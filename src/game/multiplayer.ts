import type { CustomEnemyDraft } from "./customEnemies.ts";
import { TOWER_ORDER } from "./config.ts";
import { joinRoom, type JsonValue, type MessageAction, type Room } from "trystero";
import type {
  Enemy,
  MapDefinition,
  ModeDefinition,
  Particle,
  PlayerId,
  Point,
  Projectile,
  TargetingMode,
  Tower,
  TowerKind,
} from "./types.ts";
import type { CommandResult, SimulationCommandEnvelope, SimulationServerDiagnostics } from "./simulationProtocol.ts";

export const MULTIPLAYER_PROTOCOL_VERSION = 5;
export const MULTIPLAYER_ROOM_CODE_LENGTH = 8;

const MULTIPLAYER_ICE_SETTINGS_KEY = "monochromium.multiplayer-ice.v1";
const MULTIPLAYER_APP_ID = "monochromium-coop-v2";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MAX_CONTROL_BYTES = 2_000_000;
const MAX_REALTIME_BYTES = 8_000_000;
const MAX_CONTROL_MESSAGES_PER_SECOND = 60;
const MAX_REALTIME_MESSAGES_PER_SECOND = 60;
const DEFAULT_STUN_SERVERS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
] as const;

export interface MultiplayerIceSettings {
  readonly turnUrls: string;
  readonly turnUsername: string;
  readonly turnCredential: string;
}

export const DEFAULT_MULTIPLAYER_ICE_SETTINGS: MultiplayerIceSettings = Object.freeze({
  turnUrls: "",
  turnUsername: "",
  turnCredential: "",
});

const allowedIceUrl = (value: string): boolean => /^(stun|stuns|turn|turns):[^\s]+$/i.test(value);

export const sanitizeMultiplayerIceSettings = (source: Partial<MultiplayerIceSettings> | null | undefined): MultiplayerIceSettings => {
  const rawUrls = typeof source?.turnUrls === "string" ? source.turnUrls : "";
  const turnUrls = rawUrls
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && allowedIceUrl(value) && values.indexOf(value) === index)
    .slice(0, 8)
    .join("\n");
  return {
    turnUrls,
    turnUsername: typeof source?.turnUsername === "string" ? source.turnUsername.trim().slice(0, 256) : "",
    turnCredential: typeof source?.turnCredential === "string" ? source.turnCredential.trim().slice(0, 512) : "",
  };
};

export const loadMultiplayerIceSettings = (): MultiplayerIceSettings => {
  try {
    const stored = window.localStorage.getItem(MULTIPLAYER_ICE_SETTINGS_KEY);
    return sanitizeMultiplayerIceSettings(stored ? JSON.parse(stored) as Partial<MultiplayerIceSettings> : null);
  } catch {
    return DEFAULT_MULTIPLAYER_ICE_SETTINGS;
  }
};

export const saveMultiplayerIceSettings = (source: Partial<MultiplayerIceSettings>): MultiplayerIceSettings => {
  const sanitized = sanitizeMultiplayerIceSettings(source);
  try {
    window.localStorage.setItem(MULTIPLAYER_ICE_SETTINGS_KEY, JSON.stringify(sanitized));
  } catch {
    // The active pairing can still use the in-memory values if storage is unavailable.
  }
  return sanitized;
};

const configuredIceServers = (): RTCIceServer[] => {
  const settings = loadMultiplayerIceSettings();
  const iceServers: RTCIceServer[] = DEFAULT_STUN_SERVERS.map((urls) => ({ urls }));
  const turnUrls = settings.turnUrls.split("\n").filter(Boolean);
  if (turnUrls.length > 0 && settings.turnUsername && settings.turnCredential) {
    iceServers.push({ urls: turnUrls, username: settings.turnUsername, credential: settings.turnCredential });
  }
  return iceServers;
};

export const hasConfiguredMultiplayerTurn = (): boolean => {
  const settings = loadMultiplayerIceSettings();
  return settings.turnUrls.length > 0 && settings.turnUsername.length > 0 && settings.turnCredential.length > 0;
};

