import type { CustomEnemyDraft } from "./customEnemies.ts";
import { TOWER_ORDER, TOWER_PERK_ORDER } from "./config.ts";
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
  TowerPerkKind,
} from "./types.ts";
import type { CommandResult, SimulationCommandEnvelope, SimulationServerDiagnostics } from "./simulationProtocol.ts";
import protocol from "../../shared/multiplayer-protocol.json";
import packageJson from "../../package.json";

// This is the binary/control wire schema version, not the game/content version.
// Keep it stable for additive, backward-compatible messages and field additions.
export const MULTIPLAYER_PROTOCOL_VERSION = protocol.protocolVersion;
export const GAME_VERSION = packageJson.version;
export const MULTIPLAYER_ROOM_CODE_LENGTH = 8;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LEGACY_MULTIPLAYER_NETWORK_KEYS = [
  "monochromium.multiplayer-ice.v1",
  "monochromium.multiplayer-connection.v1",
] as const;

export const clearLegacyMultiplayerNetworkSettings = (): void => {
  try {
    LEGACY_MULTIPLAYER_NETWORK_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Legacy connection settings are ignored when local storage is unavailable.
  }
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
  readonly perkLoadout: readonly TowerPerkKind[];
}

export type MultiplayerCommand =
  | { readonly type: "deploy"; readonly kind: TowerKind; readonly position: Point }
  | { readonly type: "relocate"; readonly towerId: number; readonly position: Point }
  | { readonly type: "sell"; readonly towerId: number }
  | { readonly type: "upgrade"; readonly towerId: number }
  | { readonly type: "target"; readonly towerId: number; readonly targeting: TargetingMode }
  | { readonly type: "counter"; readonly towerId: number }
  | { readonly type: "auto-counter"; readonly towerId: number }
  | { readonly type: "ability"; readonly towerId: number; readonly slot?: import("./types.ts").TowerAbilitySlot }
  | { readonly type: "aim"; readonly towerId: number; readonly position: Point }
  | { readonly type: "cancel-aim"; readonly towerId: number }
  | { readonly type: "mecha-control"; readonly towerId: number; readonly active: boolean }
  | { readonly type: "mecha-input"; readonly towerId: number; readonly moveX: -1 | 0 | 1; readonly moveY: -1 | 0 | 1; readonly aim: Point; readonly firing: boolean; readonly brake?: boolean }
  | { readonly type: "pause" }
  | { readonly type: "speed" }
  | { readonly type: "skip-wave" };

export interface MultiplayerSessionStart {
  readonly id: string;
  /** Monotonically increasing round number within the persistent room. */
  readonly round: number;
  readonly map: MapDefinition;
  readonly mode: ModeDefinition;
  readonly customEnemies: readonly CustomEnemyDraft[];
  /** Host-authorized tower pool for this round. */
  readonly allowedTowers: readonly TowerKind[];
  readonly players: readonly MultiplayerPlayer[];
}

export interface MultiplayerResult {
  readonly id: string;
  readonly round: number;
  readonly victory: boolean;
  readonly wave: number;
  readonly coins: number;
  readonly tokens: number;
  readonly official: boolean;
  readonly mapKind: string;
  readonly modeKind: string;
}

export type MultiplayerLobbyPhase = "lobby" | "playing";

export interface MultiplayerLobbyState {
  readonly id: string;
  readonly round: number;
  readonly phase: MultiplayerLobbyPhase;
  readonly session: MultiplayerSessionStart | null;
  readonly guestReady: boolean;
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
  readonly label?: string;
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
  readonly spawnQueue: readonly { readonly kind: string; readonly spawnAt: number; readonly hp: number; readonly pathIndex?: number }[];
}

export type MultiplayerControlMessage =
  | { readonly type: "hello"; readonly player: MultiplayerPlayer; readonly gameVersion?: string }
  | { readonly type: "lobby-state"; readonly state: MultiplayerLobbyState }
  | { readonly type: "lobby-ready"; readonly round: number; readonly player: MultiplayerPlayer; readonly ready: boolean }
  | { readonly type: "session-start"; readonly session: MultiplayerSessionStart }
  | { readonly type: "command"; readonly envelope: SimulationCommandEnvelope }
  | { readonly type: "command-result"; readonly result: CommandResult }
  | { readonly type: "resync-request"; readonly lastSequence: number }
  | { readonly type: "server-diagnostics"; readonly diagnostics: SimulationServerDiagnostics }
  | { readonly type: "log"; readonly message: string; readonly tone?: "neutral" | "good" | "danger" }
  | { readonly type: "chat"; readonly text: string; readonly senderId: string; readonly senderName: string; readonly senderColor: string; readonly sentAt: number }
  | { readonly type: "result"; readonly result: MultiplayerResult }
  | { readonly type: "end"; readonly reason: string }
  | { readonly type: "error"; readonly message: string };

