import type { CustomEnemyDraft } from "./customEnemies.ts";
import type {
  MultiplayerCommand,
  MultiplayerGameSnapshot,
  MultiplayerPilotInput,
  MultiplayerPlayer,
  MultiplayerSessionStart,
} from "./multiplayer.ts";
import type { Point } from "./types.ts";

export const SIMULATION_TICK_HZ = 30;
// State is deliberately lower-rate than the fixed simulation. Clients keep a
// short interpolation buffer so this remains smooth without streaming every
// simulation tick.
export const REPLICATION_HZ = 8;
export const PILOT_REPLICATION_HZ = 10;
export const IDLE_REPLICATION_HZ = 1;
export const CONGESTED_REPLICATION_HZ = 4;

export interface SimulationSessionConfig {
  readonly protocol: number;
  readonly sessionId: string;
  readonly seed: number;
  readonly map: MultiplayerSessionStart["map"];
  readonly mode: MultiplayerSessionStart["mode"];
  readonly customEnemies: readonly CustomEnemyDraft[];
  readonly allowedTowers: MultiplayerSessionStart["allowedTowers"];
  readonly players: readonly MultiplayerPlayer[];
}

export interface SimulationCommandEnvelope {
  readonly commandId: string;
  readonly playerId: string;
  readonly clientSequence: number;
  readonly command: MultiplayerCommand;
}

export type CommandRejectionCode =
  | "invalid-command"
  | "invalid-player"
  | "duplicate"
  | "not-running"
  | "rejected";

export interface CommandResult {
  readonly commandId: string;
  readonly accepted: boolean;
  readonly serverTick: number;
  readonly rejectionCode?: CommandRejectionCode;
  readonly message?: string;
}

export type SimulationEventKind =
  | "log"
  | "spawn"
  | "attack"
  | "charge"
  | "flame"
  | "slash"
  | "dash"
  | "flurry"
  | "flurry-pulse"
  | "cross-slash"
  | "strike"
  | "impact"
  | "death"
  | "summon"
  | "counter"
  | "ability"
  | "shockwave"
  | "haste-pulse"
  | "drain"
  | "phase"
  | "blink"
  | "behavior"
  | "explosion"
  | "smash";

export interface SimulationEvent {
  readonly id: number;
  readonly tick: number;
  readonly kind: SimulationEventKind;
  readonly entityId?: number;
  readonly targetId?: number;
  readonly position?: Point;
  /** Optional origin for client-side tracer/beam effects. */
  readonly from?: Point;
  readonly visual?: "hitscan" | "projectile";
  readonly speed?: number;
  /** Cosmetic accent selected by the authoritative simulation. */
  readonly color?: string;
  readonly value?: number;
  readonly count?: number;
  /** Cosmetic-only offsets (in fixed ticks) for an otherwise coalesced burst. */
  readonly occurrenceTickOffsets?: readonly number[];
  readonly duration?: number;
  readonly label?: string;
  /** Stable v4 definition IDs; guests never infer these from card order. */
  readonly abilityId?: string;
  readonly actionId?: string;
  readonly phase?: "trigger" | "telegraph" | "target-lock" | "impact" | "action" | "complete";
  readonly tone?: "neutral" | "good" | "danger";
  readonly cosmeticSeed: number;
}

export interface AuthoritativeStateFrame {
  readonly tick: number;
  readonly generatedAt: number;
  readonly snapshot: MultiplayerGameSnapshot;
  readonly events: readonly SimulationEvent[];
}

export interface SimulationServerDiagnostics {
  readonly status: "starting" | "running" | "stopped" | "failed";
  readonly tick: number;
  readonly tickRate: number;
  readonly frameSequence: number;
  readonly startedAt: number;
  readonly packetRate?: number;
  readonly stateBytes?: number;
  readonly eventBytes?: number;
  readonly keyframes?: number;
  readonly replacedFrames?: number;
  readonly backpressureMs?: number;
  readonly message?: string;
}

export type HostServerInboundMessage =
  | { readonly type: "start"; readonly config: SimulationSessionConfig }
  | { readonly type: "restart"; readonly config: SimulationSessionConfig }
  | { readonly type: "command"; readonly envelope: SimulationCommandEnvelope }
  | { readonly type: "pilot-input"; readonly input: MultiplayerPilotInput }
  | { readonly type: "keyframe-request" }
  | { readonly type: "guest-pulse"; readonly sequence: number; readonly stateSequence: number; readonly eventId: number }
  | { readonly type: "host-cursor"; readonly point: Point | null }
  | { readonly type: "frame-replaced" }
  | { readonly type: "replication-pressure"; readonly congested: boolean }
  | { readonly type: "peer-status"; readonly connected: boolean }
  | { readonly type: "stop"; readonly reason: string };

export type HostServerOutboundMessage =
  | { readonly type: "ready"; readonly diagnostics: SimulationServerDiagnostics }
  | { readonly type: "state"; readonly frame: ArrayBuffer }
  | { readonly type: "network-bytes"; readonly bytes: number }
  | { readonly type: "command-result"; readonly result: CommandResult }
  | { readonly type: "diagnostics"; readonly diagnostics: SimulationServerDiagnostics }
  | { readonly type: "result"; readonly victory: boolean; readonly wave: number }
  | { readonly type: "fatal"; readonly message: string };
