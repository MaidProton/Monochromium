import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import protocol from "../shared/multiplayer-protocol.json" with { type: "json" };
import { RelayNetwork, RelayRequestError } from "./relay-network.mjs";

const PROTOCOL = protocol.protocolVersion;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeWebSocket.OPEN;
    this.bufferedAmount = 0;
    this.binaryType = "blob";
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(value) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("Socket closed.");
    this.sent.push(value);
  }

  message(value) {
    this.onmessage?.({ data: value });
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }
}

const room = Object.freeze({ roomCode: "ABCD2345", ticket: "host-ticket", expiresAt: Date.now() + 60_000 });

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

const createHarness = (fetchImpl = vi.fn(async (_url, init) =>
  init?.method === "DELETE" ? response(204, null) : response(201, room))) => {
  const statuses = [];
  const controls = [];
  const binary = [];
  const peerStatuses = [];
  const pressure = [];
  const replaced = [];
  const passiveRtt = [];
  const network = new RelayNetwork({
    onStatus: (message) => statuses.push(message),
    onControl: (message) => controls.push(message),
    onBinary: (frame) => binary.push(frame),
    onPeerStatus: (connected) => peerStatuses.push(connected),
    onStateBackpressure: (busy) => pressure.push(busy),
    onStateReplaced: () => replaced.push(true),
    onPassiveRtt: (rtt) => passiveRtt.push(rtt),
  }, {
    relayUrl: "https://relay.example",
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
    random: () => 0.5,
  });
  return { network, statuses, controls, binary, peerStatuses, pressure, replaced, passiveRtt, fetchImpl };
};

