import type { Point } from "./types.ts";

/** Cosmetic pose derived from actual displacement, including replicated motion. */
export interface MechaChassisPose {
  readonly position: Point;
  readonly angle: number;
  readonly targetAngle: number;
  readonly treadOffset: number;
}

export function advanceMechaChassisPose(previous: MechaChassisPose | undefined, position: Point, delta: number, reducedMotion = false): MechaChassisPose {
  const dx = previous ? position.x - previous.position.x : 0;
  const dy = previous ? position.y - previous.position.y : 0;
  const travel = Math.hypot(dx, dy);
  const targetAngle = travel > 0.001 ? Math.atan2(dy, dx) : previous?.targetAngle ?? 0;
  const angle = previous?.angle ?? targetAngle;
  const turn = Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle));
  return {
    position: { ...position },
    angle: reducedMotion ? targetAngle : angle + turn * (1 - Math.exp(-Math.max(0, delta) * 16)),
    targetAngle,
    treadOffset: reducedMotion ? 0 : ((previous?.treadOffset ?? 0) + travel) % 8,
  };
}