export type MultiplayerRole = "host" | "guest";
export type MultiplayerConnectionStatus =
  | "idle"
  | "creating-room"
  | "joining-room"
  | "waiting-for-player"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface MultiplayerPlayer {
  readonly id: PlayerId;
  readonly username: string;
  readonly color: string;
  readonly loadout: readonly TowerKind[];
}

export type MultiplayerCommand =
  | { readonly type: "deploy"; readonly kind: TowerKind; readonly position: Point }
  | { readonly type: "relocate"; readonly towerId: number; readonly position: Point }
  | { readonly type: "sell"; readonly towerId: number }
  | { readonly type: "upgrade"; readonly towerId: number }
  | { readonly type: "target"; readonly towerId: number; readonly targeting: TargetingMode }
  | { readonly type: "counter"; readonly towerId: number }
  | { readonly type: "ability"; readonly towerId: number }
  | { readonly type: "pause" }
  | { readonly type: "speed" };

export interface MultiplayerSessionStart {
  readonly id: string;
  readonly map: MapDefinition;
  readonly mode: ModeDefinition;
  readonly customEnemies: readonly CustomEnemyDraft[];
  readonly players: readonly MultiplayerPlayer[];
}

export interface MultiplayerResult {
  readonly id: string;
  readonly victory: boolean;
  readonly wave: number;
  readonly coins: number;
  readonly tokens: number;
  readonly official: boolean;
  readonly mapKind: string;
  readonly modeKind: string;
}

export interface SerializedTower extends Omit<Tower, "engaged"> {
  readonly engaged: readonly number[];
}

export interface SerializedTimedBomb {
  readonly position: Point;
  readonly damage: number;
  readonly radius: number;
  readonly color: string;
  readonly playerId: PlayerId;
  readonly sourceTowerId?: number;
  readonly sourceKind?: TowerKind;
  readonly proximity?: boolean;
  readonly towerLevel?: number;
  readonly timer: number;
}

export interface MultiplayerPlayerState {
  readonly id: PlayerId;
  readonly shards: number;
  readonly pendingCasualtyRefund: number;
  readonly copiesRemaining: Readonly<Record<TowerKind, number>>;
}

export interface MultiplayerGameSnapshot {
  readonly sequence: number;
  readonly sentAt: number;
  readonly integrity: number;
  readonly maxIntegrity: number;
  readonly wave: number;
  readonly waveActive: boolean;
  readonly intermissionRemaining: number;
  readonly nextWaveIndex: number;
  readonly paused: boolean;
  readonly speed: number;
  readonly started: boolean;
  readonly gameOver: boolean;
  readonly modeComplete: boolean;
  readonly players: readonly MultiplayerPlayerState[];
  readonly towers: readonly SerializedTower[];
  readonly enemies: readonly Enemy[];
  readonly projectiles: readonly Projectile[];
  readonly particles: readonly Particle[];
  readonly timedBombs: readonly SerializedTimedBomb[];
  readonly spawnQueue: readonly { readonly kind: string; readonly spawnAt: number; readonly hp: number }[];
}

export type MultiplayerControlMessage =
  | { readonly type: "hello"; readonly player: MultiplayerPlayer }
  | { readonly type: "session-start"; readonly session: MultiplayerSessionStart }
  | { readonly type: "command"; readonly envelope: SimulationCommandEnvelope }
  | { readonly type: "command-result"; readonly result: CommandResult }
  | { readonly type: "resync-request"; readonly lastSequence: number }
  | { readonly type: "event-ack"; readonly eventId: number }
  | { readonly type: "server-diagnostics"; readonly diagnostics: SimulationServerDiagnostics }
  | { readonly type: "log"; readonly message: string; readonly tone?: "neutral" | "good" | "danger" }
  | { readonly type: "result"; readonly result: MultiplayerResult }
  | { readonly type: "end"; readonly reason: string }
  | { readonly type: "error"; readonly message: string };

export type MultiplayerRealtimeMessage =
  { readonly type: "cursor"; readonly point: Point | null };

type WireMessage = MultiplayerControlMessage | MultiplayerRealtimeMessage;

