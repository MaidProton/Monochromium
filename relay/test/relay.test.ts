import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import protocol from "../../shared/multiplayer-protocol.json";

const PROTOCOL = protocol.protocolVersion;
const sockets: WebSocket[] = [];

interface RoomCredentials {
  readonly roomCode: string;
  readonly ticket: string;
  readonly expiresAt: number;
}

class SocketInbox {
  private readonly messages: Array<string | ArrayBuffer | Blob> = [];
  private readonly waiters: Array<(message: string | ArrayBuffer | Blob) => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const value = event.data as string | ArrayBuffer | Blob;
      const waiter = this.waiters.shift();
      if (waiter) waiter(value);
      else this.messages.push(value);
    });
  }

  async next(timeoutMs = 1_000): Promise<string | ArrayBuffer | Blob> {
    const queued = this.messages.shift();
    if (queued !== undefined) return queued;
    return await new Promise<string | ArrayBuffer | Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message.")), timeoutMs);
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  async nextRelay(type: string): Promise<Record<string, unknown>> {
    for (;;) {
      const message = await this.next();
      if (typeof message !== "string") continue;
      const parsed = JSON.parse(message) as { relay?: Record<string, unknown> };
      if (parsed.relay?.["type"] === type) return parsed.relay;
    }
  }
}

const postJson = (path: string, body: unknown): Promise<Response> => SELF.fetch(`https://relay.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const createRoom = async (): Promise<RoomCredentials> => {
  const response = await postJson("/v1/rooms", { protocol: PROTOCOL });
  expect(response.status).toBe(201);
  return await response.json<RoomCredentials>();
};

const joinRoom = async (roomCode: string, protocol = PROTOCOL): Promise<Response> =>
  postJson(`/v1/rooms/${roomCode}/join`, { protocol });

const connect = async (credentials: Pick<RoomCredentials, "roomCode" | "ticket">): Promise<SocketInbox> => {
  const response = await SELF.fetch(`https://relay.test/v1/rooms/${credentials.roomCode}/socket`, {
    headers: {
      upgrade: "websocket",
      "sec-websocket-protocol": `monochromium-v${PROTOCOL}, ticket.${credentials.ticket}`,
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).not.toBeNull();
  socket!.accept();
  sockets.push(socket!);
  return new SocketInbox(socket!);
};

const connectedPair = async (): Promise<{
  room: RoomCredentials;
  guest: RoomCredentials;
  hostInbox: SocketInbox;
  guestInbox: SocketInbox;
}> => {
  const room = await createRoom();
  const hostInbox = await connect(room);
  expect(await hostInbox.nextRelay("ready")).toMatchObject({ role: "host", peerConnected: false });
  const joinResponse = await joinRoom(room.roomCode);
  expect(joinResponse.status).toBe(200);
  const guest = await joinResponse.json<RoomCredentials>();
  const guestInbox = await connect(guest);
  expect(await guestInbox.nextRelay("ready")).toMatchObject({ role: "guest", peerConnected: true });
  expect(await hostInbox.nextRelay("peer-status")).toMatchObject({ connected: true });
  return { room, guest, hostInbox, guestInbox };
};

const envelope = (sessionId: string, channel: "control" | "realtime" | "transport", message: unknown): string => JSON.stringify({
  protocol: PROTOCOL,
  sessionId,
  channel,
  message,
});

afterEach(async () => {
  const active = sockets.splice(0).filter((socket) => socket.readyState < WebSocket.CLOSING);
  await Promise.all(active.map((socket) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 100);
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    try { socket.close(1000, "Test complete."); } catch { clearTimeout(timer); resolve(); }
  })));
});

