import type { Point, Tower, TowerControlDefinition } from "./types.ts";

export const angleDifference = (target: number, current: number): number => Math.atan2(Math.sin(target - current), Math.cos(target - current));
const approach = (current: number, target: number, step: number): number => current + Math.max(-step, Math.min(step, target - current));
const turnToward = (angle: number, target: number, step: number): number => {
  const next = angle + Math.max(-step, Math.min(step, angleDifference(target, angle)));
  return Math.atan2(Math.sin(next), Math.cos(next));
};

/** Actual barrel direction, never the instantaneous mouse request. */
export function tankWeaponEndpoint(tower: Tower, range: number): Point {
  const aim = tower.aimPoint ?? { x: tower.position.x + range, y: tower.position.y };
  const angle = tower.mechaTurretAngle ?? Math.atan2(aim.y - tower.position.y, aim.x - tower.position.x);
  return { x: tower.position.x + Math.cos(angle) * range, y: tower.position.y + Math.sin(angle) * range };
}

/** Authoritative forward-only steering, acceleration, braking and turret traverse. */
export function advanceTankMotion(tower: Tower, moveX: number, moveY: number, delta: number, control: TowerControlDefinition, bounds: { x: number; y: number; width: number; height: number }, emergencyStop = false): void {
  tower.mechaHullAngle ??= 0;
  tower.mechaTurretAngle ??= 0;
  tower.mechaSpeed ??= 0;
  if (emergencyStop) { tower.mechaSpeed = 0; return; }
  const radius = control.bodyRadius;
  const left = bounds.x + radius;
  const right = bounds.x + bounds.width - radius;
  const top = bounds.y + radius;
  const bottom = bounds.y + bounds.height - radius;
  tower.position = { x: Math.max(left, Math.min(right, tower.position.x)), y: Math.max(top, Math.min(bottom, tower.position.y)) };
  const level = Math.min(tower.level, control.movementSpeed.length - 1);
  const driving = moveX !== 0 || moveY !== 0;
  const direction = driving ? Math.atan2(moveY, moveX) : tower.mechaHullAngle;
  // Substeps keep large diagnostic steps consistent with fixed-tick steering.
  let remaining = delta;
  while (remaining > 0.000001) {
    const dt = Math.min(remaining, 1 / 60);
    remaining -= dt;
    const previousAngle = tower.mechaHullAngle;
    tower.mechaHullAngle = turnToward(previousAngle, direction, control.hullTurnRate[level]! * dt);
    const alignment = Math.max(0, Math.cos(angleDifference(direction, tower.mechaHullAngle)));
    const desiredSpeed = driving ? control.movementSpeed[level]! * alignment * alignment : 0;
    tower.mechaSpeed = approach(tower.mechaSpeed, desiredSpeed, (desiredSpeed > tower.mechaSpeed ? control.acceleration[level]! : control.braking[level]!) * dt);
    const dx = Math.cos(tower.mechaHullAngle) * tower.mechaSpeed * dt;
    const dy = Math.sin(tower.mechaHullAngle) * tower.mechaSpeed * dt;
    const fraction = Math.max(0, Math.min(1,
      dx > 0 ? (right - tower.position.x) / dx : dx < 0 ? (left - tower.position.x) / dx : 1,
      dy > 0 ? (bottom - tower.position.y) / dy : dy < 0 ? (top - tower.position.y) / dy : 1));
    tower.position = { x: tower.position.x + dx * fraction, y: tower.position.y + dy * fraction };
    if (fraction < 1) tower.mechaSpeed = 0;
    // A rotating hull carries the mount; the motor then traverses toward aim.
    tower.mechaTurretAngle += angleDifference(tower.mechaHullAngle, previousAngle);
    const aim = tower.aimPoint;
    const targetAngle = aim && Math.hypot(aim.x - tower.position.x, aim.y - tower.position.y) > 0.001
      ? Math.atan2(aim.y - tower.position.y, aim.x - tower.position.x) : tower.mechaTurretAngle;
    tower.mechaTurretAngle = turnToward(tower.mechaTurretAngle, targetAngle, control.turretTurnRate[level]! * dt);
  }
}
