import { describe, expect, it } from "vitest";
import {
  TOWER_HEALTH_BAR_FADE_MS,
  TOWER_HEALTH_BAR_HOLD_MS,
  TowerHealthBarTracker,
  towerHealthBarColor,
  towerHealthBarOpacity,
} from "./towerHealthBar.ts";

describe("tower health bar presentation", () => {
  it("uses a smooth green-to-yellow-to-red health color", () => {
    expect(towerHealthBarColor(1)).toBe("hsl(120, 85%, 50%)");
    expect(towerHealthBarColor(0.5)).toBe("hsl(60, 85%, 50%)");
    expect(towerHealthBarColor(0)).toBe("hsl(0, 85%, 50%)");
    expect(towerHealthBarColor(2)).toBe(towerHealthBarColor(1));
  });

  it("stays visible while selected or hovered", () => {
    expect(towerHealthBarOpacity(true, false, null, 10_000)).toBe(1);
    expect(towerHealthBarOpacity(false, true, null, 10_000)).toBe(1);
  });

  it("holds after damage, fades, and then expires", () => {
    const damagedAt = 2_000;
    expect(towerHealthBarOpacity(false, false, damagedAt, damagedAt + TOWER_HEALTH_BAR_HOLD_MS)).toBe(1);
    expect(towerHealthBarOpacity(false, false, damagedAt, damagedAt + TOWER_HEALTH_BAR_HOLD_MS + TOWER_HEALTH_BAR_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(towerHealthBarOpacity(false, false, damagedAt, damagedAt + TOWER_HEALTH_BAR_HOLD_MS + TOWER_HEALTH_BAR_FADE_MS)).toBe(0);
  });

  it("reveals only for damage after an established observation", () => {
    const tracker = new TowerHealthBarTracker();
    expect(tracker.opacityFor({ id: 1, hp: 100, maxHp: 100 }, 0, false, false)).toBe(0);
    expect(tracker.opacityFor({ id: 1, hp: 80, maxHp: 100 }, 100, false, false)).toBe(1);

    const expiredAt = 100 + TOWER_HEALTH_BAR_HOLD_MS + TOWER_HEALTH_BAR_FADE_MS;
    expect(tracker.opacityFor({ id: 1, hp: 90, maxHp: 100 }, expiredAt, false, false)).toBe(0);
    expect(tracker.opacityFor({ id: 1, hp: 90, maxHp: 120 }, expiredAt + 100, false, false)).toBe(0);
  });

  it("forgets removed towers and does not flash reused IDs", () => {
    const tracker = new TowerHealthBarTracker();
    tracker.opacityFor({ id: 4, hp: 100, maxHp: 100 }, 0, false, false);
    tracker.opacityFor({ id: 4, hp: 50, maxHp: 100 }, 100, false, false);
    tracker.retain(new Set());
    expect(tracker.opacityFor({ id: 4, hp: 25, maxHp: 100 }, 200, false, false)).toBe(0);
  });
});
