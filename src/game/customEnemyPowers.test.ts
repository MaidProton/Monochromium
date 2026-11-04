import { afterEach, describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE, TOWER_DEFINITIONS } from "./config.ts";
import { createCustomEnemy, sanitizeCustomEnemiesDetailed } from "./customEnemies.ts";
import { createEnemyAbilityPreset } from "./enemyAbilities.ts";
import { setCustomEnemyRegistry } from "./enemyRegistry.ts";
import { Game } from "./Game.ts";
import type { Enemy, EnemyAbilityDefinition, Point, Tower } from "./types.ts";

const tower = (): Tower => ({
  id: 90, ownerId: "solo", kind: "bandit", perks: [], position: { x: 65, y: 300 }, onPath: false, pathDistance: 0, level: 0,
  totalInvested: TOWER_DEFINITIONS.bandit.cost, targeting: "first", hp: 100, maxHp: 100, maxAggro: 0, engaged: new Set(),
  fireTimer: 0, counterCooldown: 0, autoCounter: false, counterFlash: 0, hurtFlash: 0, selectedPulse: 0, fortifyCharges: 0, overdriveTimer: 0,
  damageBuff: 1, abilityTimer: 0, abilityCooldown: 0, abilityCooldowns: { f: 0 }, aimPoint: null, aiming: false, focus: 0,
  meleeTimer: 0, ammo: -1, shotCounter: 0, attackRamp: 0, rampTimer: 0, rampStackTimers: [], fireRateBuff: 0, idleTimer: 0,
  rocketTimer: 0, fieldTimer: 0, fieldTickTimer: 0, fieldVfxTimer: 0, regenTimer: 0, burstTimer: 0, burstTargetId: null,
  burstShotsRemaining: 0, burstSpacing: 0, stunTimer: 0,
});

interface GameInternals {
  towers: Tower[];
  enemies: Enemy[];
  enemyPosition(enemy: Enemy): Point;
  spawnEnemy(kind: Enemy["kind"], hp: number, pathDistance?: number, pathIndex?: number): void;
  updateEnemies(delta: number): void;
  damageEnemy(enemy: Enemy, amount: number, color: string, ownerId?: string): void;
}

const createGame = (events: Array<Record<string, unknown>> = []): Game => new Game(null as unknown as HTMLCanvasElement, {
  onUi: () => undefined, onLog: () => undefined, onGameOver: () => undefined, onVictory: () => undefined,
  onSimulationEvent: (event) => events.push(event),
}, null, { headless: true });

const immediate = (ability: EnemyAbilityDefinition): EnemyAbilityDefinition => ability.trigger.type === "interval"
  ? { ...ability, cooldown: 0, trigger: { ...ability.trigger, initialDelay: 0 } }
  : ability;

afterEach(() => setCustomEnemyRegistry([]));

