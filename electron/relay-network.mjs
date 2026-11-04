// Keep this aligned with the deployed relay and the renderer protocol.
import protocol from "../shared/multiplayer-protocol.json" with { type: "json" };

const PROTOCOL_VERSION = protocol.protocolVersion;
const MAX_CONTROL_BYTES = 2_000_000;
const MAX_REALTIME_BYTES = 8 * 1024 * 1024;
const MAX_BINARY_BYTES = 8 * 1024 * 1024;
const BACKPRESSURE_BYTES = 1_000_000;
const SOCKET_CONNECT_TIMEOUT_MS = 10_000;
const PEER_PING_TIMEOUT_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 10_000];

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isBoundedString = (value, maximum) => typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);

const isControlMessage = (value) => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "hello":
      return isRecord(value.player);
    case "lobby-state":
      return isRecord(value.state);
    case "lobby-ready":
      return Number.isSafeInteger(value.round) && isRecord(value.player) && typeof value.ready === "boolean";
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
    case "server-diagnostics":
      return isRecord(value.diagnostics);
    case "log":
      return isBoundedString(value.message, 2_000);
    case "chat":
      return isBoundedString(value.text, 256) &&
        isBoundedString(value.senderId, 64) &&
        isBoundedString(value.senderName, 20) &&
        typeof value.senderColor === "string" && value.senderColor.length <= 32 &&
        Number.isFinite(value.sentAt);
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
  if (!isRecord(value) || (value.type !== "cursor" && value.type !== "pulse" && value.type !== "pilot-input")) return false;
  const validPoint = value.point === null || (isRecord(value.point) && isFiniteNumber(value.point.x) && isFiniteNumber(value.point.y));
  if (value.type === "pilot-input") {
    const validAim = isRecord(value.aim) && isFiniteNumber(value.aim.x) && isFiniteNumber(value.aim.y);
    return isBoundedString(value.playerId, 64) && Number.isSafeInteger(value.towerId) && Number.isSafeInteger(value.sequence) &&
      [-1, 0, 1].includes(value.moveX) && [-1, 0, 1].includes(value.moveY) && validAim && typeof value.firing === "boolean" &&
      (value.brake === undefined || typeof value.brake === "boolean");
  }
  if (!validPoint) return false;
  return value.type === "cursor" || (Number.isSafeInteger(value.sequence) && isFiniteNumber(value.sentAt) &&
    Number.isSafeInteger(value.stateSequence) && Number.isSafeInteger(value.eventId));
};

const byteLength = (value) => new TextEncoder().encode(value).byteLength;
const normalizeRoomCode = (value) => String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
const validRoomCode = (value) => /^[A-HJ-NP-Z2-9]{8}$/.test(normalizeRoomCode(value));
const wait = (setTimeoutImpl, timeoutMs) => new Promise((resolve) => setTimeoutImpl(resolve, timeoutMs));

export class RelayRequestError extends Error {
  constructor(code, message, retryable = false, status = 0) {
    super(message);
    this.name = "RelayRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export class RelayNetwork {
  constructor(callbacks, options = {}) {
    this.callbacks = callbacks;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    this.relayUrl = String(options.relayUrl ?? "").replace(/\/+$/g, "");
    this.setTimeoutImpl = options.setTimeoutImpl ?? globalThis.setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? globalThis.clearTimeout;
    this.setIntervalImpl = options.setIntervalImpl ?? globalThis.setInterval;
    this.clearIntervalImpl = options.clearIntervalImpl ?? globalThis.clearInterval;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => performance.now());
    this.socket = null;
    this.role = null;
    this.roomCode = "";
    this.ticket = "";
    this.expiresAt = 0;
    this.requestedConfig = null;
    this.peerConnected = false;
    this.peerResponsive = false;
    this.intentionallyClosed = true;
    this.hasConnectedOnce = false;
    this.generation = 0;
    this.retryAttempt = 0;
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.heartbeatTimer = null;
    this.flushTimer = null;
    this.pendingBinaryFrame = null;
    this.replacementNotified = false;
    this.stateBackpressure = false;
    this.pendingPings = new Map();
    this.sentStateAt = new Map();
    this.rttFailureCount = 0;
    this.lastFailureRetryable = false;
    this.lastTrafficAt = this.now();
  }

