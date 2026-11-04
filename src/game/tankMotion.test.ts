import { describe, expect, it } from "vitest";
import { TOWER_DEFINITIONS } from "./config.ts";
import { advanceTankMotion, angleDifference, tankWeaponEndpoint } from "./tankMotion.ts";
import { makeTestTower } from "./testSupport.ts";

const control = TOWER_DEFINITIONS.mecha.control!;
const bounds = { x: 0, y: 0, width: 1600, height: 700 };
const tank = () => makeTestTower("mecha", 0, { position: { x: 600, y: 350 }, mechaHullAngle: 0, mechaTurretAngle: 0, mechaSpeed: 0, aimPoint: { x: 1000, y: 350 } });

describe("Tank driving and turret traverse", () => {
  it("accelerates toward top speed and brakes to rest on key release", () => {
    const tower = tank();
    advanceTankMotion(tower, 1, 0, 0.1, control, bounds);
    expect(tower.mechaSpeed).toBeCloseTo(22);
    advanceTankMotion(tower, 1, 0, 1, control, bounds);
    expect(tower.mechaSpeed).toBe(150);
    advanceTankMotion(tower, 0, 0, 0.1, control, bounds);
    expect(tower.mechaSpeed).toBeGreaterThan(0);
    expect(tower.mechaSpeed).toBeLessThan(150);
    advanceTankMotion(tower, 0, 0, 1, control, bounds);
    const stopped = { ...tower.position };
    advanceTankMotion(tower, 0, 0, 1, control, bounds);
    expect(tower.position).toEqual(stopped);
  });

  it("turns through arbitrary angles and only travels along its front when reversing", () => {
    const tower = tank();
    tower.mechaHullAngle = -Math.PI / 2;
    tower.mechaSpeed = 150;
    const angles = new Set<string>();
    for (let tick = 0; tick < 120; tick += 1) {
      const from = { ...tower.position };
      advanceTankMotion(tower, 0, 1, 1 / 60, control, bounds);
      angles.add(tower.mechaHullAngle!.toFixed(3));
      const dx = tower.position.x - from.x;
      const dy = tower.position.y - from.y;
      if (Math.hypot(dx, dy) > 0.001) expect(angleDifference(Math.atan2(dy, dx), tower.mechaHullAngle!)).toBeCloseTo(0, 7);
    }
    expect(angles.size).toBeGreaterThan(8);
    expect(tower.mechaHullAngle).toBeCloseTo(Math.PI / 2);
    expect(tower.mechaSpeed).toBeCloseTo(150);
  });

  it("does not gain speed diagonally and cannot slide along a wall sideways", () => {
    const straight = tank();
    const diagonal = tank();
    diagonal.mechaHullAngle = Math.PI / 4;
    advanceTankMotion(straight, 1, 0, 1, control, bounds);
    advanceTankMotion(diagonal, 1, 1, 1, control, bounds);
    expect(Math.hypot(diagonal.position.x - 600, diagonal.position.y - 350)).toBeCloseTo(straight.position.x - 600);
    diagonal.position = { x: 1572, y: 400 };
    advanceTankMotion(diagonal, 1, 1, 0.1, control, bounds);
    expect(diagonal.position).toEqual({ x: 1572, y: 400 });
    expect(diagonal.mechaSpeed).toBe(0);
  });

  it("limits turret velocity, holds orientation at zero aim distance, and stops safely", () => {
    const tower = tank();
    tower.aimPoint = { x: 100, y: 350 };
    advanceTankMotion(tower, 0, 0, 0.1, control, bounds);
    expect(Math.abs(tower.mechaTurretAngle!)).toBeCloseTo(control.turretTurnRate[0]! * 0.1);
    expect(tankWeaponEndpoint(tower, 100).x).toBeGreaterThan(tower.position.x);
    const angle = tower.mechaTurretAngle;
    tower.aimPoint = { ...tower.position };
    advanceTankMotion(tower, 0, 0, 0.1, control, bounds);
    expect(tower.mechaTurretAngle).toBe(angle);
    tower.mechaSpeed = 100;
    const from = { ...tower.position };
    advanceTankMotion(tower, 1, 0, 0.1, control, bounds, true);
    expect(tower.mechaSpeed).toBe(0);
    expect(tower.position).toEqual(from);
  });
});
