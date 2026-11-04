import { describe, expect, it } from "vitest";
import {
  calculateResistanceMultiplier,
  DEFAULT_ENEMY_RESISTANCES,
  sanitizeResistances,
} from "./damageTypes.ts";
import { ENEMY_DEFINITIONS, TOWER_DEFINITIONS } from "./config.ts";
import { createCustomEnemy, customEnemyToDefinition, sanitizeCustomEnemies } from "./customEnemies.ts";
import { validateGameDefinitions } from "./definitionValidation.ts";
import {
  createHeadlessGame,
  getTestGameInternals,
  makeTestEnemy,
  makeTestTower,
} from "./testSupport.ts";

describe("damage types and resistance calculation", () => {
  it("calculates resistance multipliers correctly", () => {
    expect(calculateResistanceMultiplier(undefined)).toBe(1);
    expect(calculateResistanceMultiplier(0)).toBe(1);
    expect(calculateResistanceMultiplier(0.25)).toBeCloseTo(0.75);
    expect(calculateResistanceMultiplier(0.5)).toBeCloseTo(0.5);
    expect(calculateResistanceMultiplier(1.0)).toBe(0);
    // Positive resistance caps at 100% (takes 0 damage)
    expect(calculateResistanceMultiplier(1.5)).toBe(0);

    // Negative resistance has no lower bound (amplifies damage)
    expect(calculateResistanceMultiplier(-0.7)).toBeCloseTo(1.7);
    expect(calculateResistanceMultiplier(-1.5)).toBeCloseTo(2.5);
  });

  it("sanitizes resistance inputs", () => {
    const empty = sanitizeResistances(null);
    expect(empty).toEqual(DEFAULT_ENEMY_RESISTANCES);

    const sanitized = sanitizeResistances({
      bullet: 1.5,
      energy: -0.7,
      explosive: 0.3,
      fire: "invalid",
      melee: 0.8,
    });
    expect(sanitized.bullet).toBe(1.0); // capped at 1.0
    expect(sanitized.energy).toBe(-0.7); // unbounded negative
    expect(sanitized.explosive).toBe(0.3);
    expect(sanitized.fire).toBe(0); // fallback
    expect(sanitized.melee).toBe(0.8);
  });

  it("assigns expected base damage types to official towers", () => {
    expect(TOWER_DEFINITIONS.bandit.damageType).toBe("bullet");
    expect(TOWER_DEFINITIONS.gunner.damageType).toBe("bullet");
    expect(TOWER_DEFINITIONS.mercenary.damageType).toBe("bullet");
    expect(TOWER_DEFINITIONS.recon.damageType).toBe("bullet");
    expect(TOWER_DEFINITIONS.latch.damageType).toBe("bullet");
    expect(TOWER_DEFINITIONS.mecha.damageType).toBe("bullet");

    expect(TOWER_DEFINITIONS.cyborg.damageType).toBe("energy");
    expect(TOWER_DEFINITIONS.tempest.damageType).toBe("energy");
    expect(TOWER_DEFINITIONS.prism.damageType).toBe("energy");
    expect(TOWER_DEFINITIONS.zenith.damageType).toBe("energy");

    expect(TOWER_DEFINITIONS.bomber.damageType).toBe("explosive");
    expect(TOWER_DEFINITIONS.admiral.damageType).toBe("explosive");

    expect(TOWER_DEFINITIONS.infernus.damageType).toBe("fire");

    expect(TOWER_DEFINITIONS.samurai.damageType).toBe("melee");
    expect(TOWER_DEFINITIONS.warrior.damageType).toBe("melee");
    expect(TOWER_DEFINITIONS.vanguard.damageType).toBe("melee");
    expect(TOWER_DEFINITIONS.wraith.damageType).toBe("melee");
  });
});

