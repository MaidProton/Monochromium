import { describe, expect, it } from "vitest";
import { TOWER_DEFINITIONS } from "./config.ts";
import type { SimulationEvent } from "./simulationProtocol.ts";
import {
  createHeadlessGame,
  getTestGameInternals,
  makeTestEnemy,
  makeTestTower,
} from "./testSupport.ts";

describe("tower behavior registry", () => {
  it("keeps the pistol attack damage and attack event contract", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const bandit = makeTestTower("bandit");
    const target = makeTestEnemy({ id: 1, hp: 100, maxHp: 100 });
    internals.towers = [bandit];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(98);
    expect(bandit.fireTimer).toBeCloseTo(1.2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "attack", label: "bandit", targetId: target.id, visual: "hitscan" }),
    ]));
    game.destroy();
  });

  it("continues a Twinshot burst against a living replacement target", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const bandit = makeTestTower("bandit", 3, { meleeTimer: 10 });
    const firstTarget = makeTestEnemy({ id: 1, hp: 4, maxHp: 4, pathDistance: 100 });
    const replacementTarget = makeTestEnemy({ id: 2, hp: 100, maxHp: 100, pathDistance: 80 });
    internals.towers = [bandit];
    internals.enemies = [firstTarget, replacementTarget];

    internals.updateTowers(0);
    internals.updateTowers(0.3);

    expect(firstTarget.hp).toBe(0);
    expect(replacementTarget.hp).toBe(96);
    expect(bandit.burstShotsRemaining).toBe(0);
    expect(bandit.burstTargetId).toBeNull();
    expect(events.filter((event) => event.kind === "attack").map((event) => event.targetId)).toEqual([1, 2]);
    game.destroy();
  });

  it("keeps the Bladeworks inner-ring slash and semantic slash event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const bandit = makeTestTower("bandit", 2, { fireTimer: 0.5 });
    const target = makeTestEnemy({ id: 1, hp: 100, maxHp: 100, pathDistance: 100 });
    internals.towers = [bandit];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(94);
    expect(bandit.meleeTimer).toBeCloseTo(3.5);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "slash", label: "bandit", value: 92 }),
    ]));
    game.destroy();
  });

  it("keeps Quickdraw counter damage, event output, and slash reset", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const bandit = makeTestTower("bandit", 3, { onPath: true, meleeTimer: 2 });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: bandit.id, attackTimer: 0.1 });
    internals.towers = [bandit];
    internals.enemies = [attacker];
    internals.selectedTowerId = bandit.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(992);
    expect(bandit.meleeTimer).toBe(0);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "bandit", entityId: bandit.id }),
      expect.objectContaining({ kind: "attack", label: "bandit", targetId: attacker.id, visual: "hitscan" }),
    ]));
    game.destroy();
  });

  it("arms one AutoCounter tower and fires it inside the incoming attack window", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const bandit = makeTestTower("bandit", 0, { onPath: true, autoCounter: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: bandit.id, attackTimer: 0.4 });
    internals.towers = [bandit];
    internals.enemies = [attacker];

    internals.updateEnemies(0);

    expect(attacker.hp).toBe(998);
    expect(bandit.counterCooldown).toBe(8);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "bandit", entityId: bandit.id, targetId: attacker.id }),
    ]));

    const secondAttacker = makeTestEnemy({ id: 2, hp: 1_000, maxHp: 1_000, targetTowerId: bandit.id, attackTimer: 0.1 });
    internals.enemies = [secondAttacker];
    internals.updateEnemies(0.2);
    expect(secondAttacker.hp).toBe(1_000);
    expect(bandit.hp).toBeLessThan(bandit.maxHp);
    game.destroy();
  });

  it("keeps AutoCounter to one pathbound tower per operator", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const first = makeTestTower("bandit", 0, { id: 1, onPath: true });
    const second = makeTestTower("samurai", 0, { id: 2, onPath: true });
    internals.towers = [first, second];

    internals.selectedTowerId = first.id;
    expect(game.toggleSelectedAutoCounter()).toBe(true);
    expect(first.autoCounter).toBe(true);
    internals.selectedTowerId = second.id;
    expect(game.toggleSelectedAutoCounter()).toBe(true);
    expect(first.autoCounter).toBe(false);
    expect(second.autoCounter).toBe(true);

    second.onPath = false;
    expect(game.toggleSelectedAutoCounter()).toBe(false);
    expect(second.autoCounter).toBe(true);
    game.destroy();
  });

  it("keeps Latch's fifth-hit Tether cadence and attack event output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const latch = makeTestTower("latch");
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [latch];
    internals.enemies = [target];

    for (let shot = 0; shot < 5; shot += 1) {
      latch.fireTimer = 0;
      internals.updateTowers(0);
    }

    expect(latch.shotCounter).toBe(5);
    expect(target.hp).toBe(995);
    expect(target.stunTimer).toBeCloseTo(0.3);
    expect(events.filter((event) => event.kind === "attack")).toHaveLength(5);
    game.destroy();
  });

  it("keeps Latch's level-2 fifth-hit Tether timing and stun strength", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const latch = makeTestTower("latch", 2);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [latch];
    internals.enemies = [target];

    for (let shot = 0; shot < 5; shot += 1) {
      latch.fireTimer = 0;
      internals.updateTowers(0);
    }

    expect(latch.shotCounter).toBe(5);
    expect(target.hp).toBe(985);
    expect(target.stunTimer).toBeCloseTo(0.45);
    game.destroy();
  });

  it("keeps Latch's Tripwire counter damage, stun, and semantic events", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const latch = makeTestTower("latch", 0, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: latch.id, attackTimer: 0.1 });
    internals.towers = [latch];
    internals.enemies = [attacker];
    internals.selectedTowerId = latch.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(998);
    expect(attacker.stunTimer).toBeCloseTo(0.75);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "latch", entityId: latch.id }),
      expect.objectContaining({ kind: "attack", label: "latch", targetId: attacker.id, visual: "hitscan" }),
    ]));
    game.destroy();
  });

  it("keeps Gunner burst continuation and Redline stack growth", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const gunner = makeTestTower("gunner", 4);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    const damage = TOWER_DEFINITIONS.gunner.levels[4]!.damage;
    internals.towers = [gunner];
    internals.enemies = [target];

    internals.updateTowers(0);
    internals.updateTowers(0.2);

    expect(target.hp).toBe(1_000 - damage * 2);
    expect(gunner.burstShotsRemaining).toBe(2);
    expect(gunner.burstTargetId).toBe(target.id);
    expect(gunner.rampStackTimers).toHaveLength(2);
    expect(gunner.fireRateBuff).toBeCloseTo(0.04);
    expect(events.filter((event) => event.kind === "attack")).toHaveLength(2);
    game.destroy();
  });

  it("caps Gunner's self-applied Ultraburst rate by level", () => {
    const levelFour = makeTestTower("gunner", 4, {
      fireTimer: 1,
      rampStackTimers: Array.from({ length: 75 }, () => 10),
    });
    const levelFive = makeTestTower("gunner", 5, {
      fireTimer: 1,
      rampStackTimers: Array.from({ length: 150 }, () => 10),
    });
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    internals.towers = [levelFour, levelFive];

    internals.updateTowers(0);

    expect(levelFour.fireRateBuff).toBeCloseTo(1.5);
    expect(levelFive.fireRateBuff).toBeCloseTo(3);
    expect(levelFour.rampStackTimers).toHaveLength(75);
    expect(levelFive.rampStackTimers).toHaveLength(150);
    game.destroy();
  });

  it("keeps Gunner Redline Return counter damage and semantic events", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const gunner = makeTestTower("gunner", 0, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: gunner.id, attackTimer: 0.1 });
    internals.towers = [gunner];
    internals.enemies = [attacker];
    internals.selectedTowerId = gunner.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(997);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "gunner", entityId: gunner.id }),
      expect.objectContaining({ kind: "attack", label: "gunner", targetId: attacker.id, visual: "hitscan", speed: 3 }),
    ]));
    game.destroy();
  });

  it("keeps Warrior's delayed Double Strike and strike events", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const warrior = makeTestTower("warrior", 4);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [warrior];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(974);
    expect(warrior.fireTimer).toBeCloseTo(0.7);
    expect(events.filter((event) => event.kind === "strike")).toHaveLength(1);

    internals.updateDelayedSlashes(0.18);

    expect(target.hp).toBe(948);
    expect(events.filter((event) => event.kind === "strike")).toHaveLength(2);
    game.destroy();
  });

  it("keeps Warrior's range-wide Riposte counter and cross-slash event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const warrior = makeTestTower("warrior", 4, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: warrior.id, attackTimer: 0.1 });
    internals.towers = [warrior];
    internals.enemies = [attacker];
    internals.selectedTowerId = warrior.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(896);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "warrior", entityId: warrior.id }),
      expect.objectContaining({ kind: "cross-slash", label: "warrior" }),
    ]));
    game.destroy();
  });

  it("keeps Warrior's level-4 arrival slash damage and four slash events", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const warrior = makeTestTower("warrior", 4);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [warrior];
    internals.enemies = [target];

    internals.invokeTowerArrivalBehavior(warrior);

    expect(target.hp).toBe(974);
    expect(events.filter((event) => event.kind === "slash" && event.label === "warrior")).toHaveLength(4);
    game.destroy();
  });

  it("keeps Vanguard's automatic Charged Smash damage and semantic event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const vanguard = makeTestTower("vanguard", 1);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [vanguard];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(980);
    expect(vanguard.abilityCooldown).toBeCloseTo(4);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "smash", label: "vanguard", entityId: vanguard.id, targetId: target.id, value: 82 }),
    ]));
    game.destroy();
  });

  it("keeps Vanguard's Riposte counter smash and cooldown state", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const vanguard = makeTestTower("vanguard", 4, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: vanguard.id, attackTimer: 0.1 });
    internals.towers = [vanguard];
    internals.enemies = [attacker];
    internals.selectedTowerId = vanguard.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(910);
    expect(vanguard.abilityCooldown).toBeCloseTo(3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "vanguard", entityId: vanguard.id }),
      expect.objectContaining({ kind: "smash", label: "vanguard", targetId: attacker.id, value: 96 }),
    ]));
    game.destroy();
  });

  it("keeps Recon's five-pellet attack, ramp, ammo, and attack event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const recon = makeTestTower("recon", 0);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [recon];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(990);
    expect(recon.ammo).toBe(4);
    expect(recon.attackRamp).toBeCloseTo(0.25);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "attack", label: "recon", targetId: target.id, visual: "hitscan", speed: 0.0975 }),
    ]));
    game.destroy();
  });

  it("keeps Recon's maximum spread while making its base spread linger longer", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const recon = makeTestTower("recon", 0, { fireTimer: 1, attackRamp: 1, idleTimer: 0.65 });
    internals.towers = [recon];

    internals.updateTowers(0.25);

    expect(recon.attackRamp).toBeCloseTo(0.75);

    recon.fireTimer = 0;
    recon.idleTimer = 0;
    recon.attackRamp = 1;
    internals.enemies = [makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 })];
    internals.updateTowers(0);

    const maxSpreadAttack = events.find((event) => event.kind === "attack");
    expect(maxSpreadAttack).toEqual(expect.objectContaining({ kind: "attack", label: "recon" }));
    expect(maxSpreadAttack?.speed).toBeCloseTo(0.425);
    game.destroy();
  });

  it("keeps Recon's Breach Load counter damage, reload reset, and event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const recon = makeTestTower("recon", 0, { onPath: true, ammo: 1, attackRamp: 0.7, idleTimer: 2 });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: recon.id, attackTimer: 0.1 });
    internals.towers = [recon];
    internals.enemies = [attacker];
    internals.selectedTowerId = recon.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(990);
    expect(recon.ammo).toBe(5);
    expect(recon.attackRamp).toBe(0);
    expect(recon.idleTimer).toBe(0);
    expect(recon.fireTimer).toBe(0);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "recon", entityId: recon.id }),
      expect.objectContaining({ kind: "attack", label: "recon", targetId: attacker.id, visual: "hitscan", speed: 0 }),
    ]));
    game.destroy();
  });

  it("keeps Mercenary's rifle attack and Rally Fire counter", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const mercenary = makeTestTower("mercenary", 0, { onPath: true });
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: mercenary.id, attackTimer: 0.1 });
    internals.towers = [mercenary];
    internals.enemies = [target];

    internals.updateTowers(0);
    expect(target.hp).toBe(995);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "attack", label: "mercenary", targetId: target.id, visual: "hitscan" }),
    ]));

    target.hp = 1_000;
    internals.selectedTowerId = mercenary.id;
    target.attackTimer = 0.1;
    expect(game.counterSelected()).toBe(true);
    expect(target.hp).toBe(990);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "mercenary", entityId: mercenary.id }),
    ]));
    game.destroy();
  });

  it("keeps Mercenary's Onslaught buff and ability event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const mercenary = makeTestTower("mercenary", 5);
    const ally = makeTestTower("bandit", 0, { id: 2, position: { x: 72, y: 300 } });
    internals.towers = [mercenary, ally];
    internals.selectedTowerId = mercenary.id;

    expect(game.activateSelectedAbility()).toBe(true);

    expect(mercenary.abilityCooldown).toBeCloseTo(40);
    expect(mercenary.damageBuff).toBeCloseTo(1.25);
    expect(ally.damageBuff).toBeCloseTo(1.25);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ability", entityId: mercenary.id }),
    ]));
    game.destroy();
  });

  it("keeps Prism's chained damage falloff and per-hit attack events", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const prism = makeTestTower("prism", 0);
    const first = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, pathDistance: 100 });
    const second = makeTestEnemy({ id: 2, hp: 1_000, maxHp: 1_000, pathDistance: 130 });
    internals.towers = [prism];
    internals.enemies = [first, second];

    internals.updateTowers(0);

    expect(first.hp).toBeCloseTo(995.68);
    expect(second.hp).toBeCloseTo(994);
    expect(events.filter((event) => event.kind === "attack" && event.label === "prism")).toHaveLength(2);
    game.destroy();
  });

  it("keeps Prism's Total Reflection counter chain and event output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const prism = makeTestTower("prism", 0, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: prism.id, attackTimer: 0.1 });
    internals.towers = [prism];
    internals.enemies = [attacker];
    internals.selectedTowerId = prism.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(988);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "prism", entityId: prism.id }),
      expect.objectContaining({ kind: "attack", label: "prism", targetId: attacker.id, visual: "hitscan" }),
    ]));
    game.destroy();
  });

  it("keeps Infernus cone damage, burn application, and flame event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const infernus = makeTestTower("infernus", 3);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [infernus];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(998);
    expect(target.burnTimer).toBeCloseTo(6);
    expect(target.burnDamage).toBeCloseTo(3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "flame", entityId: infernus.id, targetId: target.id, value: 8 }),
    ]));
    game.destroy();
  });

  it("keeps Infernus Flashover counter burn and semantic counter event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const infernus = makeTestTower("infernus", 0, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: infernus.id, attackTimer: 0.1 });
    internals.towers = [infernus];
    internals.enemies = [attacker];
    internals.selectedTowerId = infernus.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(998);
    expect(attacker.burnDamage).toBeCloseTo(1.5);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "infernus", entityId: infernus.id }),
    ]));
    game.destroy();
  });

  it("keeps Bomber projectile damage, critical cadence, and explosion event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const bomber = makeTestTower("bomber", 3, { shotCounter: 3 });
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [bomber];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(bomber.shotCounter).toBe(4);
    expect(internals.projectiles).toHaveLength(1);
    expect(internals.projectiles[0]?.damage).toBeCloseTo(10 * 3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "attack", label: "bomber", targetId: target.id, visual: "projectile", speed: 330 }),
    ]));

    const projectile = internals.projectiles[0];
    if (!projectile) throw new Error("Expected Bomber projectile");
    internals.resolveProjectile(projectile, target);
    expect(target.hp).toBe(970);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "explosion", label: "bomber", entityId: target.id, value: 60 }),
    ]));
    game.destroy();
  });

  it("keeps Bomber Dead Man's Switch and Time Bomb ability behavior", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const bomber = makeTestTower("bomber", 4, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: bomber.id, attackTimer: 0.1 });
    internals.towers = [bomber];
    internals.enemies = [attacker];
    internals.selectedTowerId = bomber.id;

    expect(game.counterSelected()).toBe(true);
    expect(attacker.hp).toBe(925);

    attacker.hp = 1_000;
    attacker.attackTimer = 1;
    bomber.counterCooldown = 0;
    expect(game.activateSelectedAbility()).toBe(true);
    expect(bomber.abilityCooldown).toBeCloseTo(60);
    internals.updateTimedBombs(5);
    expect(attacker.hp).toBe(500);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ability", entityId: bomber.id }),
      expect.objectContaining({ kind: "explosion", label: "bomber", value: 105 }),
    ]));
    game.destroy();
  });

  it("keeps Admiral artillery scheduling and impact event output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const admiral = makeTestTower("admiral", 0, { aimPoint: { x: 180, y: 300 } });
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [admiral];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(internals.admiralShots).toHaveLength(1);
    expect(admiral.fireTimer).toBeCloseTo(5.5);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "attack", label: "admiral", visual: "projectile", speed: 620 / 1.5 }),
    ]));
    game.destroy();
  });

  it("lets Admiral's detected artillery hit hidden enemies", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const admiral = makeTestTower("admiral", 2, { aimPoint: { x: 65, y: 360 } });
    const hidden = makeTestEnemy({ kind: "transparentDummy", hp: 1_000, maxHp: 1_000, pathDistance: 100 });
    internals.towers = [admiral];
    internals.enemies = [hidden];

    internals.updateTowers(0);
    internals.updateAdmiralShots(1);

    expect(hidden.hp).toBeLessThan(1_000);
    game.destroy();
  });

  it("keeps Admiral Fire Support's immediate barrage scheduling", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const admiral = makeTestTower("admiral", 0, { onPath: true, aimPoint: { x: 180, y: 300 } });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: admiral.id, attackTimer: 0.1 });
    internals.towers = [admiral];
    internals.enemies = [attacker];
    internals.selectedTowerId = admiral.id;

    expect(game.counterSelected()).toBe(true);

    expect(internals.admiralShots).toHaveLength(1);
    expect(admiral.fireTimer).toBe(0);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "admiral", entityId: admiral.id }),
    ]));
    game.destroy();
  });

  it("keeps Tempest's delayed second strike and Lightning Charge cadence", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const tempest = makeTestTower("tempest", 3);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [tempest];
    internals.enemies = [target];

    internals.updateTowers(0);
    expect(target.hp).toBe(960);
    expect(tempest.burstTargetId).toBe(target.id);

    internals.updateTowers(0.6);
    expect(target.hp).toBe(920);

    for (let shot = 0; shot < 5; shot += 1) {
      tempest.fireTimer = 0;
      internals.updateTowers(0);
    }
    expect(tempest.shotCounter).toBe(6);
    expect(tempest.fieldTimer).toBeCloseTo(6);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ability", entityId: tempest.id, label: "tempest-field-start" }),
    ]));
    game.destroy();
  });

  it("keeps Tempest Thunder Break field and shock event output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const tempest = makeTestTower("tempest", 0, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: tempest.id, attackTimer: 0.1 });
    internals.towers = [tempest];
    internals.enemies = [attacker];
    internals.selectedTowerId = tempest.id;

    expect(game.counterSelected()).toBe(true);

    expect(tempest.fieldTimer).toBeCloseTo(6);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ability", entityId: tempest.id, label: "tempest-field-start" }),
      expect.objectContaining({ kind: "counter", label: "tempest", entityId: tempest.id }),
    ]));
    game.destroy();
  });

  it("keeps Cyborg Howitzer damage, reload timing, and attack event output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const cyborg = makeTestTower("cyborg", 3, { ammo: 1 });
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [cyborg];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(980);
    expect(cyborg.ammo).toBe(0);
    expect(cyborg.fireTimer).toBeCloseTo(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "attack", label: "cyborg", targetId: target.id, visual: "hitscan", value: 46 }),
    ]));
    game.destroy();
  });

  it("keeps Cyborg Magnum Dump rounds, shot priming, and semantic events", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const cyborg = makeTestTower("cyborg", 0, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: cyborg.id, attackTimer: 0.1 });
    internals.towers = [cyborg];
    internals.enemies = [attacker];
    internals.selectedTowerId = cyborg.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(992);
    expect(cyborg.shotCounter).toBe(29);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "cyborg", entityId: cyborg.id }),
      expect.objectContaining({ kind: "attack", label: "cyborg", targetId: attacker.id, visual: "hitscan", speed: 8 }),
    ]));
    game.destroy();
  });

  it("keeps Cyborg Jetstream's delayed rocket volley trigger", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const cyborg = makeTestTower("cyborg", 5, { fireTimer: 1, rocketTimer: 0 });
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [cyborg];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(internals.projectiles).toHaveLength(3);
    expect(internals.projectiles.map((projectile) => projectile.delay)).toEqual([0, 1, 2]);
    expect(cyborg.rocketTimer).toBeCloseTo(8);
    expect(events.filter((event) => event.kind === "attack" && event.label === "cyborg" && event.visual === "projectile")).toHaveLength(3);
    game.destroy();
  });

  it("keeps Samurai's stance attack scaling and slash event", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const samurai = makeTestTower("samurai", 2, { abilityTimer: 10 });
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [samurai];
    internals.enemies = [target];

    internals.updateTowers(0);

    expect(target.hp).toBe(962);
    expect(samurai.fireTimer).toBeCloseTo(0.7);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "slash", label: "samurai", value: 135 }),
    ]));
    game.destroy();
  });

  it("keeps Samurai Blade Stance and BladeStorm ability behavior", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const samurai = makeTestTower("samurai", 3, { focus: 0.6 });
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [samurai];
    internals.enemies = [target];
    internals.selectedTowerId = samurai.id;

    expect(game.activateSelectedAbility("f")).toBe(true);

    expect(samurai.abilityTimer).toBe(15);
    expect(target.hp).toBe(680);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ability", entityId: samurai.id }),
      expect.objectContaining({ kind: "slash", label: "samurai" }),
    ]));
    game.destroy();
  });

  it("restarts and advances Samurai's cooldown after Blade Stance ends", () => {
    const game = createHeadlessGame();
    const internals = getTestGameInternals(game);
    const samurai = makeTestTower("samurai", 3, { abilityTimer: 0.1 });
    internals.towers = [samurai];

    internals.updateTowers(0.1);
    expect(samurai.abilityCooldown).toBe(30);
    expect(samurai.abilityCooldowns?.f).toBe(30);

    internals.updateTowers(1);
    expect(samurai.abilityCooldown).toBeCloseTo(29);
    expect(samurai.abilityCooldowns?.f).toBeCloseTo(29);
    game.destroy();
  });

  it("keeps Samurai Iai Parry damage and crossing slash output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const samurai = makeTestTower("samurai", 4, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: samurai.id, attackTimer: 0.1 });
    internals.towers = [samurai];
    internals.enemies = [attacker];
    internals.selectedTowerId = samurai.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBe(904);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "samurai", entityId: samurai.id }),
      expect.objectContaining({ kind: "cross-slash", label: "samurai" }),
    ]));
    game.destroy();
  });

  it("keeps Wraith's multi-dash attack and dash events", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const wraith = makeTestTower("wraith", 2);
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [wraith];
    internals.enemies = [target];

    internals.updateTowers(0);
    internals.updateTowers(0.32);

    expect(target.hp).toBeLessThan(1_000);
    expect(wraith.burstShotsRemaining).toBe(0);
    expect(events.filter((event) => event.kind === "dash" && event.label === "wraith")).toHaveLength(2);
    game.destroy();
  });

  it("keeps Wraith Phase Cut and Crimson Flurry behavior", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const wraith = makeTestTower("wraith", 4, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: wraith.id, attackTimer: 0.1 });
    internals.towers = [wraith];
    internals.enemies = [attacker];
    internals.selectedTowerId = wraith.id;

    expect(game.counterSelected()).toBe(true);
    expect(attacker.hp).toBe(886);

    attacker.hp = 1_000;
    expect(game.activateSelectedAbility("f")).toBe(true);
    expect(wraith.abilityTimer).toBe(3);
    internals.updateTowers(0);
    expect(attacker.hp).toBeLessThan(1_000);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "flurry", entityId: wraith.id }),
      expect.objectContaining({ kind: "flurry-pulse", entityId: wraith.id }),
    ]));
    game.destroy();
  });

  it("keeps Zenith charge completion and lance event output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const zenith = makeTestTower("zenith");
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [zenith];
    internals.enemies = [target];

    internals.updateTowers(0);
    expect(zenith.zenithChargeTargetId).toBe(target.id);
    internals.updateTowers(2);

    expect(target.hp).toBe(925);
    expect(zenith.fireTimer).toBeCloseTo(3.6);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "charge", entityId: zenith.id, label: "start" }),
      expect.objectContaining({ kind: "attack", label: "zenith", visual: "hitscan" }),
    ]));
    game.destroy();
  });

  it("cancels a Zenith charge when the tower is stunned", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const zenith = makeTestTower("zenith");
    const target = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000 });
    internals.towers = [zenith];
    internals.enemies = [target];

    internals.updateTowers(0);
    zenith.stunTimer = 1;
    internals.updateTowers(1 / 30);

    expect(zenith.zenithChargeTimer).toBe(0);
    expect(zenith.zenithChargeTargetId).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({ kind: "charge", entityId: zenith.id, label: "cancel" }));
    game.destroy();
  });

  it("keeps Zenith Event Horizon counter targeting and lance output", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const zenith = makeTestTower("zenith", 0, { onPath: true });
    const attacker = makeTestEnemy({ id: 1, hp: 1_000, maxHp: 1_000, targetTowerId: zenith.id, attackTimer: 0.1 });
    internals.towers = [zenith];
    internals.enemies = [attacker];
    internals.selectedTowerId = zenith.id;

    expect(game.counterSelected()).toBe(true);

    expect(attacker.hp).toBeCloseTo(868.75);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "counter", label: "zenith", entityId: zenith.id }),
      expect.objectContaining({ kind: "attack", label: "zenith", visual: "hitscan" }),
    ]));
    game.destroy();
  });
});
