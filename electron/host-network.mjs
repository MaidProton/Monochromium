import { getRelaySockets, joinRoom } from "trystero";
import { RTCPeerConnection } from "werift";

const APP_ID = "monochromium-coop-v2";
const PROTOCOL_VERSION = 5;
const MAX_CONTROL_BYTES = 2_000_000;
const MAX_REALTIME_BYTES = 8_000_000;
const MAX_CONTROL_MESSAGES_PER_SECOND = 60;
const MAX_REALTIME_MESSAGES_PER_SECOND = 60;
const DEFAULT_STUN_SERVERS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isBoundedString = (value, maximum) => typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);

const isControlMessage = (value) => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "hello":
      return isRecord(value.player);
    case "session-start":
      return isRecord(value.session);
    case "command":
      return isRecord(value.envelope) && isBoundedString(value.envelope.commandId, 96) &&
        isBoundedString(value.envelope.playerId, 64) && Number.isSafeInteger(value.envelope.clientSequence) &&
        isRecord(value.envelope.command) && isBoundedString(value.envelope.command.type, 32);
    case "command-result":
      return isRecord(value.result);
    case "resync-request":
      return Number.isSafeInteger(value.lastSequence);
    case "event-ack":
      return Number.isSafeInteger(value.eventId);
    case "server-diagnostics":
      return isRecord(value.diagnostics);
    case "log":
      return isBoundedString(value.message, 2_000);
    case "result":
      return isRecord(value.result);
    case "end":
    case "error":
      return isBoundedString(value.reason ?? value.message, 500);
    default:
      return false;
  }
};

const isRealtimeMessage = (value) => {
  if (!isRecord(value) || value.type !== "cursor") return false;
  if (value.point === null) return true;
  return isRecord(value.point) && isFiniteNumber(value.point.x) && isFiniteNumber(value.point.y);
};

const sanitizeIceServers = (source) => {
  const servers = Array.isArray(source) ? source : [];
  const result = DEFAULT_STUN_SERVERS.map((urls) => ({ urls }));
  for (const candidate of servers.slice(0, 12)) {
    if (!isRecord(candidate)) continue;
    const urls = Array.isArray(candidate.urls)
      ? candidate.urls.filter((url) => typeof url === "string" && /^(stun|stuns|turn|turns):[^\s]+$/i.test(url)).slice(0, 8)
      : typeof candidate.urls === "string" && /^(stun|stuns|turn|turns):[^\s]+$/i.test(candidate.urls)
        ? candidate.urls
        : null;
    if (!urls) continue;
    const entry = { urls };
    if (typeof candidate.username === "string" && candidate.username.length <= 256) entry.username = candidate.username;
    if (typeof candidate.credential === "string" && candidate.credential.length <= 512) entry.credential = candidate.credential;
    result.push(entry);
  }
  return result;
};

