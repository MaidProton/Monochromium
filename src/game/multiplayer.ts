import type { CustomEnemyDraft } from "./customEnemies.ts";
import { TOWER_ORDER } from "./config.ts";
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

export const MULTIPLAYER_PROTOCOL_VERSION = 2;
export const MULTIPLAYER_SNAPSHOT_HZ = 15;

const MAX_CONTROL_BYTES = 2_000_000;
const MAX_REALTIME_BYTES = 1_000_000;
const MAX_REALTIME_BUFFER = 256_000;
const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export type MultiplayerRole = "host" | "guest";
export type MultiplayerConnectionStatus =
  | "idle"
  | "creating-offer"
  | "waiting-for-answer"
  | "creating-answer"
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
  | { readonly type: "command"; readonly command: MultiplayerCommand }
  | { readonly type: "log"; readonly message: string; readonly tone?: "neutral" | "good" | "danger" }
  | { readonly type: "result"; readonly result: MultiplayerResult }
  | { readonly type: "end"; readonly reason: string }
  | { readonly type: "error"; readonly message: string };

export type MultiplayerRealtimeMessage =
  | { readonly type: "snapshot"; readonly snapshot: MultiplayerGameSnapshot }
  | { readonly type: "cursor"; readonly point: Point | null };

type WireMessage = MultiplayerControlMessage | MultiplayerRealtimeMessage;

interface WireEnvelope {
  readonly protocol: number;
  readonly sessionId: string;
  readonly message: WireMessage;
}

interface PairingCode {
  readonly type: "monochromium-webrtc";
  readonly protocol: number;
  readonly kind: "offer" | "answer";
  readonly sessionId: string;
  readonly description: RTCSessionDescriptionInit;
}

interface MultiplayerSessionCallbacks {
  readonly onStatus: (status: MultiplayerConnectionStatus, detail?: string) => void;
  readonly onControl: (message: MultiplayerControlMessage) => void;
  readonly onRealtime: (message: MultiplayerRealtimeMessage) => void;
}

const randomId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const encodeUtf8Base64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const decodeUtf8Base64 = (value: string): string => {
  const binary = atob(value.trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const encodePairingCode = (code: PairingCode): string => encodeUtf8Base64(JSON.stringify(code));

const parsePairingCode = (raw: string, expectedKind: PairingCode["kind"]): PairingCode => {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8Base64(raw));
  } catch {
    throw new Error("Invalid pairing code. Copy the entire code without editing it.");
  }
  if (!value || typeof value !== "object") throw new Error("Invalid pairing code.");
  const code = value as Partial<PairingCode>;
  if (code.type !== "monochromium-webrtc" || code.kind !== expectedKind || !code.description || typeof code.sessionId !== "string") {
    throw new Error(`This is not a valid Monochromium ${expectedKind} code.`);
  }
  if (code.protocol !== MULTIPLAYER_PROTOCOL_VERSION) {
    throw new Error(`Multiplayer protocol mismatch (local ${MULTIPLAYER_PROTOCOL_VERSION}, remote ${String(code.protocol)}).`);
  }
  if (code.description.type !== expectedKind || typeof code.description.sdp !== "string") {
    throw new Error(`The ${expectedKind} code does not contain a valid WebRTC description.`);
  }
  return code as PairingCode;
};

const waitForIceGathering = async (peer: RTCPeerConnection): Promise<void> => {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }, 8_000);
    const onChange = (): void => {
      if (peer.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", onChange);
  });
};

export class MultiplayerSession {
  private peer: RTCPeerConnection | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private realtimeChannel: RTCDataChannel | null = null;
  private _role: MultiplayerRole | null = null;
  private _status: MultiplayerConnectionStatus = "idle";
  private _sessionId = "";
  private intentionallyClosed = false;

  constructor(private readonly callbacks: MultiplayerSessionCallbacks) {}

  get role(): MultiplayerRole | null { return this._role; }
  get status(): MultiplayerConnectionStatus { return this._status; }
  get sessionId(): string { return this._sessionId; }
  get connected(): boolean { return this._status === "connected"; }

  async createHostOffer(sessionId = this._sessionId || randomId()): Promise<string> {
    this.closePeer(false);
    this._role = "host";
    this._sessionId = sessionId;
    this.intentionallyClosed = false;
    this.setStatus("creating-offer", "Gathering direct connection candidates…");
    const peer = this.createPeer();
    this.attachChannel(peer.createDataChannel("control", { ordered: true }), "control");
    this.attachChannel(peer.createDataChannel("realtime", { ordered: false, maxRetransmits: 0 }), "realtime");
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIceGathering(peer);
    if (!peer.localDescription) throw new Error("WebRTC did not produce an offer.");
    this.setStatus("waiting-for-answer", "Offer ready. Send it to the guest, then paste their answer.");
    return encodePairingCode({
      type: "monochromium-webrtc",
      protocol: MULTIPLAYER_PROTOCOL_VERSION,
      kind: "offer",
      sessionId: this._sessionId,
      description: peer.localDescription.toJSON(),
    });
  }