interface WireEnvelope {
  readonly protocol: number;
  readonly sessionId: string;
  readonly message: WireMessage;
}

interface MultiplayerSessionCallbacks {
  readonly onStatus: (status: MultiplayerConnectionStatus, detail?: string) => void;
  readonly onControl: (message: MultiplayerControlMessage, peerId: string) => void;
  readonly onRealtime: (message: MultiplayerRealtimeMessage, peerId: string) => void;
  readonly onBinary: (frame: ArrayBuffer, peerId: string) => void;
}

interface JsonRecord {
  readonly type?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly player?: unknown;
  readonly session?: unknown;
  readonly command?: unknown;
  readonly envelope?: unknown;
  readonly commandId?: unknown;
  readonly playerId?: unknown;
  readonly clientSequence?: unknown;
  readonly message?: unknown;
  readonly reason?: unknown;
  readonly tone?: unknown;
  readonly result?: unknown;
  readonly point?: unknown;
  readonly lastSequence?: unknown;
  readonly eventId?: unknown;
  readonly diagnostics?: unknown;
}

const isJsonRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isFiniteJsonNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoundedString = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);

const isPointMessage = (value: unknown): boolean => {
  if (value === null) return true;
  if (!isJsonRecord(value)) return false;
  return isFiniteJsonNumber(value.x) && isFiniteJsonNumber(value.y);
};

const isControlMessage = (value: unknown): value is MultiplayerControlMessage => {
  if (!isJsonRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "hello":
      return isJsonRecord(value.player);
    case "session-start":
      return isJsonRecord(value.session);
    case "command":
      if (!isJsonRecord(value.envelope)) return false;
      return isBoundedString(value.envelope.commandId, 96) &&
        isBoundedString(value.envelope.playerId, 64) && Number.isSafeInteger(value.envelope.clientSequence) &&
        isJsonRecord(value.envelope.command) && isBoundedString(value.envelope.command.type, 32);
    case "command-result":
      return isJsonRecord(value.result);
    case "resync-request":
      return Number.isSafeInteger(value.lastSequence);
    case "event-ack":
      return Number.isSafeInteger(value.eventId);
    case "server-diagnostics":
      return isJsonRecord(value.diagnostics);
    case "log":
      return isBoundedString(value.message, 2_000) && (value.tone === undefined || value.tone === "neutral" || value.tone === "good" || value.tone === "danger");
    case "result":
      return isJsonRecord(value.result);
    case "end":
    case "error":
      return isBoundedString(value.message ?? value.reason, 500);
    default:
      return false;
  }
};

const isRealtimeMessage = (value: unknown): value is MultiplayerRealtimeMessage => {
  if (!isJsonRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "cursor") return isPointMessage(value.point);
  return false;
};

const randomId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const randomRoomCode = (): string => {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(MULTIPLAYER_ROOM_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length] ?? "A").join("");
  }
  return Array.from({ length: MULTIPLAYER_ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)] ?? "A").join("");
};

const normalizeRoomCode = (raw: string): string => raw.replace(/[\s-]/g, "").toUpperCase();

