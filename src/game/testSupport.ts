import { MAP_DEFINITIONS, NORMAL_MODE, TOWER_DEFINITIONS } from "./config.ts";
import { Game } from "./Game.ts";
import { MULTIPLAYER_PROTOCOL_VERSION, type MultiplayerPlayer, type MultiplayerRole } from "./multiplayer.ts";
import type { MultiplayerGameSnapshot } from "./multiplayer.ts";
import type { SimulationEvent, SimulationSessionConfig } from "./simulationProtocol.ts";
import type { Enemy, MapDefinition, ModeDefinition, Point, Tower, TowerKind, TowerPerkKind } from "./types.ts";

export const makeStraightTestMap = (): MapDefinition => {
  const path = [{ x: 0, y: 350 }, { x: 1600, y: 350 }];
  return { ...MAP_DEFINITIONS.sector07, path, paths: [{ ...MAP_DEFINITIONS.sector07.paths[0]!, path, width: 100 }] };
};

export const makeTestEnemy = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 1,
  kind: "dummy",
  pathDistance: 100,
  hp: 1_000,
  maxHp: 1_000,
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
  ...overrides,
});

export const makeTestTower = (kind: TowerKind = "bandit", level = 0, overrides: Partial<Tower> = {}): Tower => {
  const definition = TOWER_DEFINITIONS[kind];
  const stats = definition.levels[level] ?? definition.levels[0]!;
  const maxHp = definition.onPath.hp * stats.hpMultiplier;
  return {
    id: 1,
    ownerId: "solo",
    kind,
    perks: [],
    position: { x: 65, y: 300 },
    onPath: false,
    pathDistance: 0,
    level,
    totalInvested: definition.cost,
    targeting: "first",
    hp: maxHp,
    maxHp,
    maxAggro: 0,
    engaged: new Set<number>(),
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
    perkPrepTimer: 0,
    aimPoint: null,
    aiming: false,
    focus: 0,
    meleeTimer: 0,
    ammo: stats.ammo ?? -1,
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
    mutinyKillProgress: 0,
    mutinyDamageProgress: 0,
    mutinyStackTimers: [],
    ...overrides,
  };
};

export const makeTestPlayer = (id: string, loadout: readonly TowerKind[] = ["bandit"]): MultiplayerPlayer => ({
  id,
  username: id.toUpperCase(),
  color: id === "test-guest" ? "#ff806f" : "#66d9ff",
  loadout,
  perkLoadout: [],
});

export const makeTestSimulationConfig = (overrides: Partial<SimulationSessionConfig> = {}): SimulationSessionConfig => ({
  protocol: MULTIPLAYER_PROTOCOL_VERSION,
  sessionId: "TEST1234",
  seed: 12345,
  map: MAP_DEFINITIONS.sector07,
  mode: NORMAL_MODE,
  customEnemies: [],
  allowedTowers: ["bandit"],
  players: [makeTestPlayer("test-host"), makeTestPlayer("test-guest")],
  ...overrides,
});

export interface TestGameInternals {
  headless: boolean;
  audio: Pick<import("./audio.ts").AudioSystem, "tankMissileLaunch" | "tankFlameStream">;
  towers: Tower[];
  enemies: Enemy[];
  projectiles: import("./types.ts").Projectile[];
  timedBombs: import("./presentationTypes.ts").TimedBomb[];
  admiralShots: unknown[];
  selectedTowerId: number | null;
  context: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  cameraPan: { x: number; y: number };
  mechaKeys: Set<string>;
  particles: unknown[];
  visualProjectiles: import("./presentationTypes.ts").VisualProjectile[];
  shake: number;
  updateTowers(delta: number): void;
  updateProjectiles(delta: number): void;
  updateAdmiralShots(delta: number): void;
  updateTimedBombs(delta: number): void;
  updateDelayedSlashes(delta: number): void;
  invokeTowerArrivalBehavior(tower: Tower): void;
  updateEnemies(delta: number): void;
  updateControlledMecha(delta: number): void;
  updateMechaPilotInput(): void;
  updateMirror(delta: number): void;
  updateVisualProjectiles(delta: number): void;
  syncTankWeaponAudio(): void;
  updateMechaCameraFollow(delta: number): void;
  spawnEnemy(kind: Enemy["kind"], hp: number, pathDistance?: number, pathIndex?: number): void;
  startLightningField(tower: Tower): void;
  updateLightningField(tower: Tower, delta: number): void;
  resolveProjectile(projectile: import("./types.ts").Projectile, target: Enemy): void;
  drawZenithCharge(tower: Tower): void;
}

export const getTestGameInternals = (game: Game): TestGameInternals => game as unknown as TestGameInternals;

export const createHeadlessGame = (options: {
  readonly role?: MultiplayerRole;
  readonly localPlayer?: MultiplayerPlayer;
  readonly players?: readonly MultiplayerPlayer[];
  readonly map?: MapDefinition;
  readonly mode?: ModeDefinition;
  readonly availableTowers?: readonly TowerKind[];
  readonly availablePerks?: readonly TowerPerkKind[];
  readonly now?: () => number;
  readonly onSimulationEvent?: (event: SimulationEvent) => void;
  readonly onCommand?: (command: import("./multiplayer.ts").MultiplayerCommand) => void;
  readonly onPilotInput?: (input: import("./multiplayer.ts").MultiplayerPilotInput) => void;
} = {}): Game => {
  const localPlayer = options.localPlayer ?? makeTestPlayer("test-host");
  const players = options.players ?? [localPlayer];
  const game = new Game(null as unknown as HTMLCanvasElement, {
    onUi: () => undefined,
    onLog: () => undefined,
    onGameOver: () => undefined,
    onVictory: () => undefined,
    onSimulationEvent: (event) => options.onSimulationEvent?.(event as SimulationEvent),
    onCommand: options.onCommand,
    onPilotInput: options.onPilotInput,
  }, null, { headless: true, now: options.now });
  if (options.role) game.configureMultiplayer(options.role, localPlayer, players);
  game.startRun(options.map ?? MAP_DEFINITIONS.sector07, options.availableTowers ?? localPlayer.loadout, options.mode ?? NORMAL_MODE);
  if (options.availablePerks) game.setAvailablePerks(options.availablePerks);
  return game;
};

export const advanceTicks = (core: { advance(): void }, ticks: number): void => {
  for (let index = 0; index < ticks; index += 1) core.advance();
};

export const snapshotDigest = (snapshot: MultiplayerGameSnapshot): string => JSON.stringify({
  integrity: snapshot.integrity,
  maxIntegrity: snapshot.maxIntegrity,
  wave: snapshot.wave,
  waveActive: snapshot.waveActive,
  intermissionRemaining: snapshot.intermissionRemaining,
  nextWaveIndex: snapshot.nextWaveIndex,
  paused: snapshot.paused,
  speed: snapshot.speed,
  started: snapshot.started,
  gameOver: snapshot.gameOver,
  modeComplete: snapshot.modeComplete,
  players: [...snapshot.players].sort((left, right) => left.id.localeCompare(right.id)),
  towers: [...snapshot.towers].sort((left, right) => left.id - right.id),
  enemies: [...snapshot.enemies].sort((left, right) => left.id - right.id),
  timedBombs: snapshot.timedBombs,
});

export const point = (x: number, y: number): Point => ({ x, y });