  async acceptHostOffer(rawOffer: string): Promise<string> {
    const offer = parsePairingCode(rawOffer, "offer");
    this.closePeer(false);
    this._role = "guest";
    this._sessionId = offer.sessionId;
    this.intentionallyClosed = false;
    this.setStatus("creating-answer", "Accepting host offer and gathering connection candidates…");
    const peer = this.createPeer();
    peer.ondatachannel = (event) => {
      if (event.channel.label === "control" || event.channel.label === "realtime") {
        this.attachChannel(event.channel, event.channel.label);
      } else {
        event.channel.close();
      }
    };
    await peer.setRemoteDescription(offer.description);
    await peer.setLocalDescription(await peer.createAnswer());
    await waitForIceGathering(peer);
    if (!peer.localDescription) throw new Error("WebRTC did not produce an answer.");
    this.setStatus("connecting", "Answer ready. Send it to the host.");
    return encodePairingCode({
      type: "monochromium-webrtc",
      protocol: MULTIPLAYER_PROTOCOL_VERSION,
      kind: "answer",
      sessionId: this._sessionId,
      description: peer.localDescription.toJSON(),
    });
  }

  async acceptGuestAnswer(rawAnswer: string): Promise<void> {
    if (this._role !== "host" || !this.peer) throw new Error("Create a host offer before applying an answer.");
    const answer = parsePairingCode(rawAnswer, "answer");
    if (answer.sessionId !== this._sessionId) throw new Error("This answer belongs to a different multiplayer session.");
    this.setStatus("connecting", "Applying guest answer…");
    await this.peer.setRemoteDescription(answer.description);
  }

  sendControl(message: MultiplayerControlMessage): boolean {
    return this.send(this.controlChannel, message, MAX_CONTROL_BYTES, false);
  }

  sendRealtime(message: MultiplayerRealtimeMessage): boolean {
    return this.send(this.realtimeChannel, message, MAX_REALTIME_BYTES, true);
  }

  close(reason = "Session closed."): void {
    if (this.connected) this.sendControl({ type: "end", reason });
    this.intentionallyClosed = true;
    this.closePeer(true);
    this._role = null;
    this._sessionId = "";
    this.setStatus("closed", reason);
  }

  private createPeer(): RTCPeerConnection {
    const peer = new RTCPeerConnection(RTC_CONFIGURATION);
    this.peer = peer;
    peer.onconnectionstatechange = () => {
      if (peer !== this.peer) return;
      if (peer.connectionState === "connected") this.maybeConnected();
      else if (peer.connectionState === "failed") this.setStatus("failed", "Direct connection failed. A restrictive NAT may require TURN, which is not configured.");
      else if (peer.connectionState === "disconnected" && !this.intentionallyClosed) this.setStatus("disconnected", "Peer disconnected. Create a new pairing exchange to reconnect this session.");
      else if (peer.connectionState === "closed" && !this.intentionallyClosed) this.setStatus("disconnected", "Peer connection closed.");
    };
    peer.onicecandidateerror = () => {
      if (this._status !== "connected") this.callbacks.onStatus(this._status, "Some network candidates failed; local or other candidates may still connect.");
    };
    return peer;
  }

  private attachChannel(channel: RTCDataChannel, kind: "control" | "realtime"): void {
    if (kind === "control") this.controlChannel = channel;
    else this.realtimeChannel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.maybeConnected();
    channel.onclose = () => {
      if (!this.intentionallyClosed && this._status === "connected") this.setStatus("disconnected", `${kind} channel closed. Re-pair to reconnect.`);
    };
    channel.onerror = () => this.setStatus("failed", `${kind} channel encountered a WebRTC error.`);
    channel.onmessage = (event) => this.receive(event.data, kind);
  }

  private maybeConnected(): void {
    if (this.peer?.connectionState === "connected" && this.controlChannel?.readyState === "open" && this.realtimeChannel?.readyState === "open") {
      this.setStatus("connected", "Peer connected directly.");
    }
  }

  private receive(raw: unknown, kind: "control" | "realtime"): void {
    if (typeof raw !== "string" || raw.length > (kind === "control" ? MAX_CONTROL_BYTES : MAX_REALTIME_BYTES)) return;
    try {
      const envelope = JSON.parse(raw) as Partial<WireEnvelope>;
      if (envelope.protocol !== MULTIPLAYER_PROTOCOL_VERSION || envelope.sessionId !== this._sessionId || !envelope.message) return;
      if (kind === "control") this.callbacks.onControl(envelope.message as MultiplayerControlMessage);
      else this.callbacks.onRealtime(envelope.message as MultiplayerRealtimeMessage);
    } catch {
      if (kind === "control") this.sendControl({ type: "error", message: "Malformed control message rejected." });
    }
  }

  private send(channel: RTCDataChannel | null, message: WireMessage, maxBytes: number, dropWhenBuffered: boolean): boolean {
    if (!channel || channel.readyState !== "open") return false;
    if (dropWhenBuffered && channel.bufferedAmount > MAX_REALTIME_BUFFER) return false;
    const wire = JSON.stringify({ protocol: MULTIPLAYER_PROTOCOL_VERSION, sessionId: this._sessionId, message } satisfies WireEnvelope);
    if (wire.length > maxBytes) return false;
    try {
      channel.send(wire);
      return true;
    } catch {
      return false;
    }
  }

  private closePeer(clearChannels: boolean): void {
    this.controlChannel?.close();
    this.realtimeChannel?.close();
    this.peer?.close();
    this.peer = null;
    if (clearChannels) {
      this.controlChannel = null;
      this.realtimeChannel = null;
    } else {
      this.controlChannel = null;
      this.realtimeChannel = null;
    }
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
