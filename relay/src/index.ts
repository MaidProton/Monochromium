import { DurableObject } from "cloudflare:workers";
import protocol from "../../shared/multiplayer-protocol.json";

const PROTOCOL_VERSION = protocol.protocolVersion;
const ROOM_CODE_LENGTH = 8;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGES_PER_SECOND = 120;
const API_JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

type MultiplayerRole = "host" | "guest";

interface Env {
  ROOMS: DurableObjectNamespace<MultiplayerRoom>;
}

interface RoomRecord {
  readonly protocol: number;
  readonly hostTicketHash: string;
  readonly guestTicketHash?: string;
  readonly hostAdmitted: boolean;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface SocketAttachment {
  readonly role: MultiplayerRole;
  rateStartedAt: number;
  rateCount: number;
}

interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

const json = (value: unknown, status = 200, headers: HeadersInit = {}): Response => new Response(JSON.stringify(value), {
  status,
  headers: { ...API_JSON_HEADERS, ...headers },
});

const apiError = (status: number, code: string, message: string, retryable = false): Response =>
  json({ error: { code, message, retryable } } satisfies ApiError, status);

const normalizeRoomCode = (raw: string): string => raw.replace(/[\s-]/g, "").toUpperCase();

const validRoomCode = (raw: string): boolean => {
  const code = normalizeRoomCode(raw);
  return code.length === ROOM_CODE_LENGTH && [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
};

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const randomRoomCode = (): string => Array.from(randomBytes(ROOM_CODE_LENGTH), (byte) =>
  ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length] ?? "A").join("");

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

const randomTicket = (): string => base64Url(randomBytes(32));

const hashTicket = async (ticket: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const safeRequestBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const parseProtocol = async (request: Request): Promise<number | null> => {
  const body = await safeRequestBody(request);
  return typeof body?.["protocol"] === "number" && Number.isSafeInteger(body["protocol"])
    ? body["protocol"]
    : null;
};

const parseOfferedProtocols = (request: Request): string[] =>
  (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const readBearerTicket = (request: Request): string => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
};

const internalRequest = (path: string, init?: RequestInit): Request => new Request(`https://room.internal${path}`, init);

const responsePayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return { error: { code: "relay-error", message: "Relay returned an invalid response.", retryable: true } };
  }
};

const forwardInternalResponse = async (response: Response): Promise<Response> =>
  json(await responsePayload(response), response.status);

const selectRoomStub = (env: Env, code: string): DurableObjectStub<MultiplayerRoom> => env.ROOMS.getByName(code);

const createRoom = async (request: Request, env: Env): Promise<Response> => {
  const protocol = await parseProtocol(request);
  if (protocol !== PROTOCOL_VERSION) {
    return apiError(409, "protocol-mismatch", `This relay requires multiplayer protocol ${PROTOCOL_VERSION}.`);
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const roomCode = randomRoomCode();
    const hostTicket = randomTicket();
    const now = Date.now();
    const expiresAt = now + ROOM_LIFETIME_MS;
    const response = await selectRoomStub(env, roomCode).fetch(internalRequest("/internal/create", {
      method: "POST",
      headers: API_JSON_HEADERS,
      body: JSON.stringify({
        protocol,
        hostTicketHash: await hashTicket(hostTicket),
        hostAdmitted: false,
        createdAt: now,
        expiresAt,
      } satisfies RoomRecord),
    }));
    if (response.status === 201) return json({ roomCode, ticket: hostTicket, expiresAt }, 201);
    if (response.status !== 409) return forwardInternalResponse(response);
  }

  return apiError(503, "room-allocation-failed", "Could not allocate a room. Try again.", true);
};

const joinRoom = async (request: Request, env: Env, code: string): Promise<Response> => {
  if (!validRoomCode(code)) return apiError(404, "room-not-found", "Room not found.");
  const protocol = await parseProtocol(request);
  if (protocol !== PROTOCOL_VERSION) {
    return apiError(409, "protocol-mismatch", `This relay requires multiplayer protocol ${PROTOCOL_VERSION}.`);
  }
  const guestTicket = randomTicket();
  const response = await selectRoomStub(env, code).fetch(internalRequest("/internal/join", {
    method: "POST",
    headers: API_JSON_HEADERS,
    body: JSON.stringify({ protocol, guestTicketHash: await hashTicket(guestTicket) }),
  }));
  if (!response.ok) return forwardInternalResponse(response);
  const payload = await responsePayload(response) as { expiresAt?: unknown };
  return json({ roomCode: code, ticket: guestTicket, expiresAt: payload.expiresAt }, 200);
};

