import { describe, expect, it } from "vitest";
import { createHeadlessGame, getTestGameInternals, makeTestEnemy, makeTestTower } from "./testSupport.ts";

const prepareGame = (tower: ReturnType<typeof makeTestTower>, enemy = makeTestEnemy()): ReturnType<typeof createHeadlessGame> => {
  const game = createHeadlessGame({ availablePerks: tower.perks });
  const internals = getTestGameInternals(game);
  internals.towers = [tower];
  internals.enemies = [enemy];
  return game;
};

describe("persistent tower perks", () => {
  it("makes Cold Chamber replace Gunner's ramp with a fourth-shot piercing stun", () => {
    const tower = makeTestTower("gunner", 4, {
      ownerId: "test-host",
      position: { x: 0, y: 360 },
      perks: ["cold-chamber"],
      fireTimer: 0,
    });
    const primary = makeTestEnemy({ id: 2, pathDistance: 100, hp: 1_000, maxHp: 1_000 });
    const pierced = makeTestEnemy({ id: 3, pathDistance: 160, hp: 1_000, maxHp: 1_000 });
    const game = prepareGame(tower, primary);
    const internals = getTestGameInternals(game);
    internals.enemies = [primary, pierced];

    internals.updateTowers(0);
    internals.updateTowers(0.2);
    internals.updateTowers(0.2);
    internals.updateTowers(0.2);

    expect(primary.hp).toBeCloseTo(997, 5);
    expect(pierced.hp).toBeCloseTo(988, 5);
    expect(primary.stunTimer).toBeCloseTo(0.45, 5);
    expect(pierced.stunTimer).toBeCloseTo(0.45, 5);
    expect(tower.rampStackTimers).toEqual([]);
    expect(tower.fireRateBuff).toBe(0);
  });

  it("triggers Mutiny from kills, resets both meters, and independently expires stacks", () => {
    const mercenary = makeTestTower("mercenary", 5, {
      ownerId: "test-host",
      position: { x: 0, y: 360 },
      perks: ["mutiny"],
      fireTimer: 0,
    });
    const recipient = makeTestTower("bandit", 0, {
      id: 2,
      ownerId: "test-host",
      position: { x: 100, y: 360 },
      fireTimer: 999,
    });
    const enemies = Array.from({ length: 6 }, (_, index) => makeTestEnemy({
      id: index + 3,
      pathDistance: 100 + index * 4,
      hp: 2,
      maxHp: 2,
    }));
    const game = createHeadlessGame({ availablePerks: mercenary.perks });
    const internals = getTestGameInternals(game);
    internals.towers = [mercenary, recipient];
    internals.enemies = enemies;

    for (let kill = 0; kill < enemies.length; kill += 1) {
      mercenary.fireTimer = 0;
      internals.updateTowers(0);
    }

    expect(mercenary.mutinyKillProgress).toBe(0);
    expect(mercenary.mutinyDamageProgress).toBe(0);
    expect(mercenary.mutinyStackTimers).toHaveLength(1);
    expect(mercenary.mutinyStackTimers?.[0]).toBeCloseTo(19, 5);
    expect(recipient.overdriveMultiplier).toBeCloseTo(1.28, 5);
    expect(recipient.overdriveTimer).toBeCloseTo(19, 5);
    expect(mercenary.overdriveMultiplier).toBeCloseTo(1.28, 5);

    mercenary.mutinyStackTimers = [10, 15];
    mercenary.overdriveTimer = 15;
    recipient.overdriveTimer = 15;
    internals.updateTowers(5);
    expect(mercenary.mutinyStackTimers).toEqual([5, 10]);
    expect(recipient.overdriveTimer).toBeCloseTo(10, 5);
  });

  it("does not activate Mutiny before Mercenary unlocks Onslaught", () => {
    const tower = makeTestTower("mercenary", 4, {
      perks: ["mutiny"],
      fireTimer: 0,
    });
    const target = makeTestEnemy({ id: 2 });
    const game = prepareGame(tower, target);
    const internals = getTestGameInternals(game);
    internals.updateTowers(0);

    expect(target.hp).toBe(989);
    expect(tower.damageBuff).toBe(1);
    expect(tower.mutinyKillProgress).toBe(0);
    expect(tower.mutinyDamageProgress).toBe(0);
    expect(tower.mutinyStackTimers).toEqual([]);
  });

  it("triggers Mutiny from the base-DPS damage meter and scales its reward", () => {
    const tower = makeTestTower("mercenary", 6, {
      ownerId: "test-host",
      perks: ["mutiny"],
      fireTimer: 0,
      mutinyDamageProgress: (13 / 0.14) * 30 - 1,
    });
    const target = makeTestEnemy({ id: 2, hp: 1_000, maxHp: 1_000 });
    const game = prepareGame(tower, target);
    const internals = getTestGameInternals(game);
    internals.updateTowers(0);

    expect(tower.mutinyDamageProgress).toBe(0);
    expect(tower.mutinyStackTimers?.[0]).toBeCloseTo(20, 5);
    expect(tower.overdriveTimer).toBeCloseTo(20, 5);
    expect(tower.damageBuff).toBeCloseTo(0.52, 5);
  });

  it("makes Backdraft burns tick 50% faster without changing direct flame damage", () => {
    const baselineTower = makeTestTower("infernus", 4, { ownerId: "test-host", fireTimer: 0 });
    const baselineEnemy = makeTestEnemy({ id: 2, pathDistance: 100, hp: 1_000, maxHp: 1_000 });
    const baseline = prepareGame(baselineTower, baselineEnemy);
    const baselineInternals = getTestGameInternals(baseline);
    baselineInternals.updateTowers(0.01);
    expect(baselineEnemy.hp).toBe(998);
    expect(baselineEnemy.burnTickInterval).toBe(0.5);

    const perkTower = makeTestTower("infernus", 4, { ownerId: "test-host", perks: ["backdraft"], fireTimer: 0 });
    const perkEnemy = makeTestEnemy({ id: 2, pathDistance: 100, hp: 1_000, maxHp: 1_000 });
    const perkGame = prepareGame(perkTower, perkEnemy);
    const perkInternals = getTestGameInternals(perkGame);
    perkInternals.updateTowers(0.01);
    expect(perkEnemy.hp).toBe(998);
    expect(perkEnemy.burnTickInterval).toBeCloseTo(1 / 3, 5);
    perkInternals.updateEnemies(0.34);
    expect(perkEnemy.hp).toBe(994);
    expect(perkEnemy.burnSpeedFactor).toBe(1.3);
  });

  it("starts Backdraft haste at 6% and adds 6% per Infernus level", () => {
    for (const [level, expected] of [[0, 1.06], [1, 1.12], [4, 1.3], [5, 1.36]] as const) {
      const tower = makeTestTower("infernus", level, { ownerId: "test-host", perks: ["backdraft"], fireTimer: 0 });
      const enemy = makeTestEnemy({ id: 2, pathDistance: 100, hp: 1_000, maxHp: 1_000 });
      const game = prepareGame(tower, enemy);
      getTestGameInternals(game).updateTowers(0.01);
      expect(enemy.burnSpeedFactor).toBeCloseTo(expected, 5);
      game.destroy();
    }
  });

  it("automatically prepares and buffs High Noon, then starts its post-uptime cooldown", () => {
    const tower = makeTestTower("bandit", 2, { ownerId: "test-host", perks: ["high-noon"], fireTimer: 999 });
    const enemy = makeTestEnemy({ id: 2, pathDistance: 100 });
    const game = prepareGame(tower, enemy);
    const internals = getTestGameInternals(game);
    internals.updateTowers(1);
    expect(tower.perkPrepTimer).toBe(2);
    expect(tower.abilityTimer).toBe(0);
    internals.updateTowers(1);
    expect(tower.perkPrepTimer).toBe(1);
    internals.updateTowers(1);
    expect(tower.perkPrepTimer).toBe(0);
    expect(tower.abilityTimer).toBeCloseTo(10, 5);
    expect(tower.damageBuff).toBeCloseTo(1.35, 5);
    expect(tower.fireRateBuff).toBeCloseTo(0.35, 5);
    for (let tick = 0; tick < 10; tick += 1) internals.updateTowers(1);
    expect(tower.abilityTimer).toBe(0);
    expect(tower.abilityCooldown).toBeCloseTo(15, 5);
    for (let tick = 0; tick < 15; tick += 1) internals.updateTowers(1);
    expect(tower.abilityCooldown).toBe(0);
    internals.updateTowers(0.01);
    expect(tower.perkPrepTimer).toBeCloseTo(1.99, 5);

    internals.selectedTowerId = tower.id;
    expect(game.activateSelectedAbility("f")).toBe(false);
  });

  it("keeps High Noon ready without preparing until an enemy enters range", () => {
    const tower = makeTestTower("bandit", 2, {
      ownerId: "test-host",
      perks: ["high-noon"],
      fireTimer: 999,
      abilityCooldown: 1,
      abilityCooldowns: { f: 1 },
    });
    const enemy = makeTestEnemy({ id: 2, pathDistance: 1_000 });
    const game = prepareGame(tower, enemy);
    const internals = getTestGameInternals(game);

    internals.updateTowers(1);
    expect(tower.abilityCooldown).toBe(0);
    expect(tower.perkPrepTimer).toBe(0);
    expect(tower.abilityTimer).toBe(0);

    enemy.pathDistance = 100;
    internals.updateTowers(0.01);
    expect(tower.perkPrepTimer).toBe(2);
  });

  it("scales High Noon by level", () => {
    const tower = makeTestTower("bandit", 4, { ownerId: "test-host", perks: ["high-noon"], fireTimer: 999 });
    const game = prepareGame(tower);
    const internals = getTestGameInternals(game);
    internals.updateTowers(1);
    internals.updateTowers(1);
    internals.updateTowers(1);
    expect(tower.abilityTimer).toBeCloseTo(15, 5);
    expect(tower.damageBuff).toBeCloseTo(1.45, 5);
    expect(tower.fireRateBuff).toBeCloseTo(0.45, 5);
  });

  it("applies Glass Cannon to Admiral damage, interval, and splash radius", () => {
    const tower = makeTestTower("admiral", 0, { ownerId: "test-host", perks: ["glass-cannon"], fireTimer: 0, aimPoint: { x: 100, y: 360 } });
    const game = prepareGame(tower);
    const internals = getTestGameInternals(game);
    internals.updateTowers(0.01);
    expect(tower.damageBuff).toBe(2);
    expect(tower.fireTimer).toBeCloseTo(5.5 * 1.5, 5);
    expect((internals.admiralShots[0] as { damage: number; radius: number }).damage).toBe(24);
    expect((internals.admiralShots[0] as { damage: number; radius: number }).radius).toBe(40);
  });
});