export interface MultiplayerPilotInput {
  /** Latest-wins pilot state. This intentionally bypasses reliable command acknowledgement. */
  readonly type: "pilot-input";
  readonly playerId: string;
  readonly towerId: number;
  readonly sequence: number;
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aim: Point;
  readonly firing: boolean;
  readonly brake?: boolean;
}

export interface MultiplayerPilotInputAck {
  readonly playerId: string;
  readonly towerId: number;
  readonly sequence: number;
}

export type MultiplayerRealtimeMessage =
  | { readonly type: "cursor"; readonly point: Point | null }
  | MultiplayerPilotInput
  | {
      readonly type: "pulse";
      readonly sequence: number;
      readonly sentAt: number;
      readonly point: Point | null;
      readonly stateSequence: number;
      readonly eventId: number;
    };

interface MultiplayerSessionCallbacks {
  readonly onStatus: (status: MultiplayerConnectionStatus, detail?: string) => void;
  readonly onControl: (message: MultiplayerControlMessage, peerId: string, receivedAt?: number) => void;
  readonly onRealtime: (message: MultiplayerRealtimeMessage, peerId: string, receivedAt?: number) => void;
  readonly onBinary: (frame: ArrayBuffer, peerId: string, receivedAt?: number) => void;
}

interface JsonRecord {
  readonly type?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly player?: unknown;
  readonly gameVersion?: unknown;
  readonly state?: unknown;
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
  readonly ready?: unknown;
  readonly round?: unknown;
  readonly point?: unknown;
  readonly lastSequence?: unknown;
  readonly eventId?: unknown;
  readonly stateSequence?: unknown;
  readonly sentAt?: unknown;
  readonly sequence?: unknown;
  readonly towerId?: unknown;
  readonly moveX?: unknown;
  readonly moveY?: unknown;
  readonly aim?: unknown;
  readonly firing?: unknown;
  readonly brake?: unknown;
  readonly events?: unknown;
  readonly diagnostics?: unknown;
  readonly id?: unknown;
  readonly tick?: unknown;
  readonly cosmeticSeed?: unknown;
  readonly kind?: unknown;
  readonly entityId?: unknown;
  readonly targetId?: unknown;
  readonly position?: unknown;
  readonly from?: unknown;
  readonly visual?: unknown;
  readonly speed?: unknown;
  readonly value?: unknown;
  readonly count?: unknown;
  readonly duration?: unknown;
  readonly color?: unknown;
  readonly label?: unknown;
  readonly text?: unknown;
  readonly senderId?: unknown;
  readonly senderName?: unknown;
  readonly senderColor?: unknown;
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
      return isJsonRecord(value.player) && (value.gameVersion === undefined || isBoundedString(value.gameVersion, 32));
    case "lobby-state":
      return isJsonRecord(value.state);
    case "lobby-ready":
      return Number.isSafeInteger(value.round) && isJsonRecord(value.player) && typeof value.ready === "boolean";
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
    case "server-diagnostics":
      return isJsonRecord(value.diagnostics);
    case "log":
      return isBoundedString(value.message, 2_000) && (value.tone === undefined || value.tone === "neutral" || value.tone === "good" || value.tone === "danger");
    case "chat":
      return isBoundedString(value.text, 256) &&
        isBoundedString(value.senderId, 64) &&
        isBoundedString(value.senderName, 20) &&
        typeof value.senderColor === "string" && value.senderColor.length <= 32 &&
        Number.isFinite(value.sentAt);
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
  if (value.type === "pilot-input") return isBoundedString(value.playerId, 64) && Number.isSafeInteger(value.towerId) &&
    Number.isSafeInteger(value.sequence) && [-1, 0, 1].includes(value.moveX as number) && [-1, 0, 1].includes(value.moveY as number) &&
    isPointMessage(value.aim) && value.aim !== null && typeof value.firing === "boolean" &&
    (value.brake === undefined || typeof value.brake === "boolean");
  if (value.type === "pulse") return Number.isSafeInteger(value.sequence) && isFiniteJsonNumber(value.sentAt) &&
    Number.isSafeInteger(value.stateSequence) && Number.isSafeInteger(value.eventId) && isPointMessage(value.point);
  return false;
};

const randomId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export const isValidMultiplayerRoomCode = (raw: string): boolean => {
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return code.length === MULTIPLAYER_ROOM_CODE_LENGTH && [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
};

const roomCodeOrThrow = (raw: string): string => {
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!isValidMultiplayerRoomCode(code)) throw new Error(`Room codes are ${MULTIPLAYER_ROOM_CODE_LENGTH} letters/numbers. Check the code and try again.`);
  return code;
};

export class MultiplayerSession {
  private _role: MultiplayerRole | null = null;
  private _status: MultiplayerConnectionStatus = "idle";
  private _sessionId = "";
  private remotePeerId = "";
  private binaryBusy = false;