const upgradeRoomSocket = async (request: Request, env: Env, code: string): Promise<Response> => {
  if (!validRoomCode(code)) return apiError(404, "room-not-found", "Room not found.");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return apiError(426, "websocket-required", "This endpoint requires a WebSocket upgrade.");
  }
  const protocols = parseOfferedProtocols(request);
  const expectedProtocol = `monochromium-v${PROTOCOL_VERSION}`;
  const ticketProtocol = protocols.find((value) => value.startsWith("ticket."));
  const ticket = ticketProtocol?.slice("ticket.".length) ?? "";
  if (!protocols.includes(expectedProtocol)) {
    return apiError(409, "protocol-mismatch", `This relay requires multiplayer protocol ${PROTOCOL_VERSION}.`);
  }
  if (!ticket) {
    return apiError(401, "invalid-ticket", "The room ticket is missing or invalid.");
  }
  const headers = new Headers(request.headers);
  headers.set("x-monochromium-ticket-hash", await hashTicket(ticket));
  headers.set("x-monochromium-selected-protocol", expectedProtocol);
  return selectRoomStub(env, code).fetch(new Request("https://room.internal/internal/socket", {
    method: "GET",
    headers,
  }));
};

const deleteRoom = async (request: Request, env: Env, code: string): Promise<Response> => {
  if (!validRoomCode(code)) return apiError(404, "room-not-found", "Room not found.");
  const ticket = readBearerTicket(request);
  if (!ticket) return apiError(401, "invalid-ticket", "A host ticket is required.");
  const response = await selectRoomStub(env, code).fetch(internalRequest("/internal/delete", {
    method: "DELETE",
    headers: { "x-monochromium-ticket-hash": await hashTicket(ticket) },
  }));
  return response.ok ? new Response(null, { status: 204 }) : forwardInternalResponse(response);
};

const routeRequest = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "monochromium-multiplayer-relay", protocol: PROTOCOL_VERSION });
  }
  if (request.method === "POST" && url.pathname === "/v1/rooms") return createRoom(request, env);

  const match = /^\/v1\/rooms\/([^/]+)(?:\/(join|socket))?$/.exec(url.pathname);
  if (!match?.[1]) return apiError(404, "not-found", "Endpoint not found.");
  const code = normalizeRoomCode(match[1]);
  const action = match[2] ?? "";
  if (request.method === "POST" && action === "join") return joinRoom(request, env, code);
  if (request.method === "GET" && action === "socket") return upgradeRoomSocket(request, env, code);
  if (request.method === "DELETE" && !action) return deleteRoom(request, env, code);
  return apiError(405, "method-not-allowed", "Method not allowed.");
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch {
      return apiError(503, "relay-unavailable", "The multiplayer relay is temporarily unavailable.", true);
    }
  },
} satisfies ExportedHandler<Env>;

export class MultiplayerRoom extends DurableObject<Env> {
  private readonly textEncoder = new TextEncoder();

  private async record(): Promise<RoomRecord | null> {
    return await this.ctx.storage.get<RoomRecord>("room") ?? null;
  }

  private sockets(role?: MultiplayerRole): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private systemMessage(socket: WebSocket, message: Record<string, unknown>): void {
    try {
      socket.send(JSON.stringify({ relay: message }));
    } catch {
      try { socket.close(1011, "Relay send failed."); } catch { /* Already closed. */ }
    }
  }

  private notifyPeerStatus(role: MultiplayerRole, connected: boolean): void {
    const opposite: MultiplayerRole = role === "host" ? "guest" : "host";
    this.sockets(opposite).forEach((socket) => this.systemMessage(socket, { type: "peer-status", connected }));
  }

  private closeSockets(code: number, reason: string): void {
    this.ctx.getWebSockets().forEach((socket) => {
      try { socket.close(code, reason); } catch { /* Already closed. */ }
    });
  }

  private async destroy(code: number, reason: string): Promise<void> {
    this.closeSockets(code, reason);
    await this.ctx.storage.deleteAll();
  }

  private async requireLiveRecord(): Promise<RoomRecord | Response> {
    const record = await this.record();
    if (!record) return apiError(404, "room-not-found", "Room not found.");
    if (Date.now() >= record.expiresAt) {
      await this.destroy(4004, "Room expired.");
      return apiError(404, "room-expired", "Room expired.");
    }
    return record;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/internal/create") return this.create(request);
    if (request.method === "POST" && url.pathname === "/internal/join") return this.join(request);
    if (request.method === "GET" && url.pathname === "/internal/socket") return this.upgrade(request);
    if (request.method === "DELETE" && url.pathname === "/internal/delete") return this.delete(request);
    return apiError(404, "not-found", "Endpoint not found.");
  }

  private async create(request: Request): Promise<Response> {
    if (await this.record()) return apiError(409, "room-exists", "Room already exists.");
    const body = await safeRequestBody(request) as Partial<RoomRecord> | null;
    if (!body || body.protocol !== PROTOCOL_VERSION || typeof body.hostTicketHash !== "string" ||
      typeof body.createdAt !== "number" || typeof body.expiresAt !== "number") {
      return apiError(400, "invalid-room", "Invalid room configuration.");
    }
    const record: RoomRecord = {
      protocol: PROTOCOL_VERSION,
      hostTicketHash: body.hostTicketHash,
      hostAdmitted: false,
      createdAt: body.createdAt,
      expiresAt: Math.min(body.expiresAt, body.createdAt + ROOM_LIFETIME_MS),
    };
    await this.ctx.storage.put("room", record);
    await this.ctx.storage.setAlarm(record.expiresAt);
    return json({ expiresAt: record.expiresAt }, 201);
  }

