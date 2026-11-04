import protocol from "../shared/multiplayer-protocol.json" with { type: "json" };
import { configuredMultiplayerRelayUrl } from "../electron/multiplayer-config.mjs";

const PROTOCOL_VERSION = protocol.protocolVersion;
const timeoutMs = 10_000;
const relayUrl = (process.env.MONOCHROMIUM_RELAY_URL ?? process.argv[2] ?? configuredMultiplayerRelayUrl()).trim().replace(/\/+$/, "");

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${relayUrl}${path}`, init);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Relay request failed (${response.status}): ${body?.error?.message ?? "invalid response"}`);
  return { response, body };
};

class SocketInbox {
  #messages = [];
  #waiters = [];

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      let value = event.data;
      if (typeof value === "string") {
        try { value = JSON.parse(value); } catch { /* Application payloads can be arbitrary validated strings. */ }
      }
      const index = this.#waiters.findIndex((waiter) => waiter.predicate(value));
      if (index < 0) this.#messages.push(value);
      else this.#waiters.splice(index, 1)[0].finish(null, value);
    });
    socket.addEventListener("close", (event) => {
      this.#waiters.splice(0).forEach((waiter) => waiter.finish(new Error(`Relay WebSocket closed unexpectedly (${event.code}).`)));
    });
    socket.addEventListener("error", () => {
      this.#waiters.splice(0).forEach((waiter) => waiter.finish(new Error("Relay WebSocket failed.")));
    });
  }

  waitFor(predicate) {
    const index = this.#messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.#messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        finish: (error, value) => {
          clearTimeout(timer);
          const pendingIndex = this.#waiters.indexOf(waiter);
          if (pendingIndex >= 0) this.#waiters.splice(pendingIndex, 1);
          if (error) reject(error);
          else resolve(value);
        },
      };
      const timer = setTimeout(() => waiter.finish(new Error("Timed out waiting for the relay WebSocket.")), timeoutMs);
      this.#waiters.push(waiter);
    });
  }
}

const connect = (credentials) => new Promise((resolve, reject) => {
  const socketUrl = new URL(`${relayUrl}/v1/rooms/${credentials.roomCode}/socket`);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(socketUrl, [`monochromium-v${PROTOCOL_VERSION}`, `ticket.${credentials.ticket}`]);
  socket.binaryType = "arraybuffer";
  const inbox = new SocketInbox(socket);
  const timer = setTimeout(() => finish(reject, new Error("Timed out connecting to the relay WebSocket.")), timeoutMs);
  const onOpen = () => finish(resolve, inbox);
  const onError = () => finish(reject, new Error("Could not connect to the relay WebSocket."));
  const finish = (callback, value) => {
    clearTimeout(timer);
    socket.removeEventListener("open", onOpen);
    socket.removeEventListener("error", onError);
    callback(value);
  };
  socket.addEventListener("open", onOpen);
  socket.addEventListener("error", onError);
});

const relayMessage = (type) => (value) => value?.relay?.type === type;
const applicationEnvelope = (sessionId, channel, message) => JSON.stringify({
  protocol: PROTOCOL_VERSION,
  sessionId,
  channel,
  message,
});

let hostInbox;
let guestInbox;
let room;
let replacementHostInbox;
let replacementRoom;

try {
  const health = await requestJson("/health");
  if (health.body?.protocol !== PROTOCOL_VERSION) throw new Error("The deployed relay uses an incompatible protocol.");

  room = (await requestJson("/v1/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocol: PROTOCOL_VERSION }),
  })).body;
  hostInbox = await connect(room);
  await hostInbox.waitFor(relayMessage("ready"));

  const guest = (await requestJson(`/v1/rooms/${room.roomCode}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocol: PROTOCOL_VERSION }),
  })).body;
  guestInbox = await connect(guest);
  await Promise.all([
    guestInbox.waitFor(relayMessage("ready")),
    hostInbox.waitFor((value) => value?.relay?.type === "peer-status" && value.relay.connected === true),
  ]);

  const control = applicationEnvelope(room.roomCode, "control", { type: "log", message: "relay-smoke" });
  const hostControl = hostInbox.waitFor((value) => value?.message?.message === "relay-smoke");
  guestInbox.socket.send(control);
  await hostControl;

  const binary = new Uint8Array([9, 4, 2, 1]);
  const guestBinary = guestInbox.waitFor((value) => value instanceof ArrayBuffer && new Uint8Array(value).join(",") === binary.join(","));
  hostInbox.socket.send(binary);
  await guestBinary;

  guestInbox.socket.close(1000, "Guest reconnect check.");
  await hostInbox.waitFor((value) => value?.relay?.type === "peer-status" && value.relay.connected === false);
  guestInbox = await connect(guest);
  await Promise.all([
    guestInbox.waitFor(relayMessage("ready")),
    hostInbox.waitFor((value) => value?.relay?.type === "peer-status" && value.relay.connected === true),
  ]);

  const closedRoomCode = room.roomCode;
  const deleted = await fetch(`${relayUrl}/v1/rooms/${room.roomCode}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${room.ticket}` },
  });
  if (deleted.status !== 204) throw new Error(`Relay room cleanup failed (${deleted.status}).`);
  room = null;

  const staleJoin = await fetch(`${relayUrl}/v1/rooms/${closedRoomCode}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocol: PROTOCOL_VERSION }),
  });
  if (staleJoin.status !== 404) throw new Error(`Closed room remained available (${staleJoin.status}).`);

  replacementRoom = (await requestJson("/v1/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocol: PROTOCOL_VERSION }),
  })).body;
  if (replacementRoom.roomCode === closedRoomCode) throw new Error("Replacement room reused the closed room code.");
  replacementHostInbox = await connect(replacementRoom);
  await replacementHostInbox.waitFor(relayMessage("ready"));
  const replacementDeleted = await fetch(`${relayUrl}/v1/rooms/${replacementRoom.roomCode}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${replacementRoom.ticket}` },
  });
  if (replacementDeleted.status !== 204) throw new Error(`Replacement room cleanup failed (${replacementDeleted.status}).`);
  replacementRoom = null;
  console.log("Relay smoke passed: forwarding, guest reconnect, permanent host close, fresh replacement room, and cleanup.");
} finally {
  try { replacementHostInbox?.socket.close(1000, "Smoke complete."); } catch { /* Already closed. */ }
  try { guestInbox?.socket.close(1000, "Smoke complete."); } catch { /* Already closed. */ }
  try { hostInbox?.socket.close(1000, "Smoke complete."); } catch { /* Already closed. */ }
  if (replacementRoom) {
    await fetch(`${relayUrl}/v1/rooms/${replacementRoom.roomCode}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${replacementRoom.ticket}` },
    }).catch(() => undefined);
  }
  if (room) {
    await fetch(`${relayUrl}/v1/rooms/${room.roomCode}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${room.ticket}` },
    }).catch(() => undefined);
  }
}
