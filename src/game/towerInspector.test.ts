import { describe, expect, it } from "vitest";
import { TOWER_DEFINITIONS } from "./config.ts";
import { buildTowerInspectorData } from "./towerInspector.ts";
import { getTowerBehavior } from "./towerBehaviors/index.ts";
import { makeTestTower } from "./testSupport.ts";

describe("tower inspector data", () => {
  it("exposes static, computed, and live tower readouts", () => {
    const tower = makeTestTower("cyborg", 3, {
      onPath: true,
      hp: 72,
      maxHp: 100,
      maxAggro: 2,
      fireTimer: 1.25,
      counterCooldown: 2.5,
      autoCounter: true,
      abilityCooldown: 3,
      ammo: 4,
      damageBuff: 1.5,
      fireRateBuff: 0.2,
    });
    tower.engaged.add(10);
    tower.engaged.add(11);
    const definition = TOWER_DEFINITIONS.cyborg;
    const stats = definition.levels[tower.level]!;
    const data = buildTowerInspectorData({
      tower,
      definition,
      levelStats: stats,
      damageMultiplier: tower.damageBuff,
      sellValue: 1_200,
      incomingAttack: 0.4,
      behaviorStats: [],
    });
    const values = new Map(data.stats.map((stat) => [stat.key, stat.value]));

    expect(data.sellValue).toBe(1_200);
    const effectiveDamage = stats.damage * 1.5;
    expect(values.get("damage")).toBe(`${Number.isInteger(effectiveDamage) ? effectiveDamage : effectiveDamage.toFixed(1)} × 1`);
    expect(values.get("attack-rate")).toBe((1.2 / stats.fireRate).toFixed(2));
    expect(values.get("dps")).toBe((stats.damage * 1.5 * 1.2 / stats.fireRate).toFixed(1));
    expect(values.get("integrity")).toBe("72/100");
    expect(values.get("aggro")).toBe("2/2");
    expect(values.get("attack-cooldown")).toBe("1.3s");
    expect(values.get("auto-counter")).toBe("ONLINE");
    expect(values.get("ammo")).toBe(`4/${stats.ammo}`);
    expect(values.get("damage-buff")).toContain("×1.50");
    expect(values.get("incoming-attack")).toBe("0.4s");
  });

  it("accepts tower-specific advanced stats from behavior hooks", () => {
    const tower = makeTestTower("prism", 5);
    const definition = TOWER_DEFINITIONS.prism;
    const levelStats = definition.levels[tower.level]!;
    const behaviorStats = getTowerBehavior("prism")?.inspectorStats?.(tower, levelStats) ?? [];
    const data = buildTowerInspectorData({
      tower,
      definition,
      levelStats,
      damageMultiplier: 1,
      sellValue: 100,
      incomingAttack: null,
      behaviorStats,
    });

    expect(data.stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "chain-targets", value: "5", group: "advanced" }),
      expect.objectContaining({ key: "chain-retention", value: "80% PER BOUNCE", group: "advanced" }),
      expect.objectContaining({ key: "chain-range", value: "135", group: "advanced" }),
    ]));
  });

  it("reports integrity for ranged-field towers", () => {
    const tower = makeTestTower("bandit", 0, { onPath: false, hp: 37, maxHp: 60 });
    const definition = TOWER_DEFINITIONS.bandit;
    const data = buildTowerInspectorData({
      tower,
      definition,
      levelStats: definition.levels[tower.level]!,
      damageMultiplier: 1,
      sellValue: 50,
      incomingAttack: null,
    });

    expect(data.stats.find((stat) => stat.key === "integrity")?.value).toBe("37/60");
  });

  it("counts Bandit and Warrior burst hits in sustained DPS", () => {
    const cases = [
      { kind: "bandit" as const, level: 3, damage: 4, fireRate: 1, rate: 2, dps: 8 },
      { kind: "warrior" as const, level: 4, damage: 26, fireRate: 0.7, rate: 2 / 0.7, dps: 26 * 2 / 0.7 },
    ];

    cases.forEach(({ kind, level, damage, fireRate, rate, dps }) => {
      const tower = makeTestTower(kind, level);
      const definition = TOWER_DEFINITIONS[kind];
      const data = buildTowerInspectorData({
        tower,
        definition,
        levelStats: definition.levels[level]!,
        damageMultiplier: 1,
        sellValue: 100,
        incomingAttack: null,
      });
      const values = new Map(data.stats.map((stat) => [stat.key, stat.value]));

      expect(values.get("damage")).toBe(`${damage} × 2`);
      expect(values.get("attack-rate")).toBe(rate.toFixed(2));
      expect(values.get("dps")).toBe(dps.toFixed(1));
      expect(values.get("attack-rate")).not.toBe(fireRate.toFixed(2));
    });
  });

  it("builds hover breakdowns for Bandit's blade and Cyborg's late abilities", () => {
    const bandit = makeTestTower("bandit", 3);
    const banditData = buildTowerInspectorData({
      tower: bandit,
      definition: TOWER_DEFINITIONS.bandit,
      levelStats: TOWER_DEFINITIONS.bandit.levels[3]!,
      damageMultiplier: 1,
      sellValue: 100,
      incomingAttack: null,
    });
    const banditPopovers = new Map(banditData.popovers.map((popover) => [popover.key, popover]));
    expect(banditPopovers.get("damage")?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "BLADE", value: "8", note: expect.stringContaining("3.5s") }),
    ]));
    expect(banditPopovers.get("fire-rate")?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "BURST DELAY", value: "0.30s" }),
      expect.objectContaining({ label: "BLADE", value: "3.50s" }),
    ]));
    expect(banditPopovers.get("range")?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "BLADE REACH", value: "6.1" }),
    ]));

    const cyborg = makeTestTower("cyborg", 5);
    const cyborgData = buildTowerInspectorData({
      tower: cyborg,
      definition: TOWER_DEFINITIONS.cyborg,
      levelStats: TOWER_DEFINITIONS.cyborg.levels[5]!,
      damageMultiplier: 1,
      sellValue: 100,
      incomingAttack: null,
    });
    const cyborgPopovers = new Map(cyborgData.popovers.map((popover) => [popover.key, popover]));
    expect(cyborgPopovers.get("damage")?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "HOWITZER", value: "50", note: expect.stringContaining("every 20 shots") }),
      expect.objectContaining({ label: "JETSTREAM MISSILES", value: "140 × 3 = 420" }),
    ]));
    expect(cyborgPopovers.get("fire-rate")?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "HOWITZER", value: "EVERY 20 SHOTS" }),
      expect.objectContaining({ label: "JETSTREAM", value: "8.00s" }),
    ]));
    expect(cyborgPopovers.get("dps")?.rows.at(-1)).toEqual(expect.objectContaining({ label: "MAX OUTPUT", value: "76.7" }));
  });

  it("shows Cyborg's internal ramp as a faster base cycle, not a buff", () => {
    const tower = makeTestTower("cyborg", 4, { attackRamp: 0.5 });
    const definition = TOWER_DEFINITIONS.cyborg;
    const data = buildTowerInspectorData({
      tower,
      definition,
      levelStats: definition.levels[tower.level]!,
      baseAttackInterval: getTowerBehavior("cyborg")?.getBaseAttackInterval?.(tower, definition.levels[tower.level]!.fireRate),
      damageMultiplier: 1,
      sellValue: 100,
      incomingAttack: null,
    });
    const values = new Map(data.stats.map((stat) => [stat.key, stat.value]));
    const ratePopover = data.popovers.find((popover) => popover.key === "fire-rate");

    expect(values.get("attack-rate")).toBe("5.00");
    expect(values.get("fire-rate-buff")).toBe("0%");
    expect(ratePopover?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "BASE CYCLE", value: "0.20s BASE", note: expect.stringContaining("before shared fire-rate buffs") }),
    ]));
  });

  it("includes explicit burst spacing in Gunner's attack cadence", () => {
    const tower = makeTestTower("gunner", 4);
    const definition = TOWER_DEFINITIONS.gunner;
    const data = buildTowerInspectorData({
      tower,
      definition,
      levelStats: definition.levels[tower.level]!,
      damageMultiplier: 1,
      sellValue: 100,
      incomingAttack: null,
    });
    const values = new Map(data.stats.map((stat) => [stat.key, stat.value]));
    const attacksPerSecond = 4 / (1.5 + 0.2 * 3);

    expect(values.get("attack-rate")).toBe(attacksPerSecond.toFixed(2));
    expect(values.get("dps")).toBe((5 * attacksPerSecond).toFixed(1));
  });
});
