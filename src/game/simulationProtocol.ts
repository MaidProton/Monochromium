import type { CustomEnemyDraft } from "./customEnemies.ts";
import type {
  MultiplayerCommand,
  MultiplayerGameSnapshot,
  MultiplayerPlayer,
  MultiplayerSessionStart,
} from "./multiplayer.ts";
import type { Point } from "./types.ts";

export const SIMULATION_TICK_HZ = 30;
// State is deliberately lower-rate than the fixed simulation. Clients keep a
// short interpolation buffer so this remains smooth without streaming every
// simulation tick.
export const REPLICATION_HZ = 10;

export interface SimulationSessionConfig {
  readonly protocol: number;
  readonly sessionId: string;
  readonly seed: number;
  readonly map: MultiplayerSessionStart["map"];
  readonly mode: MultiplayerSessionStart["mode"];
  readonly customEnemies: readonly CustomEnemyDraft[];
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
  | "slash"
  | "cross-slash"
  | "strike"
  | "impact"
  | "death"
  | "summon"
  | "counter"
  | "ability"
  | "shockwave"
  | "explosion";

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
  readonly label?: string;
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
  readonly message?: string;
}

export type HostServerInboundMessage =
  | { readonly type: "start"; readonly config: SimulationSessionConfig }
  | { readonly type: "command"; readonly envelope: SimulationCommandEnvelope }
  | { readonly type: "keyframe-request" }
  | { readonly type: "event-ack"; readonly eventId: number }
  | { readonly type: "peer-status"; readonly connected: boolean }
  | { readonly type: "stop"; readonly reason: string };

export type HostServerOutboundMessage =
  | { readonly type: "ready"; readonly diagnostics: SimulationServerDiagnostics }
  | { readonly type: "state"; readonly frame: ArrayBuffer }
  | { readonly type: "command-result"; readonly result: CommandResult }
  | { readonly type: "diagnostics"; readonly diagnostics: SimulationServerDiagnostics }
  | { readonly type: "result"; readonly victory: boolean; readonly wave: number }
  | { readonly type: "fatal"; readonly message: string };