describe("multiplayer relay API", () => {
  it("reports health and rejects incompatible clients", async () => {
    const health = await SELF.fetch("https://relay.test/health");
    expect(await health.json()).toEqual({ ok: true, service: "monochromium-multiplayer-relay", protocol: PROTOCOL });

    const response = await postJson("/v1/rooms", { protocol: 8 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "protocol-mismatch", retryable: false } });

    const room = await createRoom();
    const socketMismatch = await SELF.fetch(`https://relay.test/v1/rooms/${room.roomCode}/socket`, {
      headers: {
        upgrade: "websocket",
        "sec-websocket-protocol": `monochromium-v8, ticket.${room.ticket}`,
      },
    });
    expect(socketMismatch.status).toBe(409);
    expect(await socketMismatch.json()).toMatchObject({ error: { code: "protocol-mismatch", retryable: false } });
  });

  it("admits one authenticated host and guest and rejects a third player", async () => {
    const { room } = await connectedPair();
    const extra = await joinRoom(room.roomCode);
    expect(extra.status).toBe(409);
    expect(await extra.json()).toMatchObject({ error: { code: "room-full" } });

    const badSocket = await SELF.fetch(`https://relay.test/v1/rooms/${room.roomCode}/socket`, {
      headers: { upgrade: "websocket", "sec-websocket-protocol": `monochromium-v${PROTOCOL}, ticket.invalid` },
    });
    expect(badSocket.status).toBe(401);

    const duplicateHost = await SELF.fetch(`https://relay.test/v1/rooms/${room.roomCode}/socket`, {
      headers: {
        upgrade: "websocket",
        "sec-websocket-protocol": `monochromium-v${PROTOCOL}, ticket.${room.ticket}`,
      },
    });
    expect(duplicateHost.status).toBe(409);
    expect(await duplicateHost.json()).toMatchObject({ error: { code: "host-reconnect-forbidden" } });
  });

  it("forwards validated control and binary state without echoing to the sender", async () => {
    const { room, hostInbox, guestInbox } = await connectedPair();
    const control = envelope(room.roomCode, "control", { type: "hello", player: { username: "FRIEND" } });
    guestInbox.socket.send(control);
    expect(await hostInbox.next()).toBe(control);

    const state = new Uint8Array([9, 8, 7, 6]).buffer;
    hostInbox.socket.send(state);
    const received = await guestInbox.next();
    const receivedBuffer = received instanceof Blob ? await received.arrayBuffer() : received;
    expect(receivedBuffer).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(receivedBuffer as ArrayBuffer)]).toEqual([9, 8, 7, 6]);
  });

  it("restores authenticated sockets across Durable Object eviction", async () => {
    const { room, hostInbox, guestInbox } = await connectedPair();
    const stub = env.ROOMS.getByName(room.roomCode);
    await evictDurableObject(stub);

    const control = envelope(room.roomCode, "realtime", { type: "cursor", point: null });
    guestInbox.socket.send(control);
    expect(await hostInbox.next()).toBe(control);
  });

  it("lets the reserved guest reconnect with the existing ticket", async () => {
    const { room, guest, hostInbox, guestInbox } = await connectedPair();
    guestInbox.socket.close(1000, "Reconnect test.");
    expect(await hostInbox.nextRelay("peer-status")).toMatchObject({ connected: false });

    const replacement = await connect(guest);
    expect(await replacement.nextRelay("ready")).toMatchObject({ role: "guest", peerConnected: true });
    expect(await hostInbox.nextRelay("peer-status")).toMatchObject({ connected: true });

    replacement.socket.send(envelope(room.roomCode, "control", { type: "log", message: "back" }));
    expect(await hostInbox.next()).toContain("\"back\"");
  });

  it("permanently invalidates the room and both tickets when the host disconnects", async () => {
    const { room, hostInbox, guestInbox } = await connectedPair();
    const guestClosed = new Promise<CloseEvent>((resolve) => guestInbox.socket.addEventListener("close", resolve, { once: true }));
    hostInbox.socket.close(1000, "Host offline.");
    expect((await guestClosed).code).toBe(4002);

    const join = await joinRoom(room.roomCode);
    expect(join.status).toBe(404);

    const hostReconnect = await SELF.fetch(`https://relay.test/v1/rooms/${room.roomCode}/socket`, {
      headers: {
        upgrade: "websocket",
        "sec-websocket-protocol": `monochromium-v${PROTOCOL}, ticket.${room.ticket}`,
      },
    });
    expect(hostReconnect.status).toBe(404);
  });

  it("requires the host ticket to close a room and disconnects both clients", async () => {
    const { room, guest } = await connectedPair();
    const denied = await SELF.fetch(`https://relay.test/v1/rooms/${room.roomCode}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${guest.ticket}` },
    });
    expect(denied.status).toBe(403);

    const closed = await SELF.fetch(`https://relay.test/v1/rooms/${room.roomCode}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${room.ticket}` },
    });
    expect(closed.status).toBe(204);
    const rejoin = await joinRoom(room.roomCode);
    expect(rejoin.status).toBe(404);
  });

  it("expires stored room state when its alarm fires", async () => {
    const room = await createRoom();
    const stub = env.ROOMS.getByName(room.roomCode);
    await runInDurableObject(stub, async (_instance, state) => {
      const record = await state.storage.get<Record<string, unknown>>("room");
      await state.storage.put("room", { ...record, expiresAt: Date.now() - 1 });
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const join = await joinRoom(room.roomCode);
    expect(join.status).toBe(404);
  });

  it("closes clients that send invalid, oversized, or excessive traffic", async () => {
    const first = await connectedPair();
    const invalidClose = new Promise<CloseEvent>((resolve) => first.guestInbox.socket.addEventListener("close", resolve, { once: true }));
    first.guestInbox.socket.send("not-json");
    expect((await invalidClose).code).toBe(1008);

    const second = await connectedPair();
    const oversizedClose = new Promise<CloseEvent>((resolve) => second.hostInbox.socket.addEventListener("close", resolve, { once: true }));
    second.hostInbox.socket.send(new Uint8Array(8 * 1024 * 1024 + 1).buffer);
    expect((await oversizedClose).code).toBe(1009);

    const third = await connectedPair();
    const rateClose = new Promise<CloseEvent>((resolve) => third.guestInbox.socket.addEventListener("close", resolve, { once: true }));
    const message = envelope(third.room.roomCode, "realtime", { type: "cursor", point: null });
    for (let index = 0; index < 121; index += 1) third.guestInbox.socket.send(message);
    expect((await rateClose).code).toBe(1008);
  });
});