export class HostNetwork {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.room = null;
    this.controlAction = null;
    this.realtimeAction = null;
    this.binaryAction = null;
    this.roomCode = "";
    this.remotePeerId = "";
    this.generation = 0;
    this.intentionallyClosed = true;
    this.realtimeBusy = false;
    this.binaryBusy = false;
    this.receiveWindows = new Map();
  }

  get connected() {
    return Boolean(this.room && this.remotePeerId);
  }

  get stateSendBusy() {
    return this.binaryBusy;
  }

  async start(roomCode, iceServers) {
    this.stop("Host networking restarted.");
    this.roomCode = roomCode;
    this.intentionallyClosed = false;
    const generation = ++this.generation;
    this.setStatus("creating-room", "Starting host networking in the desktop main process.");
    try {
      const room = joinRoom({
        appId: APP_ID,
        password: roomCode,
        rtcConfig: { iceServers: sanitizeIceServers(iceServers) },
        rtcPolyfill: RTCPeerConnection,
        trickleIce: true,
      }, roomCode, {
        onJoinError: (details) => {
          if (generation !== this.generation) return;
          this.setStatus("failed", `Room connection failed: ${details?.error ?? "signaling unavailable"}.`);
        },
        onPeerHandshake: async (peerId) => {
          if (generation !== this.generation) throw new Error("Stale host room.");
          if (this.remotePeerId && this.remotePeerId !== peerId) throw new Error("This room already has a player.");
        },
      });
      this.room = room;
      this.controlAction = room.makeAction("monochromium-control");
      this.realtimeAction = room.makeAction("monochromium-realtime");
      this.binaryAction = room.makeAction("monochromium-state-v5");
      this.controlAction.onMessage = (data, context) => {
        if (generation === this.generation) this.receiveAction(data, "control", context.peerId);
      };
      this.realtimeAction.onMessage = (data, context) => {
        if (generation === this.generation) this.receiveAction(data, "realtime", context.peerId);
      };
      room.onPeerJoin = (peerId) => {
        if (generation !== this.generation) return;
        if (this.remotePeerId && this.remotePeerId !== peerId) {
          void this.controlAction?.send(this.wire({ type: "error", message: "This room already has a player." }), { target: peerId });
          return;
        }
        this.remotePeerId = peerId;
        this.receiveWindows.delete(peerId);
        this.setStatus("connected", "Friend joined the room. Host networking is running outside the renderer.", peerId);
        this.callbacks.onPeerStatus?.(true);
      };
      room.onPeerLeave = (peerId) => {
        if (generation !== this.generation || peerId !== this.remotePeerId) return;
        this.remotePeerId = "";
        this.receiveWindows.delete(peerId);
        this.callbacks.onPeerStatus?.(false);
        if (!this.intentionallyClosed) this.setStatus("disconnected", "Friend disconnected. The authoritative server is still running.");
      };
      this.setStatus("waiting-for-player", "Room ready. Send the room code to your friend.");
    } catch (error) {
      if (generation !== this.generation) return;
      this.setStatus("failed", error instanceof Error ? error.message : "Could not start host networking.");
    }
  }

  stop(reason = "Host networking stopped.") {
    this.intentionallyClosed = true;
    this.generation += 1;
    const room = this.room;
    this.room = null;
    this.controlAction = null;
    this.realtimeAction = null;
    this.binaryAction = null;
    this.remotePeerId = "";
    this.receiveWindows.clear();
    this.realtimeBusy = false;
    this.binaryBusy = false;
    if (room) {
      void room.leave();
      const closeRelays = setTimeout(() => {
        Object.values(getRelaySockets()).forEach((socket) => socket?.close?.());
      }, 150);
      closeRelays.unref?.();
    }
    this.callbacks.onPeerStatus?.(false);
    if (this.roomCode) this.setStatus("closed", reason);
    this.roomCode = "";
  }

  sendControl(message) {
    if (!this.connected) return false;
    return this.sendJsonAction(this.controlAction, message, MAX_CONTROL_BYTES);
  }

  sendRealtime(message) {
    if (!this.connected) return false;
    if (this.realtimeBusy) return false;
    this.realtimeBusy = true;
    const sent = this.sendJsonAction(this.realtimeAction, message, MAX_REALTIME_BYTES);
    if (!sent) this.realtimeBusy = false;
    return sent;
  }

  sendBinary(frame) {
    if (!this.binaryAction || !this.remotePeerId || this.binaryBusy || !(frame instanceof ArrayBuffer) || frame.byteLength > MAX_REALTIME_BYTES) return false;
    this.binaryBusy = true;
    const action = this.binaryAction;
    void action.send(frame, { target: this.remotePeerId }).catch(() => {
      if (!this.intentionallyClosed) this.setStatus("disconnected", "The peer connection dropped while sending state.");
    }).finally(() => {
      this.binaryBusy = false;
    });
    return true;
  }

  async measureRtt() {
    if (!this.room || !this.remotePeerId) return null;
    try {
      return await this.room.ping(this.remotePeerId);
    } catch {
      return null;
    }
  }

  wire(message) {
    return { protocol: PROTOCOL_VERSION, sessionId: this.roomCode, message };
  }

  sendJsonAction(action, message, maximum) {
    if (!action || !this.remotePeerId) return false;
    const wire = this.wire(message);
    let bytes;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(wire)).byteLength;
    } catch {
      return false;
    }
    if (bytes > maximum) return false;
    const target = this.remotePeerId;
    void action.send(wire, { target }).catch(() => {
      if (!this.intentionallyClosed) this.setStatus("disconnected", "The peer connection dropped while sending data.");
    }).finally(() => {
      if (action === this.realtimeAction) this.realtimeBusy = false;
    });
    return true;
  }

  receiveAction(raw, kind, peerId) {
    if (peerId !== this.remotePeerId || !isRecord(raw)) return;
    let bytes;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(raw)).byteLength;
    } catch {
      return;
    }
    if (bytes > (kind === "control" ? MAX_CONTROL_BYTES : MAX_REALTIME_BYTES)) return;
    if (raw.protocol !== PROTOCOL_VERSION || raw.sessionId !== this.roomCode) return;
    const now = performance.now();
    const window = this.receiveWindows.get(peerId) ?? {
      controlStartedAt: now,
      controlCount: 0,
      realtimeStartedAt: now,
      realtimeCount: 0,
    };
    const startedAtKey = kind === "control" ? "controlStartedAt" : "realtimeStartedAt";
    const countKey = kind === "control" ? "controlCount" : "realtimeCount";
    if (now - window[startedAtKey] >= 1_000) {
      window[startedAtKey] = now;
      window[countKey] = 0;
    }
    const limit = kind === "control" ? MAX_CONTROL_MESSAGES_PER_SECOND : MAX_REALTIME_MESSAGES_PER_SECOND;
    if (window[countKey] >= limit) return;
    window[countKey] += 1;
    this.receiveWindows.set(peerId, window);
    if (kind === "control" && isControlMessage(raw.message)) this.callbacks.onControl?.(raw.message, peerId);
    if (kind === "realtime" && isRealtimeMessage(raw.message)) this.callbacks.onRealtime?.(raw.message, peerId);
  }

  setStatus(status, detail, peerId) {
    this.callbacks.onStatus?.({ type: "status", status, detail, peerId });
  }
}
