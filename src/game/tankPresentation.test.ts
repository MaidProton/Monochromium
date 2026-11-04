import { describe, expect, it, vi } from "vitest";
import { drawTankPlasmaBeam, tankCannonRecoil } from "./tankPresentation.ts";
import { makeTestTower } from "./testSupport.ts";

describe("continuous Tank plasma beam", () => {
  it("keeps the barrel attached during overheat, idle and active cooldowns", () => {
    const tower = makeTestTower("mecha", 7, { mechaFiring: true, mechaOverheatTimer: 4 });
    for (const timer of [-100, -5, -0.1, 0, 0.1, 100]) {
      tower.fireTimer = timer;
      expect(tankCannonRecoil(tower)).toBeGreaterThanOrEqual(0);
      expect(tankCannonRecoil(tower)).toBeLessThanOrEqual(5);
      if (timer <= 0) expect(tankCannonRecoil(tower)).toBe(0);
    }
  });
  it("draws between damage ticks and stops immediately with the channel", () => {
    const stroke = vi.fn();
    const canvas = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke, fill: vi.fn(), arc: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }) } as unknown as CanvasRenderingContext2D;
    const tower = makeTestTower("mecha", 3, { mechaControlled: true, mechaActiveAbility: "g", mechaAbilityTimer: 2 });
    for (const timeUntilTick of [0.15, 0.1, 0.001]) {
      tower.fieldTickTimer = timeUntilTick;
      drawTankPlasmaBeam(canvas, tower, 435);
    }
    expect(stroke).toHaveBeenCalledTimes(9);
    tower.mechaActiveAbility = null;
    drawTankPlasmaBeam(canvas, tower, 435);
    expect(stroke).toHaveBeenCalledTimes(9);
    tower.mechaActiveAbility = "g";
    tower.mechaOverheatTimer = 2;
    drawTankPlasmaBeam(canvas, tower, 435);
    expect(stroke).toHaveBeenCalledTimes(9);
  });
});
