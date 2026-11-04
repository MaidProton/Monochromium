import { describe, expect, it } from "vitest";
import { advanceMechaChassisPose } from "./mechaPresentation.ts";
import { makeTestTower } from "./testSupport.ts";

describe("Mecha chassis presentation", () => {
  it("faces actual movement independently of mouse aim and holds its heading when stopped", () => {
    const tower = makeTestTower("mecha", 0, { position: { x: 100, y: 100 }, aimPoint: { x: 300, y: 100 } });
    let pose = advanceMechaChassisPose(undefined, tower.position, 0);
    tower.position = { x: 100, y: 120 };
    pose = advanceMechaChassisPose(pose, tower.position, 1);
    expect(pose.angle).toBeCloseTo(Math.PI / 2);
    expect(pose.treadOffset).toBe(4);
    tower.aimPoint = { x: 0, y: 100 };
    const stopped = advanceMechaChassisPose(pose, tower.position, 1);
    expect(stopped.angle).toBeCloseTo(Math.PI / 2);
    expect(stopped.treadOffset).toBe(pose.treadOffset);
  });

  it("uses diagonal replicated displacement and takes the shortest turn across the angle seam", () => {
    const pose = advanceMechaChassisPose(undefined, { x: 0, y: 0 }, 0);
    const diagonal = advanceMechaChassisPose(pose, { x: -10, y: 10 }, 1, true);
    expect(diagonal.angle).toBeCloseTo(Math.PI * 0.75);
    expect(diagonal.treadOffset).toBe(0);
    const wrapped = advanceMechaChassisPose({ ...pose, angle: Math.PI - 0.01 }, { x: -10, y: -0.1 }, 0.01);
    expect(Math.abs(wrapped.angle - (Math.PI - 0.01))).toBeLessThan(0.01);
  });
});