describe("custom enemy v4 abilities", () => {
  it("migrates v3 powers, rules, and attacks into v4-only persisted abilities", () => {
    const source = {
      ...createCustomEnemy(), version: 3, regenerationEnabled: true, regenerationRate: 12, blinkEnabled: true, blinkInterval: 6,
      blinkDistance: 150, behaviorRules: [{ id: "rule-last-stand", name: "Last stand", minHp: null, maxHp: 30, minAliveTime: null,
        maxAliveTime: null, cooldown: 1, maxUses: 1, actions: [{ type: "invulnerable", delay: 0, duration: 3 }] }],
      attacks: [{ id: "attack-legacy", name: "Legacy Beam", cooldown: 2, maxUses: 0, minHp: null, maxHp: null, minAliveTime: 0,
        maxAliveTime: null, targeting: "first", range: 220, maxTargets: 1, delivery: "ranged", width: 60, depth: 180, angle: 60,
        projectileSpeed: 360, effects: [{ type: "damage", amount: 20 }], visuals: [{ type: "beam", color: "#ff806f", size: 1, width: 3, duration: .3, speed: 360 }] }],
    };
    const report = sanitizeCustomEnemiesDetailed([source]); const migrated = report.enemies[0]!;
    expect(report.migrated).toBe(1);
    expect(migrated.version).toBe(4);
    expect(migrated.abilities.map((ability) => ability.id)).toEqual(expect.arrayContaining(["rule-last-stand", "attack-legacy"]));
    expect(migrated.abilities.find((ability) => ability.id === "attack-legacy")?.attack).toEqual(expect.objectContaining({ telegraphDuration: 0, impactTime: 0 }));
    const persisted = JSON.parse(JSON.stringify(migrated));
    expect(persisted).not.toHaveProperty("behaviorRules");
    expect(persisted).not.toHaveProperty("attacks");
    expect(persisted).not.toHaveProperty("regenerationEnabled");
  });

  it("runs haste, drain, phase, and blink through the shared game engine", () => {
    const draft = createCustomEnemy(); draft.hp = 500; draft.speed = 0;
    const haste = immediate(createEnemyAbilityPreset("haste"));
    const phase = immediate(createEnemyAbilityPreset("phase"));
    const blink = immediate(createEnemyAbilityPreset("blink"));
    const drain: EnemyAbilityDefinition = {
      ...immediate(createEnemyAbilityPreset("shockwave")), name: "Drain", conditions: [],
      attack: { ...createEnemyAbilityPreset("shockwave").attack!, range: 2_000, delivery: { type: "radial", radius: 2_000 }, telegraphDuration: 0, impactTime: 0 },
      actions: [{ id: "action-drain-test", type: "drain", delay: 0, damage: 12, healingPerTarget: 20 }],
    };
    draft.abilities = [haste, drain, phase, blink]; setCustomEnemyRegistry([draft]);
    const events: Array<Record<string, unknown>> = []; const game = createGame(events); game.startRun(MAP_DEFINITIONS.sector07, ["bandit"], NORMAL_MODE);
    const internals = game as unknown as GameInternals; const victim = tower(); internals.towers = [victim]; internals.spawnEnemy(draft.id, draft.hp, 100);
    const caster = internals.enemies[0]!; caster.hp = 400; internals.updateEnemies(.1);
    expect(victim.hp).toBe(88);
    expect(caster.hp).toBe(420);
    expect(caster.hasteFactor).toBe(1.5);
    expect(caster.phaseTimer).toBeGreaterThan(0);
    expect(caster.pathDistance).toBeGreaterThanOrEqual(220);
    expect(events.map((event) => event["kind"])).toEqual(expect.arrayContaining(["haste-pulse", "drain", "phase", "blink"]));
    game.destroy();
  });

  it("consumes HP threshold uses on activation and applies Last Stand before later damage", () => {
    const draft = createCustomEnemy(); draft.hp = 100; draft.abilities = [createEnemyAbilityPreset("last-stand")]; setCustomEnemyRegistry([draft]);
    const game = createGame(); game.startRun(MAP_DEFINITIONS.sector07, ["bandit"], NORMAL_MODE); const internals = game as unknown as GameInternals;
    internals.spawnEnemy(draft.id, draft.hp, 100); const enemy = internals.enemies[0]!;
    internals.damageEnemy(enemy, 80, "#ffffff");
    const entry = enemy.abilityRuntime?.entries[draft.abilities[0]!.id];
    expect(entry?.uses).toBe(1);
    expect(enemy.behaviorInvulnerableTimer).toBeGreaterThan(0);
    internals.damageEnemy(enemy, 10, "#ffffff");
    expect(enemy.hp).toBe(20);
    game.destroy();
  });

  it("locks attack targets at activation and impacts on an absolute fixed tick", () => {
    const draft = createCustomEnemy(); draft.speed = 0; const attack = immediate(createEnemyAbilityPreset("ranged")); draft.abilities = [attack]; setCustomEnemyRegistry([draft]);
    const events: Array<Record<string, unknown>> = []; const game = createGame(events); game.startRun(MAP_DEFINITIONS.sector07, ["bandit"], NORMAL_MODE); const internals = game as unknown as GameInternals;
    const victim = tower(); internals.towers = [victim]; internals.spawnEnemy(draft.id, draft.hp, 100); const enemy = internals.enemies[0]!;
    internals.updateEnemies(.1);
    expect(enemy.abilityRuntime?.pendingActions[0]).toEqual(expect.objectContaining({ abilityId: attack.id, lockedTargetIds: [victim.id] }));
    expect(victim.hp).toBe(100);
    internals.updateEnemies(.4);
    expect(victim.hp).toBe(80);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "ability", abilityId: attack.id, phase: "telegraph" }), expect.objectContaining({ kind: "attack", abilityId: attack.id, phase: "impact" })]));
    game.destroy();
  });

  it("does not recursively treat ability damage as a base-contact impact", () => {
    const draft = createCustomEnemy(); draft.speed = 0;
    const ranged = immediate(createEnemyAbilityPreset("ranged"));
    const afterContact: EnemyAbilityDefinition = { ...createEnemyAbilityPreset("blink"), trigger: { type: "attack" }, conditions: [], maxUses: 1 };
    draft.abilities = [ranged, afterContact]; setCustomEnemyRegistry([draft]);
    const game = createGame(); game.startRun(MAP_DEFINITIONS.sector07, ["bandit"], NORMAL_MODE); const internals = game as unknown as GameInternals;
    internals.towers = [tower()]; internals.spawnEnemy(draft.id, draft.hp, 100); const enemy = internals.enemies[0]!;
    internals.updateEnemies(.6);
    expect(enemy.abilityRuntime?.entries[afterContact.id]?.uses).toBe(0);
    game.destroy();
  });
});