  get connected() {
    return Boolean(this.socket && this.socket.readyState === this.WebSocketImpl.OPEN && this.peerConnected && this.peerResponsive);
  }

  get stateSendBusy() {
    return this.stateBackpressure;
  }

  peerId() {
    return this.role === "host" ? "relay-guest" : "relay-host";
  }

  setStatus(status, detail, peerId) {
    this.callbacks.onStatus?.({ type: "status", status, detail, peerId });
  }

  setStateBackpressure(busy) {
    if (this.stateBackpressure === busy) return;
    this.stateBackpressure = busy;
    this.callbacks.onStateBackpressure?.(busy);
  }

  apiUrl(path) {
    return `${this.relayUrl}${path}`;
  }

  websocketUrl() {
    const url = new URL(this.apiUrl(`/v1/rooms/${this.roomCode}/socket`));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  async request(path, init) {
    let response;
    try {
      response = await this.fetchImpl(this.apiUrl(path), init);
    } catch {
      throw new RelayRequestError("relay-unavailable", "The multiplayer service is unavailable. Check your connection and try again.", true);
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* A successful delete has no body. */ }
    if (response.ok) return payload;
    const error = isRecord(payload?.error) ? payload.error : {};
    throw new RelayRequestError(
      typeof error.code === "string" ? error.code : "relay-error",
      typeof error.message === "string" ? error.message : `The multiplayer service returned HTTP ${response.status}.`,
      Boolean(error.retryable),
      response.status,
    );
  }

  async start(config) {
    if (!isRecord(config) || (config.role !== "host" && config.role !== "guest")) throw new Error("Invalid multiplayer role.");
    if (!this.relayUrl || !this.fetchImpl || !this.WebSocketImpl) throw new Error("The multiplayer relay is not available in this desktop build.");
    if (config.role === "guest" && !validRoomCode(config.roomCode)) throw new Error("Room codes are 8 letters/numbers. Check the code and try again.");
    await this.stop("Multiplayer networking restarted.", true);
    const operationGeneration = this.generation;
    this.requestedConfig = { role: config.role, roomCode: config.role === "guest" ? normalizeRoomCode(config.roomCode) : "" };
    this.role = config.role;
    this.intentionallyClosed = false;
    this.lastFailureRetryable = false;
    this.setStatus(config.role === "host" ? "creating-room" : "joining-room", "Contacting the secure multiplayer relayÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦");
    try {
      const path = config.role === "host" ? "/v1/rooms" : `/v1/rooms/${this.requestedConfig.roomCode}/join`;
      const payload = await this.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocol: PROTOCOL_VERSION }),
      });
      if (operationGeneration !== this.generation || this.intentionallyClosed) throw new RelayRequestError("connection-closed", "Connection cancelled.", false);
      if (!isRecord(payload) || !validRoomCode(payload.roomCode) || typeof payload.ticket !== "string") {
        throw new RelayRequestError("relay-error", "The multiplayer service returned an invalid room.", true);
      }
      this.roomCode = normalizeRoomCode(payload.roomCode);
      this.ticket = payload.ticket;
      this.expiresAt = typeof payload.expiresAt === "number" ? payload.expiresAt : 0;
      await this.openSocket(true);
      return { roomCode: this.roomCode };
    } catch (error) {
      if (!this.intentionallyClosed && operationGeneration === this.generation) this.handleStartFailure(error);
      throw error;
    }
  }

  handleStartFailure(error) {
    const relayError = error instanceof RelayRequestError ? error : new RelayRequestError("connection-failed", error instanceof Error ? error.message : "Could not connect to the multiplayer service.", true);
    this.lastFailureRetryable = relayError.retryable || Boolean(this.ticket);
    const details = {
      "room-not-found": "Room not found. Check the code with your friend.",
      "host-offline": "The host is not online. Ask them to create the room again.",
      "room-full": "This room already has a guest.",
      "protocol-mismatch": `The two game versions are incompatible. Both players need multiplayer protocol ${PROTOCOL_VERSION}.`,
      "room-expired": "This room expired. Ask the host for a new code.",
    };
    this.setStatus("failed", details[relayError.code] ?? relayError.message);
  }

  async openSocket(initial = false) {
    if (this.intentionallyClosed || !this.role || !this.roomCode || !this.ticket) throw new Error("No relay room is available.");
    this.cancelReconnect();
    this.clearConnectionTimer();
    const generation = ++this.generation;
    const socket = new this.WebSocketImpl(this.websocketUrl(), [`monochromium-v${PROTOCOL_VERSION}`, `ticket.${this.ticket}`]);
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    this.setStatus("connecting", initial ? "Opening the secure room connectionÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦" : "Reconnecting to the multiplayer relayÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦");

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        this.clearConnectionTimer();
        if (this.cancelSocketOpen === cancel) this.cancelSocketOpen = null;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => finish(new RelayRequestError("connection-closed", "Connection cancelled.", false));
      this.cancelSocketOpen = cancel;
      this.connectionTimer = this.setTimeoutImpl(() => {
        this.connectionTimer = null;
        if (this.socket === socket && generation === this.generation) {
          try { socket.close(4003, "Connection timed out."); } catch { /* Closed concurrently. */ }
          finish(new RelayRequestError("connection-timeout", "The multiplayer service did not respond in time.", true));
        }
      }, SOCKET_CONNECT_TIMEOUT_MS);
      socket.onmessage = (event) => { void this.handleSocketMessage(socket, generation, event.data, () => finish()); };
      socket.onerror = () => {
        if (!this.hasConnectedOnce) finish(new RelayRequestError("connection-failed", "Could not open the secure room connection.", true));
      };
      socket.onclose = (event) => {
        if (this.socket === socket) this.socket = null;
        if (generation !== this.generation) return;
        finish(new RelayRequestError("connection-closed", event.reason || "The secure room connection closed.", ![4000, 4001, 4002, 4004, 1008].includes(event.code)));
        this.handleSocketClose(event);
      };
    });
  }

  async handleSocketMessage(socket, generation, raw, ready) {
    if (socket !== this.socket || generation !== this.generation) return;
    this.lastTrafficAt = this.now();
    if (raw instanceof Blob) raw = await raw.arrayBuffer();
    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      if (this.role !== "guest") return;
      const frame = raw instanceof ArrayBuffer
        ? raw
        : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer;
      if (frame.byteLength <= MAX_BINARY_BYTES) this.callbacks.onBinary?.(frame, this.peerId());
      return;
    }
    if (typeof raw !== "string" || byteLength(raw) > MAX_REALTIME_BYTES) return;
    let envelope;
    try { envelope = JSON.parse(raw); } catch { return; }
    if (isRecord(envelope?.relay)) {
      const relay = envelope.relay;
      if (relay.type === "ready" && relay.role === this.role) {
        this.hasConnectedOnce = true;
        this.retryAttempt = 0;
        this.peerConnected = Boolean(relay.peerConnected);
        this.peerResponsive = this.peerConnected;
        this.rttFailureCount = 0;
        this.startHeartbeat();
        if (this.peerConnected) {
          this.setStatus("connected", "Connected through the secure multiplayer relay.", this.peerId());
          this.callbacks.onPeerStatus?.(true);
        } else {
          this.setStatus(this.role === "host" ? "waiting-for-player" : "disconnected", this.role === "host" ? "Room ready. Send the code to your friend." : "Connected to the room. Waiting for the hostÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦");
        }
        ready();
      } else if (relay.type === "peer-status" && typeof relay.connected === "boolean") {
        this.peerConnected = relay.connected;
        this.peerResponsive = relay.connected;
        if (!relay.connected) this.sentStateAt.clear();
        this.callbacks.onPeerStatus?.(relay.connected);
        if (relay.connected) {
          this.rttFailureCount = 0;
          this.setStatus("connected", "Your friend joined the room.", this.peerId());
        } else {
          this.rejectPendingPings();
          this.setStatus("disconnected", this.role === "host"
            ? "Friend disconnected. The room and simulation are still running."
            : "The host left. This room is closingÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦");
        }
      }
      return;
    }
    if (!isRecord(envelope) || envelope.protocol !== PROTOCOL_VERSION || envelope.sessionId !== this.roomCode || !isRecord(envelope.message)) return;
    if (envelope.channel === "transport") this.handleTransport(envelope.message);
    else if (envelope.channel === "control" && isControlMessage(envelope.message)) this.callbacks.onControl?.(envelope.message, this.peerId());
    else if (envelope.channel === "realtime" && isRealtimeMessage(envelope.message)) {
      if (this.role === "host" && envelope.message.type === "pulse") {
        const sentAt = this.sentStateAt.get(envelope.message.stateSequence);
        if (sentAt !== undefined) this.callbacks.onPassiveRtt?.(Math.max(0, this.now() - sentAt));
        for (const sequence of this.sentStateAt.keys()) if (sequence <= envelope.message.stateSequence) this.sentStateAt.delete(sequence);
      }
      this.callbacks.onRealtime?.(envelope.message, this.peerId());
    }
  }

  handleSocketClose(event) {
    this.stopHeartbeat();
    this.peerConnected = false;
    this.peerResponsive = false;
    this.setStateBackpressure(false);
    this.pendingBinaryFrame = null;
    this.replacementNotified = false;
    this.sentStateAt.clear();
    this.rejectPendingPings();
    this.callbacks.onPeerStatus?.(false);
    if (this.intentionallyClosed) return;
    if ([4000, 4001, 4002, 4004, 1008].includes(event.code)) {
      const detail = event.code === 4000 ? "The host closed the room."
        : event.code === 4001 ? "This room was opened by another connection."
          : event.code === 4002 ? "The host left and permanently closed this room."
            : event.code === 4004 ? "The room expired."
              : "The relay rejected invalid multiplayer traffic.";
      this.lastFailureRetryable = false;
      this.setStatus("failed", detail);
      return;
    }
    if (this.hasConnectedOnce && this.role === "host") {
      this.lastFailureRetryable = true;
      this.setStatus("failed", "The host relay connection was lost, so the old room was permanently closed. Retry to create a fresh room.");
      return;
    }
    if (this.hasConnectedOnce) this.scheduleReconnect(event.reason || "The relay connection dropped.");
  }

  scheduleReconnect(detail) {
    if (this.intentionallyClosed || this.role !== "guest" || !this.ticket || this.reconnectTimer !== null) return;
    const index = Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1);
    const base = RETRY_DELAYS_MS[index];
    this.retryAttempt += 1;
    const delay = Math.round(base * (0.85 + this.random() * 0.3));
    this.lastFailureRetryable = true;
    this.setStatus("connecting", `${detail} Retrying in ${Math.max(1, Math.ceil(delay / 1_000))}sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦`);
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      if (!this.intentionallyClosed && this.ticket) void this.openSocket().catch((error) => {
        if (!this.intentionallyClosed) this.scheduleReconnect(error instanceof Error ? error.message : "Reconnect failed.");
      });
    }, delay);
    this.reconnectTimer?.unref?.();
  }

  async retryNow() {
    if (this.intentionallyClosed) throw new Error("No multiplayer connection is active.");
    this.cancelReconnect();
    if (this.role === "host") {
      return await this.start({ role: "host" });
    }
    if (this.ticket && this.role === "guest") {
      try {
        await this.openSocket();
        return { roomCode: this.roomCode };
      } catch (error) {
        if (!this.intentionallyClosed && operationGeneration === this.generation) this.handleStartFailure(error);
        throw error;
      }
    }
    if (!this.requestedConfig) throw new Error("No multiplayer connection can be retried.");
    return await this.start(this.requestedConfig);
  }

  sendEnvelope(channel, message, maximum) {
    if (!this.connected || !this.socket) return false;
    const encoded = JSON.stringify({ protocol: PROTOCOL_VERSION, sessionId: this.roomCode, channel, message });
    if (byteLength(encoded) > maximum) return false;
    try {
      this.socket.send(encoded);
      this.lastTrafficAt = this.now();
      return true;
    } catch {
      try { this.socket.close(1011, "Send failed."); } catch { /* Already closed. */ }
      return false;
    }
  }

  sendControl(message) {
    return isControlMessage(message) && this.sendEnvelope("control", message, MAX_CONTROL_BYTES);
  }

  sendRealtime(message) {
    if (!isRealtimeMessage(message) || !this.socket || this.socket.bufferedAmount > BACKPRESSURE_BYTES) return false;
    return this.sendEnvelope("realtime", message, MAX_REALTIME_BYTES);
  }

  sendBinary(frame) {
    if (this.role !== "host" || !this.connected || !this.socket || !(frame instanceof ArrayBuffer) || frame.byteLength > MAX_BINARY_BYTES) return false;
    if (this.socket.bufferedAmount > BACKPRESSURE_BYTES || this.stateBackpressure) {
      if (this.pendingBinaryFrame && !this.replacementNotified) {
        this.replacementNotified = true;
      }
      this.pendingBinaryFrame = frame;
      this.setStateBackpressure(true);
      this.scheduleBinaryFlush();
      return true;
    }
    try {
      this.socket.send(frame);
      this.lastTrafficAt = this.now();
      if (frame.byteLength >= 16) {
        const sequence = new DataView(frame).getUint32(12);
        this.sentStateAt.set(sequence, this.lastTrafficAt);
        while (this.sentStateAt.size > 128) this.sentStateAt.delete(this.sentStateAt.keys().next().value);
      }
      this.callbacks.onStateSent?.(frame.byteLength);
      if (this.socket.bufferedAmount > BACKPRESSURE_BYTES) {
        this.setStateBackpressure(true);
        this.scheduleBinaryFlush();
      }
      return true;
    } catch {
      try { this.socket.close(1011, "State send failed."); } catch { /* Already closed. */ }
      return false;
    }
  }

  scheduleBinaryFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = this.setTimeoutImpl(() => {
      this.flushTimer = null;
      if (!this.socket || !this.connected) {
        this.pendingBinaryFrame = null;
        this.replacementNotified = false;
        this.setStateBackpressure(false);
        return;
      }
      if (this.socket.bufferedAmount > BACKPRESSURE_BYTES) {
        this.scheduleBinaryFlush();
        return;
      }
      const frame = this.pendingBinaryFrame;
      const frameWasReplaced = this.replacementNotified;
      this.pendingBinaryFrame = null;
      this.replacementNotified = false;
      this.setStateBackpressure(false);
      // A replacement means the newest delta may depend on a frame that never
      // reached the socket. Discard it and have the authority generate a fresh
      // keyframe against an accepted baseline instead of sending a known gap.
      if (frameWasReplaced) this.callbacks.onStateReplaced?.();
      else if (frame) this.sendBinary(frame);
    }, 25);
    this.flushTimer?.unref?.();
  }

  handleTransport(message) {
    if (message.type === "ping" && isBoundedString(message.id, 96)) {
      this.sendEnvelope("transport", { type: "pong", id: message.id }, 1_024);
    } else if (message.type === "pong" && isBoundedString(message.id, 96)) {
      const pending = this.pendingPings.get(message.id);
      if (pending) {
        this.pendingPings.delete(message.id);
        this.clearTimeoutImpl(pending.timer);
        pending.resolve(Math.max(0, this.now() - pending.startedAt));
      }
    }
  }

  async measureRtt() {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN || !this.peerConnected) return null;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${this.random().toString(36).slice(2)}`;
    return await new Promise((resolve) => {
      const timer = this.setTimeoutImpl(() => {
        this.pendingPings.delete(id);
        resolve(null);
      }, PEER_PING_TIMEOUT_MS);
      this.pendingPings.set(id, { resolve, timer, startedAt: this.now() });
      if (!this.sendEnvelope("transport", { type: "ping", id }, 1_024)) {
        this.pendingPings.delete(id);
        this.clearTimeoutImpl(timer);
        resolve(null);
      }
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = this.setIntervalImpl(() => {
      if (!this.peerConnected) return;
      if (this.now() - this.lastTrafficAt < HEARTBEAT_INTERVAL_MS) {
        this.peerResponsive = true;
        this.rttFailureCount = 0;
        return;
      }
      void this.measureRtt().then((rtt) => {
        if (rtt !== null) {
          const restored = !this.peerResponsive;
          this.peerResponsive = true;
          this.rttFailureCount = 0;
          if (restored) {
            this.callbacks.onPeerStatus?.(true);
            this.setStatus("connected", "Your friend is responding again.", this.peerId());
          }
          return;
        }
        this.rttFailureCount += 1;
        if (this.rttFailureCount >= 2 && this.socket) {
          if (this.role === "guest") {
            try { this.socket.close(4003, "Host stopped responding."); } catch { /* Already closed. */ }
          } else if (this.peerResponsive) {
            this.peerResponsive = false;
            this.callbacks.onPeerStatus?.(false);
            this.setStatus("disconnected", "Friend stopped responding. The room and simulation are still running.");
          }
        }
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer?.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      this.clearIntervalImpl(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  rejectPendingPings() {
    this.pendingPings.forEach(({ resolve, timer }) => {
      this.clearTimeoutImpl(timer);
      resolve(null);
    });
    this.pendingPings.clear();
  }

  cancelReconnect() {
    if (this.reconnectTimer !== null) {
      this.clearTimeoutImpl(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  clearConnectionTimer() {
    if (this.connectionTimer !== null) {
      this.clearTimeoutImpl(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  async stop(reason = "Multiplayer networking stopped.", restarting = false) {
    const wasActive = Boolean(this.role || this.roomCode || this.socket);
    const hostRoom = this.role === "host" && this.roomCode && this.ticket ? { roomCode: this.roomCode, ticket: this.ticket } : null;
    this.intentionallyClosed = true;
    this.cancelSocketOpen?.();
    this.cancelReconnect();
    this.clearConnectionTimer();
    this.stopHeartbeat();
    this.rejectPendingPings();
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.peerConnected = false;
    this.peerResponsive = false;
    this.callbacks.onPeerStatus?.(false);
    if (socket) {
      try { socket.close(1000, reason.slice(0, 120)); } catch { /* Already closed. */ }
    }
    if (this.flushTimer !== null) {
      this.clearTimeoutImpl(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingBinaryFrame = null;
    this.replacementNotified = false;
    this.sentStateAt.clear();
    this.setStateBackpressure(false);
    if (hostRoom) {
      try {
        await Promise.race([
          this.request(`/v1/rooms/${hostRoom.roomCode}`, { method: "DELETE", headers: { authorization: `Bearer ${hostRoom.ticket}` } }),
          wait(this.setTimeoutImpl, 1_000),
        ]);
      } catch { /* The room will expire if the relay cannot be reached. */ }
    }
    this.role = null;
    this.roomCode = "";
    this.ticket = "";
    this.expiresAt = 0;
    this.hasConnectedOnce = false;
    this.retryAttempt = 0;
    this.rttFailureCount = 0;
    if (!restarting) this.requestedConfig = null;
    if (wasActive && !restarting) this.setStatus("closed", reason);
  }
}