  private async join(request: Request): Promise<Response> {
    const live = await this.requireLiveRecord();
    if (live instanceof Response) return live;
    if (this.sockets("host").length === 0) return apiError(404, "host-offline", "The host is not online.");
    if (live.guestTicketHash) return apiError(409, "room-full", "This room already has a guest.");
    const body = await safeRequestBody(request);
    if (body?.["protocol"] !== live.protocol || typeof body["guestTicketHash"] !== "string") {
      return apiError(409, "protocol-mismatch", `This room requires multiplayer protocol ${live.protocol}.`);
    }
    const next: RoomRecord = { ...live, guestTicketHash: body["guestTicketHash"] };
    await this.ctx.storage.put("room", next);
    return json({ expiresAt: next.expiresAt });
  }

  private async upgrade(request: Request): Promise<Response> {
    const live = await this.requireLiveRecord();
    if (live instanceof Response) return live;
    const ticketHash = request.headers.get("x-monochromium-ticket-hash") ?? "";
    const role: MultiplayerRole | null = ticketHash === live.hostTicketHash
      ? "host"
      : ticketHash && ticketHash === live.guestTicketHash
        ? "guest"
        : null;
    if (!role) return apiError(401, "invalid-ticket", "The room ticket is invalid.");

    if (role === "host" && live.hostAdmitted) {
      return apiError(409, "host-reconnect-forbidden", "The host ticket cannot reopen a room.");
    }
    if (role === "guest") {
      this.sockets(role).forEach((socket) => {
        try { socket.close(4001, "Connection replaced."); } catch { /* Already closed. */ }
      });
    } else {
      await this.ctx.storage.put("room", { ...live, hostAdmitted: true } satisfies RoomRecord);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = { role, rateStartedAt: Date.now(), rateCount: 0 };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [role]);
    const peerConnected = this.sockets(role === "host" ? "guest" : "host").length > 0;
    this.systemMessage(server, { type: "ready", role, peerConnected });
    this.notifyPeerStatus(role, true);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": request.headers.get("x-monochromium-selected-protocol") ?? `monochromium-v${live.protocol}` },
    });
  }

  private async delete(request: Request): Promise<Response> {
    const live = await this.requireLiveRecord();
    if (live instanceof Response) return live;
    if (request.headers.get("x-monochromium-ticket-hash") !== live.hostTicketHash) {
      return apiError(403, "host-required", "Only the host can close this room.");
    }
    await this.destroy(4000, "Host closed the room.");
    return new Response(null, { status: 204 });
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || (attachment.role !== "host" && attachment.role !== "guest")) {
      socket.close(1008, "Invalid connection state.");
      return;
    }
    const byteLength = typeof message === "string" ? this.textEncoder.encode(message).byteLength : message.byteLength;
    if (byteLength > MAX_MESSAGE_BYTES) {
      socket.close(1009, "Message too large.");
      return;
    }
    const now = Date.now();
    if (now - attachment.rateStartedAt >= 1_000) {
      attachment.rateStartedAt = now;
      attachment.rateCount = 0;
    }
    attachment.rateCount += 1;
    socket.serializeAttachment(attachment);
    if (attachment.rateCount > MAX_MESSAGES_PER_SECOND) {
      socket.close(1008, "Message rate exceeded.");
      return;
    }
    if (typeof message !== "string" && attachment.role !== "host") {
      socket.close(1008, "Guests cannot send state frames.");
      return;
    }
    if (typeof message === "string") {
      try {
        const envelope = JSON.parse(message) as Record<string, unknown>;
        if (envelope["protocol"] !== PROTOCOL_VERSION || typeof envelope["sessionId"] !== "string" ||
          !["control", "realtime", "transport"].includes(String(envelope["channel"]))) {
          socket.close(1008, "Invalid message envelope.");
          return;
        }
      } catch {
        socket.close(1008, "Invalid JSON message.");
        return;
      }
    }
    const opposite: MultiplayerRole = attachment.role === "host" ? "guest" : "host";
    this.sockets(opposite).forEach((peer) => {
      try { peer.send(message); } catch { try { peer.close(1011, "Relay send failed."); } catch { /* Already closed. */ } }
    });
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || this.sockets(attachment.role).length > 0) return;
    if (attachment.role === "host") {
      await this.destroy(4002, "Host left the room.");
      return;
    }
    this.notifyPeerStatus(attachment.role, false);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const live = await this.record();
    if (!live) return;
    if (Date.now() >= live.expiresAt) {
      await this.destroy(4004, "Room expired.");
      return;
    }
    await this.ctx.storage.setAlarm(live.expiresAt);
  }
}
