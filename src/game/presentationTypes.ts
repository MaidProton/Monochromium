import type { MultiplayerPlayer } from "./multiplayer.ts";
import type { Point, PlayerId, TowerKind, DamageType } from "./types.ts";

export interface TimedBomb {
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
  readonly damageType?: DamageType;
  timer: number;
}

export interface DelayedSlash {
  readonly towerId: number;
  readonly targetId: number;
  readonly damage: number;
  readonly color: string;
  readonly damageType?: DamageType;
  timer: number;
}

export interface PlayerRuntime {
  shards: number;
  pendingCasualtyRefund: number;
  damageIncomeRemainder: number;
  copiesRemaining: Record<TowerKind, number>;
}

export interface RemoteCursor {
  readonly player: MultiplayerPlayer;
  point: Point | null;
  readonly targetPoint: Point | null;
  updatedAt: number;
  lastRenderAt: number;
}

export interface AdmiralShot {
  readonly towerId: number;
  readonly position: Point;
  readonly damage: number;
  readonly radius: number;
  readonly color: string;
  readonly playerId: PlayerId;
  readonly towerLevel: number;
  timer: number;
}

export interface VisualProjectile {
  position: { x: number; y: number };
  readonly targetId: number | null;
  start: Point;
  readonly endpoint: Point;
  readonly kind: TowerKind;
  readonly speed: number;
  readonly color: string;
  readonly splash: boolean;
  readonly style?: "admiral" | "mecha-missile";
  delay?: number;
  readonly launchTowerId?: number;
  readonly launchSide?: number;
  readonly flightDuration?: number;
  launchSoundPlayed?: boolean;
  age: number;
  hidden: boolean;
  scale: number;
}

export interface MirrorFieldEffect {
  remaining: number;
  vfxTimer: number;
  readonly color: string;
}

/** A local-only marker shown while an authoritative placement command is in flight. */
export interface PendingPlacementFeedback {
  readonly commandId: string;
  readonly kind: TowerKind;
  readonly position: Point;
  readonly onPath: boolean;
  readonly relocatingTowerId?: number;
}