describe("custom enemy resistances and definition validation", () => {
  it("initializes custom enemies with default resistances", () => {
    const enemy = createCustomEnemy();
    expect(enemy.resistances).toEqual(DEFAULT_ENEMY_RESISTANCES);
  });

  it("sanitizes custom enemy drafts with positive and negative resistances", () => {
    const drafts = sanitizeCustomEnemies([{
      ...createCustomEnemy(),
      name: "Resistant Boss",
      resistances: { bullet: 1.5, fire: -0.8, explosive: 0.5 },
    }]);
    const sanitized = drafts[0];
    expect(sanitized).toBeDefined();
    if (!sanitized) throw new Error("Expected sanitized draft");
    expect(sanitized.resistances["bullet"]).toBe(1.0);
    expect(sanitized.resistances["fire"]).toBe(-0.8);
    expect(sanitized.resistances["explosive"]).toBe(0.5);
    expect(sanitized.resistances["energy"]).toBe(0);
    expect(sanitized.resistances["melee"]).toBe(0);

    const definition = customEnemyToDefinition(sanitized);
    expect(definition.resistances?.["bullet"]).toBe(1.0);
    expect(definition.resistances?.["fire"]).toBe(-0.8);
  });

  it("validates game definitions with custom enemy resistances", () => {
    const validEnemy = {
      ...ENEMY_DEFINITIONS.dummy,
      resistances: { bullet: 0.5, fire: -0.7, melee: 1.0 },
    };
    const result = validateGameDefinitions({
      enemies: { ...ENEMY_DEFINITIONS, dummy: validEnemy },
    });
    expect(result.valid).toBe(true);

    const invalidEnemy = {
      ...ENEMY_DEFINITIONS.dummy,
      resistances: { bullet: 1.5 },
    };
    const invalidResult = validateGameDefinitions({
      enemies: { ...ENEMY_DEFINITIONS, dummy: invalidEnemy },
    });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.some((err) => err.includes("resistances.bullet must be a finite number <= 1"))).toBe(true);
  });
});

describe("simulation combat with damage types and resistances", () => {
  it("applies bullet resistance to bullet towers like Bandit", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const bandit = makeTestTower("bandit", 0); // 2 base damage, bullet
    const resistantTarget = makeTestEnemy({
      id: 1,
      hp: 100,
      maxHp: 100,
      resistances: { bullet: 0.5 },
    });
    internals.towers = [bandit];
    internals.enemies = [resistantTarget];

    internals.updateTowers(0);

    // 2 damage * 0.5 = 1 damage dealt
    expect(resistantTarget.hp).toBe(99);
    game.destroy();
  });

  it("completely negates damage against 100% immunity", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const cyborg = makeTestTower("cyborg", 0);
    const immuneTarget = makeTestEnemy({
      id: 1,
      hp: 100,
      maxHp: 100,
      resistances: { energy: 1.0 },
    });
    internals.towers = [cyborg];
    internals.enemies = [immuneTarget];

    internals.updateTowers(0);

    expect(immuneTarget.hp).toBe(100);
    game.destroy();
  });

  it("amplifies damage on negative resistance", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const bandit = makeTestTower("bandit", 0); // 2 base damage, bullet
    const vulnerableTarget = makeTestEnemy({
      id: 1,
      hp: 100,
      maxHp: 100,
      resistances: { bullet: -0.5 },
    });
    internals.towers = [bandit];
    internals.enemies = [vulnerableTarget];

    internals.updateTowers(0);

    // 2 damage * 1.5 = 3 damage dealt
    expect(vulnerableTarget.hp).toBe(97);
    game.destroy();
  });

  it("applies fire resistance to burn status effect ticks", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const resistantEnemy = makeTestEnemy({
      id: 1,
      hp: 100,
      maxHp: 100,
      burnTimer: 5,
      burnTickTimer: 0.05,
      burnDamage: 10,
      burnTickInterval: 1,
      resistances: { fire: 0.4 },
    });
    internals.enemies = [resistantEnemy];

    internals.updateEnemies(0.1);

    expect(resistantEnemy.hp).toBe(94);
    game.destroy();
  });

  it("applies melee resistance to Samurai attacks", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const samurai = makeTestTower("samurai", 0, { abilityTimer: 10 }); // 12 damage, melee
    const resistantEnemy = makeTestEnemy({
      id: 1,
      hp: 100,
      maxHp: 100,
      resistances: { melee: 0.5 },
    });
    internals.towers = [samurai];
    internals.enemies = [resistantEnemy];

    internals.updateTowers(0);

    // 12 damage * 0.5 = 6 damage dealt
    expect(resistantEnemy.hp).toBe(94);
    game.destroy();
  });
});