const ready = (socket, role, peerConnected) => socket.message(JSON.stringify({
  relay: { type: "ready", role, peerConnected },
}));

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RelayNetwork", () => {
  it("creates a host room and keeps its local socket when the guest disconnects", async () => {
    const { network, statuses, peerStatuses } = createHarness();
    const started = network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    ready(socket, "host", false);
    await expect(started).resolves.toEqual({ roomCode: room.roomCode });
    expect(statuses.at(-1)).toMatchObject({ status: "waiting-for-player" });

    socket.message(JSON.stringify({ relay: { type: "peer-status", connected: true } }));
    expect(network.connected).toBe(true);
    socket.message(JSON.stringify({ relay: { type: "peer-status", connected: false } }));

    expect(network.connected).toBe(false);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(peerStatuses.at(-1)).toBe(false);
    expect(statuses.at(-1)).toMatchObject({ status: "disconnected" });
    await network.stop("done");
  });

  it("reconnects a dropped guest WebSocket with the existing ticket and cancels retries on stop", async () => {
    const { network } = createHarness();
    const started = network.start({ role: "guest", roomCode: room.roomCode });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    ready(FakeWebSocket.instances[0], "guest", true);
    await started;

    FakeWebSocket.instances[0].close(1006, "network lost");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    ready(FakeWebSocket.instances[1], "guest", true);
    expect(network.connected).toBe(true);

    FakeWebSocket.instances[1].close(1006, "lost again");
    await network.stop("cancel");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("permanently abandons a dropped host room and retries by creating a fresh room", async () => {
    const { network, statuses } = createHarness();
    const started = network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    ready(FakeWebSocket.instances[0], "host", true);
    await started;

    FakeWebSocket.instances[0].close(1006, "host network lost");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses.at(-1)).toMatchObject({ status: "failed" });

    const retried = network.retryNow();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    ready(FakeWebSocket.instances[1], "host", false);
    await expect(retried).resolves.toEqual({ roomCode: room.roomCode });
    expect(statuses.at(-1)).toMatchObject({ status: "waiting-for-player" });
    await network.stop("done");
  });

  it("surfaces terminal join errors immediately", async () => {
    const fetchImpl = vi.fn(async () => response(409, {
      error: { code: "room-full", message: "This room already has a guest.", retryable: false },
    }));
    const { network, statuses } = createHarness(fetchImpl);
    await expect(network.start({ role: "guest", roomCode: room.roomCode })).rejects.toMatchObject({
      code: "room-full",
      retryable: false,
    });
    expect(statuses.at(-1)).toMatchObject({ status: "failed", detail: "This room already has a guest." });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("validates and forwards control messages received from the peer", async () => {
    const { network, controls } = createHarness();
    const started = network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    ready(socket, "host", true);
    await started;

    const message = { type: "log", message: "friend ready", tone: "good" };
    socket.message(JSON.stringify({ protocol: PROTOCOL, sessionId: room.roomCode, channel: "control", message }));
    expect(controls).toEqual([message]);
    expect(network.sendControl({ type: "log", message: "host ready" })).toBe(true);
    expect(JSON.parse(socket.sent.at(-1))).toMatchObject({ protocol: PROTOCOL, channel: "control", message: { message: "host ready" } });
    await network.stop("done");
  });

  it("measures end-to-end RTT through peer ping and pong messages", async () => {
    let clock = 100;
    const harness = createHarness();
    harness.network.now = () => clock;
    const started = harness.network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    ready(socket, "host", true);
    await started;

    const measured = harness.network.measureRtt();
    const ping = JSON.parse(socket.sent.at(-1));
    clock = 142;
    socket.message(JSON.stringify({ protocol: PROTOCOL, sessionId: room.roomCode, channel: "transport", message: { type: "pong", id: ping.message.id } }));
    await expect(measured).resolves.toBe(42);
    await harness.network.stop("done");
  });

  it("discards a replaced delta and requests a keyframe when congestion clears", async () => {
    const { network, pressure, replaced } = createHarness();
    const started = network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    ready(socket, "host", true);
    await started;
    socket.bufferedAmount = 2_000_000;

    const first = new Uint8Array([1]).buffer;
    const newest = new Uint8Array([2]).buffer;
    expect(network.sendBinary(first)).toBe(true);
    expect(network.sendBinary(newest)).toBe(true);
    expect(pressure).toContain(true);
    socket.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(25);

    const binaryFrames = socket.sent.filter((value) => value instanceof ArrayBuffer);
    expect(binaryFrames).toHaveLength(0);
    expect(replaced).toEqual([true]);
    expect(pressure.at(-1)).toBe(false);
    await network.stop("done");
  });

  it("forwards multiplexed guest pulses as latest-value realtime traffic", async () => {
    const realtime = [];
    const harness = createHarness();
    harness.network.callbacks.onRealtime = (message) => realtime.push(message);
    const started = harness.network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    ready(socket, "host", true);
    await started;

    const pulse = { type: "pulse", sequence: 7, sentAt: 123, point: { x: 12, y: 34 }, stateSequence: 9, eventId: 5 };
    socket.message(JSON.stringify({ protocol: PROTOCOL, sessionId: room.roomCode, channel: "realtime", message: pulse }));
    expect(realtime).toEqual([pulse]);
    await harness.network.stop("done");
  });

  it("derives host RTT from acknowledged state sequence traffic", async () => {
    let clock = 100;
    const harness = createHarness();
    harness.network.now = () => clock;
    const started = harness.network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    ready(socket, "host", true);
    await started;
    const frame = new ArrayBuffer(16);
    new DataView(frame).setUint32(12, 19);
    harness.network.sendBinary(frame);
    clock = 138;
    socket.message(JSON.stringify({
      protocol: PROTOCOL,
      sessionId: room.roomCode,
      channel: "realtime",
      message: { type: "pulse", sequence: 1, sentAt: 0, point: null, stateSequence: 19, eventId: 0 },
    }));
    expect(harness.passiveRtt).toEqual([38]);
    await harness.network.stop("done");
  });

  it("forwards chat control messages between connected peers", async () => {
    const harness = createHarness();
    const started = harness.network.start({ role: "host" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    ready(socket, "host", true);
    await started;

    const chat = {
      type: "chat",
      text: "Defend the core!",
      senderId: "player-1",
      senderName: "OPERATOR",
      senderColor: "#66d9ff",
      sentAt: 123456789,
    };
    expect(harness.network.sendControl(chat)).toBe(true);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({
      protocol: PROTOCOL,
      sessionId: room.roomCode,
      channel: "control",
      message: chat,
    });

    socket.message(JSON.stringify({
      protocol: PROTOCOL,
      sessionId: room.roomCode,
      channel: "control",
      message: chat,
    }));
    expect(harness.controls).toEqual([chat]);
    await harness.network.stop("done");
  });

  it("marks network failures retryable", () => {
    expect(new RelayRequestError("relay-unavailable", "offline", true)).toMatchObject({
      code: "relay-unavailable",
      retryable: true,
    });
  });
});

it("settles socket setup when stopped before relay readiness", async () => {
  const { network } = createHarness();
  const started = network.start({ role: "guest", roomCode: room.roomCode });
  const rejected = expect(started).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  await network.stop();
  await rejected;
  expect(network.connectionTimer).toBeNull();
});

it("does not restore credentials from a room request completed after stop", async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const { network } = createHarness(() => pending);
  const started = network.start({ role: "guest", roomCode: room.roomCode });
  const rejected = expect(started).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(network.role).toBe("guest"));
  await network.stop();
  complete(response(201, room));
  await rejected;
  expect(network.ticket).toBeFalsy();
  expect(network.roomCode).toBeFalsy();
  expect(FakeWebSocket.instances).toHaveLength(0);
});