  constructor(private readonly callbacks: MultiplayerSessionCallbacks) {
    clearLegacyMultiplayerNetworkSettings();
  }

  get role(): MultiplayerRole | null { return this._role; }
  get status(): MultiplayerConnectionStatus { return this._status; }
  get sessionId(): string { return this._sessionId; }
  get connected(): boolean { return this._status === "connected"; }
  get stateSendBusy(): boolean { return this.binaryBusy; }
  isExpectedPeer(peerId: string): boolean { return Boolean(peerId) && peerId === this.remotePeerId; }

  handleDesktopMessage(message: MonochromiumMultiplayerNetworkMessage): void {
    if (message.type === "state-pressure") {
      this.binaryBusy = message.busy;
      return;
    }
    if (message.type === "rtt") return;
    if (message.type === "status") {
      if (message.peerId) this.remotePeerId = message.peerId;
      if (message.status !== "connected") {
        this.remotePeerId = "";
        this.binaryBusy = false;
      }
      this.setStatus(message.status, message.detail);
      return;
    }
    if (!message.peerId || !this.isExpectedPeer(message.peerId)) return;
    if (message.type === "control" && isControlMessage(message.message)) this.callbacks.onControl(message.message, message.peerId, message.receivedAt);
    else if (message.type === "realtime" && isRealtimeMessage(message.message)) this.callbacks.onRealtime(message.message, message.peerId, message.receivedAt);
    else if (message.type === "binary" && message.frame instanceof ArrayBuffer) this.callbacks.onBinary(message.frame, message.peerId, message.receivedAt);
  }

  async measureRtt(): Promise<number | null> {
    return await (window.monochromiumDesktop?.measureMultiplayerRtt() ?? null);
  }

  async createHostRoom(): Promise<string> {
    const desktop = window.monochromiumDesktop;
    if (!desktop) throw new Error("Multiplayer requires the Monochromium desktop app.");
    this._role = "host";
    this._sessionId = "";
    this.remotePeerId = "";
    this.binaryBusy = false;
    this.setStatus("creating-room", "Contacting the secure multiplayer relay…");
    try {
      const result = await desktop.startMultiplayerNetwork({ role: "host" });
      this._sessionId = roomCodeOrThrow(result.roomCode);
      return this._sessionId;
    } catch (error) {
      if (this._status !== "failed") this.setStatus("failed", error instanceof Error ? error.message : "Could not create the multiplayer room.");
      throw error;
    }
  }

  async joinRoom(rawRoomCode: string): Promise<string> {
    const desktop = window.monochromiumDesktop;
    if (!desktop) throw new Error("Multiplayer requires the Monochromium desktop app.");
    const code = roomCodeOrThrow(rawRoomCode);
    this._role = "guest";
    this._sessionId = code;
    this.remotePeerId = "";
    this.binaryBusy = false;
    this.setStatus("joining-room", "Contacting the secure multiplayer relay…");
    try {
      const result = await desktop.startMultiplayerNetwork({ role: "guest", roomCode: code });
      this._sessionId = roomCodeOrThrow(result.roomCode);
      return this._sessionId;
    } catch (error) {
      if (this._status !== "failed") this.setStatus("failed", error instanceof Error ? error.message : "Could not join the multiplayer room.");
      throw error;
    }
  }

  async retryConnection(): Promise<string> {
    const result = await window.monochromiumDesktop?.retryMultiplayerNetwork();
    if (!result) throw new Error("No multiplayer connection is available to retry.");
    this._sessionId = roomCodeOrThrow(result.roomCode);
    return this._sessionId;
  }

  sendControl(message: MultiplayerControlMessage): boolean {
    if (!this.connected || !window.monochromiumDesktop) return false;
    void window.monochromiumDesktop.sendMultiplayerControl(message);
    return true;
  }

  sendRealtime(message: MultiplayerRealtimeMessage): boolean {
    if (!this.connected || !window.monochromiumDesktop) return false;
    void window.monochromiumDesktop.sendMultiplayerRealtime(message);
    return true;
  }

  close(reason = "Session closed."): void {
    if (this.connected) this.sendControl({ type: "end", reason });
    void window.monochromiumDesktop?.stopMultiplayerNetwork(reason);
    this._role = null;
    this._sessionId = "";
    this.remotePeerId = "";
    this.binaryBusy = false;
    this.setStatus("closed", reason);
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
  const perkLoadout = Array.isArray(player.perkLoadout)
    ? [...new Set(player.perkLoadout.filter((kind): kind is TowerPerkKind => typeof kind === "string" && TOWER_PERK_ORDER.includes(kind as TowerPerkKind)))].slice(0, 3)
    : [];
  return {
    id: typeof player.id === "string" && /^[a-z0-9-]{4,64}$/i.test(player.id) ? player.id : fallbackId,
    username,
    color,
    loadout,
    perkLoadout,
  };
};
