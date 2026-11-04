import { describe, expect, it } from "vitest";
import { makeTestTower } from "../game/testSupport.ts";
import { mechaAbilityState, mechaWeaponStatus, renderMechaControls, renderTankCooldowns, tankCooldownState } from "./mechaControls.ts";

describe("Mecha inspector states", () => {
  it("shows true recharge time even when another channel blocks a weapon", () => {
    const tower = makeTestTower("mecha", 7, { mechaControlled: true, mechaActiveAbility: "g", abilityCooldowns: { f: 11, g: 30, h: 0 } });
    expect(tankCooldownState(tower, "f")).toMatchObject({ label: "11.0s" });
    expect(tankCooldownState(tower, "f").progress).toBeCloseTo(7 / 18);
    expect(tankCooldownState(tower, "g").active).toBe(true);
    expect(tankCooldownState(tower, "h").label).toBe("READY");
    tower.level = 0;
    expect(tankCooldownState(tower, "g")).toMatchObject({ label: "LV 3", progress: 0, locked: true });
    expect(renderTankCooldowns().match(/role="progressbar"/g)).toHaveLength(3);
  });
  it("renders owner controls and keeps remote ownership read-only", () => {
    const tower = makeTestTower("mecha", 7, { mechaHeat: 42 });
    expect(renderMechaControls(tower, true)).toContain("ENTER PILOT MODE");
    expect(renderMechaControls(tower, true)).toContain("HEAT 42 / 400");
    expect(renderMechaControls(tower, false)).toContain("READ ONLY");
    expect(renderMechaControls(tower, false)).toContain("disabled");
    expect(mechaWeaponStatus(tower)).toBe("DORMANT");
    expect(mechaAbilityState(tower, "f", true, false).status).toBe("PILOT REQUIRED");
    expect(mechaAbilityState(tower, "f", false, false).status).toBe("OWNER ONLY");
  });

  it("uses actual level-scaled channel duration and blocks conflicting weapons", () => {
    const tower = makeTestTower("mecha", 7, { mechaControlled: true, mechaActiveAbility: "g", mechaAbilityTimer: 2.25 });
    expect(mechaAbilityState(tower, "g", true, false).progress).toBe(0.5);
    expect(mechaAbilityState(tower, "h", true, false).status).toBe("CHANNEL BUSY");
    expect(mechaAbilityState(tower, "f", true, true).status).toBe("PAUSED");
    tower.mechaActiveAbility = null;
    tower.mechaOverheatTimer = 3;
    expect(mechaAbilityState(tower, "f", true, false).status).toBe("OVERHEATED");
    expect(mechaWeaponStatus(tower)).toBe("COOLING 3.0s");
    tower.mechaOverheatTimer = 0;
    tower.level = 0;
    expect(mechaAbilityState(tower, "g", true, false).status).toBe("LEVEL 3");
  });
});
