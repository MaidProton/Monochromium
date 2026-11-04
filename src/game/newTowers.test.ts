import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE, TOWER_DEFINITIONS } from "./config.ts";
import { Game } from "./Game.ts";
import type { Enemy, Tower, TowerKind } from "./types.ts";

const enemy = (id: number, pathDistance: number, hp = 1_000, maxHp = hp): Enemy => ({
  id,
  kind: "dummy",
  pathDistance,
  hp,
  maxHp,
  shieldHp: 0,
  maxShieldHp: 0,
  speed: 0,
  damage: 1,
  attackInterval: 1,
  telegraphDuration: 0.4,
  coreDamage: 1,
  defense: 0,
  protection: 0,
  armor: 0,
  superarmor: 0,
  hitCashMultiplier: 1,
  summonModifiers: { hitCashMultiplier: 1, hpMultiplier: 1, shieldMultiplier: 1, speedMultiplier: 1, damageMultiplier: 1, attackIntervalMultiplier: 1, coreDamageMultiplier: 1, defenseBonus: 0, protectionBonus: 0, armorBonus: 0, superarmorBonus: 0 },
  targetTowerId: null,
  attackTimer: 1,
  stunTimer: 0,
  slowTimer: 0,
  slowFactor: 1,
  shockStacks: 0,
  burnTimer: 0,
  burnTickTimer: 0,
  burnDamage: 0,
  burnOwnerId: null,
  burnSlowFactor: 1,
  burnTickInterval: 1,
  burnSpeedFactor: 1,
  hitFlash: 0,
  spawnScale: 1,
  summonTimer: 0,
  abilityTimer: 0,
  regenerationVfxTimer: 0,
  hasteCooldown: 0,
  hasteTimer: 0,
  hasteFactor: 1,
  drainCooldown: 0,
  phaseCooldown: 0,
  phaseTimer: 0,
  blinkCooldown: 0,
  aliveTime: 0,
  lockTriggered: false,
  lockTimeRemaining: 0,
  lockWavesRemaining: 0,
  attackCooldowns: [],
  attackUses: [],
  behaviorMovementLockTimer: 0,
  behaviorInvulnerableTimer: 0,
  behaviorSpeedFactor: 1,
  behaviorDamageFactor: 1,
  behaviorRuleUses: [],
  behaviorRuleCooldowns: [],
  behaviorActionQueue: [],
  behaviorEffects: [],
});

const tower = (kind: TowerKind, level = 0): Tower => {
  const definition = TOWER_DEFINITIONS[kind];
  const stats = definition.levels[level]!;
  return {
    id: 40,
    ownerId: "solo",
    kind,
    perks: [],
    position: { x: 65, y: 300 },
    onPath: false,
    pathDistance: 0,
    level,
    totalInvested: definition.cost,
    targeting: "first",
    hp: definition.onPath.hp * stats.hpMultiplier,
    maxHp: definition.onPath.hp * stats.hpMultiplier,
    maxAggro: 0,
    engaged: new Set(),
    fireTimer: 0,
    counterCooldown: 0,
    autoCounter: false,
    counterFlash: 0,
    hurtFlash: 0,
    selectedPulse: 0,
    fortifyCharges: 0,
    overdriveTimer: 0,
    damageBuff: 1,
    abilityTimer: 0,
    abilityCooldown: 0,
    abilityCooldowns: { f: 0 },
    aimPoint: null,
    aiming: false,
    focus: 0,
    meleeTimer: 0,
    ammo: -1,
    shotCounter: 0,
    attackRamp: 0,
    rampTimer: 0,
    rampStackTimers: [],
    fireRateBuff: 0,
    idleTimer: 0,
    rocketTimer: 0,
    fieldTimer: 0,
    fieldTickTimer: 0,
    fieldVfxTimer: 0,
    regenTimer: 0,
    burstTimer: 0,
    burstTargetId: null,
    burstShotsRemaining: 0,
    burstSpacing: 0,
    stunTimer: 0,
  };
};

interface GameInternals {
  towers: Tower[];
  enemies: Enemy[];
  selectedTowerId: number | null;
  context: CanvasRenderingContext2D;
  drawZenithCharge(tower: Tower): void;
  updateTowers(delta: number): void;
}

