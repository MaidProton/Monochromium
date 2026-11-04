import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE } from "./config.ts";
import { Game } from "./Game.ts";
import type { MultiplayerCommand, MultiplayerPlayer } from "./multiplayer.ts";
import type { SimulationEvent } from "./simulationProtocol.ts";
import type { Enemy, Projectile, Tower, TowerKind } from "./types.ts";

const player: MultiplayerPlayer = {
  id: "test-player",
  username: "TEST",
  color: "#66d9ff",
  loadout: ["bomber", "cyborg", "recon", "samurai", "tempest"],
  perkLoadout: [],
};

const enemy = (): Enemy => ({
  id: 9,
  kind: "dummy",
  pathDistance: 100,
  hp: 10_000,
  maxHp: 10_000,
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

const tower = (kind: TowerKind): Tower => ({
  id: 4,
  ownerId: player.id,
  kind,
  perks: [],
  position: { x: 65, y: 300 },
  onPath: false,
  pathDistance: 0,
  level: 0,
  totalInvested: 0,
  targeting: "first",
  hp: 100,
  maxHp: 100,
  maxAggro: 1,
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
  ammo: 5,
  shotCounter: 0,
  attackRamp: 0,
  rampTimer: 0,
  rampStackTimers: [],
  fireRateBuff: 0,
  idleTimer: 0,
  rocketTimer: 8,
  fieldTimer: 0,
  fieldTickTimer: 0,
  fieldVfxTimer: 0,
  regenTimer: 0,
  burstTimer: 0,
  burstTargetId: null,
  burstShotsRemaining: 0,
  burstSpacing: 0,
  stunTimer: 0,
});

interface GameInternals {
  towers: Tower[];
  enemies: Enemy[];
  selectedTowerId: number | null;
  mirrorFieldEffects: Map<number, { remaining: number }>;
  particles: unknown[];
  visualProjectiles: unknown[];
  shake: number;
  updateTowers(delta: number): void;
  updateMirror(delta: number): void;
  updateLightningField(tower: Tower, delta: number): void;
  startLightningField(tower: Tower): void;
  resolveProjectile(projectile: Projectile, target: Enemy): void;
}

const createGame = (role: "host" | "guest", events: SimulationEvent[], commands: MultiplayerCommand[] = []): Game => {
  const game = new Game(null as unknown as HTMLCanvasElement, {
    onUi: () => undefined,
    onLog: () => undefined,
    onGameOver: () => undefined,
    onVictory: () => undefined,
    onSimulationEvent: (event) => events.push(event as SimulationEvent),
    onCommand: (command) => commands.push(command),
  }, null, { headless: true });
  game.configureMultiplayer(role, player, [player]);
  game.startRun(MAP_DEFINITIONS.sector07, player.loadout, NORMAL_MODE);
  return game;
};

describe("multiplayer combat presentation events", () => {
  it("emits Bomber splash explosions with their tower color and radius", () => {
    const events: SimulationEvent[] = [];
    const game = createGame("host", events);
    const internals = game as unknown as GameInternals;
    const target = enemy();
    internals.enemies = [target];
    internals.resolveProjectile({
      position: { x: 0, y: 0 },
      delay: 0,
      targetId: target.id,
      ownerId: player.id,
      damage: 20,
      kind: "bomber",
      speed: 330,
      splash: 60,
      chain: 0,
      towerLevel: 1,
    }, target);
    expect(events).toContainEqual(expect.objectContaining({ kind: "explosion", label: "bomber", value: 60 }));
  });

  it("marks Recon spreads and Cyborg Howitzer rounds for mirror rendering", () => {
    const events: SimulationEvent[] = [];
    const game = createGame("host", events);
    const internals = game as unknown as GameInternals;
    const target = enemy();
    internals.enemies = [target];

    internals.towers = [tower("recon")];
    internals.updateTowers(1 / 30);
    expect(events).toContainEqual(expect.objectContaining({ kind: "attack", label: "recon", visual: "hitscan" }));

    events.length = 0;
    const cyborg = tower("cyborg");
    cyborg.level = 3;
    cyborg.ammo = 1;
    internals.towers = [cyborg];
    internals.updateTowers(1 / 30);
    expect(events).toContainEqual(expect.objectContaining({ kind: "attack", label: "cyborg", value: 46 }));
  });

  it("rejects a mirrored Samurai ability locally while cooldown remains", () => {
    const events: SimulationEvent[] = [];
    const commands: MultiplayerCommand[] = [];
    const game = createGame("guest", events, commands);
    const internals = game as unknown as GameInternals;
    const samurai = tower("samurai");
    samurai.level = 4;
    samurai.abilityCooldown = 12;
    samurai.abilityCooldowns = { f: 12 };
    internals.towers = [samurai];
    internals.selectedTowerId = samurai.id;
    expect(game.activateSelectedAbility("f")).toBe(false);
    expect(commands).toEqual([]);
  });

  it("advances mirrored tower cooldowns between authoritative snapshots", () => {
    const game = createGame("guest", []);
    const internals = game as unknown as GameInternals;
    const samurai = tower("samurai");
    samurai.abilityCooldown = 12;
    samurai.abilityCooldowns = { f: 12 };
    internals.towers = [samurai];

    internals.updateMirror(0.5);

    expect(samurai.abilityCooldown).toBeCloseTo(11.5);
    expect(samurai.abilityCooldowns?.f).toBeCloseTo(11.5);
    game.destroy();
  });

  it("starts and stops a client-simulated Tempest field from two small events", () => {
    const events: SimulationEvent[] = [];
    const authority = createGame("host", events);
    const authorityInternals = authority as unknown as GameInternals;
    const tempest = tower("tempest");
    authorityInternals.towers = [tempest];
    authorityInternals.startLightningField(tempest);
    const start = events.find((event) => event.label === "tempest-field-start");
    expect(start).toEqual(expect.objectContaining({ kind: "ability", entityId: tempest.id, duration: 6 }));

    const mirrorEvents: SimulationEvent[] = [];
    const mirror = createGame("guest", mirrorEvents);
    const mirrorInternals = mirror as unknown as GameInternals;
    mirrorInternals.towers = [tower("tempest")];
    mirror.applySimulationEvents([start!]);
    expect(mirrorInternals.mirrorFieldEffects.get(tempest.id)?.remaining).toBe(6);

    events.length = 0;
    authorityInternals.updateLightningField(tempest, 6.1);
    const end = events.find((event) => event.label === "tempest-field-end");
    expect(end).toEqual(expect.objectContaining({ kind: "ability", entityId: tempest.id }));
    mirror.applySimulationEvents([end!]);
    expect(mirrorInternals.mirrorFieldEffects.has(tempest.id)).toBe(false);
  });

  it("clears transient presentation on hide and never replays stale effects", () => {
    const game = createGame("guest", []);
    const internals = game as unknown as GameInternals;
    internals.particles = [{}];
    internals.visualProjectiles = [{}];
    internals.shake = 1;
    game.setPresentationSuspended(true);
    expect(internals.particles).toEqual([]);
    expect(internals.visualProjectiles).toEqual([]);
    expect(internals.shake).toBe(0);

    const fiveMinutesOfExplosions: SimulationEvent[] = Array.from({ length: 5 * 60 * 8 }, (_, index) => ({
      id: index + 1, tick: index + 1, kind: "explosion", position: { x: 100, y: 100 }, value: 80, cosmeticSeed: index,
    }));
    game.applySimulationEvents(fiveMinutesOfExplosions, false);
    expect(internals.particles).toEqual([]);
    expect(internals.visualProjectiles).toEqual([]);
  });

  it("queues transient replicated effects against the mirror timeline instead of presenting them on receipt", () => {
    const game = createGame("guest", []);
    const internals = game as unknown as GameInternals;
    game.scheduleMultiplayerEvents([{
      id: 99,
      tick: 26,
      kind: "attack",
      entityId: 4,
      targetId: 9,
      from: { x: 65, y: 300 },
      position: { x: 100, y: 300 },
      label: "recon",
      visual: "hitscan",
      cosmeticSeed: 9,
    }], 30, performance.now());

    expect(game.getMultiplayerPresentationDiagnostics().queuedEvents).toBe(1);
    internals.updateMirror(0);
    expect(game.getMultiplayerPresentationDiagnostics().queuedEvents).toBe(0);
  });

  it("rebuilds persistent Tempest presentation from the current keyframe", () => {
    const game = createGame("guest", []);
    const internals = game as unknown as GameInternals;
    const tempest = tower("tempest");
    tempest.fieldTimer = 4.25;
    internals.towers = [tempest];
    game.restorePersistentPresentation();
    expect(internals.mirrorFieldEffects.get(tempest.id)?.remaining).toBe(4.25);
  });

  it("bounds an extreme replicated attack batch", () => {
    const game = createGame("guest", []);
    const internals = game as unknown as GameInternals;
    const attacks: SimulationEvent[] = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      tick: index + 1,
      kind: "attack",
      entityId: 4,
      from: { x: 20, y: 20 },
      position: { x: 100, y: 100 },
      visual: "projectile",
      label: "bomber",
      speed: 330,
      count: 16,
      cosmeticSeed: index,
    }));
    game.applySimulationEvents(attacks);
    expect(internals.visualProjectiles).toHaveLength(128);
  });

  it("preserves a persistent lifecycle event behind a saturated transient batch", () => {
    const game = createGame("guest", []);
    const internals = game as unknown as GameInternals;
    internals.towers = [tower("tempest")];
    const transients: SimulationEvent[] = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1, tick: index, kind: "explosion", position: { x: 1, y: 1 }, cosmeticSeed: index,
    }));
    game.applySimulationEvents([...transients, {
      id: 201, tick: 201, kind: "ability", entityId: 4, label: "tempest-field-start", duration: 3, cosmeticSeed: 201,
    }], false);
    expect(internals.mirrorFieldEffects.get(4)?.remaining).toBe(3);
  });
});