export const isValidMultiplayerRoomCode = (raw: string): boolean => {
  const code = normalizeRoomCode(raw);
  return code.length >= 6 && code.length <= MULTIPLAYER_ROOM_CODE_LENGTH && [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
};

const roomCodeOrThrow = (raw: string): string => {
  const code = normalizeRoomCode(raw);
  if (!isValidMultiplayerRoomCode(code)) throw new Error(`Room codes are ${MULTIPLAYER_ROOM_CODE_LENGTH} letters/numbers. Check the code and try again.`);
  return code;
};

const roomConfig = (roomCode: string): Parameters<typeof joinRoom>[0] => ({
  appId: MULTIPLAYER_APP_ID,
  password: roomCode,
  rtcConfig: { iceServers: configuredIceServers() },
  trickleIce: true,
});

export class MultiplayerSession {
  private room: Room | null = null;
  private controlAction: MessageAction<JsonValue> | null = null;
  private realtimeAction: MessageAction<JsonValue> | null = null;
  private binaryAction: MessageAction<ArrayBuffer | ArrayBufferView> | null = null;
  private _role: MultiplayerRole | null = null;
  private _status: MultiplayerConnectionStatus = "idle";
  private _sessionId = "";
  private intentionallyClosed = false;
  private remotePeerId = "";
  private realtimeBusy = false;
  private binaryBusy = false;
  private pendingPeerIds = new Set<string>();
  private roomGeneration = 0;
  private readonly receiveWindows = new Map<string, { controlStartedAt: number; controlCount: number; realtimeStartedAt: number; realtimeCount: number }>();

  constructor(private readonly callbacks: MultiplayerSessionCallbacks) {}

  get role(): MultiplayerRole | null { return this._role; }
  get status(): MultiplayerConnectionStatus { return this._status; }
  get sessionId(): string { return this._sessionId; }
  get connected(): boolean { return this._status === "connected"; }
  get stateSendBusy(): boolean { return this.binaryBusy; }
  isExpectedPeer(peerId: string): boolean { return Boolean(peerId) && peerId === this.remotePeerId; }

  handleDesktopMessage(message: MonochromiumHostNetworkMessage): void {
    if (this._role !== "host") return;
    if (message.type === "status") {
      if (message.peerId) this.remotePeerId = message.peerId;
      if (message.status === "disconnected" || message.status === "closed" || message.status === "failed") this.remotePeerId = "";
      this.setStatus(message.status, message.detail);
      return;
    }
    if (!message.peerId || !this.isExpectedPeer(message.peerId)) return;
    if (message.type === "control") this.callbacks.onControl(message.message, message.peerId);
    else this.callbacks.onRealtime(message.message, message.peerId);
  }

  async measureRtt(): Promise<number | null> {
    if (this._role === "host") return await (window.monochromiumDesktop?.measureHostNetworkRtt() ?? null);
    if (!this.room || !this.remotePeerId) return null;
    try {
      return await this.room.ping(this.remotePeerId);
    } catch {
      return null;
    }
  }

  createHostRoom(roomCode = randomRoomCode()): string {
    const code = roomCodeOrThrow(roomCode);
    this.closeRoom();
    this._role = "host";
    this._sessionId = code;
    this.intentionallyClosed = false;
    this.setStatus("creating-room", "Creating a short room code…");
    void window.monochromiumDesktop?.startHostNetwork({ roomCode: code, iceServers: configuredIceServers() }).catch((error) => {
      if (this._role === "host" && this._sessionId === code) this.setStatus("failed", error instanceof Error ? error.message : "Could not start host networking.");
    });
    return code;
  }

  joinRoom(rawRoomCode: string): string {
    const code = roomCodeOrThrow(rawRoomCode);
    this.closeRoom();
    this._role = "guest";
    this._sessionId = code;
    this.intentionallyClosed = false;
    this.setStatus("joining-room", "Looking for the host room…");
    this.openRoom(code);
    return code;
  }

  sendControl(message: MultiplayerControlMessage): boolean {
    if (this._role === "host") {
      void window.monochromiumDesktop?.sendHostNetworkControl(message);
      return Boolean(window.monochromiumDesktop && this.connected);
    }
    return this.sendAction(this.controlAction, message, MAX_CONTROL_BYTES);
  }

  sendRealtime(message: MultiplayerRealtimeMessage): boolean {
    if (this._role === "host") {
      void window.monochromiumDesktop?.sendHostNetworkRealtime(message);
      return Boolean(window.monochromiumDesktop && this.connected);
    }
    if (this.realtimeBusy) return false;
    this.realtimeBusy = true;
    const sent = this.sendAction(this.realtimeAction, message, MAX_REALTIME_BYTES);
    if (!sent) this.realtimeBusy = false;
    return sent;
  }

  sendBinary(frame: ArrayBuffer): boolean {
    if (this._role === "host") return false;
    if (!this.binaryAction || !this.remotePeerId || this.binaryBusy || frame.byteLength > MAX_REALTIME_BYTES) return false;
    this.binaryBusy = true;
    const action = this.binaryAction;
    void action.send(frame, { target: this.remotePeerId }).catch(() => {
      if (!this.intentionallyClosed) this.setStatus("disconnected", "The peer connection dropped while sending state.");
    }).finally(() => {
      this.binaryBusy = false;
    });
    return true;
  }

  close(reason = "Session closed."): void {
    if (this.connected) this.sendControl({ type: "end", reason });
    this.intentionallyClosed = true;
    this.closeRoom();
    this._role = null;
    this._sessionId = "";
    this.setStatus("closed", reason);
  }

  private openRoom(roomCode: string): void {
    const generation = ++this.roomGeneration;
    const room = joinRoom(roomConfig(roomCode), roomCode, {
      onJoinError: (details) => {
        if (generation !== this.roomGeneration) return;
        const detail = hasConfiguredMultiplayerTurn()
          ? `Room connection failed even with TURN configured: ${details.error}`
          : `Room connection failed: ${details.error}. If this repeats, configure TURN in Network Settings.`;
        this.setStatus("failed", detail);
      },
      onPeerHandshake: async (peerId) => {
        if (generation !== this.roomGeneration) throw new Error("Stale multiplayer room.");
        if ((this.remotePeerId && this.remotePeerId !== peerId) || (this.pendingPeerIds.size > 0 && !this.pendingPeerIds.has(peerId))) {
          throw new Error("This room already has a player.");
        }
        this.pendingPeerIds.add(peerId);
        try {
          if (this.remotePeerId && this.remotePeerId !== peerId) throw new Error("This room already has a player.");
        } finally {
          this.pendingPeerIds.delete(peerId);
        }
      },
    });
    this.room = room;
    this.controlAction = room.makeAction<JsonValue>("monochromium-control");
    this.realtimeAction = room.makeAction<JsonValue>("monochromium-realtime");
    this.binaryAction = room.makeAction<ArrayBuffer | ArrayBufferView>("monochromium-state-v5");
    this.controlAction.onMessage = (data, context) => {
      if (generation === this.roomGeneration) this.receiveAction(data, "control", context.peerId);
    };
    this.realtimeAction.onMessage = (data, context) => {
      if (generation === this.roomGeneration) this.receiveAction(data, "realtime", context.peerId);
    };
    this.binaryAction.onMessage = (data, context) => {
      if (generation !== this.roomGeneration || !this.isExpectedPeer(context.peerId)) return;
      // Trystero documents ArrayBuffer delivery, although some Chromium/WebRTC
      // paths hand back a typed view. Normalize both forms before the frame
      // reaches the decoder; otherwise a valid keyframe is silently discarded.
      const frame = data instanceof ArrayBuffer
        ? data
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
          : null;
      if (!frame || frame.byteLength > MAX_REALTIME_BYTES) return;
      this.callbacks.onBinary(frame, context.peerId);
    };
    room.onPeerJoin = (peerId) => {
      if (generation !== this.roomGeneration) return;
      if (this.remotePeerId && this.remotePeerId !== peerId) {
        void this.controlAction?.send({ type: "error", message: "This room already has a player." }, { target: peerId });
        return;
      }
      this.remotePeerId = peerId;
      this.setStatus("connected", "Friend joined the room. You are connected peer-to-peer.");
    };
    room.onPeerLeave = (peerId) => {
      if (generation !== this.roomGeneration) return;
      this.receiveWindows.delete(peerId);
      if (peerId !== this.remotePeerId || this.intentionallyClosed) return;
      this.remotePeerId = "";
      this.setStatus("disconnected", "Friend disconnected. Rejoin with the same room code to reconnect.");
    };
  }

  private receiveAction(raw: JsonValue, kind: "control" | "realtime", peerId: string): void {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    if (!this.isExpectedPeer(peerId)) return;
    let encodedBytes = 0;
    try {
      encodedBytes = new TextEncoder().encode(JSON.stringify(raw)).byteLength;
    } catch {
      return;
    }
    const maximum = kind === "control" ? MAX_CONTROL_BYTES : MAX_REALTIME_BYTES;
    if (encodedBytes > maximum) return;
    const envelope = raw as Partial<WireEnvelope>;
    if (envelope.protocol !== MULTIPLAYER_PROTOCOL_VERSION) {
      this.setStatus("failed", `Incompatible multiplayer protocol. Both players must run protocol ${MULTIPLAYER_PROTOCOL_VERSION}.`);
      return;
    }
    if (envelope.sessionId !== this._sessionId || !envelope.message) return;
    if (!this.acceptIncoming(peerId, kind)) return;
    if (kind === "control") {
      if (isControlMessage(envelope.message)) this.callbacks.onControl(envelope.message, peerId);
    } else if (isRealtimeMessage(envelope.message)) this.callbacks.onRealtime(envelope.message, peerId);
  }

  private acceptIncoming(peerId: string, kind: "control" | "realtime"): boolean {
    const now = performance.now();
    const window = this.receiveWindows.get(peerId) ?? {
      controlStartedAt: now,
      controlCount: 0,
      realtimeStartedAt: now,
      realtimeCount: 0,
    };
    if (kind === "control") {
      if (now - window.controlStartedAt >= 1_000) {
        window.controlStartedAt = now;
        window.controlCount = 0;
      }
      if (window.controlCount >= MAX_CONTROL_MESSAGES_PER_SECOND) return false;
      window.controlCount += 1;
    } else {
      if (now - window.realtimeStartedAt >= 1_000) {
        window.realtimeStartedAt = now;
        window.realtimeCount = 0;
      }
      if (window.realtimeCount >= MAX_REALTIME_MESSAGES_PER_SECOND) return false;
      window.realtimeCount += 1;
    }
    this.receiveWindows.set(peerId, window);
    return true;
  }

  private sendAction(action: MessageAction<JsonValue> | null, message: WireMessage, maxBytes: number): boolean {
    if (!action || !this.remotePeerId) return false;
    const wire = { protocol: MULTIPLAYER_PROTOCOL_VERSION, sessionId: this._sessionId, message } satisfies WireEnvelope;
    let encodedBytes = 0;
    try {
      encodedBytes = new TextEncoder().encode(JSON.stringify(wire)).byteLength;
    } catch {
      return false;
    }
    if (encodedBytes > maxBytes) return false;
    const target = this.remotePeerId;
    void action.send(wire as unknown as JsonValue, { target }).catch(() => {
      if (!this.intentionallyClosed) this.setStatus("disconnected", "The peer connection dropped while sending data.");
    }).finally(() => {
      if (action === this.realtimeAction) this.realtimeBusy = false;
    });
    return true;
  }

  private closeRoom(): void {
    if (this._role === "host") void window.monochromiumDesktop?.stopHostNetwork("Host room closed.");
    this.roomGeneration += 1;
    void this.room?.leave();
    this.room = null;
    this.controlAction = null;
    this.realtimeAction = null;
    this.binaryAction = null;
    this.remotePeerId = "";
    this.realtimeBusy = false;
    this.binaryBusy = false;
    this.pendingPeerIds.clear();
    this.receiveWindows.clear();
  }

  private setStatus(status: MultiplayerConnectionStatus, detail?: string): void {
    this._status = status;
    this.callbacks.onStatus(status, detail);
  }
}

export const sanitizeMultiplayerPlayer = (
  player: Partial<MultiplayerPlayer>,
  fallbackId = randomId(),
): MultiplayerPlayer => {
  const username = typeof player.username === "string"
    ? player.username.trim().replace(/[^a-z0-9 _-]/gi, "").slice(0, 20) || "PLAYER"
    : "PLAYER";
  const color = typeof player.color === "string" && /^#[0-9a-f]{6}$/i.test(player.color)
    ? player.color.toLowerCase()
    : "#66d9ff";
  const loadout = Array.isArray(player.loadout)
    ? player.loadout.filter((kind): kind is TowerKind => typeof kind === "string" && TOWER_ORDER.includes(kind as TowerKind)).slice(0, 5)
    : [];
  return {
    id: typeof player.id === "string" && /^[a-z0-9-]{4,64}$/i.test(player.id) ? player.id : fallbackId,
    username,
    color,
    loadout,
  };
};