const createSoloGame = (): { game: Game; internals: GameInternals } => {
  const game = new Game(null as unknown as HTMLCanvasElement, {
    onUi: () => undefined,
    onLog: () => undefined,
    onGameOver: () => undefined,
    onVictory: () => undefined,
  }, null, { headless: true });
  game.startRun(MAP_DEFINITIONS.sector07, ["latch", "prism", "zenith"], NORMAL_MODE);
  return { game, internals: game as unknown as GameInternals };
};

describe("progression-focused towers", () => {
  it("occupies distinct early, mid, and endgame price bands with valid upgrade curves", () => {
    expect(TOWER_DEFINITIONS.latch.cost).toBeLessThanOrEqual(NORMAL_MODE.startingCash);
    expect(TOWER_DEFINITIONS.prism.cost).toBeGreaterThan(NORMAL_MODE.startingCash);
    expect(TOWER_DEFINITIONS.prism.cost).toBeLessThan(TOWER_DEFINITIONS.zenith.cost);
    expect(TOWER_DEFINITIONS.zenith.copyLimit).toBe(2);
    for (const kind of ["latch", "prism", "zenith"] as const) {
      const definition = TOWER_DEFINITIONS[kind];
      expect(definition.upgrades).toHaveLength(definition.levels.length - 1);
      definition.upgrades.forEach((upgrade, index) => expect(upgrade.level).toBe(index + 1));
    }
  });

  it("lets Latch immobilize its fifth solo target hit", () => {
    const { game, internals } = createSoloGame();
    const latch = tower("latch");
    const target = enemy(1, 100);
    internals.towers = [latch];
    internals.enemies = [target];
    for (let shot = 0; shot < 5; shot += 1) {
      latch.fireTimer = 0;
      internals.updateTowers(0);
    }
    expect(latch.shotCounter).toBe(5);
    expect(target.stunTimer).toBeCloseTo(0.3);
    expect(target.hp).toBe(995);
    game.destroy();
  });

  it("refracts a mid-level Prism beam through three nearby enemies", () => {
    const { game, internals } = createSoloGame();
    const prism = tower("prism", 2);
    const targets = [enemy(1, 100), enemy(2, 130), enemy(3, 160)];
    internals.towers = [prism];
    internals.enemies = targets;
    internals.updateTowers(0);
    expect(targets.every((target) => target.hp < 1_000)).toBe(true);
    expect(targets[0]!.hp).toBeCloseTo(994.816);
    expect(targets[1]!.hp).toBeCloseTo(992.8);
    expect(targets[2]!.hp).toBeCloseTo(990);
    game.destroy();
  });

  it("pierces a line and applies capped max-HP damage with Zenith", () => {
    const { game, internals } = createSoloGame();
    const zenith = tower("zenith");
    const targets = [enemy(1, 100, 10_000, 10_000), enemy(2, 100, 10_000, 10_000), enemy(3, 100, 10_000, 10_000)];
    internals.towers = [zenith];
    internals.enemies = targets;
    internals.updateTowers(0);
    expect(zenith.zenithChargeTargetId).toBe(1);
    expect(zenith.zenithChargeTimer).toBe(2);
    expect(targets.every((target) => target.hp === 10_000)).toBe(true);
    internals.updateTowers(2);
    expect(targets.map((target) => target.hp)).toEqual([9_820, 9_820, 9_820]);
    expect(zenith.fireTimer).toBe(3.6);
    internals.updateTowers(3.5);
    expect(zenith.zenithChargeTimer).toBe(0);
    internals.updateTowers(0.11);
    expect(zenith.zenithChargeTimer).toBe(2);
    game.destroy();
  });

  it("cancels Zenith charge on a dead lock and applies a one-second retry cooldown", () => {
    const { game, internals } = createSoloGame();
    const zenith = tower("zenith");
    const target = enemy(1, 100);
    internals.towers = [zenith];
    internals.enemies = [target];

    internals.updateTowers(0);
    expect(zenith.zenithChargeTargetId).toBe(target.id);
    target.hp = 0;
    internals.updateTowers(0.1);

    expect(zenith.zenithChargeTimer).toBe(0);
    expect(zenith.zenithChargeTargetId).toBeNull();
    expect(zenith.fireTimer).toBe(1);
    game.destroy();
  });

  it("scales Zenith charge duration to five seconds at max level", () => {
    const { game, internals } = createSoloGame();
    const zenith = tower("zenith", 5);
    expect(TOWER_DEFINITIONS.zenith.levels.every((stats) => stats.fireRate === 3.6)).toBe(true);
    internals.towers = [zenith];
    internals.enemies = [enemy(1, 100)];

    internals.updateTowers(0);

    expect(zenith.zenithChargeTimer).toBe(5);
    internals.updateTowers(5);
    expect(zenith.fireTimer).toBe(3.6);
    game.destroy();
  });

  it("draws Zenith's reverse shockwave around the tower instead of the beam endpoint", () => {
    const { game, internals } = createSoloGame();
    const zenith = tower("zenith");
    const target = enemy(1, 100);
    zenith.zenithChargeTimer = 1;
    zenith.zenithChargeTargetId = target.id;
    internals.enemies = [target];
    const arcs: Array<{ x: number; y: number; radius: number }> = [];
    internals.context = {
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      fill: () => undefined,
      setLineDash: () => undefined,
      arc: (x: number, y: number, radius: number) => arcs.push({ x, y, radius }),
      createRadialGradient: () => ({ addColorStop: () => undefined }),
    } as unknown as CanvasRenderingContext2D;

    internals.drawZenithCharge(zenith);

    expect(arcs[0]).toEqual({ x: zenith.position.x, y: zenith.position.y, radius: 46 });
    expect(arcs[1]?.x).toBe(zenith.position.x);
    expect(arcs[1]?.y).toBe(zenith.position.y);
    expect(Math.hypot(
      (arcs[2]?.x ?? zenith.position.x) - zenith.position.x,
      (arcs[2]?.y ?? zenith.position.y) - zenith.position.y,
    )).toBeCloseTo(24);
    game.destroy();
  });

  it("uses the shared fire-rate and damage buffs for Samurai stances", () => {
    const { game, internals } = createSoloGame();
    const samurai = tower("samurai", 4);
    samurai.abilityCooldown = 0;
    samurai.abilityCooldowns = { f: 0 };
    samurai.focus = 0.6;
    internals.towers = [samurai];
    internals.selectedTowerId = samurai.id;

    expect(game.activateSelectedAbility("f")).toBe(true);
    expect(samurai.abilityTimer).toBe(15);
    expect(samurai.abilityCooldown).toBe(0);
    expect(samurai.damageBuff).toBe(1.5);
    expect(samurai.fireRateBuff).toBe(0.6);

    internals.updateTowers(7.5);
    expect(samurai.abilityTimer).toBeCloseTo(7.5);
    expect(samurai.abilityCooldown).toBe(0);

    expect(game.activateSelectedAbility("f")).toBe(true);
    expect(samurai.abilityTimer).toBe(0);
    expect(samurai.abilityCooldown).toBe(30);
    expect(samurai.damageBuff).toBe(1);
    expect(samurai.fireRateBuff).toBe(0);
  });

  it("lets level 4 Samurai toggle Senseless Stance and disables Mental Focus there", () => {
    const { game, internals } = createSoloGame();
    const samurai = tower("samurai", 4);
    samurai.abilityCooldown = 0;
    samurai.abilityCooldowns = { f: 0 };
    samurai.focus = 0.6;
    internals.towers = [samurai];
    internals.selectedTowerId = samurai.id;

    expect(game.activateSelectedAbility("g")).toBe(true);
    expect(samurai.senselessStance).toBe(true);
    expect(samurai.focus).toBe(0.6);
    expect(samurai.fireRateBuff).toBe(0.6);
    internals.updateTowers(1);
    expect(samurai.focus).toBeCloseTo(0.52);
    expect(samurai.fireRateBuff).toBeCloseTo(0.52);

    expect(game.activateSelectedAbility("g")).toBe(true);
    expect(samurai.senselessStance).toBe(false);
  });

  it("starts Blade Stance cooldown only after the stance drains naturally", () => {
    const { game, internals } = createSoloGame();
    const samurai = tower("samurai", 1);
    samurai.abilityCooldown = 0;
    samurai.abilityCooldowns = { f: 0 };
    internals.towers = [samurai];
    internals.selectedTowerId = samurai.id;

    expect(game.activateSelectedAbility("f")).toBe(true);
    internals.updateTowers(15);
    expect(samurai.abilityTimer).toBe(0);
    expect(samurai.abilityCooldown).toBe(30);
    expect(samurai.abilityCooldowns?.f).toBe(30);
    game.destroy();
  });
});
