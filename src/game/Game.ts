import type { AudioSystem, TowerAttackSound } from "./audio.ts";
import {
  COMBAT_RULES,
  ECONOMY_RULES,
  getTankHeatCap,
  MAP_DEFINITIONS,
  NORMAL_MODE,
  PATH_HALF_WIDTH,
  RANGE_SCALE,
  TOWER_DEFINITIONS,
  TOWER_ORDER,
  TOWER_PERK_DEFINITIONS,
  TOWER_PERK_ORDER,
  TOWER_PLACEMENT_CLEARANCE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./config.ts";
import { getEnemyDefinition, isKnownEnemyKind } from "./enemyRegistry.ts";
import {
  createMapPathShapes,
  mapWorldBounds,
  normalizedMapScale,
  scaleMapDefinition,
} from "./mapRendering.ts";
import { GameRenderer, type GameRendererHost } from "./GameRenderer.ts";
import { GameEffects, type GameEffectsHost } from "./GameEffects.ts";
import {
  GameInputController,
  type GameInputHost,
  clampCameraPan,
} from "./GameInput.ts";
import { advanceTankMotion } from "./tankMotion.ts";
import { clamp, distance, Polyline } from "./math.ts";
import { combineSummonModifiers, NEUTRAL_SUMMON_MODIFIERS, NO_CASH_SUMMON_MODIFIERS, resolveEnemyDamage } from "./enemyDamage.ts";
import {
  EnemyAbilityEngine,
  advanceEnemyAbilityWaveLocks,
  createEnemyAbilityRuntime,
  normalizeEnemyAbilities,
  signalEnemyAbility,
  type EnemyAbilityEngineSource,
  type EnemyAbilityEngineTarget,
  type EnemyAbilityWorldAdapter,
} from "./enemyAbilities.ts";
import { getTowerBehavior, getTowerBehaviorForEvent } from "./towerBehaviors/index.ts";
import {
  getEffectiveTowerSplash,
  getTowerAbilityWithPerks,
  getTowerPerkAttackIntervalMultiplier,
  getTowerPerkDamageMultiplier,
} from "./towerPerks.ts";
import { buildTowerInspectorData } from "./towerInspector.ts";
import { TowerHealthBarTracker } from "./towerHealthBar.ts";
import type {
  TowerLifecycleBehaviorContext,
  TowerAbilityBehaviorContext,
  TowerAttackBehaviorContext,
  TowerCounterBehaviorContext,
  TowerPresentationBehaviorContext,
  TowerRenderBehaviorContext,
  TowerVisualProjectileSpec,
} from "./towerBehaviors/index.ts";
import type { TowerOverlayItem } from "./towerOverlay.ts";
import type {
  MultiplayerCommand,
  MultiplayerGameSnapshot,
  MultiplayerPilotInput,
  MultiplayerPilotInputAck,
  MultiplayerPlayer,
  MultiplayerRole,
} from "./multiplayer.ts";
import type {
  Enemy,
  EnemyAbilityDefinition,
  EnemyAttackDefinition,
  EnemyDefinition,
  EnemyKind,
  MapDefinition,
  ModeDefinition,
  Particle,
  PlayerId,
  PlacementPreview,
  Point,
  Projectile,
  SelectedTowerView,
  TargetingMode,
  Tower,
  TowerAbilitySlot,
  TowerKind,
  TowerLevelStats,
  TowerPerkKind,
  EnemySummonModifiers,
  DamageType,
  EnemyResistances,
} from "./types.ts";
import { SIMULATION_TICK_HZ, type SimulationEvent, type SimulationEventKind } from "./simulationProtocol.ts";
import type {
  AdmiralShot,
  DelayedSlash,
  MirrorFieldEffect,
  PlayerRuntime,
  RemoteCursor,
  PendingPlacementFeedback,
  TimedBomb,
  VisualProjectile,
} from "./presentationTypes.ts";
import {
  WAVE_INTERMISSION_SECONDS,
  WAVE_SKIP_DELAY_AFTER_SPAWN_SECONDS,
  buildWaveSpawnPlan,
  spawnDurationForWave,
  type WaveSpawn,
} from "./waveProgression.ts";

const DAMAGE_BUFF_COLOR = "#ff5c64";
const BURN_EFFECT_COLOR = "#ff8a4c";
const ZENITH_CHARGE_MIN_DURATION = 2;
const ZENITH_CHARGE_MAX_DURATION = 5;
const ZENITH_CANCEL_COOLDOWN = 1;
const MECHA_INPUT_STALE_SECONDS = 0.35;

interface MirrorEnemySample {
  readonly tick: number;
  readonly pathDistance: number;
}

interface MirrorTankSample {
  readonly tick: number;
  readonly position: Point;
  readonly hullAngle: number;
  readonly turretAngle: number;
}

interface ScheduledPresentationEvent {
  readonly event: SimulationEvent;
  readonly dueTick: number;
  readonly allowTransient: boolean;
}

interface PendingCommandFeedback {
  readonly command: MultiplayerCommand;
  accepted: boolean;
  expiresAt: number;
}

const zenithChargeDuration = (level: number): number =>
  ZENITH_CHARGE_MIN_DURATION + (ZENITH_CHARGE_MAX_DURATION - ZENITH_CHARGE_MIN_DURATION) * clamp(level, 0, 5) / 5;

export interface GameUiState {
  readonly integrity: number;
  readonly maxIntegrity: number;
  readonly shards: number;
  readonly pendingCasualtyRefund: number;
  readonly infiniteCash: boolean;
  readonly copiesRemaining: Readonly<Record<TowerKind, number>>;
  readonly availableTowers: readonly TowerKind[];
  readonly availablePerks: readonly TowerPerkKind[];
  readonly towerCount: number;
  readonly wave: number;
  readonly totalWaves: number;
  readonly modeName: string;
  readonly mapName: string;
  readonly waveActive: boolean;
  readonly skipWaveAvailable: boolean;
  readonly skipWaveVoteCast: boolean;
  readonly intermissionRemaining: number;
  readonly waveElapsed: number;
  readonly elapsed: number;
  readonly enemiesRemaining: number;
  readonly paused: boolean;
  readonly speed: number;
  readonly soundEnabled: boolean;
  readonly selectedKind: TowerKind | null;
  readonly selectedTower: SelectedTowerView | null;
  readonly placement: PlacementPreview | null;
  readonly relocating: boolean;
  readonly started: boolean;
  readonly gameOver: boolean;
  readonly modeComplete: boolean;
  readonly bosses: readonly {
    readonly id: number;
    readonly name: string;
    readonly accent: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly shieldHp: number;
    readonly maxShieldHp: number;
  }[];
  readonly multiplayer: boolean;
  readonly mirror: boolean;
  readonly localPlayerId: PlayerId;
  readonly selectedOwned: boolean;
  readonly teammates: readonly { readonly id: PlayerId; readonly username: string; readonly color: string; readonly shards: number }[];
}

interface GameCallbacks {
  readonly onUi: (state: GameUiState) => void;
  readonly onLog: (message: string, tone?: "neutral" | "good" | "danger") => void;
  readonly onGameOver: (wave: number) => void;
  readonly onVictory: (mode: ModeDefinition) => void;
  readonly onCursor?: (point: Point | null) => void;
  readonly onCommand?: (command: MultiplayerCommand) => void;
  readonly onPilotInput?: (input: MultiplayerPilotInput) => void;
  readonly onSimulationEvent?: (event: {
    readonly kind: SimulationEventKind;
    readonly entityId?: number;
    readonly targetId?: number;
    readonly position?: Point;
    readonly from?: Point;
    readonly visual?: "hitscan" | "projectile";
    readonly speed?: number;
    readonly color?: string;
    readonly value?: number;
    readonly count?: number;
    readonly duration?: number;
    readonly label?: string;
    readonly abilityId?: string;
    readonly actionId?: string;
    readonly phase?: "trigger" | "telegraph" | "target-lock" | "impact" | "action" | "complete";
  }) => void;
}

export interface GameRuntimeOptions {
  readonly headless?: boolean;
  /** Injectable monotonic clock for authoritative timing and deterministic tests. */
  readonly now?: () => number;
}

interface MechaInputState {
  brake?: boolean;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  aim: Point;
  firing: boolean;
  age: number;
  remote: boolean;
}

interface PendingPilotInput {
  readonly input: MultiplayerPilotInput;
  readonly sentAt: number;
}

type GameAudio = Pick<AudioSystem,
  | "enabled"
  | "unlock"
  | "toggle"
  | "uiPause"
  | "uiSpeed"
  | "fail"
  | "tone"
  | "deploy"
  | "shoot"
  | "flameStream"
  | "tankMissileLaunch"
  | "tankFlameStream"
  | "towerReload"
  | "admiralLaunch"
  | "towerUpgrade"
  | "towerAbility"
  | "towerEffect"
  | "zenithCharge"
  | "counter"
  | "hit"
  | "towerDamage"
  | "enemySpawn"
  | "enemyHit"
  | "enemyDeath"
  | "enemyShockwave"
  | "waveStart"
  | "waveClear"
  | "victory"
  | "defeat"
  | "breach"
  | "startAmbience"
  | "setAmbienceIntensity"
  | "stopAmbience"
  | "stopZenithCharges"
>;

const HEADLESS_AUDIO: GameAudio = {
  enabled: false,
  unlock: async () => undefined,
  toggle: () => false,
  uiPause: () => undefined,
  uiSpeed: () => undefined,
  fail: () => undefined,
  tone: () => undefined,
  deploy: () => undefined,
  shoot: () => undefined,
  flameStream: () => undefined,
  tankMissileLaunch: () => undefined,
  tankFlameStream: () => undefined,
  towerReload: () => undefined,
  admiralLaunch: () => undefined,
  towerUpgrade: () => undefined,
  towerAbility: () => undefined,
  towerEffect: () => undefined,
  zenithCharge: () => undefined,
  counter: () => undefined,
  hit: () => undefined,
  towerDamage: () => undefined,
  enemySpawn: () => undefined,
  enemyHit: () => undefined,
  enemyDeath: () => undefined,
  enemyShockwave: () => undefined,
  waveStart: () => undefined,
  waveClear: () => undefined,
  victory: () => undefined,
  defeat: () => undefined,
  breach: () => undefined,
  startAmbience: () => undefined,
  setAmbienceIntensity: () => undefined,
  stopAmbience: () => undefined,
  stopZenithCharges: () => undefined,
};

const SOLO_PLAYER_ID = "solo";
/** Admiral flight is authoritative as a fixed timer; clients use this speed for the cosmetic arc. */
const ADMIRAL_PROJECTILE_SPEED = 620 / 1.5;

export class Game {
  private readonly context: CanvasRenderingContext2D;
  private readonly staticMapCanvas: HTMLCanvasElement;
  private readonly vignetteCanvas: HTMLCanvasElement;
  // Initialized lazily so the authoritative Node utility process never needs DOM Path2D.
  private mapPathShapes = [] as Path2D[];
  private map: MapDefinition = MAP_DEFINITIONS.sector07;
  private path = new Polyline(this.map.path);
  private paths = this.map.paths.map((route) => new Polyline(route.path));
  private readonly audio: GameAudio;
  private readonly callbacks: GameCallbacks;
  private readonly headless: boolean;
  private readonly renderer: GameRenderer;
  private readonly effects: GameEffects;
  private readonly now: () => number;
  private mode: ModeDefinition = NORMAL_MODE;

  private towers: Tower[] = [];
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private visualProjectiles: VisualProjectile[] = [];
  /** Presentation-only cache for custom enemy artwork. */
  private readonly enemyImageCache = new Map<string, HTMLImageElement>();
  private readonly mirrorFieldEffects = new Map<number, MirrorFieldEffect>();
  /** Presentation-only Zenith charge clocks on multiplayer guests. */
  private readonly mirrorZenithCharges = new Map<number, {
    targetId: number;
    remaining: number;
    duration: number;
    angle: number;
  }>();
  private readonly slashDirections = new Map<TowerKind, boolean>();
  private readonly towerHealthBars = new TowerHealthBarTracker();
  private particles: Particle[] = [];
  private timedBombs: TimedBomb[] = [];
  private admiralShots: AdmiralShot[] = [];
  private delayedSlashes: DelayedSlash[] = [];
  private spawnQueue: WaveSpawn[] = [];
  private nextId = 1;
  private lastTimestamp = 0;
  private uiTimer = 0;
  private animationFrame = 0;
  private pointer: Point | null = null;
  private mechaPointerClient: Pick<PointerEvent, "clientX" | "clientY"> | null = null;
  private mechaPointerId: number | null = null;
  private cameraZoom = 1;
  private cameraPan = { x: 0, y: 0 };
  private inputController: GameInputController | null = null;
  private placement: PlacementPreview | null = null;
  private selectedKind: TowerKind | null = null;
  private selectedTowerId: number | null = null;
  private inspectorOpen = false;
  private relocatingTowerId: number | null = null;
  private waveElapsed = 0;
  private waveAllSpawnedAt: number | null = null;
  private waveSpawnDuration = 0;
  private skipWaveDismissedWave = 0;
  private skipWaveVoteWave = 0;
  private readonly skipWaveVotes = new Set<PlayerId>();
  private nextWaveIndex = 0;
  private waveNumber = 0;
  private waveActive = false;
  private intermissionTimer = 0;
  private integrity = this.mode.coreIntegrity;
  private maxIntegrity = this.mode.coreIntegrity;
  private infiniteCash = false;
  private availableTowerKinds = new Set<TowerKind>(["bandit"]);
  private availablePerkKinds = new Set<TowerPerkKind>();
  private readonly playerRuntimes = new Map<PlayerId, PlayerRuntime>();
  private playerProfiles = new Map<PlayerId, MultiplayerPlayer>();
  private localPlayerId: PlayerId = SOLO_PLAYER_ID;
  private multiplayerRole: MultiplayerRole | null = null;
  private remoteCursor: RemoteCursor | null = null;
  private lastSnapshotSequence = -1;
  private mirrorControlledMechaId: number | null = null;
  private readonly mirrorEnemyTargets = new Map<number, number>();
  private readonly mirrorEnemySamples = new Map<number, MirrorEnemySample[]>();
  private readonly mirrorTankSamples = new Map<number, MirrorTankSample[]>();
  private mirrorServerTick = 0;
  private mirrorServerTickReceivedAt = 0;
  private mirrorPresentationDelayTicks = 4;
  private mirrorFrameJitterTicks = 0;
  private mirrorExtrapolationTicks = 0;
  private mirrorLateEvents = 0;
  private mirrorScheduledEvents = 0;
  private readonly scheduledPresentationEvents: ScheduledPresentationEvent[] = [];
  private mirrorInterpolationCorrection = 0;
  private readonly pendingCommandFeedback = new Map<string, PendingCommandFeedback>();
  private readonly pendingPlacementFeedback = new Map<string, PendingPlacementFeedback>();
  private readonly multiplayerRequestTimes = new Map<PlayerId, { pause: number; speed: number }>();
  private readonly mechaInputs = new Map<number, MechaInputState>();
  private readonly mechaKeys = new Set<string>();
  private mechaFireHeld = false;
  private readonly mirrorTankPoses = new Map<number, Pick<Tower, "position" | "mechaHullAngle" | "mechaTurretAngle">>();
  private mechaInputSentAt = -Infinity;
  private pilotInputSequence = 0;
  private readonly pendingPilotInputs = new Map<number, PendingPilotInput[]>();
  private pilotInputsSent = 0;
  private pilotInputsAcknowledged = 0;
  private pilotInputAckDelayMs = 0;
  private pilotCorrection = 0;
  private pilotCorrectionSnaps = 0;
  private tempestPlacementTriggered = false;
  private paused = false;
  private speed = 1;
  private started = false;
  private gameOver = false;
  private modeComplete = false;
  private elapsed = 0;
  private shake = 0;
  private screenShakeStrength = 1;
  private canvasResolution = 2;
  private particleLimit = 600;
  private projectileLimit = 128;
  private particleCullMode: "full" | "third" | "half" | "sparse" = "full";
  private canvasGlow = true;
  private reducedMotion = false;
  private presentationSuspended = false;
  private simulationRandomState = 0x6d2b79f5;
  private readonly enemyAbilityEngine = new EnemyAbilityEngine();
  private enemyAbilityTick = 0;
  private enemyAbilityTickAccumulator = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    callbacks: GameCallbacks,
    audio: GameAudio | null = null,
    options: GameRuntimeOptions = {},
  ) {
    this.headless = options.headless === true;
    this.now = options.now ?? (() => performance.now());
    this.callbacks = callbacks;
    this.audio = this.headless ? HEADLESS_AUDIO : (audio ?? HEADLESS_AUDIO);
    this.effects = new GameEffects(this.createEffectsHost());
    if (this.headless) {
      this.context = {} as CanvasRenderingContext2D;
      this.staticMapCanvas = {} as HTMLCanvasElement;
      this.vignetteCanvas = {} as HTMLCanvasElement;
      this.renderer = new GameRenderer(this.createRendererHost());
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable in the desktop app.");
    this.context = context;
    this.staticMapCanvas = document.createElement("canvas");
    this.vignetteCanvas = document.createElement("canvas");
    this.renderer = new GameRenderer(this.createRendererHost());
    this.rebuildStaticMapLayer();
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.emitUi();
    this.animationFrame = requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  private createRendererHost(): GameRendererHost {
    const game = this;
    return {
      get canvas() { return game.canvas; },
      get context() { return game.context; },
      get staticMapCanvas() { return game.staticMapCanvas; },
      get vignetteCanvas() { return game.vignetteCanvas; },
      get map() { return game.map; },
      get mapPathShapes() { return game.mapPathShapes; },
      get enemyImageCache() { return game.enemyImageCache; },
      get mirrorZenithCharges() { return game.mirrorZenithCharges; },
      get towerHealthBars() { return game.towerHealthBars; },
      get particles() { return game.particles; },
      get visualProjectiles() { return game.visualProjectiles; },
      get timedBombs() { return game.timedBombs; },
      get towers() { return game.towers; },
      get enemies() { return game.enemies; },
      get projectiles() { return game.projectiles; },
      get pointer() { return game.pointer; },
      get placement() { return game.placement; },
      get pendingPlacementFeedback() { return [...game.pendingPlacementFeedback.values()]; },
      get selectedKind() { return game.selectedKind; },
      get selectedTower() { return game.selectedTower; },
      get selectedTowerId() { return game.selectedTowerId; },
      get relocatingTowerId() { return game.relocatingTowerId; },
      get remoteCursor() { return game.remoteCursor; },
      get playerProfiles() { return game.playerProfiles; },
      get localPlayerId() { return game.localPlayerId; },
      get integrity() { return game.integrity; },
      get shake() { return game.shake; },
      get screenShakeStrength() { return game.screenShakeStrength; },
      get elapsed() { return game.elapsed; },
      get canvasGlow() { return game.canvasGlow; },
      get reducedMotion() { return game.reducedMotion; },
      get particleCullMode() { return game.particleCullMode; },
      get headless() { return game.headless; },
      get inspectorOpen() { return game.inspectorOpen; },
      get isMirror() { return game.isMirror; },
      get multiplayerActive() { return game.multiplayerActive; },
      get now() { return game.now; },
      get viewport() { return game.viewport; },
      clampAdmiralAimPoint: (tower, point) => game.clampAdmiralAimPoint(tower, point),
      enemyDrawingImage: (dataUrl) => game.renderer.enemyDrawingImage(dataUrl),
      enemyMovementLocked: (enemy) => game.enemyMovementLocked(enemy),
      enemyPosition: (enemy) => game.enemyPosition(enemy),
      towerStats: (tower) => game.towerStats(tower),
      towerRenderBehaviorContext: (tower, showSupplementalStats, addOverlay) =>
        game.towerRenderBehaviorContext(tower, showSupplementalStats, addOverlay),
    };
  }

  private createEffectsHost(): GameEffectsHost {
    const game = this;
    return {
      get headless() { return game.headless; },
      get particles() { return game.particles; },
      get towers() { return game.towers; },
      audio: game.audio,
      towerStats: (tower) => game.towerStats(tower),
      fireRateCooldown: (tower, baseCooldown) => game.fireRateCooldown(tower, baseCooldown),
    };
  }

  private createInputHost(): GameInputHost {
    const game = this;
    return {
      get canvas() { return game.canvas; },
      get audio() { return game.audio; },
      get started() { return game.started; },
      get gameOver() { return game.gameOver; },
      get paused() { return game.paused; },
      get selectedTower() { return game.selectedTower; },
      get localPlayerId() { return game.localPlayerId; },
      get cameraPanLocked() { return game.cameraPanLocked; },
      get cameraZoom() { return game.cameraZoom; },
      set cameraZoom(v: number) { game.cameraZoom = v; },
      get cameraPan() { return game.cameraPan; },
      get baseViewportScale() { return game.baseViewportScale; },
      get relocatingTowerId() { return game.relocatingTowerId; },
      get placement() { return game.placement; },
      set placement(v: PlacementPreview | null) { game.placement = v; },
      get mechaPointerId() { return game.mechaPointerId; },
      set mechaPointerId(v: number | null) { game.mechaPointerId = v; },
      get mechaPointerClient() { return game.mechaPointerClient; },
      set mechaPointerClient(v: { clientX: number; clientY: number } | null) { game.mechaPointerClient = v; },
      get pointer() { return game.pointer; },
      set pointer(v: Point | null) { game.pointer = v; },

      setMechaAim: (pointer) => game.setMechaAim(pointer),
      setMechaFiring: (firing) => game.setMechaFiring(firing),
      releaseMechaInput: () => game.releaseMechaInput(),
      cancelAimSelected: () => game.cancelAimSelected(),
      cancelPlacement: () => game.cancelPlacement(),
      updatePlacement: () => game.updatePlacement(),
      emitUi: () => game.emitUi(),
      panCameraBy: (dx, dy) => game.panCameraBy(dx, dy),
      clampCameraPan: () => game.clampCameraPan(),
      eventToWorld: (event) => game.eventToWorld(event),
      eventToCanvasPixel: (event) => game.eventToCanvasPixel(event),
      handlePrimaryClick: (point) => game.handlePrimaryClick(point),
      onCursor: (point) => game.callbacks.onCursor?.(point),
    };
  }

  destroy(): void {
    this.audio.tankFlameStream(false);
    this.releaseMechaInput();
    this.audio.stopZenithCharges();
    this.inputController?.unbind();
    if (!this.headless) cancelAnimationFrame(this.animationFrame);
  }

  /** Advances an authoritative headless instance by one fixed simulation step. */
  advanceFixedStep(delta = 1 / 30): void {
    if (!this.headless || !this.started) return;
    if (!this.paused && !this.gameOver) this.update(delta * this.speed);
  }

  finishReplicatedRun(victory: boolean, wave: number): void {
    if (!this.isMirror) return;
    if (victory) this.callbacks.onVictory(this.mode);
    else this.callbacks.onGameOver(wave);
  }

  private emitTowerBehaviorEvent(tower: Tower, event: Omit<SimulationEvent, "id" | "tick" | "cosmeticSeed" | "tone">): void {
    this.callbacks.onSimulationEvent?.(event);
    // Mecha uses the same presentation hook in solo and on multiplayer mirrors.
    // Existing behaviors still emit their local effects at their legacy seams.
    if (tower.kind === "mecha" && !this.headless && !this.presentationSuspended) {
      getTowerBehavior("mecha")?.presentEvent?.(this.towerPresentationBehaviorContext({ ...event, id: 0, tick: 0, cosmeticSeed: 0 }, tower));
    }
  }

  private towerPresentationBehaviorContext(event: SimulationEvent, tower?: Tower): TowerPresentationBehaviorContext {
    const position = event.position;
    const color = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#ffffff";
    const target = event.targetId === undefined
      ? undefined
      : this.enemies.find((enemy) => enemy.id === event.targetId && enemy.hp > 0);
    const kind = tower?.kind ?? (event.label?.startsWith("mecha-") ? "mecha" : event.label && Object.hasOwn(TOWER_DEFINITIONS, event.label) ? event.label as TowerKind : undefined);
    return {
      event,
      tower,
      target,
      position,
      color,
      enemyPosition: (enemy) => this.enemyPosition(enemy),
      spawnRing: (at, ringColor, life, size, radius) => this.spawnRing(at, ringColor, life, size, radius),
      spawnBeam: (from, to, beamColor, width, delay, secondaryColor, life) => this.spawnBeam(from, to, beamColor, width, delay, secondaryColor, life),
      spawnMuzzleFlash: (from, to, flashColor, size) => this.spawnMuzzleFlash(from, to, flashColor, size),
      spawnArc: (from, to, arcColor) => this.spawnArc(from, to, arcColor),
      spawnLightningAuraArc: (at, radius, arcColor) => this.spawnLightningAuraArc(at, radius, arcColor),
      spawnFlash: (at, flashColor, size) => this.spawnFlash(at, flashColor, size),
      spawnExplosion: (at, explosionColor, radius, scale) => this.spawnExplosion(at, explosionColor, radius, scale),
      spawnImpactDust: (at, dustColor) => this.spawnImpactDust(at, dustColor),
      spawnSlash: (from, to, slashColor, reach, spread, delay, sound, life, direction) => this.spawnSlash(from, to, slashColor, reach, spread, delay, sound, life, direction),
      spawnCrossSlash: (from, to, slashColor, reach, secondaryColor) => this.spawnCrossSlash(from, to, slashColor, reach, secondaryColor),
      spawnCyborgBeam: (from, to, beamColor, width) => this.spawnCyborgBeam(from, to, beamColor, width),
      spawnBulletTracer: (from, to, tracerColor, width) => this.spawnBulletTracer(from, to, tracerColor, width),
      spawnFlameCone: (from, to, halfAngle) => this.effects.spawnFlameCone(from, to, halfAngle),
      spawnWraithDashTrail: (from, to, trailColor, dashDistance) => this.spawnWraithDashTrail(from, to, trailColor, dashDistance),
      spawnWraithFlurry: (at, flurryColor, radius) => this.spawnWraithFlurry(at, flurryColor, radius),
      spawnWraithFlurrySlashes: (at, flurryColor, radius) => this.spawnWraithFlurrySlashes(at, flurryColor, radius),
      spawnShieldFlash: (at, shieldColor, reach) => this.spawnShieldFlash(at, shieldColor, reach),
      spawnVanguardMaceStrike: (from, to, strikeColor) => this.spawnVanguardMaceStrike(from, to, strikeColor),
      spawnVanguardSmash: (at, smashColor, radius) => this.spawnVanguardSmash(at, smashColor, radius),
      startInfernusFlameStream: (sourceTower, targetPoint) => this.startInfernusFlameStream(sourceTower, targetPoint),
      spawnText: (at, text, textColor) => this.spawnText(at, text, textColor),
      enqueueVisualProjectile: (spec: TowerVisualProjectileSpec) => {
        if (!kind) return;
        this.visualProjectiles.push({
          position: { ...spec.start },
          targetId: spec.targetId,
          start: { ...spec.start },
          endpoint: { ...spec.endpoint },
          kind,
          speed: spec.speed,
          color: spec.color,
          splash: spec.splash,
          ...(spec.style === undefined ? {} : { style: spec.style }),
          ...(spec.flightDuration === undefined ? {} : { flightDuration: spec.flightDuration }),
          delay: spec.delay ?? 0,
          launchTowerId: spec.launchTowerId,
          launchSide: spec.launchSide,
          age: 0,
          hidden: (spec.delay ?? 0) > 0,
          scale: spec.scale,
        });
      },
      playShoot: (pitch, sound) => this.audio.shoot(pitch, kind, sound),
      playCounter: () => this.audio.counter(),
      playAbility: (abilityKind = kind) => this.audio.towerAbility(abilityKind),
      playEffect: (effect) => this.audio.towerEffect(effect),
      playBreach: (breachKind = kind) => this.audio.breach("explosion", breachKind),
      playTone: (pitch, duration, volume, detune, bus) => this.audio.tone(pitch, duration, volume, detune, bus),
      clearZenithCharge: (entityId) => {
        this.mirrorZenithCharges.delete(entityId);
        if (!this.presentationSuspended) this.audio.zenithCharge(entityId, false, event.label === "complete" ? 1 : 0);
      },
      setZenithCharge: (entityId, targetId, duration, angle) => {
        this.mirrorZenithCharges.set(entityId, { targetId, remaining: duration, duration, angle });
        if (!this.presentationSuspended) this.audio.zenithCharge(entityId, true, 0, tower?.level ?? 0);
      },
      setTempestField: (entityId, duration, fieldColor) => {
        const previous = this.mirrorFieldEffects.get(entityId);
        this.mirrorFieldEffects.set(entityId, {
          remaining: (previous?.remaining ?? 0) + duration,
          vfxTimer: 0,
          color: fieldColor,
        });
      },
      clearTempestField: (entityId) => this.mirrorFieldEffects.delete(entityId),
    };
  }

  applySimulationEvents(events: readonly SimulationEvent[], allowTransient = true): void {
    const selectedEvents: SimulationEvent[] = [];
    let transientEvents = 0;
    let lifecycleEvents = 0;
    for (const event of events) {
      const eventKind = event.label && Object.hasOwn(TOWER_DEFINITIONS, event.label) ? event.label as TowerKind : undefined;
      const eventTower = event.entityId === undefined ? undefined : this.towers.find((tower) => tower.id === event.entityId);
      const eventBehavior = eventKind ? getTowerBehavior(eventKind) : eventTower ? getTowerBehavior(eventTower.kind) : getTowerBehaviorForEvent(event);
      const persistent = event.kind === "log" || Boolean(eventBehavior?.persistentEvent?.(event));
      if (persistent) {
        if (lifecycleEvents++ < 128) selectedEvents.push(event);
      } else if (transientEvents++ < 64) selectedEvents.push(event);
    }
    selectedEvents.forEach((event) => {
      const eventKind = event.label && Object.hasOwn(TOWER_DEFINITIONS, event.label) ? event.label as TowerKind : undefined;
      const eventTower = event.entityId === undefined ? undefined : this.towers.find((tower) => tower.id === event.entityId);
      const persistent = event.kind === "log" || Boolean((eventKind ? getTowerBehavior(eventKind) : eventTower ? getTowerBehavior(eventTower.kind) : getTowerBehaviorForEvent(event))?.persistentEvent?.(event));
      if ((!allowTransient || this.presentationSuspended) && event.kind !== "log" && !persistent) return;
      const position = event.position;
      const towerKind = event.label && Object.hasOwn(TOWER_DEFINITIONS, event.label) ? event.label as TowerKind : undefined;
      const presentationTower = event.entityId === undefined
        ? towerKind === undefined ? undefined : this.towers.find((candidate) => candidate.kind === towerKind)
        : this.towers.find((candidate) => candidate.id === event.entityId) ?? (towerKind === undefined ? undefined : this.towers.find((candidate) => candidate.kind === towerKind));
      const presentationBehavior = event.label?.startsWith("mecha-") ? getTowerBehavior("mecha") : presentationTower ? getTowerBehavior(presentationTower.kind) : towerKind ? getTowerBehavior(towerKind) : undefined;
      if (presentationBehavior?.presentEvent?.(this.towerPresentationBehaviorContext(event, presentationTower)) === true) return;
      if (event.kind === "charge") {
        const tower = presentationTower;
        if (!tower || event.entityId === undefined) return;
        if (event.label === "start" && event.targetId !== undefined && event.from && event.position) {
          const duration = clamp(event.duration ?? zenithChargeDuration(tower.level), 0.1, 10);
          this.mirrorZenithCharges.set(event.entityId, {
            targetId: event.targetId,
            remaining: duration,
            duration,
            angle: Math.atan2(event.position.y - event.from.y, event.position.x - event.from.x),
          });
          this.audio.zenithCharge(tower.id, true, 0, tower.level);
        } else {
          this.mirrorZenithCharges.delete(event.entityId);
          this.audio.zenithCharge(tower.id, false, event.label === "complete" ? 1 : 0);
        }
      } else if (event.kind === "counter") {
        if (position) {
          this.spawnRing(position, "#ffffff", 0.32, 7, 62);
        }
        this.audio.counter();
      } else if (event.kind === "ability") {
        const hostile = event.entityId === undefined ? undefined : this.enemies.find((enemy) => enemy.id === event.entityId);
        const hostileAbility = hostile && event.abilityId ? normalizeEnemyAbilities(getEnemyDefinition(hostile.kind)).find((ability) => ability.id === event.abilityId) : undefined;
        if (hostile && hostileAbility) {
          if (event.phase === "telegraph") {
            const targets = event.targetId === undefined ? [] : this.towers.filter((tower) => tower.id === event.targetId);
            this.presentEnemyAbilityVisual(hostile, hostileAbility, targets);
          } else if (position && event.phase === "trigger") this.spawnRing(position, event.color ?? "#ff806f", 0.35, 5, 54);
          if (event.phase === "impact") this.audio.hit();
          return;
        }
        const tower = event.entityId === undefined ? undefined : this.towers.find((candidate) => candidate.id === event.entityId);
        if (position) this.spawnRing(position, "#ffd36a", 0.45, 6, 78);
        this.audio.towerAbility(tower?.kind);
      } else if (event.kind === "shockwave") {
        if (position) this.spawnRing(position, "#9ae6ed", 0.7, 9, event.value ?? 120);
        this.audio.enemyShockwave();
      } else if (event.kind === "haste-pulse") {
        const color = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#78f0a0";
        if (position) {
          this.spawnRing(position, color, 0.55, 8, event.value ?? 180);
          this.spawnText(position, `HASTE x${(event.speed ?? 1.5).toFixed(2)}`, color);
        }
        this.audio.tone(330, 0.12, 0.08, 70, "enemies");
      } else if (event.kind === "drain") {
        const color = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#d46cff";
        if (position) {
          this.spawnRing(position, color, 0.65, 10, event.value ?? 160);
          this.spawnText(position, `SIPHON x${event.count ?? 0}`, color);
        }
        this.audio.tone(115, 0.2, 0.1, -35, "enemies");
      } else if (event.kind === "phase") {
        const color = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#a9d7ff";
        if (position) {
          this.spawnRing(position, color, 0.4, 6, event.value ?? 44);
          this.spawnFlash(position, color, 30);
          this.spawnText(position, "PHASE", color);
        }
        this.audio.tone(410, 0.1, 0.07, 90, "enemies");
      } else if (event.kind === "blink") {
        const color = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#f0b4ff";
        if (event.from && position) {
          this.spawnBeam(event.from, position, color, 5, 0, "#ffffff", 0.18);
          this.spawnRing(event.from, color, 0.3, 4, 32);
          this.spawnRing(position, color, 0.35, 6, 40);
          this.spawnText(position, "BLINK", color);
        }
        this.audio.tone(460, 0.08, 0.08, 120, "enemies");
      } else if (event.kind === "behavior") {
        const color = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#f0b4ff";
        if (event.label === "blink" && event.from && position) {
          this.spawnBeam(event.from, position, color, 5, 0, "#ffffff", 0.18);
          this.spawnRing(position, color, 0.35, 6, 40);
        } else if (position) {
          this.spawnRing(position, color, event.label === "stomp" ? 0.75 : 0.45, event.label === "stomp" ? 11 : 7, event.value ?? 54);
          this.spawnText(position, (event.label ?? "BEHAVIOR").replaceAll("-", " ").toUpperCase(), color);
        }
        if (event.label === "stomp") this.audio.enemyShockwave();
        else this.audio.tone(390, 0.1, 0.07, 60, "enemies");
      } else if (event.kind === "attack") {
        const hostile = event.entityId === undefined ? undefined : this.enemies.find((enemy) => enemy.id === event.entityId);
        const hostileAttack = hostile && event.label
          ? getEnemyDefinition(hostile.kind).attacks?.find((attack) => attack.id === event.label)
          : undefined;
        if (hostile && hostileAttack) {
          this.presentEnemyAttackVisual(hostile, hostileAttack);
          this.audio.tone(220, 0.12, 0.08, -20, "enemies");
          return;
        }
        const color = typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#ffffff";
        const target = event.targetId === undefined ? undefined : this.enemies.find((enemy) => enemy.id === event.targetId && enemy.hp > 0);
        const predictedPosition = target ? this.enemyPosition(target) : position;
        const visualCount = clamp(event.count ?? 1, 1, 16);
        const kind = event.label && Object.hasOwn(TOWER_DEFINITIONS, event.label) ? event.label as TowerKind : undefined;
        if (event.from && predictedPosition && event.visual === "projectile" && kind) {
          const speed = clamp(event.speed ?? 330, 40, 2_000);
          for (let shot = 0; shot < visualCount; shot += 1) this.visualProjectiles.push({
            position: { ...event.from }, targetId: event.targetId ?? null, start: { ...event.from }, endpoint: { ...predictedPosition }, kind, speed, color,
            splash: true, age: 0, hidden: false, scale: 1,
          });
          this.spawnMuzzleFlash(event.from, predictedPosition, color, 13);
        } else if (event.from && predictedPosition) {
          // Use the mirror's current predicted target position rather than the
          // delayed position captured when the server emitted the event.
          for (let shot = 0; shot < visualCount; shot += 1) this.spawnBeam(event.from, predictedPosition, shot % 2 === 0 ? color : "#ffffff", 2.2, shot * 0.025);
          this.spawnMuzzleFlash(event.from, predictedPosition, color, 13);
        } else if (position) this.spawnImpactDust(position, color);
        const attackSound = kind === undefined ? undefined : getTowerBehavior(kind)?.attackSound;
        if (attackSound) this.audio.shoot(attackSound.pitch, kind, attackSound.sound);
      } else if (event.kind === "flame") {
        // Tower-specific flame presentation is owned by Infernus's behavior.
      } else if (event.kind === "slash") {
        const color = typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#ffffff";
        if (event.from && position) {
          this.spawnSlash(event.from, position, color, event.value, 0.62, 0, undefined, 0.24, 1);
        }
      } else if (event.kind === "dash") {
        const color = typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#a9d7ff";
        if (event.from && position) {
          this.spawnWraithDashTrail(event.from, position, color, event.value);
        }
      } else if (event.kind === "flurry") {
        const color = typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#a9d7ff";
        if (position) this.spawnWraithFlurry(position, color, event.value ?? 170);
      } else if (event.kind === "flurry-pulse") {
        const color = typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#a9d7ff";
        if (position) this.spawnWraithFlurrySlashes(position, color, event.value ?? 170);
      } else if (event.kind === "cross-slash") {
        const color = typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#ffffff";
        if (event.from && position) this.spawnCrossSlash(event.from, position, color, event.value ?? 90);
      } else if (event.kind === "strike") {
        const color = typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#ffffff";
        if (position) this.spawnSwordStrike(position, color);
        const strikeKind = event.label && Object.hasOwn(TOWER_DEFINITIONS, event.label) ? event.label as TowerKind : undefined;
        const attackSound = strikeKind === undefined ? undefined : getTowerBehavior(strikeKind)?.attackSound;
        if (attackSound && strikeKind) this.audio.shoot(attackSound.pitch, strikeKind, attackSound.sound);
      } else if (event.kind === "explosion") {
        const explosionColor = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#ffb44d";
        if (position) this.spawnExplosion(position, explosionColor, event.value ?? 70);
        this.audio.breach("explosion", towerKind);
      } else if (event.kind === "smash") {
        const smashColor = event.color && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : "#d6a85c";
        if (position) this.spawnRing(position, smashColor, 0.75, 11, event.value ?? 82);
      } else if (event.kind === "impact") {
        if (position) this.spawnImpactDust(position, "#ff806f");
        const struckTower = event.targetId !== undefined && this.towers.some((tower) => tower.id === event.targetId);
        if (struckTower) this.audio.towerDamage();
        else this.audio.enemyHit(false);
      } else if (event.kind === "death") {
        // Enemy removal already matches the single-player path. Do not add a
        // multiplayer-only burst here.
      } else if (event.kind === "summon" || event.kind === "spawn") {
        if (position) this.spawnRing(position, "#9ad7cf", 0.28, 3, 28);
      }
    });
    if (this.particles.length > this.particleLimit) this.particles.splice(0, this.particles.length - this.particleLimit);
    if (this.visualProjectiles.length > this.projectileLimit) this.visualProjectiles.splice(0, this.visualProjectiles.length - this.projectileLimit);
  }

  setPresentationSuspended(suspended: boolean): void {
    this.presentationSuspended = suspended;
    if (suspended) {
      this.audio.tankFlameStream(false);
      this.scheduledPresentationEvents.length = 0;
    }
    if (!suspended) {
      this.towers.forEach((tower) => {
        const remaining = tower.zenithChargeTimer ?? 0;
        if (tower.kind !== "zenith" || remaining <= 0) return;
        this.audio.zenithCharge(tower.id, true, 1 - remaining / zenithChargeDuration(tower.level), tower.level);
      });
      this.mirrorZenithCharges.forEach((charge, towerId) => {
        const tower = this.towers.find((candidate) => candidate.id === towerId);
        if (tower) this.audio.zenithCharge(towerId, true, 1 - charge.remaining / charge.duration, tower.level);
      });
      return;
    }
    this.audio.stopZenithCharges();
    this.particles = [];
    this.visualProjectiles = [];
    this.shake = 0;
  }

  restorePersistentPresentation(): void {
    this.mirrorFieldEffects.clear();
    this.towers.forEach((tower) => {
      const duration = getTowerBehavior(tower.kind)?.persistentFieldDuration?.(tower) ?? 0;
      if (duration <= 0) return;
      this.mirrorFieldEffects.set(tower.id, {
        remaining: duration,
        vfxTimer: 0,
        color: TOWER_DEFINITIONS[tower.kind].accent,
      });
    });
  }

  setSimulationSeed(seed: number): void {
    const normalized = Number.isSafeInteger(seed) ? seed >>> 0 : 0x6d2b79f5;
    this.simulationRandomState = normalized || 0x6d2b79f5;
  }

  private simulationRandom(): number {
    let state = this.simulationRandomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.simulationRandomState = state >>> 0;
    return this.simulationRandomState / 0x1_0000_0000;
  }

  private freshTowerStock(): Record<TowerKind, number> {
    return Object.fromEntries(
      TOWER_ORDER.map((kind) => [kind, TOWER_DEFINITIONS[kind].copyLimit]),
    ) as Record<TowerKind, number>;
  }

  private createPlayerRuntime(): PlayerRuntime {
    return {
      shards: this.mode.startingCash,
      pendingCasualtyRefund: 0,
      damageIncomeRemainder: 0,
      copiesRemaining: this.freshTowerStock(),
    };
  }

  private runtimeFor(playerId: PlayerId): PlayerRuntime {
    let runtime = this.playerRuntimes.get(playerId);
    if (!runtime) {
      runtime = this.createPlayerRuntime();
      this.playerRuntimes.set(playerId, runtime);
    }
    return runtime;
  }

  private get localRuntime(): PlayerRuntime { return this.runtimeFor(this.localPlayerId); }
  private get shards(): number { return this.localRuntime.shards; }
  private set shards(value: number) { this.localRuntime.shards = value; }
  private get pendingCasualtyRefund(): number { return this.localRuntime.pendingCasualtyRefund; }
  private set pendingCasualtyRefund(value: number) { this.localRuntime.pendingCasualtyRefund = value; }
  private get copiesRemaining(): Record<TowerKind, number> { return this.localRuntime.copiesRemaining; }
  private set copiesRemaining(value: Record<TowerKind, number>) { this.localRuntime.copiesRemaining = value; }
  private get isMirror(): boolean { return this.multiplayerRole === "guest"; }
  private get multiplayerActive(): boolean { return this.multiplayerRole !== null; }
  private get cameraPanLocked(): boolean {
    return this.selectedKind !== null || this.relocatingTowerId !== null || this.selectedTower?.aiming === true || this.towers.some((tower) => tower.ownerId === this.localPlayerId && tower.kind === "mecha" && tower.mechaControlled === true);
  }

  configureMultiplayer(role: MultiplayerRole, localPlayer: MultiplayerPlayer, players: readonly MultiplayerPlayer[]): void {
    this.mirrorControlledMechaId = null;
    this.multiplayerRole = role;
    this.localPlayerId = localPlayer.id;
    this.playerProfiles = new Map(players.map((player) => [player.id, player]));
    if (!this.playerProfiles.has(localPlayer.id)) this.playerProfiles.set(localPlayer.id, localPlayer);
    this.availableTowerKinds = new Set(localPlayer.loadout);
    this.availablePerkKinds = new Set(localPlayer.perkLoadout ?? []);
    this.playerRuntimes.clear();
    this.multiplayerRequestTimes.clear();
    this.skipWaveVoteWave = 0;
    this.skipWaveVotes.clear();
    this.mechaInputs.clear();
    this.mechaKeys.clear();
    this.mechaInputSentAt = -Infinity;
    // Preserve the monotonic pilot sequence across same-session reconnects.
    this.pendingPilotInputs.clear();
    this.pilotInputsSent = 0;
    this.pilotInputsAcknowledged = 0;
    this.pilotInputAckDelayMs = 0;
    this.pilotCorrection = 0;
    this.pilotCorrectionSnaps = 0;
    this.playerProfiles.forEach((_player, id) => this.playerRuntimes.set(id, this.createPlayerRuntime()));
    this.remoteCursor = null;
    this.lastSnapshotSequence = -1;
    this.mirrorEnemySamples.clear();
    this.mirrorTankSamples.clear();
    this.mirrorServerTick = 0;
    this.mirrorServerTickReceivedAt = 0;
    this.mirrorPresentationDelayTicks = 4;
    this.mirrorFrameJitterTicks = 0;
    this.mirrorLateEvents = 0;
    this.mirrorScheduledEvents = 0;
    this.clearMultiplayerPresentationQueue();
    this.emitUi();
  }

  updateMultiplayerPlayers(players: readonly MultiplayerPlayer[]): void {
    if (!this.multiplayerActive) return;
    players.forEach((player) => {
      this.playerProfiles.set(player.id, player);
      this.runtimeFor(player.id);
    });
    this.emitUi();
  }

  clearMultiplayer(): void {
    this.mirrorControlledMechaId = null;
    this.multiplayerRole = null;
    this.localPlayerId = SOLO_PLAYER_ID;
    this.playerProfiles.clear();
    this.playerRuntimes.clear();
    this.multiplayerRequestTimes.clear();
    this.skipWaveVoteWave = 0;
    this.skipWaveVotes.clear();
    this.mechaInputs.clear();
    this.mechaKeys.clear();
    this.mechaInputSentAt = -Infinity;
    this.pilotInputSequence = 0;
    this.pendingPilotInputs.clear();
    this.pilotInputsSent = 0;
    this.pilotInputsAcknowledged = 0;
    this.pilotInputAckDelayMs = 0;
    this.pilotCorrection = 0;
    this.pilotCorrectionSnaps = 0;
    this.remoteCursor = null;
    this.lastSnapshotSequence = -1;
    this.mirrorEnemyTargets.clear();
    this.mirrorEnemySamples.clear();
    this.mirrorTankSamples.clear();
    this.mirrorServerTick = 0;
    this.mirrorServerTickReceivedAt = 0;
    this.mirrorPresentationDelayTicks = 4;
    this.mirrorFrameJitterTicks = 0;
    this.mirrorLateEvents = 0;
    this.mirrorScheduledEvents = 0;
    this.clearMultiplayerPresentationQueue();
    this.mirrorZenithCharges.clear();
    this.mirrorInterpolationCorrection = 0;
    this.emitUi();
  }

  getMultiplayerInterpolationCorrection(): number {
    return this.mirrorInterpolationCorrection;
  }

  getMultiplayerPredictionDiagnostics(): Readonly<{ pending: number; sent: number; acknowledged: number; ackDelayMs: number; correction: number; snaps: number }> {
    return {
      pending: [...this.pendingPilotInputs.values()].reduce((total, inputs) => total + inputs.length, 0),
      sent: this.pilotInputsSent,
      acknowledged: this.pilotInputsAcknowledged,
      ackDelayMs: this.pilotInputAckDelayMs,
      correction: this.pilotCorrection,
      snaps: this.pilotCorrectionSnaps,
    };
  }

  getMultiplayerPresentationDiagnostics(): Readonly<{ delayTicks: number; extrapolationTicks: number; queuedEvents: number; lateEvents: number; scheduledEvents: number }> {
    return {
      delayTicks: this.mirrorPresentationDelayTicks,
      extrapolationTicks: this.mirrorExtrapolationTicks,
      queuedEvents: this.scheduledPresentationEvents.length,
      lateEvents: this.mirrorLateEvents,
      scheduledEvents: this.mirrorScheduledEvents,
    };
  }

  beginMultiplayerCommandFeedback(commandId: string, command: MultiplayerCommand): void {
    if (!this.isMirror || !commandId) return;
    const now = this.now();
    this.pendingCommandFeedback.set(commandId, { command, accepted: false, expiresAt: now + 10_000 });
    if (command.type === "deploy" || command.type === "relocate") {
      const placement = this.placementAt(command.position, command.type === "relocate" ? command.towerId : undefined);
      const kind = command.type === "deploy" ? command.kind : this.towers.find((tower) => tower.id === command.towerId)?.kind;
      if (placement.valid && kind) this.pendingPlacementFeedback.set(commandId, {
        commandId,
        kind,
        position: { ...placement.position },
        onPath: placement.onPath,
        ...(command.type === "relocate" ? { relocatingTowerId: command.towerId } : {}),
      });
    }
    if (!this.headless) {
      const towerId = "towerId" in command ? command.towerId : undefined;
      const tower = towerId === undefined ? undefined : this.towers.find((candidate) => candidate.id === towerId);
      const point = command.type === "deploy" || command.type === "relocate" ? command.position : tower?.position;
      if (point) this.spawnRing(point, tower ? TOWER_DEFINITIONS[tower.kind].accent : "#9ad7cf", 0.22, 3, 34);
    }
    this.emitUi();
  }

  resolveMultiplayerCommandFeedback(commandId: string, accepted: boolean): void {
    const feedback = this.pendingCommandFeedback.get(commandId);
    if (!feedback) return;
    if (!accepted) {
      this.pendingCommandFeedback.delete(commandId);
      this.pendingPlacementFeedback.delete(commandId);
    } else {
      feedback.accepted = true;
      // The following authoritative snapshot normally confirms the visual
      // marker. Retain a short grace period if that frame is delayed.
      feedback.expiresAt = this.now() + 1_200;
    }
    this.emitUi();
  }

  clearMultiplayerPresentationQueue(): void {
    this.scheduledPresentationEvents.length = 0;
    this.pendingCommandFeedback.clear();
    this.pendingPlacementFeedback.clear();
  }

  scheduleMultiplayerEvents(events: readonly SimulationEvent[], serverTick: number, receivedAt = this.now(), allowTransient = true): void {
    if (!this.isMirror || events.length === 0) return;
    this.updateMirrorTimeline(serverTick, receivedAt);
    const presentationTick = this.currentMirrorPresentationTick(receivedAt);
    for (const event of events) {
      const persistent = event.kind === "log" || Boolean(getTowerBehaviorForEvent(event)?.persistentEvent?.(event));
      if (persistent) {
        this.applySimulationEvents([event], allowTransient);
        continue;
      }
      const offsets = event.occurrenceTickOffsets?.length ? event.occurrenceTickOffsets : [0];
      for (const offset of offsets) {
        const dueTick = event.tick + offset;
        const occurrence = offsets.length > 1 ? { ...event, tick: dueTick, count: 1, occurrenceTickOffsets: undefined } : event;
        if (presentationTick - dueTick > 8) {
          this.mirrorLateEvents += 1;
          // Late travelling shots would otherwise visibly launch after their
          // authoritative impact. A compact tracer/impact is less misleading.
          const compact = occurrence.kind === "attack" && occurrence.visual === "projectile"
            ? { ...occurrence, visual: "hitscan" as const }
            : occurrence;
          this.applySimulationEvents([compact], allowTransient);
          continue;
        }
        this.scheduledPresentationEvents.push({ event: occurrence, dueTick, allowTransient });
        this.mirrorScheduledEvents += 1;
      }
    }
    this.scheduledPresentationEvents.sort((left, right) => left.dueTick - right.dueTick || left.event.id - right.event.id);
  }

  setRemoteCursor(player: MultiplayerPlayer, point: Point | null): void {
    const now = this.now();
    const previous = this.remoteCursor;
    const canInterpolate = Boolean(
      point && previous && previous.player.id === player.id && previous.point && previous.targetPoint && now - previous.updatedAt <= 8_000,
    );
    this.remoteCursor = {
      player,
      point: canInterpolate ? previous!.point : point ? { ...point } : null,
      targetPoint: point ? { ...point } : null,
      updatedAt: now,
      lastRenderAt: canInterpolate ? previous!.lastRenderAt : now,
    };
  }

  startRun(map: MapDefinition, unlockedTowers: readonly TowerKind[], mode: ModeDefinition = NORMAL_MODE): void {
    this.map = scaleMapDefinition(map);
    this.paths = this.map.paths.map((route) => new Polyline(route.path));
    this.path = this.paths[0] ?? new Polyline(this.map.path);
    this.resetCamera();
    this.rebuildStaticMapLayer();
    this.mode = mode;
    this.availableTowerKinds = new Set(unlockedTowers);
    this.maxIntegrity = this.mode.coreIntegrity;
    this.restart();
    this.callbacks.onLog(
      `${this.map.name} loaded // ${this.mode.name}, ${this.mode.waves.length} finite waves.`,
      "good",
    );
  }

  leaveRun(): void {
    this.audio.tankFlameStream(false);
    this.releaseMechaInput();
    this.audio.stopZenithCharges();
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.visualProjectiles = [];
    this.mirrorFieldEffects.clear();
    this.mirrorZenithCharges.clear();
    this.mirrorEnemyTargets.clear();
    this.mechaInputs.clear();
    this.mechaKeys.clear();
    this.mechaInputSentAt = -Infinity;
    this.towerHealthBars.clear();
    this.mirrorInterpolationCorrection = 0;
    this.particles = [];
    this.timedBombs = [];
    this.admiralShots = [];
    this.delayedSlashes = [];
    this.spawnQueue = [];
    this.enemyAbilityEngine.reset();
    this.enemyAbilityTick = 0;
    this.enemyAbilityTickAccumulator = 0;
    this.started = false;
    this.waveActive = false;
    this.waveAllSpawnedAt = null;
    this.waveSpawnDuration = 0;
    this.skipWaveDismissedWave = 0;
    this.skipWaveVoteWave = 0;
    this.skipWaveVotes.clear();
    this.intermissionTimer = 0;
    this.paused = false;
    this.selectedKind = null;
    this.selectedTowerId = null;
    this.relocatingTowerId = null;
    this.placement = null;
    this.audio.stopAmbience();
    this.emitUi();
  }

  setAvailableTowers(unlockedTowers: readonly TowerKind[]): void {
    this.availableTowerKinds = new Set(unlockedTowers);
    this.emitUi();
  }

  setAvailablePerks(perks: readonly TowerPerkKind[]): void {
    this.availablePerkKinds = new Set(perks.filter((kind) => Object.hasOwn(TOWER_PERK_DEFINITIONS, kind)));
    this.emitUi();
  }

  refreshAudioState(): void {
    this.emitUi();
  }

  begin(): void {
    if (this.started) return;
    this.started = true;
    this.intermissionTimer = WAVE_INTERMISSION_SECONDS;
    this.callbacks.onLog(`${this.mode.name} initialized // ${this.mode.waves.length} finite waves.`, "good");
    this.emitUi();
  }

  restart(): void {
    this.audio.tankFlameStream(false);
    this.releaseMechaInput();
    this.audio.stopZenithCharges();
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.visualProjectiles = [];
    this.mirrorFieldEffects.clear();
    this.mirrorZenithCharges.clear();
    this.mirrorEnemyTargets.clear();
    this.mechaInputs.clear();
    this.towerHealthBars.clear();
    this.mirrorInterpolationCorrection = 0;
    this.particles = [];
    this.timedBombs = [];
    this.admiralShots = [];
    this.delayedSlashes = [];
    this.spawnQueue = [];
    this.enemyAbilityEngine.reset();
    this.enemyAbilityTick = 0;
    this.enemyAbilityTickAccumulator = 0;
    this.integrity = this.maxIntegrity;
    if (!this.multiplayerActive) {
      this.localPlayerId = SOLO_PLAYER_ID;
      this.playerRuntimes.clear();
    }
    const playerIds = this.multiplayerActive ? [...this.playerProfiles.keys()] : [this.localPlayerId];
    playerIds.forEach((playerId) => this.playerRuntimes.set(playerId, this.createPlayerRuntime()));
    this.infiniteCash = false;
    this.tempestPlacementTriggered = false;
    this.waveNumber = 0;
    this.nextWaveIndex = 0;
    this.waveActive = false;
    this.intermissionTimer = WAVE_INTERMISSION_SECONDS;
    this.waveElapsed = 0;
    this.waveAllSpawnedAt = null;
    this.waveSpawnDuration = 0;
    this.skipWaveDismissedWave = 0;
    this.skipWaveVoteWave = 0;
    this.skipWaveVotes.clear();
    this.selectedTowerId = null;
    this.relocatingTowerId = null;
    this.selectedKind = null;
    this.gameOver = false;
    this.modeComplete = false;
    this.paused = false;
    this.started = true;
    this.audio.startAmbience(0.12);
    this.callbacks.onLog("Timeline restored. Core integrity nominal.", "good");
    this.emitUi();
  }

  selectKind(kind: TowerKind): void {
    if (this.gameOver) return;
    if (this.towers.some((tower) => tower.ownerId === this.localPlayerId && tower.kind === "mecha" && tower.mechaControlled === true)) {
      this.callbacks.onLog("Pilot Mode active // exit control before selecting another deployment.", "danger");
      this.audio.fail();
      return;
    }
    if (!this.availableTowerKinds.has(kind)) {
      this.callbacks.onLog(`${TOWER_DEFINITIONS[kind].name} is locked // purchase it from the tower shop.`, "danger");
      this.audio.fail();
      return;
    }
    if (this.copiesRemaining[kind] <= 0) {
      this.callbacks.onLog(`${TOWER_DEFINITIONS[kind].name} stock exhausted // deployments are permanent.`, "danger");
      this.audio.fail();
      return;
    }
    this.selectedKind = this.selectedKind === kind ? null : kind;
    this.relocatingTowerId = null;
    this.selectedTowerId = null;
    this.updatePlacement();
    this.emitUi();
  }

  cancelPlacement(): void {
    this.selectedKind = null;
    this.relocatingTowerId = null;
    this.placement = null;
    this.emitUi();
  }

  deselectTower(): void {
    if (this.selectedTower?.mechaControlled && this.selectedTower.ownerId === this.localPlayerId) return;
    if (this.selectedTowerId === null) return;
    this.selectedTowerId = null;
    this.emitUi();
  }

  setInspectorOpen(open: boolean): void {
    if (this.inspectorOpen === open) return;
    this.inspectorOpen = open;
  }

  private callWave(): void {
    if (!this.started || this.waveActive || this.intermissionTimer > 0 || this.gameOver || this.modeComplete) return;
    if (!this.mode.waves[this.nextWaveIndex]) return;
    const totalRecovered = this.collectPendingCasualtyRefund();
    if (totalRecovered > 0) this.callbacks.onLog(`Casualty recovery arrived // $${totalRecovered} distributed to tower owners.`, "good");
    this.startWave(this.nextWaveIndex, false);
  }

  private collectPendingCasualtyRefund(): number {
    let totalRecovered = 0;
    this.playerRuntimes.forEach((runtime) => {
      totalRecovered += runtime.pendingCasualtyRefund;
      runtime.shards += runtime.pendingCasualtyRefund;
      runtime.pendingCasualtyRefund = 0;
    });
    return totalRecovered;
  }

  private startWave(waveIndex: number, skipped: boolean): void {
    const definition = this.mode.waves[waveIndex];
    if (!definition) return;
    this.nextWaveIndex = waveIndex;
    this.waveNumber = waveIndex + 1;
    this.advanceEnemyWaveLocks();
    const plan = buildWaveSpawnPlan(this.mode, this.map, waveIndex, this.paths.length);
    this.waveSpawnDuration = plan.duration;
    this.spawnQueue = [...plan.entries];
    this.waveElapsed = 0;
    this.waveAllSpawnedAt = null;
    this.waveActive = true;
    this.skipWaveDismissedWave = 0;
    this.skipWaveVoteWave = 0;
    this.skipWaveVotes.clear();
    if (skipped) this.callbacks.onLog(`Wave ${this.waveNumber.toString().padStart(2, "0")} // skip accepted; existing hostiles remain active.`, "danger");
    else this.callbacks.onLog(`Wave ${this.waveNumber.toString().padStart(2, "0")} // breach signatures detected.`, "danger");
    if (definition.message) this.callbacks.onLog(definition.message, "danger");
    this.audio.waveStart();
    this.audio.setAmbienceIntensity(0.28);
    this.emitUi();
  }

  togglePause(): void {
    if (!this.started || this.gameOver) return;
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "pause" });
      return;
    }
    this.setPaused(!this.paused);
  }

  setPaused(paused: boolean): void {
    if (!this.started || this.gameOver || this.isMirror || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.releaseMechaInput();
      // Both players' inputs live on the authority. Pausing must not retain
      // a remote held key/fire command that resumes before its next heartbeat.
      this.mechaInputs.forEach((input) => {
        input.moveX = 0;
        input.moveY = 0;
        input.firing = false;
        input.brake = true;
      });
      this.towers.forEach((tower) => {
        if (tower.kind !== "mecha") return;
        tower.mechaFiring = false;
        tower.mechaSpeed = 0;
      });
    }
    this.callbacks.onLog(this.paused ? "Simulation suspended." : "Simulation resumed.");
    this.audio.setAmbienceIntensity(this.paused ? 0.05 : this.waveActive ? 0.28 : 0.12);
    this.audio.uiPause(this.paused);
    this.emitUi();
  }

  skipWave(): boolean {
    if (!this.canSkipWave()) return false;
    if (this.isMirror) {
      if (this.skipWaveVoteWave === this.waveNumber) return false;
      this.skipWaveVoteWave = this.waveNumber;
      this.callbacks.onCommand?.({ type: "skip-wave" });
      this.emitUi();
      return true;
    }
    if (this.multiplayerActive) {
      if (this.skipWaveVotes.has(this.localPlayerId)) return false;
      this.skipWaveVotes.add(this.localPlayerId);
      if (this.skipWaveVotes.size < this.playerProfiles.size) {
        this.emitUi();
        return true;
      }
    }
    return this.skipToNextWave();
  }

  dismissSkipWave(): void {
    if (!this.canSkipWave()) return;
    this.skipWaveDismissedWave = this.waveNumber;
    this.emitUi();
  }

  private canSkipWave(): boolean {
    return this.started && this.waveActive && !this.gameOver && !this.modeComplete && this.waveAllSpawnedAt !== null &&
      this.waveElapsed - this.waveAllSpawnedAt >= WAVE_SKIP_DELAY_AFTER_SPAWN_SECONDS && Boolean(this.mode.waves[this.nextWaveIndex + 1]);
  }

  private spawnDurationForWave(waveIndex: number): number {
    return spawnDurationForWave(this.mode, this.map, waveIndex, this.paths.length);
  }

  private skipToNextWave(): boolean {
    const nextWaveIndex = this.nextWaveIndex + 1;
    if (!this.mode.waves[nextWaveIndex]) return false;
    this.settleWave(true);
    return true;
  }

  setVisualPreferences(preferences: {
    readonly screenShakeStrength: number;
    readonly canvasResolution: number;
    readonly particleDensity: number;
    readonly projectileDensity: number;
    readonly canvasGlow: boolean;
    readonly reducedMotion: boolean;
  }): void {
    const resolutionChanged = this.canvasResolution !== preferences.canvasResolution;
    this.screenShakeStrength = clamp(preferences.screenShakeStrength, 0, 1);
    this.canvasResolution = clamp(preferences.canvasResolution, 0.5, 2);
    const particleDensity = clamp(preferences.particleDensity, 0.2, 1);
    const projectileDensity = clamp(preferences.projectileDensity, 0.25, 1);
    this.particleLimit = Math.round(120 + ((particleDensity - 0.2) / 0.8) * 480);
    this.projectileLimit = Math.round(32 + ((projectileDensity - 0.25) / 0.75) * 96);
    this.particleCullMode = particleDensity < 0.3 ? "sparse" : particleDensity < 0.6 ? "half" : particleDensity < 0.9 ? "third" : "full";
    this.canvasGlow = preferences.canvasGlow;
    this.reducedMotion = preferences.reducedMotion;
    if (resolutionChanged && !this.headless) this.resize();
  }

  cycleSpeed(): void {
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "speed" });
      return;
    }
    this.speed = this.speed === 1 ? 1.5 : this.speed === 1.5 ? 2 : 1;
    this.callbacks.onLog(`Simulation clock set to ${this.speed}Ã—.`);
    this.audio.uiSpeed(this.speed);
    this.emitUi();
  }

  toggleSound(): void {
    const enabled = this.audio.toggle();
    this.callbacks.onLog(`Audio ${enabled ? "enabled" : "muted"}.`);
    this.emitUi();
  }

  toggleInfiniteCash(): void {
    if (this.multiplayerActive) {
      this.callbacks.onLog("Debug commands are disabled during multiplayer.", "danger");
      return;
    }
    this.infiniteCash = !this.infiniteCash;
    this.callbacks.onLog(`Debug // infinite cash ${this.infiniteCash ? "enabled" : "disabled"}.`, "good");
    this.emitUi();
  }

  debugAddCash(amount = 1000): void {
    if (this.multiplayerActive) return;
    this.shards += amount;
    this.callbacks.onLog(`Debug // +$${amount.toLocaleString()} cash.`, "good");
    this.emitUi();
  }

  debugHealCore(): void {
    if (this.multiplayerActive) return;
    this.integrity = this.maxIntegrity;
    this.callbacks.onLog("Debug // core integrity restored.", "good");
    this.emitUi();
  }

  debugClearWave(): void {
    if (this.multiplayerActive) return;
    this.towers.forEach((tower) => tower.engaged.clear());
    this.enemies = [];
    this.projectiles = [];
    this.visualProjectiles = [];
    this.delayedSlashes = [];
    this.admiralShots = [];
    this.spawnQueue = [];
    if (this.waveActive) this.completeWave();
    else {
      this.callbacks.onLog("Debug // no active wave to clear.");
      this.emitUi();
    }
  }

  debugJumpToWave(wave: number): void {
    if (this.multiplayerActive || !this.started || this.mode.waves.length === 0) return;
    const target = Math.min(this.mode.waves.length, Math.max(1, Math.round(wave)));
    this.restart();
    this.nextWaveIndex = target - 1;
    this.intermissionTimer = 0;
    this.callbacks.onLog(`Test // jumped to wave ${target.toString().padStart(2, "0")}.`, "good");
    this.callWave();
  }

  debugRestock(): void {
    if (this.multiplayerActive) return;
    this.copiesRemaining = this.freshTowerStock();
    this.callbacks.onLog("Debug // all deployment stock restored.", "good");
    this.emitUi();
  }

  debugMaxSelected(): void {
    if (this.multiplayerActive) return;
    const tower = this.selectedTower;
    if (!tower) {
      this.callbacks.onLog("Debug // select a tower first.", "danger");
      return;
    }
    const definition = TOWER_DEFINITIONS[tower.kind];
    tower.level = definition.levels.length - 1;
    const stats = this.towerStats(tower);
    tower.maxHp = Math.round(definition.onPath.hp * stats.hpMultiplier);
    tower.hp = tower.maxHp;
    if (tower.onPath) {
      tower.maxAggro = this.towerAggroLimit(tower, true);
    }
    tower.ammo = stats.ammo ?? -1;
    tower.counterCooldown = 0;
    tower.abilityCooldown = 0;
    if (tower.abilityCooldowns) tower.abilityCooldowns.f = 0;
    tower.regenTimer = 7;
    getTowerBehavior(tower.kind)?.onDebugMax?.(this.towerLifecycleBehaviorContext(tower));
    this.spawnText(tower.position, "DEBUG MAX", definition.accent);
    this.callbacks.onLog(`Debug // ${definition.name} advanced to maximum level.`, "good");
    this.emitUi();
  }

  applyDebugTowerBalance(kind: TowerKind): void {
    const definition = TOWER_DEFINITIONS[kind];
    this.towers.filter((tower) => tower.kind === kind).forEach((tower) => {
      const stats = this.towerStats(tower);
      tower.maxHp = Math.round(definition.onPath.hp * stats.hpMultiplier);
      tower.hp = Math.min(tower.hp, tower.maxHp);
      tower.maxAggro = this.towerAggroLimit(tower, tower.onPath);
      tower.ammo = stats.ammo ?? -1;
    });
    this.callbacks.onLog(`Debug // ${definition.name} balance applied to active constructs.`, "good");
    this.emitUi();
  }

  sellSelected(): boolean {
    const tower = this.selectedTower;
    if (!tower || this.gameOver || tower.ownerId !== this.localPlayerId) return false;
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "sell", towerId: tower.id });
      return true;
    }
    const refund = this.towerSellValue(tower);
    if (tower.kind === "mecha") this.releaseMechaInput();
    this.releaseTowerEnemies(tower);
    this.towers = this.towers.filter((candidate) => candidate.id !== tower.id);
    this.mechaInputs.delete(tower.id);
    if (tower.kind === "mecha") this.mechaKeys.clear();
    this.timedBombs = this.timedBombs.filter((bomb) => bomb.label === "mecha-missile" || bomb.sourceTowerId !== tower.id);
    this.shards += refund;
    this.selectedTowerId = null;
    if (this.relocatingTowerId === tower.id) this.relocatingTowerId = null;
    this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].name} sold // +$${refund}; copy expended.`, "good");
    this.audio.tone(280, 0.12, 0.02, -120);
    this.emitUi();
    return true;
  }

  private towerSellValue(tower: Tower): number {
    const refundRate = getTowerBehavior(tower.kind)?.sellRefundRate?.(tower) ?? 0.5;
    return Math.floor(tower.totalInvested * refundRate);
  }

  upgradeSelected(): boolean {
    const tower = this.selectedTower;
    if (!tower || this.gameOver || tower.ownerId !== this.localPlayerId) return false;
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "upgrade", towerId: tower.id });
      return true;
    }
    const definition = TOWER_DEFINITIONS[tower.kind];
    const upgrade = definition.upgrades[tower.level];
    if (!upgrade) return false;
    if (!this.infiniteCash && this.shards < upgrade.cost) {
      this.callbacks.onLog(`Insufficient cash // $${upgrade.cost} required for ${upgrade.title}.`, "danger");
      this.audio.fail();
      return false;
    }

    const previousMaxHp = tower.maxHp;
    if (!this.infiniteCash) this.shards -= upgrade.cost;
    tower.totalInvested += upgrade.cost;
    tower.level = upgrade.level;
    const levelStats = this.towerStats(tower);
    tower.maxHp = Math.round(definition.onPath.hp * levelStats.hpMultiplier);
    tower.hp = Math.min(tower.maxHp, tower.hp + tower.maxHp - previousMaxHp);
    if (tower.onPath) {
      tower.maxAggro = this.towerAggroLimit(tower, true);
    }
    getTowerBehavior(tower.kind)?.onUpgrade?.(this.towerLifecycleBehaviorContext(tower));
    tower.fireTimer = Math.min(tower.fireTimer, 0.18);
    tower.counterFlash = 0.8;
    this.spawnRing(tower.position, definition.accent, 0.7, 8);
    this.spawnText(tower.position, `LEVEL ${tower.level} // ${upgrade.title.toUpperCase()}`, definition.accent);
    this.callbacks.onLog(`${definition.name} upgraded to level ${tower.level} // ${upgrade.title} unlocked.`, "good");
    this.audio.towerUpgrade();
    this.emitUi();
    return true;
  }

  startMoveSelected(): void {
    const tower = this.selectedTower;
    if (!tower || this.gameOver || tower.ownerId !== this.localPlayerId) return;
    if (tower.kind === "mecha") {
      this.callbacks.onLog("Tank drives with WASD in Pilot Mode; paid relocation is unavailable.");
      return;
    }
    if (!this.infiniteCash && this.shards < ECONOMY_RULES.relocationCost) {
      this.callbacks.onLog(`Insufficient cash // $${ECONOMY_RULES.relocationCost} required to relocate.`, "danger");
      this.audio.fail();
      return;
    }
    this.selectedKind = null;
    this.relocatingTowerId = tower.id;
    this.updatePlacement();
    this.callbacks.onLog(`Relocating ${TOWER_DEFINITIONS[tower.kind].name} // choose any valid path or field site.`);
    this.audio.tone(360, 0.08, 0.014, 80, "ui");
    this.emitUi();
  }

  setSelectedTargeting(targeting: TargetingMode): boolean {
    const tower = this.selectedTower;
    if (!tower || tower.ownerId !== this.localPlayerId || tower.targeting === targeting) return false;
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "target", towerId: tower.id, targeting });
      return true;
    }
    tower.targeting = targeting;
    this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].name} target priority // ${targeting.toUpperCase()}.`);
    this.audio.tone(410, 0.06, 0.012, 60, "ui");
    this.emitUi();
    return true;
  }

  toggleSelectedAutoCounter(): boolean {
    const tower = this.selectedTower;
    if (!tower || tower.ownerId !== this.localPlayerId || this.gameOver) {
      this.audio.fail();
      return false;
    }
    if (tower.kind === "mecha" && tower.mechaControlled !== true) {
      this.spawnText(tower.position, "PILOT MODE REQUIRED", "#9ba1a3");
      this.audio.fail();
      return false;
    }
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "auto-counter", towerId: tower.id });
      return true;
    }
    if (tower.hp <= 0 || !tower.onPath) {
      this.spawnText(tower.position, "PATHBOUND ONLY", "#9ba1a3");
      this.audio.fail();
      return false;
    }
    const enabled = !tower.autoCounter;
    if (enabled) {
      const previous = this.towers.find((candidate) =>
        candidate.id !== tower.id && candidate.ownerId === tower.ownerId && candidate.autoCounter,
      );
      if (previous) {
        previous.autoCounter = false;
        this.callbacks.onLog(`${TOWER_DEFINITIONS[previous.kind].name} AutoCounter // DISABLED (one slot per operator).`);
      }
    }
    tower.autoCounter = enabled;
    this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].name} AutoCounter // ${enabled ? "ENABLED" : "DISABLED"}.`, enabled ? "good" : undefined);
    this.audio.tone(enabled ? 620 : 360, 0.08, 0.014, 80, "ui");
    this.emitUi();
    return true;
  }

  counterSelected(): boolean {
    const tower = this.selectedTower;
    if (!tower || tower.ownerId !== this.localPlayerId || this.gameOver || this.paused) {
      this.audio.fail();
      return false;
    }
    if (tower.kind === "mecha" && tower.mechaControlled !== true) {
      this.spawnText(tower.position, "PILOT MODE REQUIRED", "#9ba1a3");
      this.audio.fail();
      return false;
    }
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "counter", towerId: tower.id });
      this.spawnRing(tower.position, TOWER_DEFINITIONS[tower.kind].accent, 0.18, 3, 34);
      this.spawnText(tower.position, "COUNTER SENT", TOWER_DEFINITIONS[tower.kind].accent);
      return true;
    }
    if (tower.stunTimer > 0) {
      this.spawnText(tower.position, `STUNNED ${tower.stunTimer.toFixed(1)}s`, "#ffc866");
      this.audio.fail();
      return false;
    }
    if (!tower.onPath) {
      this.audio.fail();
      return false;
    }
    if (tower.counterCooldown > 0) {
      this.spawnText(tower.position, "RECHARGING", "#9ba1a3");
      this.audio.fail();
      return false;
    }
    const attackers = this.incomingCounterAttackers(tower);
    const imminent = attackers[0];
    if (!imminent) {
      tower.counterCooldown = 0.7;
      this.spawnText(tower.position, "NO SIGNAL", "#a7abad");
      this.callbacks.onLog("Counter missed // no incoming strike signature.");
      this.audio.fail();
      this.emitUi();
      return false;
    }
    if (imminent.attackTimer > COMBAT_RULES.counterWindow) {
      tower.counterCooldown = 0.45;
      this.spawnText(tower.position, "TOO EARLY", "#e2a662");
      this.callbacks.onLog("Counter mistimed // wait for the ring to close.");
      this.audio.fail();
      this.emitUi();
      return false;
    }

    return this.performCounter(tower, attackers, imminent);
  }

  private incomingCounterAttackers(tower: Tower, additionalVictims: readonly Enemy[] = []): Enemy[] {
    const attackers = new Map<number, Enemy>();
    this.enemies
      .filter((enemy) => enemy.hp > 0 && enemy.targetTowerId === tower.id && enemy.attackTimer <= enemy.telegraphDuration)
      .forEach((enemy) => attackers.set(enemy.id, enemy));
    additionalVictims.forEach((enemy) => {
      if (enemy.hp > 0 && this.canTowerTarget(tower, enemy)) attackers.set(enemy.id, enemy);
    });
    return [...attackers.values()].sort((a, b) => a.attackTimer - b.attackTimer || a.id - b.id);
  }

  private performCounter(tower: Tower, attackers: readonly Enemy[], imminent?: Enemy): boolean {
    const target = imminent ?? attackers[0];
    if (!target) return false;
    tower.counterCooldown = COMBAT_RULES.counterCooldown;
    tower.counterFlash = 0.8;
    attackers.forEach((enemy) => {
      if (enemy.targetTowerId === tower.id) enemy.attackTimer = enemy.attackInterval + 0.45;
      this.applyTowerStun(enemy, 0.4);
    });
    this.executeCounter(tower, attackers);
    this.shake = Math.min(1, this.shake + 0.32);
    this.spawnText(tower.position, "PERFECT COUNTER", TOWER_DEFINITIONS[tower.kind].accent);
    this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].onPath.title} answered with ${this.counterName(tower.kind)}.`, "good");
    this.callbacks.onSimulationEvent?.({
      kind: "counter",
      entityId: tower.id,
      targetId: target.id,
      position: { ...tower.position },
      color: TOWER_DEFINITIONS[tower.kind].accent,
      label: tower.kind,
      value: this.towerStats(tower).range * RANGE_SCALE,
    });
    this.audio.counter();
    this.emitUi();
    return true;
  }

  activateSelectedAbility(slot: TowerAbilitySlot = "f"): boolean {
    const tower = this.selectedTower;
    if (!tower || tower.ownerId !== this.localPlayerId || this.gameOver || this.paused) {
      this.audio.fail();
      return false;
    }
    const ability = getTowerAbilityWithPerks(TOWER_DEFINITIONS[tower.kind], tower.perks, slot);
    const behavior = getTowerBehavior(tower.kind);
    if (!ability || tower.level < ability.unlockLevel) {
      this.spawnText(tower.position, "NO ABILITY", "#9ba1a3");
      this.audio.fail();
      return false;
    }
    if (ability.automatic) {
      this.spawnText(tower.position, "AUTOMATIC", "#9ba1a3");
      this.audio.fail();
      return false;
    }
    if (tower.stunTimer > 0) {
      this.spawnText(tower.position, `STUNNED ${tower.stunTimer.toFixed(1)}s`, "#ffc866");
      this.audio.fail();
      return false;
    }
    const cooldown = tower.abilityCooldowns?.[slot] ?? (slot === "f" ? tower.abilityCooldown : 0);
    if (cooldown > 0 && !(behavior?.pauseAbilityCooldownWhileActive && slot === "f" && tower.abilityTimer > 0)) {
      this.spawnText(tower.position, `${ability.name.toUpperCase()} ${cooldown.toFixed(1)}s`, "#9ba1a3");
      this.audio.fail();
      return false;
    }
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "ability", towerId: tower.id, slot });
      this.spawnRing(tower.position, TOWER_DEFINITIONS[tower.kind].accent, 0.18, 3, 40);
      this.spawnText(tower.position, `${ability.name.toUpperCase()} SENT`, TOWER_DEFINITIONS[tower.kind].accent);
      return true;
    }
    if (behavior?.ability) {
      const abilityResult = behavior.ability(this.towerAbilityBehaviorContext(tower, slot));
      if (abilityResult === false) return false;
    }
    this.callbacks.onSimulationEvent?.({ kind: "ability", entityId: tower.id, position: { ...tower.position } });
    this.emitUi();
    return true;
  }

  aimSelected(point: Point): boolean {
    const tower = this.selectedTower;
    const behavior = tower ? getTowerBehavior(tower.kind) : undefined;
    if (!tower || !behavior?.aim || tower.ownerId !== this.localPlayerId || !tower.aiming || this.gameOver || this.paused) {
      this.audio.fail();
      return false;
    }
    const aimed = this.clampAdmiralAimPoint(tower, point);
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "aim", towerId: tower.id, position: aimed });
      return true;
    }
    return behavior.aim({
      tower,
      point: aimed,
      clampPoint: (candidate) => this.clampAdmiralAimPoint(tower, candidate),
      accent: TOWER_DEFINITIONS[tower.kind].accent,
      dimAccent: TOWER_DEFINITIONS[tower.kind].dimAccent,
      spawnText: (position, text, color) => this.spawnText(position, text, color ?? TOWER_DEFINITIONS[tower.kind].accent),
      log: (message, tone) => this.callbacks.onLog(message, tone),
      playAbilitySound: () => this.audio.towerAbility(tower.kind),
      playFailSound: () => this.audio.fail(),
      emitUi: () => this.emitUi(),
    });
  }

  toggleSelectedMechaControl(): boolean {
    const tower = this.selectedTower;
    if (!tower || tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId || this.gameOver || (this.paused && !tower.mechaControlled)) {
      this.audio.fail();
      return false;
    }
    const active = tower.mechaControlled !== true;
    this.releaseMechaInput();
    this.cancelPlacement();
    this.inputController?.resetCameraDrag();
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "mecha-control", towerId: tower.id, active });
      tower.mechaControlled = active;
      tower.mechaFiring = false;
      if (!active) {
        tower.mechaActiveAbility = null;
        tower.mechaAbilityTimer = 0;
        this.mechaInputs.delete(tower.id);
        this.mechaKeys.clear();
      }
      this.emitUi();
      return true;
    }
    return this.setMechaControl(tower, active);
  }

  setMechaMovementKey(key: string, pressed: boolean): boolean {
    const normalized = key.toLowerCase();
    if (normalized !== "w" && normalized !== "a" && normalized !== "s" && normalized !== "d") return false;
    const tower = this.selectedTower;
    if (!tower || tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId || tower.mechaControlled !== true) return false;
    if (pressed && (this.paused || this.gameOver)) return false;
    if (pressed) this.mechaKeys.add(normalized);
    else this.mechaKeys.delete(normalized);
    this.publishMechaInput(true, true);
    return true;
  }

  setMechaAim(point: Point): boolean {
    const tower = this.selectedTower;
    if (!tower || tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId || tower.mechaControlled !== true || this.gameOver) return false;
    const aimed = this.clampAdmiralAimPoint(tower, point);
    tower.aimPoint = aimed;
    this.publishMechaInput(false, false, aimed);
    return true;
  }

  setMechaFiring(firing: boolean): boolean {
    if (!firing) {
      this.mechaFireHeld = false;
      const input = this.selectedTowerId === null ? undefined : this.mechaInputs.get(this.selectedTowerId);
      if (input) input.firing = false;
    }
    const tower = this.selectedTower;
    if (!tower || tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId || tower.mechaControlled !== true) return false;
    if (firing && (this.paused || this.gameOver)) return false;
    this.mechaFireHeld = firing;
    tower.mechaFiring = firing;
    this.publishMechaInput(true, true);
    return true;
  }

  releaseMechaInput(notifyAuthority = true): void {
    this.mechaFireHeld = false;
    this.audio.tankFlameStream(false);
    this.mechaKeys.clear();
    this.mechaPointerClient = null;
    const pointerId = this.mechaPointerId;
    this.mechaPointerId = null;
    if (!this.headless && pointerId !== null && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    const tower = this.selectedTower;
    if (!tower || tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId) return;
    tower.mechaFiring = false;
    tower.mechaSpeed = 0;
    if (notifyAuthority) this.publishMechaInput(true, true, undefined, true);
    else this.mechaInputs.delete(tower.id);
  }

  private setMechaControl(tower: Tower, active: boolean): boolean {
    if (tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId) return false;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const control = definition.control;
    if (!control) return false;
    this.mechaKeys.clear();
    tower.mechaControlled = active;
    tower.mechaFiring = false;
    tower.mechaSpeed = 0;
    tower.mechaHullAngle ??= 0;
    tower.mechaTurretAngle ??= 0;
    tower.mechaActiveAbility = active ? (tower.mechaActiveAbility ?? null) : null;
    tower.mechaAbilityTimer = active ? (tower.mechaAbilityTimer ?? 0) : 0;
    tower.mechaHeat = clamp(tower.mechaHeat ?? 0, 0, getTankHeatCap(tower.level));
    tower.mechaOverheatTimer = Math.max(0, tower.mechaOverheatTimer ?? 0);
    const aim = tower.aimPoint ?? { x: tower.position.x + this.towerStats(tower).range * RANGE_SCALE, y: tower.position.y };
    tower.aimPoint = this.clampAdmiralAimPoint(tower, aim);
    if (active) {
      this.mechaInputs.set(tower.id, { moveX: 0, moveY: 0, aim: tower.aimPoint, firing: false, age: 0, remote: false });
      this.selectedTowerId = tower.id;
    } else {
      this.mechaInputs.delete(tower.id);
    }
    this.callbacks.onSimulationEvent?.({
      kind: "ability",
      entityId: tower.id,
      position: { ...tower.position },
      color: definition.accent,
      label: active ? "mecha-control-enter" : "mecha-control-exit",
    });
    this.callbacks.onLog(`Tank ${active ? "Pilot Mode engaged" : "Pilot Mode disengaged"}.`, active ? "good" : "neutral");
    this.emitUi();
    return true;
  }

  private applyMechaInput(tower: Tower, moveX: -1 | 0 | 1, moveY: -1 | 0 | 1, aim: Point, firing: boolean, brake = false): boolean {
    if (tower.kind !== "mecha" || tower.mechaControlled !== true) return false;
    if (this.paused && (moveX !== 0 || moveY !== 0 || firing)) return false;
    const aimed = this.clampAdmiralAimPoint(tower, aim);
    tower.aimPoint = aimed;
    tower.mechaFiring = firing;
    if (brake) tower.mechaSpeed = 0;
    this.mechaInputs.set(tower.id, { moveX, moveY, aim: aimed, firing, brake, age: 0, remote: true });
    return true;
  }

  private publishMechaInput(force: boolean, includeMovement: boolean, aimOverride?: Point, brake = false): void {
    const tower = this.selectedTower;
    if (!tower || tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId || tower.mechaControlled !== true) return;
    const moveX = this.mechaKeys.has("d") === this.mechaKeys.has("a") ? 0 : this.mechaKeys.has("d") ? 1 : -1;
    const moveY = this.mechaKeys.has("s") === this.mechaKeys.has("w") ? 0 : this.mechaKeys.has("s") ? 1 : -1;
    const aim = aimOverride ?? tower.aimPoint ?? tower.position;
    // Mouse intent must never be read back from a delayed server snapshot.
    const next: MechaInputState = { moveX, moveY, aim: { ...aim }, firing: this.mechaFireHeld, brake, age: 0, remote: false };
    this.mechaInputs.set(tower.id, next);
    if (!this.isMirror) return;
    const now = this.now();
    // Critical edges send now; held state is coalesced to 12 Hz. Local pose
    // prediction runs every render frame, so this cadence is not input feel.
    if (!force && now - this.mechaInputSentAt < 1_000 / 12) return;
    this.mechaInputSentAt = now;
    if (includeMovement || aimOverride || force) {
      const input: MultiplayerPilotInput = {
        type: "pilot-input",
        playerId: this.localPlayerId,
        towerId: tower.id,
        sequence: ++this.pilotInputSequence,
        moveX,
        moveY,
        aim: { ...next.aim },
        firing: next.firing,
        ...(brake ? { brake: true } : {}),
      };
      const pending = this.pendingPilotInputs.get(tower.id) ?? [];
      pending.push({ input, sentAt: now });
      while (pending.length > 64) pending.shift();
      this.pendingPilotInputs.set(tower.id, pending);
      this.pilotInputsSent += 1;
      this.callbacks.onPilotInput?.(input);
    }
  }

  private clampAdmiralAimPoint(tower: Tower, point: Point): Point {
    const maxRange = this.towerStats(tower).range * RANGE_SCALE;
    const from = tower.position;
    const gap = distance(from, point);
    const scale = gap > maxRange && gap > 0 ? maxRange / gap : 1;
    const bounds = mapWorldBounds(this.map.mapScale);
    return {
      x: clamp(from.x + (point.x - from.x) * scale, bounds.x, bounds.x + bounds.width),
      y: clamp(from.y + (point.y - from.y) * scale, bounds.y, bounds.y + bounds.height),
    };
  }

  private updateMechaPilotInput(): void {
    const tower = this.selectedTower;
    if (!tower || tower.kind !== "mecha" || tower.ownerId !== this.localPlayerId || !tower.mechaControlled || this.paused || this.gameOver) return;
    const input = this.mechaInputs.get(tower.id);
    if (this.isMirror && input) tower.mechaFiring = input.firing;
    if (this.mechaPointerClient) {
      this.pointer = this.eventToWorld(this.mechaPointerClient);
      tower.aimPoint = this.clampAdmiralAimPoint(tower, this.pointer);
    }
    // Heartbeat keeps held keys/fire alive even when the mouse does not move.
    this.publishMechaInput(false, true);
  }

  cancelAimSelected(): boolean {
    const tower = this.selectedTower;
    const behavior = tower ? getTowerBehavior(tower.kind) : undefined;
    if (!tower || !behavior?.cancelAim || tower.ownerId !== this.localPlayerId || !tower.aiming || this.gameOver || this.paused) return false;
    if (this.isMirror) {
      this.callbacks.onCommand?.({ type: "cancel-aim", towerId: tower.id });
      return true;
    }
    return behavior.cancelAim({
      tower,
      clampPoint: (candidate) => this.clampAdmiralAimPoint(tower, candidate),
      accent: TOWER_DEFINITIONS[tower.kind].accent,
      dimAccent: TOWER_DEFINITIONS[tower.kind].dimAccent,
      spawnText: (position, text, color) => this.spawnText(position, text, color ?? TOWER_DEFINITIONS[tower.kind].accent),
      log: (message, tone) => this.callbacks.onLog(message, tone),
      playAbilitySound: () => this.audio.towerAbility(tower.kind),
      playFailSound: () => this.audio.fail(),
      emitUi: () => this.emitUi(),
    });
  }

  private counterName(kind: TowerKind): string {
    return getTowerBehavior(kind)?.counterName ?? "COUNTER";
  }

  private damageEnemiesInRadius(tower: Tower, center: Point, radius: number, amount: number, damageType?: DamageType): void {
    const defaultDamageType = damageType ?? TOWER_DEFINITIONS[tower.kind].damageType ?? "bullet";
    this.enemies
      .filter(
        (enemy) =>
          enemy.hp > 0 &&
          this.canTowerTarget(tower, enemy) &&
          distance(center, this.enemyPosition(enemy)) <= radius,
      )
      .forEach((enemy) => this.damageEnemy(enemy, amount, TOWER_DEFINITIONS[tower.kind].accent, tower.ownerId, false, tower.id, defaultDamageType));
  }

  private emitVanguardSmashEffect(tower: Tower, target: Enemy, radius: number, multiplier: number): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const impact = this.enemyPosition(target);
    this.spawnVanguardSmash(impact, definition.accent, radius);
    this.callbacks.onSimulationEvent?.({
      kind: "smash",
      entityId: tower.id,
      targetId: target.id,
      position: { ...impact },
      color: definition.accent,
      value: radius,
      label: tower.kind,
    });
    this.spawnText(impact, `CHARGED SMASH x${multiplier}`, definition.accent);
  }

  private emitReconShotgunVisual(tower: Tower, target: Enemy, spreadStep: number, range: number): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const aim = this.enemyPosition(target);
    const aimAngle = Math.atan2(aim.y - tower.position.y, aim.x - tower.position.x);
    const pelletOffsets = [-2, -1, 0, 1, 2] as const;
    pelletOffsets.forEach((offset, pellet) => {
      const angle = aimAngle + offset * spreadStep;
      const end = {
        x: tower.position.x + Math.cos(angle) * range,
        y: tower.position.y + Math.sin(angle) * range,
      };
      this.spawnBeam(tower.position, end, pellet === 2 ? "#eafffb" : definition.accent, 2, pellet * 0.018);
    });
    this.spawnMuzzleFlash(tower.position, aim, definition.accent, 26);
    this.callbacks.onSimulationEvent?.({
      kind: "attack",
      targetId: target.id,
      position: { ...aim },
      from: { ...tower.position },
      color: definition.accent,
      label: tower.kind,
      visual: "hitscan",
      speed: spreadStep,
      value: range,
    });
  }

  private emitReconCounterVisual(tower: Tower, enemy: Enemy): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const impact = this.enemyPosition(enemy);
    for (let pellet = 0; pellet < 5; pellet += 1) {
      this.spawnBeam(tower.position, impact, pellet === 2 ? "#ffffff" : definition.accent, 2.4, pellet * 0.025);
    }
    this.spawnMuzzleFlash(tower.position, impact, definition.accent, 30);
    this.spawnImpactDust(impact, definition.accent);
    this.emitAttackVisual(tower, enemy, "hitscan", 0);
  }

  private emitMercenaryRallyFireVisual(tower: Tower, enemy: Enemy): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const impact = this.enemyPosition(enemy);
    this.spawnMuzzleFlash(tower.position, impact, "#fff1b5", 19);
    this.spawnBeam(tower.position, impact, definition.accent, 4);
    this.spawnRing(impact, definition.accent, 0.34, 3, 24);
    this.emitAttackVisual(tower, enemy, "hitscan");
  }

  private emitPrismChainVisual(tower: Tower, from: Point, enemy: Enemy, hitIndex: number, width: number): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const impact = this.enemyPosition(enemy);
    this.spawnBeam(from, impact, hitIndex === 0 ? "#f6eaff" : definition.accent, width);
    this.spawnFlash(impact, definition.accent, Math.max(12, 20 - hitIndex * 2));
    this.callbacks.onSimulationEvent?.({
      kind: "attack",
      targetId: enemy.id,
      position: { ...impact },
      from: { ...from },
      color: definition.accent,
      label: tower.kind,
      visual: "hitscan",
      value: width,
    });
  }

  private towerLifecycleBehaviorContext(tower: Tower, placement?: PlacementPreview): TowerLifecycleBehaviorContext {
    const definition = TOWER_DEFINITIONS[tower.kind];
    return {
      tower,
      stats: this.towerStats(tower),
      placement,
      accent: definition.accent,
      dimAccent: definition.dimAccent,
      startField: (duration, radius, eventLabel, text) => this.startField(tower, duration, radius, eventLabel, text),
      triggerFirstTempestPlacement: () => {
        if (this.tempestPlacementTriggered) return false;
        this.tempestPlacementTriggered = true;
        const nearby = this.enemies.filter(
          (enemy) => this.canTowerTarget(tower, enemy) && distance(this.enemyPosition(enemy), tower.position) <= 150,
        );
        nearby.forEach((enemy) => {
          this.damageEnemy(enemy, 200, definition.accent, tower.ownerId, false, tower.id, "energy");
          this.spawnArc(tower.position, this.enemyPosition(enemy), definition.accent);
          enemy.slowTimer = Math.max(enemy.slowTimer, 4);
          enemy.slowFactor = Math.min(enemy.slowFactor, 0.5);
        });
        if (nearby.length > 0) this.spawnText(tower.position, "100 + 100 THUNDER", definition.accent);
        return true;
      },
      fireRateCooldown: (baseCooldown) => this.fireRateCooldown(tower, baseCooldown),
      abilityCooldownFor: (slot) => getTowerAbilityWithPerks(definition, tower.perks, slot)?.cooldown ?? 0,
    };
  }

  private towerAttackBehaviorContext(
    tower: Tower,
    candidates: readonly Enemy[],
    damage: number,
    fireRate: number,
    delta: number,
  ): TowerAttackBehaviorContext {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const range = this.towerStats(tower).range * RANGE_SCALE;
    const chainCandidates = this.enemies.filter(
      (enemy) => enemy.hp > 0 && this.canTowerTarget(tower, enemy),
    );
    const coneCandidates = this.enemies.filter(
      (enemy) =>
        enemy.hp > 0 &&
        (!tower.onPath || this.resolvePathIndex(tower.pathIndex) === this.resolvePathIndex(enemy.pathIndex)) &&
        distance(tower.position, this.enemyPosition(enemy)) <= range,
    );
    return {
      tower,
      accent: definition.accent,
      candidates,
      chainCandidates,
      coneCandidates,
      baseDamage: this.towerStats(tower).damage,
      damage,
      fireRate,
      ammoCapacity: this.towerStats(tower).ammo,
      reloadDuration: this.towerStats(tower).reload,
      delta,
      range,
      selectTarget: (available) => this.selectTarget(tower, available),
      enemyPosition: (enemy) => this.enemyPosition(enemy),
      enemiesInCone: (aim, available, range, halfAngle) => this.enemiesInCone(tower.position, aim, available, range, halfAngle),
      enemiesInLine: (target, lineRange, width) => this.enemiesInLine(tower, target, lineRange, width),
      enemiesInLineFrom: (origin, aim, lineRange, width) => this.enemiesInLineFrom(tower, origin, aim, lineRange, width),
      damageEnemy: (enemy, amount, damageType) => this.damageEnemy(enemy, amount, definition.accent, tower.ownerId, false, tower.id, damageType ?? definition.damageType ?? "bullet"),
      damageEnemiesInRadius: (center, radius, amount, damageType) => this.damageEnemiesInRadius(tower, center, radius, amount, damageType ?? definition.damageType ?? "bullet"),
      damageEnemiesInRadiusExcluding: (center, radius, amount, excludedId, damageType) => {
        this.enemies
          .filter(
            (enemy) =>
              enemy.id !== excludedId &&
              enemy.hp > 0 &&
              this.canTowerTarget(tower, enemy) &&
              distance(center, this.enemyPosition(enemy)) <= radius,
          )
          .forEach((enemy) => this.damageEnemy(enemy, amount, definition.accent, tower.ownerId, false, tower.id, damageType ?? definition.damageType ?? "bullet"));
      },
      applyBurn: (enemy, duration, burnDamage, slowFactor, tickInterval, strength = 1, speedMultiplier = 1) => this.applyBurnStatus(
        enemy,
        duration,
        burnDamage,
        slowFactor,
        tickInterval,
        strength,
        tower.damageBuff,
        tower.ownerId,
        speedMultiplier,
      ),
      applyStun: (enemy, duration) => this.applyTowerStun(enemy, duration),
      emitHitscanVisual: (enemy, width) => this.emitHitscanVisual(tower, enemy, width),
      emitMaceVisual: (enemy) => this.emitVanguardMaceVisual(tower.position, this.enemyPosition(enemy), definition.accent),
      emitSmashVisual: (target, radius, multiplier) => this.emitVanguardSmashEffect(tower, target, radius, multiplier),
      emitPrismChainVisual: (from, enemy, hitIndex, width) => this.emitPrismChainVisual(tower, from, enemy, hitIndex, width),
      emitFlameVisual: (target, flameRange, value, duration) => {
        const impact = this.enemyPosition(target);
        this.startInfernusFlameStream(tower, impact);
        this.callbacks.onSimulationEvent?.({
          kind: "flame",
          entityId: tower.id,
          targetId: target.id,
          position: impact,
          from: { ...tower.position },
          color: tower.level >= 5 ? "#d71920" : "#f04a32",
          value,
          speed: flameRange,
          duration,
        });
      },
      emitShotgunVisual: (target, spreadStep, shotgunRange) => this.emitReconShotgunVisual(tower, target, spreadStep, shotgunRange),
      enemyRadius: (enemy) => getEnemyDefinition(enemy.kind).radius,
      triggerReload: () => {
        tower.ammo = 0;
        tower.fireTimer = this.towerStats(tower).reload ?? 4;
        this.spawnText(tower.position, "SHOTGUN RELOAD", definition.dimAccent);
        this.audio.towerReload(tower.kind);
      },
      spawnProjectile: (target, amount, speed, splash, damageType) => {
        this.projectiles.push({
          position: { ...tower.position },
          ownerId: tower.ownerId,
          delay: 0,
          targetId: target.id,
          damage: amount,
          kind: tower.kind,
          speed,
          splash,
          chain: 0,
          towerLevel: tower.level,
          damageType: damageType ?? definition.damageType ?? "bullet",
        });
      },
      emitProjectileVisual: (target, speed) => this.emitAttackVisual(tower, target, "projectile", speed),
      pathBombCount: () => this.timedBombs.filter((bomb) => bomb.proximity && bomb.sourceTowerId === tower.id).length,
      canPlacePathBomb: (position, minDistance) => this.timedBombs.every((bomb) => distance(bomb.position, position) >= minDistance),
      spawnPathBomb: (position, radius, damageType) => {
        this.timedBombs.push({
          position: { ...position },
          damage,
          radius,
          color: definition.accent,
          playerId: tower.ownerId,
          sourceTowerId: tower.id,
          sourceKind: tower.kind,
          proximity: true,
          towerLevel: tower.level,
          timer: Number.POSITIVE_INFINITY,
          damageType: damageType ?? "explosive",
        });
      },
      fireAdmiralShot: (shotDamage) => {
        const aim = tower.aimPoint ?? { x: tower.position.x, y: tower.position.y };
        const projectileSpeed = ADMIRAL_PROJECTILE_SPEED;
        this.admiralShots.push({
          towerId: tower.id,
          position: { ...aim },
          damage: shotDamage,
          radius: getEffectiveTowerSplash(tower, this.towerStats(tower).splash ?? 116),
          color: definition.accent,
          playerId: tower.ownerId,
          towerLevel: tower.level,
          timer: Math.max(0.05, distance(tower.position, aim) / projectileSpeed),
        });
        if (!this.headless) {
          this.visualProjectiles.push({
            position: { ...tower.position },
            targetId: null,
            start: { ...tower.position },
            endpoint: { ...aim },
            kind: tower.kind,
            speed: projectileSpeed,
            color: definition.accent,
            splash: true,
            style: "admiral",
            flightDuration: distance(tower.position, aim) / projectileSpeed,
            age: 0,
            hidden: false,
            scale: 0.7,
          });
        }
        this.callbacks.onSimulationEvent?.({
          kind: "attack",
          position: { ...aim },
          from: { ...tower.position },
          color: definition.accent,
          label: tower.kind,
          visual: "projectile",
          speed: projectileSpeed,
        });
        this.audio.admiralLaunch();
      },
      areaTargetsAround: (center, radius) => this.enemies.filter(
        (enemy) => enemy.hp > 0 && this.canTowerTarget(tower, enemy) && distance(center, this.enemyPosition(enemy)) <= radius,
      ),
      nearbyEnemies: (radius) => this.enemies
        .filter((enemy) => enemy.hp > 0 && this.canTowerTarget(tower, enemy) && distance(tower.position, this.enemyPosition(enemy)) <= radius)
        .map((enemy) => ({ enemy, position: this.enemyPosition(enemy), radius: getEnemyDefinition(enemy.kind).radius })),
      closestPathDistance: (pathIndex, point) => this.pathForIndex(pathIndex).closest(point).distance,
      pathProjection: (pathIndex, point) => {
        const path = this.pathForIndex(pathIndex);
        const projection = path.closest(point);
        return { distance: projection.distance, offset: projection.offset, totalLength: path.totalLength };
      },
      samplePath: (pathIndex, pathDistance) => {
        const path = this.pathForIndex(pathIndex);
        const sample = path.sample(pathDistance);
        return { point: sample.point, direction: sample.direction, totalLength: path.totalLength };
      },
      placementAt: (point, relocatingTowerId) => this.placementAt(point, relocatingTowerId),
      commitRelocation: (placement) => this.commitTowerRelocation(tower, placement),
      spawnDashTrail: (from, to, color, dashDistance) => this.spawnWraithDashTrail(from, to, color, dashDistance),
      emitSimulationEvent: (event) => this.emitTowerBehaviorEvent(tower, event),
      addShake: (amount) => { this.shake = Math.min(1, this.shake + amount); },
      spawnImpactDust: (position) => this.spawnImpactDust(position, definition.accent),
      applyShock: (enemy, duration, initialFactor, decay) => this.applyShock(enemy, duration, initialFactor, decay),
      emitTempestHit: (target) => this.emitTempestHit(tower, target),
      emitTempestFieldEnd: () => {
        this.callbacks.onSimulationEvent?.({ kind: "ability", entityId: tower.id, position: { ...tower.position }, label: "tempest-field-end" });
      },
      emitTempestFieldArc: () => this.spawnLightningAuraArc(tower.position, 150, definition.accent),
      startField: (duration, radius, eventLabel, text) => this.startField(tower, duration, radius, eventLabel, text),
      emitCyborgAttackVisual: (target, isHowitzer) => {
        const impact = this.enemyPosition(target);
        this.emitAttackVisual(tower, target, "hitscan", undefined, isHowitzer ? 46 : undefined);
        this.spawnCyborgBeam(tower.position, impact, definition.accent, isHowitzer ? 7 : 3.6);
        if (isHowitzer) {
          this.spawnExplosion(impact, definition.accent, 46);
          this.audio.breach("explosion", "cyborg");
        } else this.spawnSpark(impact, definition.accent, 20);
      },
      spawnCyborgRocketVolley: () => {
        const ordered = [...candidates].sort((a, b) => b.pathDistance - a.pathDistance);
        for (let index = 0; index < 3; index += 1) {
          const target = ordered[index % ordered.length];
          if (!target) continue;
          this.projectiles.push({
            position: { ...tower.position },
            ownerId: tower.ownerId,
            delay: index * 1,
            soundPlayed: false,
            targetId: target.id,
            damage: 140 * tower.damageBuff,
            kind: "cyborg",
            speed: 430,
            splash: 52,
            chain: 0,
            towerLevel: tower.level,
            damageType: "explosive",
          });
          this.emitAttackVisual(tower, target, "projectile", 430);
        }
        this.spawnText(tower.position, "JETSTREAM x3", definition.accent);
      },
      triggerCyborgReload: () => {
        tower.fireTimer = this.towerStats(tower).reload ?? 2;
        this.spawnText(tower.position, "RELOAD", definition.dimAccent);
        this.audio.towerReload(tower.kind);
      },
      reload: (label, resetAttackRamp, setFireTimer) => {
        tower.ammo = this.towerStats(tower).ammo ?? -1;
        if (setFireTimer) tower.fireTimer = Math.max(tower.fireTimer, this.towerStats(tower).reload ?? 2);
        if (resetAttackRamp) tower.attackRamp = 0;
        this.spawnText(tower.position, label, definition.dimAccent);
        this.audio.towerReload(tower.kind);
      },
      playCyborgShotSound: (isHowitzer) => this.audio.shoot(isHowitzer ? 190 : 520, tower.kind, isHowitzer ? "howitzer" : "machine"),
      areaTargets: (targetRadius) => this.enemies.filter(
        (enemy) => enemy.hp > 0 && this.canTowerTarget(tower, enemy) && distance(tower.position, this.enemyPosition(enemy)) <= targetRadius,
      ),
      emitWraithFlurryPulse: (radius) => {
        this.spawnWraithFlurrySlashes(tower.position, definition.accent, radius);
        this.callbacks.onSimulationEvent?.({
          kind: "flurry-pulse",
          entityId: tower.id,
          position: { ...tower.position },
          color: definition.accent,
          value: radius,
          label: tower.kind,
        });
      },
      findEnemy: (enemyId) => this.enemies.find((enemy) => enemy.id === enemyId && enemy.hp > 0),
      cancelZenithCharge: () => this.cancelZenithCharge(tower),
      updateZenithChargeProgress: (progress) => {
        if (!this.presentationSuspended) this.audio.zenithCharge(tower.id, true, progress, tower.level);
      },
      finishZenithCharge: () => {
        const chargeDuration = zenithChargeDuration(tower.level);
        tower.zenithChargeTargetId = null;
        tower.zenithChargeAngle = undefined;
        if (!this.presentationSuspended) this.audio.zenithCharge(tower.id, false, 1);
        tower.fireTimer = this.fireRateCooldown(tower, fireRate);
        if (!this.presentationSuspended) {
          this.audio.shoot(125, tower.kind, "rail", chargeDuration, tower.level);
        }
      },
      startZenithCharge: (target) => {
        const targetPosition = this.enemyPosition(target);
        const duration = zenithChargeDuration(tower.level);
        tower.zenithChargeTimer = duration;
        tower.zenithChargeTargetId = target.id;
        tower.zenithChargeAngle = Math.atan2(targetPosition.y - tower.position.y, targetPosition.x - tower.position.x);
        tower.idleTimer = 0;
        this.callbacks.onSimulationEvent?.({
          kind: "charge",
          entityId: tower.id,
          targetId: target.id,
          position: { ...targetPosition },
          from: { ...tower.position },
          color: definition.accent,
          duration,
          label: "start",
        });
        if (!this.presentationSuspended) this.audio.zenithCharge(tower.id, true, 0, tower.level);
      },
      emitZenithLance: (target, lineRange, visualWidth, beamLife) => this.emitZenithLanceVisual(tower, target, lineRange, visualWidth, beamLife),
      emitZenithLanceHit: (enemy) => this.spawnFlash(this.enemyPosition(enemy), definition.accent, 26),
      emitStrikeVisual: (enemy) => this.emitStrikeVisual(this.enemyPosition(enemy), definition.accent, tower.kind),
      scheduleDelayedStrike: (enemy, amount, delay) => {
        this.delayedSlashes.push({
          towerId: tower.id,
          targetId: enemy.id,
          damage: amount,
          color: "#ffffff",
          timer: delay,
        });
      },
      emitSlashVisual: (enemy, reach, halfAngle, direction, duration, sound) => this.emitSlashVisual(
        tower.position,
        this.enemyPosition(enemy),
        definition.accent,
        reach,
        halfAngle,
        tower.kind,
        direction,
        duration,
        sound,
      ),
      nextSlashDirection: () => this.nextSlashDirection(tower.kind),
      fireRateCooldown: (baseCooldown) => this.fireRateCooldown(tower, baseCooldown),
      burstSpacingCooldown: (baseSpacing) => this.burstSpacingCooldown(tower, baseSpacing),
      spawnRing: (position, life, size, radius) => this.spawnRing(position, definition.accent, life, size, radius),
      spawnText: (position, text) => this.spawnText(position, text, definition.accent),
      spawnMuzzleFlash: (enemy, size) => this.spawnMuzzleFlash(tower.position, this.enemyPosition(enemy), definition.accent, size),
      playAttackSound: () => {
        const sound = getTowerBehavior(tower.kind)?.attackSound;
        if (sound) this.audio.shoot(sound.pitch, tower.kind, sound.sound);
      },
    };
  }

  private towerAbilityBehaviorContext(tower: Tower, slot: TowerAbilitySlot): TowerAbilityBehaviorContext {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const radius = this.towerStats(tower).range * RANGE_SCALE;
    const abilityCandidates = this.enemies.filter(
      (enemy) =>
        enemy.hp > 0 &&
        this.canTowerTarget(tower, enemy) &&
        distance(tower.position, this.enemyPosition(enemy)) <= radius,
    );
    return {
      tower,
      slot,
      abilityCooldown: getTowerAbilityWithPerks(definition, tower.perks, slot)?.cooldown ?? 0,
      nearbyTowers: this.towers.filter((candidate) => distance(candidate.position, tower.position) <= radius),
      radius,
      baseDamage: this.towerStats(tower).damage,
      abilityCandidates,
      abilityTargets: (targetRadius) => this.enemies.filter(
        (enemy) => enemy.hp > 0 && this.canTowerTarget(tower, enemy) && distance(tower.position, this.enemyPosition(enemy)) <= targetRadius,
      ),
      startAimMode: () => {
        tower.aiming = true;
        this.spawnText(tower.position, "AIMING", definition.accent);
        this.callbacks.onLog("Admiral aim mode engaged // click an impact point within range.", "good");
        this.audio.towerAbility(tower.kind);
      },
      selectTarget: (available) => this.selectTarget(tower, available),
      enemyPosition: (enemy) => this.enemyPosition(enemy),
      applyDamageBuff: (candidate, multiplier, duration) => this.applyDamageBuff(candidate, multiplier, duration),
      spawnBuffRing: (candidate) => this.spawnRing(candidate.position, DAMAGE_BUFF_COLOR, 0.4, 3, 34),
      spawnAbilityRing: (abilityRadius) => this.spawnRing(tower.position, definition.accent, 0.8, 8, abilityRadius),
      spawnText: (text) => this.spawnText(tower.position, text, definition.accent),
      spawnAbilityText: (position, text, color = definition.accent) => this.spawnText(position, text, color),
      damageEnemy: (enemy, amount, damageType) => this.damageEnemy(enemy, amount, definition.accent, tower.ownerId, false, tower.id, damageType ?? definition.damageType ?? "bullet"),
      emitSlashVisual: (enemy, reach, halfAngle, direction, duration, sound) => this.emitSlashVisual(
        tower.position,
        this.enemyPosition(enemy),
        definition.accent,
        reach,
        halfAngle,
        tower.kind,
        direction,
        duration,
        sound,
      ),
      nextSlashDirection: () => this.nextSlashDirection(tower.kind),
      refreshDamageBuff: () => this.refreshDamageBuff(tower),
      emitWraithFlurryStart: (radius) => this.emitWraithFlurryStart(tower, radius),
      log: (message) => this.callbacks.onLog(message, "good"),
      playAbilitySound: () => this.audio.towerAbility(tower.kind),
      spawnTimedBomb: (target, amount, bombRadius, timer, damageType) => {
        this.timedBombs.push({
          position: { ...this.enemyPosition(target) },
          damage: amount,
          radius: bombRadius,
          color: definition.accent,
          playerId: tower.ownerId,
          sourceKind: tower.kind,
          towerLevel: tower.level,
          timer,
          damageType: damageType ?? "explosive",
        });
      },
      spawnTimedBombAt: (position, amount, bombRadius, timer, label, damageType) => {
        this.timedBombs.push({
          position: { ...position },
          damage: amount,
          radius: bombRadius,
          color: definition.accent,
          playerId: tower.ownerId,
          sourceTowerId: tower.id,
          sourceKind: tower.kind,
          towerLevel: tower.level,
          timer,
          label,
          damageType: damageType ?? "explosive",
        });
      },
      spawnAbilityTracer: (target) => this.spawnTracer(tower.position, this.enemyPosition(target), definition.accent),
      emitSimulationEvent: (event) => this.emitTowerBehaviorEvent(tower, event),
      logDanger: (message) => this.callbacks.onLog(message, "danger"),
      playAbilityTone: () => this.audio.tone(180, 0.16, 0.025, -40, "towers"),
      failAbility: () => this.audio.fail(),
    };
  }

  private towerCounterBehaviorContext(
    tower: Tower,
    damage: number,
    victims: readonly Enemy[],
  ): TowerCounterBehaviorContext {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const range = this.towerStats(tower).range * RANGE_SCALE;
    const chainCandidates = this.enemies.filter(
      (enemy) => enemy.hp > 0 && this.canTowerTarget(tower, enemy),
    );
    return {
      tower,
      victims,
      chainCandidates,
      damage,
      baseDamage: this.towerStats(tower).damage,
      fireRate: this.towerStats(tower).fireRate,
      range,
      selectTarget: (available) => this.selectTarget(tower, available),
      enemyPosition: (enemy) => this.enemyPosition(enemy),
      damageEnemy: (enemy, amount, damageType) => this.damageEnemy(enemy, amount, definition.accent, tower.ownerId, false, tower.id, damageType ?? definition.damageType ?? "bullet"),
      damageEnemiesInRadius: (center, radius, amount, damageType) => this.damageEnemiesInRadius(tower, center, radius, amount, damageType ?? definition.damageType ?? "bullet"),
      applyBurn: (enemy, duration, burnDamage, slowFactor, tickInterval, strength = 1, speedMultiplier = 1) => this.applyBurnStatus(
        enemy,
        duration,
        burnDamage,
        slowFactor,
        tickInterval,
        strength,
        tower.damageBuff,
        tower.ownerId,
        speedMultiplier,
      ),
      fireAdmiralSupport: (supportDamage) => {
        const impact = tower.aimPoint ?? tower.position;
        const stats = this.towerStats(tower);
        this.admiralShots.push({
          towerId: tower.id,
          position: { ...impact },
          damage: supportDamage,
          radius: getEffectiveTowerSplash(tower, stats.splash ?? 116) + 16,
          color: definition.accent,
          playerId: tower.ownerId,
          towerLevel: tower.level,
          timer: 0.05,
        });
        this.spawnText(impact, "FIRE SUPPORT", definition.accent);
        tower.fireTimer = 0;
      },
      startField: (duration, radius, eventLabel, text) => this.startField(tower, duration, radius, eventLabel, text),
      areaTargetsAround: (center, radius) => this.enemies.filter(
        (enemy) => enemy.hp > 0 && this.canTowerTarget(tower, enemy) && distance(center, this.enemyPosition(enemy)) <= radius,
      ),
      applyShock: (enemy, duration, initialFactor, decay) => this.applyShock(enemy, duration, initialFactor, decay),
      emitTempestCounterVisual: () => {
        this.enemies
          .filter((enemy) => distance(tower.position, this.enemyPosition(enemy)) <= this.towerStats(tower).range * RANGE_SCALE + 45)
          .forEach((enemy) => {
            this.spawnArc(tower.position, this.enemyPosition(enemy), "#e8fcff");
            this.spawnFlash(this.enemyPosition(enemy), definition.accent, 24);
          });
      },
      counterRounds: this.towerStats(tower).ammo ? Math.min(this.towerStats(tower).ammo!, 8) : 8,
      emitCyborgCounterVisual: (victims, rounds) => {
        victims.forEach((enemy) => {
          const impact = this.enemyPosition(enemy);
          for (let round = 0; round < Math.min(rounds, 6); round += 1) {
            this.spawnBeam(tower.position, impact, round % 2 === 0 ? definition.accent : "#ffffff", 2.5, round * 0.025);
          }
          this.spawnMuzzleFlash(tower.position, impact, definition.accent, 26);
          this.spawnImpactDust(impact, definition.accent);
          this.emitAttackVisual(tower, enemy, "hitscan", rounds);
        });
        this.spawnRadialSpray(tower.position, "#f3f5f2", "#777f7b", 12, 75);
      },
      fireRateCooldown: (baseCooldown) => this.fireRateCooldown(tower, baseCooldown),
      applyStun: (enemy, duration) => this.applyTowerStun(enemy, duration),
      emitHitscanVisual: (enemy, width) => this.emitHitscanVisual(tower, enemy, width),
      emitSlashVisual: (enemy, reach, halfAngle, direction, duration, sound) => this.emitSlashVisual(
        tower.position,
        this.enemyPosition(enemy),
        definition.accent,
        reach,
        halfAngle,
        tower.kind,
        direction,
        duration,
        sound,
      ),
      emitCrossSlashVisual: (aim, reach) => this.emitCrossSlashVisual(tower.position, aim, definition.accent, reach, tower.kind),
      spawnShieldFlash: (reach) => this.spawnShieldFlash(tower.position, definition.accent, reach),
      emitSmashVisual: (target, radius, multiplier) => this.emitVanguardSmashEffect(tower, target, radius, multiplier),
      emitPrismChainVisual: (from, enemy, hitIndex, width) => this.emitPrismChainVisual(tower, from, enemy, hitIndex, width),
      emitFlameCounterVisual: (flameRange) => {
        this.spawnRadialSpray(tower.position, "#ffe66d", "#ed352f", 46, flameRange);
        this.spawnRing(tower.position, "#ff4a32", 0.6, 8, flameRange);
      },
      emitExplosionCounterVisual: (enemy, radius) => {
        const impact = this.enemyPosition(enemy);
        this.spawnExplosion(impact, definition.accent, radius);
        this.callbacks.onSimulationEvent?.({
          kind: "explosion",
          position: { ...impact },
          color: definition.accent,
          value: radius,
          label: tower.kind,
        });
      },
      emitSamuraiCounterVisual: (aim, reach) => {
        this.emitCrossSlashVisual(tower.position, aim, definition.accent, reach, tower.kind);
        this.spawnBeam(
          { x: tower.position.x - 55, y: tower.position.y },
          { x: tower.position.x + 55, y: tower.position.y },
          "#ffffff",
          6,
        );
      },
      emitWraithCounterVisual: () => {
        this.spawnWraithFlurry(tower.position, definition.accent, 120);
        this.callbacks.onSimulationEvent?.({
          kind: "flurry",
          entityId: tower.id,
          position: { ...tower.position },
          color: definition.accent,
          value: 120,
          label: tower.kind,
        });
        this.spawnText(tower.position, "PHASE CUT", definition.accent);
      },
      enemiesInLine: (target, lineRange, width) => this.enemiesInLine(tower, target, lineRange, width),
      emitZenithLance: (target, lineRange, visualWidth, beamLife) => this.emitZenithLanceVisual(tower, target, lineRange, visualWidth, beamLife),
      emitZenithLanceHit: (enemy) => this.spawnFlash(this.enemyPosition(enemy), definition.accent, 26),
      emitRallyFireVisual: (enemy) => this.emitMercenaryRallyFireVisual(tower, enemy),
      emitShotgunCounterVisual: (enemy) => this.emitReconCounterVisual(tower, enemy),
      resetMagazine: () => {
        tower.ammo = this.towerStats(tower).ammo ?? 5;
        tower.attackRamp = 0;
        tower.idleTimer = 0;
        tower.fireTimer = 0;
      },
      emitBurstCounterVisual: (enemy, burst) => {
        const impact = this.enemyPosition(enemy);
        const spacing = tower.level >= 5 ? 0.1 : 0.2;
        for (let shot = 0; shot < burst; shot += 1) {
          this.spawnBeam(tower.position, impact, shot % 2 === 0 ? definition.accent : "#ffffff", 2.2, shot * spacing);
        }
        this.spawnMuzzleFlash(tower.position, impact, definition.accent, 24);
        this.spawnImpactDust(impact, definition.accent);
        this.emitAttackVisual(tower, enemy, "hitscan", burst);
      },
      spawnImpactDust: (position) => this.spawnImpactDust(position, definition.accent),
      spawnText: (text) => this.spawnText(tower.position, text, definition.accent),
    };
  }

  private applyTowerStun(enemy: Enemy, duration: number): void {
    const effectiveDuration = getEnemyDefinition(enemy.kind).boss ? duration * 0.35 : duration;
    const wasStunned = enemy.stunTimer > 0;
    enemy.stunTimer = Math.max(enemy.stunTimer, effectiveDuration);
    if (!wasStunned && enemy.stunTimer > 0) signalEnemyAbility(enemy.abilityRuntime, "stunned");
  }

  private executeCounter(tower: Tower, additionalVictims: readonly Enemy[] = []): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const accent = definition.accent;
    const stats = this.towerStats(tower);
    const damage = stats.damage * tower.damageBuff;
    this.spawnCounterBurst(tower.position, accent);
    const behavior = getTowerBehavior(tower.kind);
    if (behavior?.counter) {
      const additionalIds = new Set(additionalVictims.map((enemy) => enemy.id));
      const victims = this.enemies.filter(
        (enemy) =>
          this.canTowerTarget(tower, enemy) &&
          (behavior.counterScope === "range"
            ? distance(tower.position, this.enemyPosition(enemy)) <= stats.range * RANGE_SCALE
            : enemy.targetTowerId === tower.id || additionalIds.has(enemy.id)),
      );
      behavior.counter(this.towerCounterBehaviorContext(tower, damage, victims));
      return;
    }
  }

  private emitWraithFlurryStart(tower: Tower, radius: number): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    this.spawnWraithFlurry(tower.position, definition.accent, radius);
    this.spawnText(tower.position, "CRIMSON FLURRY // 10 PULSES", definition.accent);
    this.callbacks.onSimulationEvent?.({
      kind: "flurry",
      entityId: tower.id,
      position: { ...tower.position },
      color: definition.accent,
      value: radius,
      label: tower.kind,
    });
  }

  private bindInput(): void {
    this.inputController = new GameInputController(this.createInputHost());
    this.inputController.bind();
  }

  private handlePrimaryClick(point: Point): void {
    const selectedTower = this.selectedTower;
    if (selectedTower?.kind === "mecha" && selectedTower.mechaControlled === true && selectedTower.ownerId === this.localPlayerId) return;
    if (selectedTower?.aiming && getTowerBehavior(selectedTower.kind)?.aim) {
      this.aimSelected(point);
      return;
    }
    if (this.relocatingTowerId !== null && this.placement) {
      if (this.isMirror) {
        this.callbacks.onCommand?.({ type: "relocate", towerId: this.relocatingTowerId, position: this.placement.position });
        this.relocatingTowerId = null;
        this.placement = null;
        this.emitUi();
        return;
      }
      this.relocateTower(this.placement);
      return;
    }
    const hitTower = [...this.towers]
      .reverse()
      .find((tower) => distance(tower.position, point) <= 31);
    if (hitTower) {
      this.selectedTowerId = hitTower.id;
      this.selectedKind = null;
      this.relocatingTowerId = null;
      hitTower.selectedPulse = 1;
      this.placement = null;
      this.audio.tone(420, 0.05, 0.012, 40, "ui");
      this.emitUi();
      return;
    }
    if (this.selectedKind && this.placement) {
      if (this.isMirror) {
        this.callbacks.onCommand?.({ type: "deploy", kind: this.selectedKind, position: this.placement.position });
        this.selectedKind = null;
        this.placement = null;
        this.emitUi();
      } else this.deploy(this.selectedKind, this.placement);
    }
    else {
      this.selectedTowerId = null;
      this.emitUi();
    }
  }

  private eventToCanvasPixel(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (this.canvas.width / Math.max(1, bounds.width)),
      y: (event.clientY - bounds.top) * (this.canvas.height / Math.max(1, bounds.height)),
    };
  }

  private eventToWorld(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
    const viewport = this.viewport;
    const canvasPoint = this.eventToCanvasPixel(event);
    return {
      x: (canvasPoint.x - viewport.x) / viewport.scale,
      y: (canvasPoint.y - viewport.y) / viewport.scale,
    };
  }

  private get baseViewportScale(): number {
    const mapScale = normalizedMapScale(this.map.mapScale);
    return Math.min(this.canvas.width / WORLD_WIDTH, this.canvas.height / WORLD_HEIGHT) / mapScale;
  }

  private get viewport(): { readonly x: number; readonly y: number; readonly scale: number } {
    const scale = this.baseViewportScale * this.cameraZoom;
    return {
      x: (this.canvas.width - WORLD_WIDTH * scale) / 2 + this.cameraPan.x,
      y: (this.canvas.height - WORLD_HEIGHT * scale) / 2 + this.cameraPan.y,
      scale,
    };
  }

  private panCameraBy(deltaX: number, deltaY: number): void {
    this.cameraPan.x += deltaX;
    this.cameraPan.y += deltaY;
    this.clampCameraPan();
  }

  private clampCameraPan(): void {
    const pan = clampCameraPan(
      this.cameraPan,
      this.canvas.width,
      this.canvas.height,
      mapWorldBounds(this.map.mapScale),
      this.baseViewportScale * this.cameraZoom,
    );
    this.cameraPan.x = pan.x;
    this.cameraPan.y = pan.y;
  }

  private resetCamera(): void {
    this.cameraZoom = 1;
    this.cameraPan = { x: 0, y: 0 };
    this.inputController?.resetCameraDrag();
  }

  private updateMechaCameraFollow(delta: number): void {
    if (this.headless) return;
    const tower = this.towers.find((candidate) => candidate.ownerId === this.localPlayerId && candidate.kind === "mecha" && candidate.mechaControlled === true);
    if (!tower) return;
    const scale = this.baseViewportScale * this.cameraZoom;
    const baseX = (this.canvas.width - WORLD_WIDTH * scale) / 2;
    const baseY = (this.canvas.height - WORLD_HEIGHT * scale) / 2;
    const targetX = this.canvas.width / 2 - baseX - tower.position.x * scale;
    const targetY = this.canvas.height / 2 - baseY - tower.position.y * scale;
    const blend = this.reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 10);
    this.cameraPan.x += (targetX - this.cameraPan.x) * blend;
    this.cameraPan.y += (targetY - this.cameraPan.y) * blend;
    this.clampCameraPan();
  }

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, this.canvasResolution);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.clampCameraPan();
    this.rebuildVignetteLayer();
  }

  private rebuildStaticMapLayer(): void {
    if (this.headless) return;
    const bounds = mapWorldBounds(this.map.mapScale);
    this.staticMapCanvas.width = Math.max(1, Math.ceil(bounds.width));
    this.staticMapCanvas.height = Math.max(1, Math.ceil(bounds.height));
    const context = this.staticMapCanvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.translate(-bounds.x, -bounds.y);
    this.mapPathShapes = createMapPathShapes(this.map);
    this.renderer.drawField(context);
    this.renderer.drawStaticPath(context);
  }

  private rebuildVignetteLayer(): void {
    if (this.headless) return;
    const baseScale = Math.min(this.canvas.width / WORLD_WIDTH, this.canvas.height / WORLD_HEIGHT);
    this.vignetteCanvas.width = Math.max(1, Math.ceil(this.canvas.width / baseScale));
    this.vignetteCanvas.height = Math.max(1, Math.ceil(this.canvas.height / baseScale));
    const context = this.vignetteCanvas.getContext("2d");
    if (!context) return;
    const centerX = this.vignetteCanvas.width / 2;
    const centerY = this.vignetteCanvas.height / 2;
    const gradient = context.createRadialGradient(
      centerX,
      centerY,
      Math.min(this.vignetteCanvas.width, this.vignetteCanvas.height) * 0.2,
      centerX,
      centerY,
      Math.hypot(this.vignetteCanvas.width, this.vignetteCanvas.height) * 0.62,
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,.56)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.vignetteCanvas.width, this.vignetteCanvas.height);
  }

  private updatePlacement(): void {
    const relocatingTower = this.towers.find((tower) => tower.id === this.relocatingTowerId) ?? null;
    if (!this.pointer || (!this.selectedKind && !relocatingTower)) {
      this.placement = null;
      return;
    }
    this.placement = this.placementAt(this.pointer, relocatingTower?.id);
  }

  private placementAt(point: Point, relocatingTowerId?: number): PlacementPreview {
    const projectedCandidates = this.paths.map((path, pathIndex) => ({ path, pathIndex, projected: path.closest(point) }));
    const closest = projectedCandidates.sort((a, b) => a.projected.offset - b.projected.offset)[0] ?? { path: this.path, pathIndex: 0, projected: this.path.closest(point) };
    const projected = closest.projected;
    const routeWidth = this.map.paths[closest.pathIndex]?.width ?? PATH_HALF_WIDTH * 2;
    const onPath = projected.offset <= routeWidth / 2;
    const position = onPath ? projected.point : point;
    const towerClear = this.towers.every(
      (tower) => tower.id === relocatingTowerId || distance(tower.position, position) >= TOWER_PLACEMENT_CLEARANCE,
    );
    const bounds = mapWorldBounds(this.map.mapScale);
    // Placement is center-based. The sprite may approach or slightly cross a
    // boundary; only the tower's actual center must remain inside the map.
    const boundsClear = position.x > bounds.x
      && position.x < bounds.x + bounds.width
      && position.y > bounds.y
      && position.y < bounds.y + bounds.height;
    const pathClear = !onPath || (projected.distance > 135 && projected.distance < closest.path.totalLength - 135);
    // A blocked zone rejects a placement only when the center is inside it;
    // its edges do not create an invisible no-build halo around the zone.
    const blockedClear = this.map.blockedZones.every((zone) =>
      position.x < zone.x || position.x > zone.x + zone.width || position.y < zone.y || position.y > zone.y + zone.height,
    );
    const pathBlockersClear = !onPath || this.map.pathBlockers.every((blocker) =>
      blocker.pathIndex !== closest.pathIndex
      || projected.distance < blocker.startDistance
      || projected.distance > blocker.startDistance + blocker.length,
    );
    return {
      position,
      onPath,
      valid: towerClear && boundsClear && pathClear && blockedClear && pathBlockersClear,
      pathIndex: closest.pathIndex,
      pathDistance: projected.distance,
    };
  }

  private relocateTower(placement: PlacementPreview): boolean {
    const tower = this.towers.find((candidate) => candidate.id === this.relocatingTowerId);
    if (!tower) {
      this.cancelPlacement();
      return false;
    }
    if (!placement.valid) {
      this.callbacks.onLog("Relocation rejected // construct collision or restricted zone.", "danger");
      this.audio.fail();
      return false;
    }
    if (!this.infiniteCash && this.shards < ECONOMY_RULES.relocationCost) {
      this.callbacks.onLog(`Insufficient cash // $${ECONOMY_RULES.relocationCost} required to relocate.`, "danger");
      this.audio.fail();
      return false;
    }

    const definition = TOWER_DEFINITIONS[tower.kind];
    const oldPosition = { ...tower.position };
    const durability = tower.maxHp > 1 ? clamp(tower.hp / tower.maxHp, 0, 1) : 1;
    tower.maxHp = Math.round(definition.onPath.hp * this.towerStats(tower).hpMultiplier);
    tower.hp = Math.max(1, tower.maxHp * durability);
    this.releaseTowerEnemies(tower);
    if (!this.infiniteCash) this.shards -= ECONOMY_RULES.relocationCost;
    tower.position = { ...placement.position };
    tower.onPath = placement.onPath;
    if (!placement.onPath) tower.autoCounter = false;
    tower.pathIndex = placement.pathIndex;
    tower.pathDistance = placement.pathDistance;
    tower.maxAggro = this.towerAggroLimit(tower, placement.onPath);
    tower.selectedPulse = 1;
    this.relocatingTowerId = null;
    this.placement = null;
    this.spawnRing(oldPosition, definition.dimAccent, 0.35, 4, 45);
    this.spawnRing(tower.position, definition.accent, 0.5, 6, 62);
    this.invokeTowerArrivalBehavior(tower);
    const form = placement.onPath ? definition.onPath.title : definition.offPath.title;
    this.callbacks.onLog(
      `${definition.name} relocated as ${form} // ${this.infiniteCash ? "debug override" : `-$${ECONOMY_RULES.relocationCost}`}.`,
      "good",
    );
    this.audio.deploy(tower.kind);
    this.emitUi();
    return true;
  }

  private commitTowerRelocation(tower: Tower, placement: PlacementPreview): void {
    if (tower.onPath) this.releaseTowerEnemies(tower);
    tower.position = { ...placement.position };
    tower.onPath = placement.onPath;
    if (!placement.onPath) tower.autoCounter = false;
    tower.pathIndex = placement.pathIndex;
    tower.pathDistance = placement.pathDistance;
    tower.maxAggro = this.towerAggroLimit(tower, placement.onPath);
  }

  private deploy(kind: TowerKind, placement: PlacementPreview): boolean {
    const definition = TOWER_DEFINITIONS[kind];
    if (!placement.valid) {
      this.callbacks.onLog("Deployment rejected // construct collision or restricted zone.", "danger");
      this.audio.fail();
      return false;
    }
    if (this.copiesRemaining[kind] <= 0) {
      this.callbacks.onLog(`${definition.name} stock exhausted // destroyed or sold copies cannot be replaced.`, "danger");
      this.audio.fail();
      return false;
    }
    if (!this.infiniteCash && this.shards < definition.cost) {
      this.callbacks.onLog(`Insufficient cash // $${definition.cost} required.`, "danger");
      this.audio.fail();
      return false;
    }
    const pathStats = definition.onPath;
    const levelStats = definition.levels[0];
    if (!levelStats) return false;
    const profilePerks = this.multiplayerActive
      ? [...(this.playerProfiles.get(this.localPlayerId)?.perkLoadout ?? [])]
      : [...this.availablePerkKinds];
    const capturedPerks = profilePerks.filter((perk) => TOWER_PERK_DEFINITIONS[perk]?.target === kind);
    const tower: Tower = {
      id: this.nextId++,
      ownerId: this.localPlayerId,
      kind,
      perks: capturedPerks,
      position: placement.position,
      onPath: placement.onPath,
      pathIndex: placement.pathIndex,
      pathDistance: placement.pathDistance,
      level: 0,
      totalInvested: definition.cost,
      targeting: "first",
      hp: pathStats.hp,
      maxHp: pathStats.hp,
      maxAggro: placement.onPath ? pathStats.maxAggro + (kind === "mecha" ? levelStats.aggroBonus : 0) : 0,
      engaged: new Set<number>(),
      fireTimer: 0.25,
      counterCooldown: 0,
      autoCounter: false,
      counterFlash: 0,
      hurtFlash: 0,
      selectedPulse: 1,
      fortifyCharges: 0,
      overdriveTimer: 0,
      overdriveMultiplier: 1,
      damageBuff: 1,
      abilityTimer: 0,
      senselessStance: false,
      abilityCooldown: 0,
      abilityCooldowns: { f: 0 },
      perkPrepTimer: 0,
      aimPoint: null,
      aiming: false,
      focus: 0,
      samuraiFocusDecayTimer: 0,
      meleeTimer: 0,
      ammo: levelStats.ammo ?? -1,
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
      regenTimer: 7,
      burstTimer: 0,
      burstTargetId: null,
      burstShotsRemaining: 0,
      burstSpacing: 0,
      stunTimer: 0,
      zenithChargeTimer: 0,
      zenithChargeTargetId: null,
      mutinyKillProgress: 0,
      mutinyDamageProgress: 0,
      mutinyStackTimers: [],
      ...(kind === "mecha" ? {
        mechaControlled: false,
        mechaFiring: false,
        mechaActiveAbility: null,
        mechaAbilityTimer: 0,
        mechaHeat: 0,
        mechaOverheatTimer: 0,
      } : {}),
    };
    getTowerBehavior(kind)?.onCreate?.(this.towerLifecycleBehaviorContext(tower, placement));
    this.towers.push(tower);
    this.refreshDamageBuff(tower);
    if (!this.infiniteCash) this.shards -= definition.cost;
    this.copiesRemaining[kind] -= 1;
    this.selectedTowerId = tower.id;
    this.selectedKind = null;
    this.placement = null;
    const form = placement.onPath ? definition.onPath.title : definition.offPath.title;
    this.callbacks.onLog(`${definition.name} deployed as ${form} // ${this.copiesRemaining[kind]} copies remain.`, "good");
    this.audio.deploy(kind);
    this.spawnRing(tower.position, definition.accent, 0.45, 5);
    getTowerBehavior(kind)?.onDeploy?.(this.towerLifecycleBehaviorContext(tower, placement));
    this.emitUi();
    return true;
  }

  applyMultiplayerCommand(playerId: PlayerId, command: MultiplayerCommand): boolean {
    if (this.multiplayerRole !== "host" || !this.playerProfiles.has(playerId) || this.gameOver || this.modeComplete) return false;
    if (!command || typeof command !== "object" || typeof command.type !== "string") return false;
    if (command.type === "pause") {
      const now = this.now();
      const times = this.multiplayerRequestTimes.get(playerId) ?? { pause: -Infinity, speed: -Infinity };
      if (now - times.pause < 400) return false;
      times.pause = now;
      this.multiplayerRequestTimes.set(playerId, times);
      this.togglePause();
      return true;
    }
    if (command.type === "speed") {
      const now = this.now();
      const times = this.multiplayerRequestTimes.get(playerId) ?? { pause: -Infinity, speed: -Infinity };
      if (now - times.speed < 400) return false;
      times.speed = now;
      this.multiplayerRequestTimes.set(playerId, times);
      this.cycleSpeed();
      return true;
    }
    if (command.type === "skip-wave") {
      return this.withPlayer(playerId, null, () => {
        if (!this.canSkipWave() || this.skipWaveVotes.has(playerId)) return false;
        this.skipWaveVotes.add(playerId);
        if (this.skipWaveVotes.size >= this.playerProfiles.size) return this.skipToNextWave();
        this.emitUi();
        return true;
      });
    }
    const profile = this.playerProfiles.get(playerId);
    if (!profile) return false;
    if (command.type === "deploy") {
      if (!Object.hasOwn(TOWER_DEFINITIONS, command.kind) || !profile.loadout.includes(command.kind)) return false;
      if (!Number.isFinite(command.position?.x) || !Number.isFinite(command.position?.y)) return false;
      const placement = this.placementAt(command.position);
      return this.withPlayer(playerId, null, () => this.deploy(command.kind, placement));
    }
    const tower = this.towers.find((candidate) => candidate.id === command.towerId && candidate.ownerId === playerId);
    if (!tower) return false;
    return this.withPlayer(playerId, tower.id, () => {
      if (command.type === "relocate") {
        if (tower.kind === "mecha") return false;
        if (!Number.isFinite(command.position?.x) || !Number.isFinite(command.position?.y)) return false;
        this.relocatingTowerId = tower.id;
        return this.relocateTower(this.placementAt(command.position, tower.id));
      } else if (command.type === "sell") return this.sellSelected();
      else if (command.type === "upgrade") return this.upgradeSelected();
      else if (command.type === "target" && ["first", "last", "strongest", "weakest", "closest"].includes(command.targeting)) return this.setSelectedTargeting(command.targeting);
      else if (command.type === "counter") return this.counterSelected();
      else if (command.type === "auto-counter") return this.toggleSelectedAutoCounter();
      else if (command.type === "ability") return this.activateSelectedAbility(command.slot ?? "f");
      else if (command.type === "aim" && Number.isFinite(command.position?.x) && Number.isFinite(command.position?.y)) return this.aimSelected(command.position);
      else if (command.type === "cancel-aim") return this.cancelAimSelected();
      else if (command.type === "mecha-control" && typeof command.active === "boolean") {
        if (command.active && this.paused) return false;
        const accepted = this.setMechaControl(tower, command.active);
        const input = this.mechaInputs.get(tower.id);
        if (accepted && input) input.remote = true;
        return accepted;
      }
      else if (command.type === "mecha-input" && [-1, 0, 1].includes(command.moveX) && [-1, 0, 1].includes(command.moveY) &&
        Number.isFinite(command.aim?.x) && Number.isFinite(command.aim?.y) && typeof command.firing === "boolean" && (command.brake === undefined || typeof command.brake === "boolean")) {
        return this.applyMechaInput(tower, command.moveX, command.moveY, command.aim, command.firing, command.brake);
      }
      return false;
    });
  }

  private withPlayer(playerId: PlayerId, towerId: number | null, action: () => boolean): boolean {
    const previousPlayerId = this.localPlayerId;
    const previousSelectedTowerId = this.selectedTowerId;
    const previousSelectedKind = this.selectedKind;
    const previousRelocatingTowerId = this.relocatingTowerId;
    this.localPlayerId = playerId;
    this.selectedTowerId = towerId;
    try {
      return action();
    } finally {
      this.localPlayerId = previousPlayerId;
      this.selectedTowerId = previousSelectedTowerId;
      this.selectedKind = previousSelectedKind;
      this.relocatingTowerId = previousRelocatingTowerId;
      this.emitUi();
    }
  }

  createMultiplayerSnapshot(sequence: number): MultiplayerGameSnapshot | null {
    if (this.multiplayerRole !== "host" || !this.started) return null;
    return {
      sequence,
      sentAt: this.now(),
      integrity: this.integrity,
      maxIntegrity: this.maxIntegrity,
      wave: this.waveNumber,
      waveActive: this.waveActive,
      intermissionRemaining: this.intermissionTimer,
      nextWaveIndex: this.nextWaveIndex,
      paused: this.paused,
      speed: this.speed,
      started: this.started,
      gameOver: this.gameOver,
      modeComplete: this.modeComplete,
      players: [...this.playerRuntimes].map(([id, runtime]) => ({
        id,
        shards: runtime.shards,
        pendingCasualtyRefund: runtime.pendingCasualtyRefund,
        copiesRemaining: { ...runtime.copiesRemaining },
      })),
      towers: this.towers.map((tower) => ({ ...tower, perks: [...tower.perks], position: { ...tower.position }, engaged: [...tower.engaged], mutinyStackTimers: [...(tower.mutinyStackTimers ?? [])] })),
      enemies: this.enemies.map((enemy) => ({ ...enemy })),
      projectiles: this.projectiles.map((projectile) => ({ ...projectile, position: { ...projectile.position } })),
      particles: this.particles.slice(-180).map((particle) => ({
        ...particle,
        position: { ...particle.position },
        velocity: { ...particle.velocity },
        points: particle.points?.map((point) => ({ ...point })),
      })),
      timedBombs: this.timedBombs.map((bomb) => ({ ...bomb, position: { ...bomb.position } })),
      spawnQueue: this.spawnQueue.map((spawn) => ({ ...spawn })),
    };
  }

  applyMultiplayerSnapshot(
    snapshot: MultiplayerGameSnapshot,
    allowPresentation = true,
    pilotInputAcks: readonly MultiplayerPilotInputAck[] = [],
    timing?: Readonly<{ serverTick: number; receivedAt: number }>,
  ): boolean {
    const record = (value: unknown): any =>
      value && typeof value === "object" && !Array.isArray(value) ? value : null;
    const finite = (value: unknown, minimum = -1_000_000_000, maximum = 1_000_000_000): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
    const safeInteger = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
    const optionalFinite = (object: any, key: string, minimum = -1_000_000, maximum = 1_000_000): boolean =>
      object[key] === undefined || finite(object[key], minimum, maximum);
    const finitePoint = (value: unknown): value is Point => {
      const point = record(value);
      return Boolean(point && finite(point.x, -100_000, 100_000) && finite(point.y, -100_000, 100_000));
    };
    const boundedText = (value: unknown, maximum: number): value is string =>
      typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
    const canvasColor = (value: unknown): value is string =>
      boundedText(value, 128) && /^(#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i.test(value);
    const playerStateValid = (value: unknown): boolean => {
      const player = record(value);
      const copies = record(player?.copiesRemaining);
      return Boolean(player && typeof player.id === "string" && this.playerProfiles.has(player.id) &&
        finite(player.shards, 0, 1_000_000_000_000) && finite(player.pendingCasualtyRefund, 0, 1_000_000_000_000) && copies &&
        TOWER_ORDER.every((kind) => safeInteger(copies[kind], 0, 100_000)));
    };
    const towerValid = (value: unknown): boolean => {
      const tower = record(value);
      if (!tower || typeof tower.ownerId !== "string" || !this.playerProfiles.has(tower.ownerId) || typeof tower.kind !== "string" ||
        !Object.hasOwn(TOWER_DEFINITIONS, tower.kind) || !finitePoint(tower.position) || typeof tower.onPath !== "boolean" ||
        (tower.autoCounter !== undefined && typeof tower.autoCounter !== "boolean") ||
        (tower.pathIndex !== undefined && !safeInteger(tower.pathIndex, 0, this.paths.length - 1)) ||
        !safeInteger(tower.id) || !safeInteger(tower.level, 0, TOWER_DEFINITIONS[tower.kind as TowerKind].levels.length - 1) ||
        !Array.isArray(tower.perks) || tower.perks.length > 3 || new Set(tower.perks).size !== tower.perks.length ||
        !tower.perks.every((perk: unknown) => typeof perk === "string" && TOWER_PERK_ORDER.includes(perk as TowerPerkKind) && TOWER_PERK_DEFINITIONS[perk as TowerPerkKind].target === tower.kind) ||
        !Array.isArray(tower.engaged) || tower.engaged.length > 500 || !tower.engaged.every((id: unknown) => safeInteger(id)) ||
        !Array.isArray(tower.rampStackTimers) || tower.rampStackTimers.length > 200 ||
        !tower.rampStackTimers.every((timer: unknown) => finite(timer, 0, 60)) ||
        (tower.aimPoint !== undefined && tower.aimPoint !== null && !finitePoint(tower.aimPoint)) ||
        (tower.aiming !== undefined && typeof tower.aiming !== "boolean") ||
        (tower.mechaControlled !== undefined && typeof tower.mechaControlled !== "boolean") ||
        (tower.mechaFiring !== undefined && typeof tower.mechaFiring !== "boolean") ||
        !optionalFinite(tower, "mechaHullAngle", -Math.PI - 0.002, Math.PI + 0.002) ||
        !optionalFinite(tower, "mechaTurretAngle", -Math.PI - 0.002, Math.PI + 0.002) ||
        !optionalFinite(tower, "mechaSpeed", 0, 10_000) ||
        (tower.mechaActiveAbility !== undefined && tower.mechaActiveAbility !== null && tower.mechaActiveAbility !== "g" && tower.mechaActiveAbility !== "h") ||
        (tower.overdriveMultiplier !== undefined && !finite(tower.overdriveMultiplier, 1, 10)) ||
        (tower.senselessStance !== undefined && typeof tower.senselessStance !== "boolean") ||
        (tower.samuraiFocusDecayTimer !== undefined && !finite(tower.samuraiFocusDecayTimer, 0, 10)) ||
        (tower.zenithChargeTimer !== undefined && !finite(tower.zenithChargeTimer, 0, 10)) ||
        (tower.zenithChargeTargetId !== undefined && !(tower.zenithChargeTargetId === null || safeInteger(tower.zenithChargeTargetId))) ||
        (tower.zenithChargeAngle !== undefined && !finite(tower.zenithChargeAngle, -Math.PI * 2, Math.PI * 2)) ||
        (tower.mutinyKillProgress !== undefined && !finite(tower.mutinyKillProgress, 0, 1_000_000_000)) ||
        (tower.mutinyDamageProgress !== undefined && !finite(tower.mutinyDamageProgress, 0, 1_000_000_000)) ||
        (tower.mutinyStackTimers !== undefined && (!Array.isArray(tower.mutinyStackTimers) || tower.mutinyStackTimers.length > 256 || !tower.mutinyStackTimers.every((timer: unknown) => finite(timer, 0, 60)))) ||
        (tower.abilityCooldowns !== undefined && (!record(tower.abilityCooldowns) ||
          !Object.values(tower.abilityCooldowns).every((value) => finite(value, 0, 86_400)))) ||
        !["first", "last", "strongest", "weakest", "closest"].includes(tower.targeting as string) ||
        !(tower.burstTargetId === null || safeInteger(tower.burstTargetId)) ||
        !["mechaAbilityTimer", "mechaHeat", "mechaOverheatTimer"].every((key) => optionalFinite(tower, key, -1_000_000, 1_000_000))) return false;
      return ["pathDistance", "totalInvested", "hp", "maxHp", "maxAggro", "fireTimer", "counterCooldown", "counterFlash", "hurtFlash", "selectedPulse", "fortifyCharges", "overdriveTimer", "damageBuff", "abilityTimer", "perkPrepTimer", "abilityCooldown", "focus", "meleeTimer", "ammo", "shotCounter", "attackRamp", "rampTimer", "fireRateBuff", "idleTimer", "rocketTimer", "fieldTimer", "fieldTickTimer", "fieldVfxTimer", "regenTimer", "burstTimer", "burstShotsRemaining", "burstSpacing", "stunTimer"]
        .every((key) => finite(tower[key], -1_000_000, 1_000_000));
    };
    const enemyValid = (value: unknown): boolean => {
      const enemy = record(value);
      if (!enemy || typeof enemy.kind !== "string" || !isKnownEnemyKind(enemy.kind) || !safeInteger(enemy.id) ||
        (enemy.pathIndex !== undefined && !safeInteger(enemy.pathIndex, 0, this.paths.length - 1)) ||
        !(enemy.targetTowerId === null || safeInteger(enemy.targetTowerId)) ||
        typeof enemy.lockTriggered !== "boolean" ||
        !Array.isArray(enemy.attackCooldowns) || enemy.attackCooldowns.length > 24 || !enemy.attackCooldowns.every((timer: unknown) => finite(timer, 0, 600)) ||
        !Array.isArray(enemy.attackUses) || enemy.attackUses.length > 24 || !enemy.attackUses.every((use: unknown) => safeInteger(use, 0, 999)) ||
        !["pathDistance", "hp", "maxHp", "shieldHp", "maxShieldHp", "speed", "damage", "attackInterval", "telegraphDuration", "attackTimer", "stunTimer", "slowTimer", "slowFactor", "shockStacks", "burnTimer", "burnTickTimer", "burnDamage", "burnSlowFactor", "burnTickInterval", "burnSpeedFactor", "hitFlash", "spawnScale", "summonTimer", "abilityTimer", "regenerationVfxTimer", "hasteCooldown", "hasteTimer", "hasteFactor", "drainCooldown", "phaseCooldown", "phaseTimer", "blinkCooldown", "aliveTime", "protection", "lockTimeRemaining", "lockWavesRemaining", "behaviorMovementLockTimer", "behaviorInvulnerableTimer", "behaviorSpeedFactor", "behaviorDamageFactor"]
          .every((key) => finite(enemy[key], -1_000_000, 1_000_000))) return false;
      if (!Array.isArray(enemy.behaviorRuleUses) || enemy.behaviorRuleUses.length > 32 || !enemy.behaviorRuleUses.every((use: unknown) => safeInteger(use, 0, 999)) ||
        !Array.isArray(enemy.behaviorRuleCooldowns) || enemy.behaviorRuleCooldowns.length > 32 || !enemy.behaviorRuleCooldowns.every((timer: unknown) => finite(timer, 0, 600)) ||
        !Array.isArray(enemy.behaviorActionQueue) || enemy.behaviorActionQueue.length > 1024 ||
        !Array.isArray(enemy.behaviorEffects) || enemy.behaviorEffects.length > 1024) return false;
      return enemy.burnOwnerId === null || (typeof enemy.burnOwnerId === "string" && this.playerProfiles.has(enemy.burnOwnerId));
    };
    const projectileValid = (value: unknown): boolean => {
      const projectile = record(value);
      return Boolean(projectile && this.playerProfiles.has(projectile.ownerId as string) && typeof projectile.kind === "string" && Object.hasOwn(TOWER_DEFINITIONS, projectile.kind) &&
        finitePoint(projectile.position) && safeInteger(projectile.targetId) && ["delay", "damage", "speed", "splash", "chain", "towerLevel"].every((key) => finite(projectile[key], -1_000_000, 1_000_000)));
    };
    const particleValid = (value: unknown): boolean => {
      const particle = record(value);
      const points = particle?.points;
      return Boolean(particle && finitePoint(particle.position) && finitePoint(particle.velocity) && canvasColor(particle.color) && boundedText(particle.type, 32) &&
        ["spark", "ring", "slash", "strike", "spray", "smoke", "flash", "beam", "lightning", "text", "flame-stream", "flame-plume"].includes(particle.type) &&
        finite(particle.life, -1_000_000, 1_000_000) && finite(particle.maxLife, 0.0001, 1_000_000) && finite(particle.size, 0, 1_000_000) &&
        optionalFinite(particle, "delay") && optionalFinite(particle, "radius", 0, 100_000) && optionalFinite(particle, "angle") && optionalFinite(particle, "spread") &&
        optionalFinite(particle, "rotation") && optionalFinite(particle, "angularVelocity") && optionalFinite(particle, "drag", 0, 1) && optionalFinite(particle, "length", 0, 100_000) &&
        (particle.text === undefined || boundedText(particle.text, 500)) && (particle.startColor === undefined || canvasColor(particle.startColor)) && (particle.endColor === undefined || canvasColor(particle.endColor)) &&
        (!points || (Array.isArray(points) && points.length <= 32 && points.every(finitePoint))));
    };
    const bombValid = (value: unknown): boolean => {
      const bomb = record(value);
      return Boolean(bomb && finitePoint(bomb.position) && finite(bomb.damage, 0, 1_000_000_000) && finite(bomb.radius, 0, 10_000) &&
        typeof bomb.playerId === "string" && this.playerProfiles.has(bomb.playerId) && canvasColor(bomb.color) && finite(bomb.timer, -1_000_000, 1_000_000) &&
        (bomb.sourceTowerId === undefined || safeInteger(bomb.sourceTowerId)) && (bomb.sourceKind === undefined || (typeof bomb.sourceKind === "string" && Object.hasOwn(TOWER_DEFINITIONS, bomb.sourceKind))) &&
        (bomb.proximity === undefined || typeof bomb.proximity === "boolean") && (bomb.towerLevel === undefined || safeInteger(bomb.towerLevel, 0, 100)) && (bomb.label === undefined || boundedText(bomb.label, 64)));
    };
    const spawnValid = (value: unknown): boolean => {
      const spawn = record(value);
      return Boolean(spawn && typeof spawn.kind === "string" && isKnownEnemyKind(spawn.kind) && finite(spawn.spawnAt, 0, 86_400) && finite(spawn.hp, 0, 1_000_000_000) && (spawn.pathIndex === undefined || safeInteger(spawn.pathIndex, 0, this.paths.length - 1)));
    };
    if (
      !this.isMirror || !snapshot || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence <= this.lastSnapshotSequence ||
      !finite(snapshot.sentAt, -1_000_000_000_000, 1_000_000_000_000) || !finite(snapshot.integrity, 0, 1_000_000_000_000) || !finite(snapshot.maxIntegrity, 1, 1_000_000_000_000) || snapshot.integrity > snapshot.maxIntegrity ||
      !safeInteger(snapshot.wave, 0, this.mode.waves.length) || !safeInteger(snapshot.nextWaveIndex, 0, this.mode.waves.length) || !finite(snapshot.intermissionRemaining, 0, 86_400) ||
      ![1, 1.5, 2].includes(snapshot.speed) || typeof snapshot.waveActive !== "boolean" || typeof snapshot.paused !== "boolean" || typeof snapshot.started !== "boolean" || typeof snapshot.gameOver !== "boolean" || typeof snapshot.modeComplete !== "boolean" ||
      !Array.isArray(snapshot.players) || snapshot.players.length !== this.playerProfiles.size || new Set(snapshot.players.map((player) => player.id)).size !== snapshot.players.length || !snapshot.players.some((player) => player.id === this.localPlayerId) || !snapshot.players.every(playerStateValid) ||
      !Array.isArray(snapshot.towers) || snapshot.towers.length > 100 || !snapshot.towers.every(towerValid) ||
      !Array.isArray(snapshot.enemies) || snapshot.enemies.length > 5_000 || !snapshot.enemies.every(enemyValid) ||
      !Array.isArray(snapshot.projectiles) || snapshot.projectiles.length > 10_000 || !snapshot.projectiles.every(projectileValid) ||
      !Array.isArray(snapshot.particles) || snapshot.particles.length > 200 || !snapshot.particles.every(particleValid) ||
      !Array.isArray(snapshot.timedBombs) || snapshot.timedBombs.length > 1_000 || !snapshot.timedBombs.every(bombValid) ||
      !Array.isArray(snapshot.spawnQueue) || snapshot.spawnQueue.length > 5_000 || !snapshot.spawnQueue.every(spawnValid)
    ) return false;
    this.lastSnapshotSequence = snapshot.sequence;
    if (timing && Number.isSafeInteger(timing.serverTick) && Number.isFinite(timing.receivedAt)) {
      this.updateMirrorTimeline(timing.serverTick, timing.receivedAt);
      this.recordMirrorTransforms(snapshot, timing.serverTick);
    }
    const previousEnemies = new Map(this.enemies.map((enemy) => [enemy.id, enemy]));
    const previousTowers = new Map(this.towers.map((tower) => [tower.id, tower]));
    const previousBombs = [...this.timedBombs];
    const previousEnemyIds = new Set(previousEnemies.keys());
    const previousProjectileCount = this.projectiles.length;
    const previousWaveActive = this.waveActive;
    const previousGameOver = this.gameOver;
    const previousModeComplete = this.modeComplete;
    const previousWave = this.waveNumber;
    const previousPilot = this.towers.find((tower) => tower.ownerId === this.localPlayerId && tower.kind === "mecha" && tower.mechaControlled);
    const nextPilot = snapshot.towers.find((tower) => tower.ownerId === this.localPlayerId && tower.kind === "mecha" && tower.mechaControlled && tower.hp > 0);
    const pilotRemoved = previousPilot && !snapshot.towers.some((tower) => tower.id === previousPilot.id && tower.hp > 0);
    if (previousPilot && nextPilot?.id !== previousPilot.id && (pilotRemoved || this.mirrorControlledMechaId === previousPilot.id)) {
      // A sold/destroyed Tank or authoritative exit must release local keys and
      // pointer capture, without sending input to an entity that no longer exists.
      this.releaseMechaInput(false);
      this.mechaInputs.delete(previousPilot.id);
    }
    // A snapshot already in flight before ENTER must not clear newly held keys.
    this.mirrorControlledMechaId = nextPilot?.id ?? null;
    this.integrity = snapshot.integrity;
    this.maxIntegrity = snapshot.maxIntegrity;
    this.waveNumber = snapshot.wave;
    this.waveActive = snapshot.waveActive;
    this.intermissionTimer = snapshot.intermissionRemaining;
    this.nextWaveIndex = snapshot.nextWaveIndex;
    if ((!this.paused && snapshot.paused) || snapshot.gameOver) this.releaseMechaInput();
    this.paused = snapshot.paused;
    this.speed = snapshot.speed;
    this.started = snapshot.started;
    this.gameOver = snapshot.gameOver;
    this.modeComplete = snapshot.modeComplete;
    if (previousWave !== this.waveNumber || !this.waveActive) {
      this.waveElapsed = 0;
      this.waveAllSpawnedAt = null;
      this.waveSpawnDuration = previousWave !== this.waveNumber ? this.spawnDurationForWave(this.waveNumber - 1) : this.waveSpawnDuration;
      if (!this.waveActive) this.waveSpawnDuration = 0;
      this.skipWaveVoteWave = 0;
      this.skipWaveDismissedWave = 0;
      this.skipWaveVotes.clear();
    }
    snapshot.players.forEach((player) => {
      const runtime = this.runtimeFor(player.id);
      runtime.shards = Math.max(0, player.shards);
      runtime.pendingCasualtyRefund = Math.max(0, player.pendingCasualtyRefund);
      runtime.copiesRemaining = { ...player.copiesRemaining };
    });
    this.towers = snapshot.towers.map((tower) => ({ ...tower, autoCounter: tower.autoCounter ?? false, perks: [...tower.perks], position: { ...tower.position }, engaged: new Set(tower.engaged), mutinyStackTimers: [...(tower.mutinyStackTimers ?? [])] }));
    this.mirrorTankPoses.clear();
    this.towers.forEach((tower) => {
      if (tower.kind !== "mecha") return;
      const previous = previousTowers.get(tower.id);
      this.mirrorTankPoses.set(tower.id, { position: { ...tower.position }, mechaHullAngle: tower.mechaHullAngle, mechaTurretAngle: tower.mechaTurretAngle });
      if (tower.ownerId === this.localPlayerId && tower.mechaControlled && !this.paused) {
        this.reconcilePredictedTank(tower, previous, pilotInputAcks);
        return;
      }
      this.pendingPilotInputs.delete(tower.id);
      if (!previous || this.paused || !tower.mechaControlled || distance(previous.position, tower.position) > 200) return;
      tower.position = { ...previous.position };
      tower.mechaHullAngle = previous.mechaHullAngle;
      tower.mechaTurretAngle = previous.mechaTurretAngle;
    });
    let correctionTotal = 0;
    let correctionSamples = 0;
    this.enemies = snapshot.enemies.map((enemy) => {
      const previous = previousEnemies.get(enemy.id);
      this.mirrorEnemyTargets.set(enemy.id, enemy.pathDistance);
      if (!previous) return { ...enemy };
      const correction = Math.abs(enemy.pathDistance - previous.pathDistance);
      correctionTotal += correction;
      correctionSamples += 1;
      const pathChanged = (previous.pathIndex ?? 0) !== (enemy.pathIndex ?? 0);
      const largeResynchronization = correction > 160;
      return { ...enemy, pathDistance: pathChanged || largeResynchronization ? enemy.pathDistance : previous.pathDistance };
    });
    this.mirrorInterpolationCorrection = correctionSamples > 0 ? correctionTotal / correctionSamples : 0;
    let visualBudget = allowPresentation && !this.presentationSuspended ? 24 : 0;
    this.enemies.filter((enemy) => !previousEnemyIds.has(enemy.id)).slice(0, 3).forEach((enemy) => {
      const definition = getEnemyDefinition(enemy.kind);
      if (visualBudget > 0) this.audio.enemySpawn(enemy.kind, Boolean(definition.boss));
      if (visualBudget-- > 0) this.spawnRing(this.enemyPosition(enemy), definition.sprite.accent, 0.3, 3, 28);
    });
    this.enemies.forEach((enemy) => {
      const previous = previousEnemies.get(enemy.id);
      if (previous && visualBudget > 0 && (enemy.hp < previous.hp || enemy.shieldHp < previous.shieldHp)) {
        visualBudget -= 1;
        this.spawnImpactDust(this.enemyPosition(enemy), getEnemyDefinition(enemy.kind).sprite.accent);
      }
    });
    const activeEnemyIds = new Set(this.enemies.map((enemy) => enemy.id));
    previousEnemies.forEach((enemy, id) => {
      if (!activeEnemyIds.has(id)) {
        const definition = getEnemyDefinition(enemy.kind);
        if (allowPresentation && !this.presentationSuspended) this.audio.enemyDeath(Boolean(definition.boss));
      }
    });
    [...this.mirrorEnemyTargets.keys()].forEach((id) => { if (!activeEnemyIds.has(id)) this.mirrorEnemyTargets.delete(id); });
    [...this.mirrorEnemySamples.keys()].forEach((id) => { if (!activeEnemyIds.has(id)) this.mirrorEnemySamples.delete(id); });
    const activeTowerIds = new Set(this.towers.map((tower) => tower.id));
    [...this.mirrorTankSamples.keys()].forEach((id) => { if (!activeTowerIds.has(id)) this.mirrorTankSamples.delete(id); });
    this.projectiles = snapshot.projectiles.map((projectile) => ({ ...projectile, position: { ...projectile.position } }));
    if (this.projectiles.length > previousProjectileCount) {
      const newest = this.projectiles[this.projectiles.length - 1];
      if (newest) this.audio.shoot(360, newest.kind);
    }
    if (snapshot.particles.length > 0) {
      this.particles = snapshot.particles.map((particle) => ({
        ...particle,
        position: { ...particle.position },
        velocity: { ...particle.velocity },
        points: particle.points?.map((point: Point) => ({ ...point })),
      }));
    }
    this.timedBombs = snapshot.timedBombs.map((bomb) => {
      const previous = previousBombs.find((candidate) => candidate.position.x === bomb.position.x && candidate.position.y === bomb.position.y && candidate.playerId === bomb.playerId);
      return { ...bomb, timer: previous?.timer ?? bomb.timer, position: { ...bomb.position } };
    });
    this.towers.forEach((tower) => {
      const previous = previousTowers.get(tower.id);
      if (!previous && visualBudget-- > 0) this.spawnRing(tower.position, TOWER_DEFINITIONS[tower.kind].accent, 0.45, 5);
      else if (previous && tower.hp < previous.hp && visualBudget-- > 0) this.spawnImpactDust(tower.position, "#ff665c");
    });
    previousBombs.forEach((bomb) => {
      // Missile explosions arrive as semantic events; do not also infer them
      // from snapshot removal, which would double their flash and sound.
      if (bomb.label === "mecha-missile") return;
      if (visualBudget <= 0 || this.timedBombs.some((candidate) => candidate.position.x === bomb.position.x && candidate.position.y === bomb.position.y && candidate.playerId === bomb.playerId)) return;
      visualBudget -= 1;
      this.spawnExplosion(bomb.position, bomb.color, bomb.radius);
    });
    this.spawnQueue = snapshot.spawnQueue
      .filter((spawn): spawn is { kind: EnemyKind; spawnAt: number; hp: number; pathIndex?: number } => typeof spawn.kind === "string" && Number.isFinite(spawn.spawnAt) && Number.isFinite(spawn.hp))
      .map((spawn) => ({ ...spawn, pathIndex: this.resolvePathIndex(spawn.pathIndex) }));
    if (allowPresentation && !this.presentationSuspended) {
      if (!previousWaveActive && this.waveActive) this.audio.waveStart();
      else if (previousWaveActive && !this.waveActive && !this.modeComplete) this.audio.waveClear();
      if (!previousGameOver && this.gameOver) this.audio.defeat();
      if (!previousModeComplete && this.modeComplete) this.audio.victory();
    }
    if (this.selectedTowerId !== null && !this.towers.some((tower) => tower.id === this.selectedTowerId)) this.selectedTowerId = null;
    this.confirmPendingCommandFeedback();
    this.updatePlacement();
    this.emitUi();
    return true;
  }

  private updateMirror(delta: number): void {
    const blend = 1 - Math.exp(-Math.min(delta, 0.1) * 18);
    this.mirrorExtrapolationTicks = 0;
    const presentationTick = this.currentMirrorPresentationTick();
    this.drainScheduledPresentationEvents();
    if (!this.paused) {
      const cooldownDelta = delta * this.speed;
      this.towers.forEach((tower) => {
        const behavior = getTowerBehavior(tower.kind);
        const stanceWasActive = tower.abilityTimer > 0;
        const activeAbility = getTowerAbilityWithPerks(TOWER_DEFINITIONS[tower.kind], tower.perks, "f");
        tower.abilityTimer = Math.max(0, tower.abilityTimer - cooldownDelta);
        const cooldownPaused = Boolean(behavior?.pauseAbilityCooldownWhileActive && stanceWasActive);
        if (stanceWasActive && tower.abilityTimer <= 0 && cooldownPaused) {
          tower.abilityCooldown = Math.max(tower.abilityCooldown, activeAbility?.cooldown ?? 0);
          if (tower.abilityCooldowns) tower.abilityCooldowns.f = tower.abilityCooldown;
        } else if (!cooldownPaused) {
          const fCooldown = Math.max(0, (tower.abilityCooldowns?.f ?? tower.abilityCooldown) - cooldownDelta);
          tower.abilityCooldown = fCooldown;
          if (tower.abilityCooldowns) tower.abilityCooldowns.f = fCooldown;
          if (tower.abilityCooldowns) {
            Object.keys(tower.abilityCooldowns).forEach((key) => {
              const slot = key as TowerAbilitySlot;
              if (slot === "f") return;
              tower.abilityCooldowns![slot] = Math.max(0, (tower.abilityCooldowns![slot] ?? 0) - cooldownDelta);
            });
          }
        }
        if (tower.kind === "mecha") {
          const localPilotInput = tower.ownerId === this.localPlayerId && tower.mechaControlled
            ? this.mechaInputs.get(tower.id)
            : undefined;
          const sampledPose = localPilotInput ? undefined : this.sampleMirrorTank(tower.id, presentationTick);
          const pose = sampledPose
            ? { position: sampledPose.position, mechaHullAngle: sampledPose.hullAngle, mechaTurretAngle: sampledPose.turretAngle }
            : this.mirrorTankPoses.get(tower.id);
          if (localPilotInput) {
            const control = TOWER_DEFINITIONS.mecha.control!;
            tower.aimPoint = { ...localPilotInput.aim };
            tower.mechaFiring = localPilotInput.firing;
            advanceTankMotion(tower, localPilotInput.moveX, localPilotInput.moveY, delta, control, mapWorldBounds(this.map.mapScale),
              localPilotInput.brake === true || tower.stunTimer > 0);
          }
          if (pose) {
            const blend = localPilotInput
              ? 1 - Math.exp(-Math.max(0, delta) * 12)
              : sampledPose
                ? 1
                : 1 - Math.exp(-Math.max(0, delta) * 30);
            tower.position = { x: tower.position.x + (pose.position.x - tower.position.x) * blend, y: tower.position.y + (pose.position.y - tower.position.y) * blend };
            for (const field of ["mechaHullAngle", "mechaTurretAngle"] as const) {
              const current = tower[field] ?? 0;
              const turn = (pose[field] ?? current) - current;
              const angle = current + Math.atan2(Math.sin(turn), Math.cos(turn)) * blend;
              tower[field] = Math.atan2(Math.sin(angle), Math.cos(angle));
            }
          }
          tower.fireTimer = Math.max(0, tower.fireTimer - cooldownDelta);
          const control = TOWER_DEFINITIONS.mecha.control!;
          const level = Math.min(tower.level, control.heat.ventPerSecond.length - 1);
          tower.mechaAbilityTimer = Math.max(0, (tower.mechaAbilityTimer ?? 0) - cooldownDelta);
          tower.mechaOverheatTimer = Math.max(0, (tower.mechaOverheatTimer ?? 0) - cooldownDelta);
          if (!tower.mechaActiveAbility) tower.mechaHeat = Math.max(0, (tower.mechaHeat ?? 0) - (control.heat.ventPerSecond[level] ?? 0) * cooldownDelta);
        }
      });
    }
    if (!this.paused && this.waveActive) {
      this.waveElapsed += delta * this.speed;
      if (this.waveAllSpawnedAt === null && this.waveElapsed >= this.waveSpawnDuration) this.waveAllSpawnedAt = this.waveSpawnDuration;
    }
    this.enemies.forEach((enemy) => {
      let target = this.mirrorEnemyTargets.get(enemy.id);
      const sampledPathDistance = this.sampleMirrorEnemy(enemy.id, presentationTick);
      if (sampledPathDistance !== undefined) {
        enemy.pathDistance = sampledPathDistance;
        target = undefined;
      }
      if (target !== undefined && !this.paused && enemy.targetTowerId === null && enemy.stunTimer <= 0 && enemy.behaviorMovementLockTimer <= 0 && !this.enemyMovementLocked(enemy)) {
        const movementScale = Math.min(enemy.slowTimer > 0 ? enemy.slowFactor : 1, enemy.burnTimer > 0 ? enemy.burnSlowFactor : 1) * (enemy.burnTimer > 0 ? enemy.burnSpeedFactor : 1);
        const hasteScale = enemy.hasteTimer > 0 ? enemy.hasteFactor : 1;
        target += enemy.speed * movementScale * hasteScale * enemy.behaviorSpeedFactor * delta * this.speed;
        this.mirrorEnemyTargets.set(enemy.id, target);
      }
      if (target !== undefined) enemy.pathDistance += (target - enemy.pathDistance) * blend;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta * 5);
      enemy.spawnScale = Math.min(1, enemy.spawnScale + delta * 4);
      if (!this.paused) {
        enemy.stunTimer = Math.max(0, enemy.stunTimer - delta * this.speed);
        enemy.slowTimer = Math.max(0, enemy.slowTimer - delta * this.speed);
        enemy.burnTimer = Math.max(0, enemy.burnTimer - delta * this.speed);
        const wasHasted = enemy.hasteTimer > 0;
        enemy.hasteTimer = Math.max(0, enemy.hasteTimer - delta * this.speed);
        if (wasHasted && enemy.hasteTimer <= 0) enemy.hasteFactor = 1;
        enemy.phaseTimer = Math.max(0, enemy.phaseTimer - delta * this.speed);
        enemy.lockTimeRemaining = Math.max(0, enemy.lockTimeRemaining - delta * this.speed);
        enemy.behaviorMovementLockTimer = Math.max(0, enemy.behaviorMovementLockTimer - delta * this.speed);
        enemy.behaviorInvulnerableTimer = Math.max(0, enemy.behaviorInvulnerableTimer - delta * this.speed);
        if (enemy.targetTowerId !== null) enemy.attackTimer = Math.max(0, enemy.attackTimer - delta * this.speed);
      }
    });
    for (const [towerId, charge] of this.mirrorZenithCharges) {
      const tower = this.towers.find((candidate) => candidate.id === towerId && candidate.hp > 0 && getTowerBehavior(candidate.kind)?.mirrorCharge);
      if (!tower) {
        this.mirrorZenithCharges.delete(towerId);
        this.audio.zenithCharge(towerId, false);
        continue;
      }
      if (!this.paused) charge.remaining = Math.max(0, charge.remaining - delta * this.speed);
      if (charge.remaining <= 0) {
        this.mirrorZenithCharges.delete(towerId);
        this.audio.zenithCharge(towerId, false, 1);
      }
    }
    for (const [towerId, field] of this.mirrorFieldEffects) {
      const tower = this.towers.find((candidate) => candidate.id === towerId && candidate.hp > 0);
      if (!tower || field.remaining <= 0) {
        this.mirrorFieldEffects.delete(towerId);
        continue;
      }
      if (!this.paused) {
        field.remaining = Math.max(0, field.remaining - delta * this.speed);
        field.vfxTimer -= delta * this.speed;
      }
      while (field.remaining > 0 && field.vfxTimer <= 0) {
        this.spawnLightningAuraArc(tower.position, 150, field.color);
        field.vfxTimer += tower.level >= 4 ? 0.09 : 0.13;
      }
      if (field.remaining <= 0) this.mirrorFieldEffects.delete(towerId);
    }
    if (!this.paused) this.timedBombs.forEach((bomb) => { if (!bomb.proximity) bomb.timer = Math.max(0, bomb.timer - delta * this.speed); });
    if (!this.paused) this.updateVisualProjectiles(delta * this.speed);
    this.updateParticles(delta);
    this.shake = Math.max(0, this.shake - delta * 3);
  }

  private updateMirrorTimeline(serverTick: number, receivedAt: number): void {
    if (serverTick <= 0) return;
    if (this.mirrorServerTickReceivedAt > 0 && serverTick > this.mirrorServerTick) {
      const expectedMs = (serverTick - this.mirrorServerTick) * 1_000 / SIMULATION_TICK_HZ;
      const arrivalJitterTicks = Math.abs((receivedAt - this.mirrorServerTickReceivedAt) - expectedMs) * SIMULATION_TICK_HZ / 1_000;
      this.mirrorFrameJitterTicks = this.mirrorFrameJitterTicks * 0.82 + arrivalJitterTicks * 0.18;
      this.mirrorPresentationDelayTicks = clamp(Math.round(4 + this.mirrorFrameJitterTicks * 1.5), 4, 7);
    }
    if (serverTick >= this.mirrorServerTick) {
      this.mirrorServerTick = serverTick;
      this.mirrorServerTickReceivedAt = receivedAt;
    }
  }

  private currentMirrorPresentationTick(now = this.now()): number {
    if (this.mirrorServerTickReceivedAt <= 0) return Number.POSITIVE_INFINITY;
    return this.mirrorServerTick + Math.max(0, now - this.mirrorServerTickReceivedAt) * SIMULATION_TICK_HZ / 1_000 - this.mirrorPresentationDelayTicks;
  }

  private recordMirrorTransforms(snapshot: MultiplayerGameSnapshot, tick: number): void {
    const push = <T extends { readonly tick: number }>(samples: T[], sample: T): void => {
      const previous = samples[samples.length - 1];
      if (previous?.tick === tick) samples[samples.length - 1] = sample;
      else if (!previous || previous.tick < tick) samples.push(sample);
      if (samples.length > 12) samples.splice(0, samples.length - 12);
    };
    snapshot.enemies.forEach((enemy) => {
      const samples = this.mirrorEnemySamples.get(enemy.id) ?? [];
      push(samples, { tick, pathDistance: enemy.pathDistance });
      this.mirrorEnemySamples.set(enemy.id, samples);
    });
    snapshot.towers.forEach((tower) => {
      if (tower.kind !== "mecha") return;
      const samples = this.mirrorTankSamples.get(tower.id) ?? [];
      push(samples, {
        tick,
        position: { ...tower.position },
        hullAngle: tower.mechaHullAngle ?? 0,
        turretAngle: tower.mechaTurretAngle ?? 0,
      });
      this.mirrorTankSamples.set(tower.id, samples);
    });
  }

  private sampleMirrorEnemy(id: number, tick: number): number | undefined {
    const samples = this.mirrorEnemySamples.get(id);
    if (!samples?.length || !Number.isFinite(tick)) return undefined;
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    if (tick <= first.tick) return first.pathDistance;
    if (tick >= last.tick) {
      this.mirrorExtrapolationTicks = Math.max(this.mirrorExtrapolationTicks, Math.min(3, tick - last.tick));
      return last.pathDistance;
    }
    for (let index = 1; index < samples.length; index += 1) {
      const next = samples[index]!;
      const previous = samples[index - 1]!;
      if (tick > next.tick) continue;
      const blend = (tick - previous.tick) / Math.max(1, next.tick - previous.tick);
      return previous.pathDistance + (next.pathDistance - previous.pathDistance) * blend;
    }
    return last.pathDistance;
  }

  private sampleMirrorTank(id: number, tick: number): MirrorTankSample | undefined {
    const samples = this.mirrorTankSamples.get(id);
    if (!samples?.length || !Number.isFinite(tick)) return undefined;
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    if (tick <= first.tick) return first;
    if (tick >= last.tick) {
      this.mirrorExtrapolationTicks = Math.max(this.mirrorExtrapolationTicks, Math.min(3, tick - last.tick));
      return last;
    }
    for (let index = 1; index < samples.length; index += 1) {
      const next = samples[index]!;
      const previous = samples[index - 1]!;
      if (tick > next.tick) continue;
      const blend = (tick - previous.tick) / Math.max(1, next.tick - previous.tick);
      const blendAngle = (from: number, to: number): number => {
        const turn = to - from;
        return Math.atan2(Math.sin(from + Math.atan2(Math.sin(turn), Math.cos(turn)) * blend), Math.cos(from + Math.atan2(Math.sin(turn), Math.cos(turn)) * blend));
      };
      return {
        tick,
        position: { x: previous.position.x + (next.position.x - previous.position.x) * blend, y: previous.position.y + (next.position.y - previous.position.y) * blend },
        hullAngle: blendAngle(previous.hullAngle, next.hullAngle),
        turretAngle: blendAngle(previous.turretAngle, next.turretAngle),
      };
    }
    return last;
  }

  private drainScheduledPresentationEvents(): void {
    const tick = this.currentMirrorPresentationTick();
    if (!Number.isFinite(tick) || this.scheduledPresentationEvents.length === 0) return;
    const due: ScheduledPresentationEvent[] = [];
    while (true) {
      const next = this.scheduledPresentationEvents[0];
      if (!next || next.dueTick > tick) break;
      due.push(this.scheduledPresentationEvents.shift()!);
    }
    due.forEach((entry) => this.applySimulationEvents([entry.event], entry.allowTransient));
  }

  private confirmPendingCommandFeedback(): void {
    const now = this.now();
    this.pendingCommandFeedback.forEach((feedback, commandId) => {
      const command = feedback.command;
      const confirmed = command.type === "deploy"
        ? this.towers.some((tower) => tower.ownerId === this.localPlayerId && tower.kind === command.kind && distance(tower.position, command.position) < 2)
        : command.type === "relocate"
          ? this.towers.some((tower) => tower.id === command.towerId && distance(tower.position, command.position) < 2)
          : command.type === "sell"
            ? !this.towers.some((tower) => tower.id === command.towerId)
            : command.type === "upgrade"
              ? (this.towers.find((tower) => tower.id === command.towerId)?.level ?? -1) > 0
              : command.type === "target"
                ? this.towers.find((tower) => tower.id === command.towerId)?.targeting === command.targeting
                : false;
      if (confirmed || (feedback.accepted && now >= feedback.expiresAt) || now >= feedback.expiresAt) {
        this.pendingCommandFeedback.delete(commandId);
        this.pendingPlacementFeedback.delete(commandId);
      }
    });
  }

  private frame(timestamp: number): void {
    const rawDelta = this.lastTimestamp === 0 ? 0 : (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    if (!this.started) {
      this.animationFrame = requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
      return;
    }
    const delta = Math.min(rawDelta, 0.05) * this.speed;
    this.elapsed += rawDelta;
    this.updateMechaPilotInput();
    if (this.isMirror) this.updateMirror(Math.min(rawDelta, 0.05));
    else if (!this.paused && !this.gameOver) this.update(delta);
    else this.updateParticles(Math.min(rawDelta, 0.05));
    this.updateMechaCameraFollow(Math.min(rawDelta, 0.05));
    this.syncTankWeaponAudio();
    this.renderer.draw();
    this.uiTimer -= rawDelta;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      this.emitUi();
    }
    this.animationFrame = requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
  }

  private syncTankWeaponAudio(): void {
    if (this.headless) return;
    const audible = this.started && !this.paused && !this.gameOver && !this.presentationSuspended && !document.hidden && document.hasFocus();
    const flamethrowers = audible ? this.towers.filter((tower) => tower.kind === "mecha" && tower.mechaControlled && tower.mechaActiveAbility === "h" && (tower.mechaAbilityTimer ?? 0) > 0 && tower.stunTimer <= 0 && (tower.mechaOverheatTimer ?? 0) <= 0) : [];
    this.audio.tankFlameStream(flamethrowers.length > 0, Math.max(0, ...flamethrowers.map((tower) => tower.level)));
  }

  private update(delta: number): void {
    if (!this.waveActive && this.intermissionTimer > 0 && !this.modeComplete) {
      this.intermissionTimer = Math.max(0, this.intermissionTimer - delta);
      if (this.intermissionTimer <= 0) this.callWave();
    }
    if (this.waveActive) this.updateSpawns(delta);
    this.updateControlledMecha(delta);
    this.updateEnemies(delta);
    this.removeDestroyedTowers();
    this.updateTowers(delta);
    this.updateProjectiles(delta);
    this.updateAdmiralShots(delta);
    this.updateVisualProjectiles(delta);
    this.updateDelayedSlashes(delta);
    this.updateTimedBombs(delta);
    this.removeDeadEnemies();
    this.updateParticles(delta);
    this.shake = Math.max(0, this.shake - delta * 3);
    if (this.waveActive && this.spawnQueue.length === 0 && this.enemies.length === 0) this.completeWave();
  }

  private updateSpawns(delta: number): void {
    this.waveElapsed += delta;
    while (this.spawnQueue[0] && this.spawnQueue[0].spawnAt <= this.waveElapsed) {
      const queued = this.spawnQueue.shift();
      if (queued) this.spawnEnemy(queued.kind, queued.hp, 0, queued.pathIndex);
    }
    if (this.spawnQueue.length === 0 && this.waveAllSpawnedAt === null) this.waveAllSpawnedAt = this.waveElapsed;
  }

  private spawnEnemy(
    kind: EnemyKind,
    hp: number,
    pathDistance = 0,
    pathIndex = 0,
    summonModifiers: EnemySummonModifiers = NEUTRAL_SUMMON_MODIFIERS,
    summoned = false,
  ): void {
    const base = getEnemyDefinition(kind);
    this.audio.enemySpawn(kind, Boolean(base.boss));
    const id = this.nextId++;
    const effectiveHp = Math.max(1, hp * summonModifiers.hpMultiplier);
    const effectiveShieldHp = Math.max(0, base.shieldHp * summonModifiers.shieldMultiplier);
    const effectiveAttackInterval = Math.max(0.05, base.attackInterval * summonModifiers.attackIntervalMultiplier);
    const effectiveDefense = Math.max(0, (base.defense ?? 0) + summonModifiers.defenseBonus);
    const effectiveProtection = Math.max(0, Math.round((base.protection ?? 0) + summonModifiers.protectionBonus));
    const effectiveArmor = clamp((base.armor ?? 0) + summonModifiers.armorBonus, 0, 1);
    const effectiveSuperarmor = clamp((base.superarmor ?? 0) + summonModifiers.superarmorBonus, 0, 1);
    let effectiveResistances: EnemyResistances | undefined;
    if (base.resistances || summonModifiers.resistanceBonuses) {
      effectiveResistances = {};
      const keys = new Set([
        ...Object.keys(base.resistances ?? {}),
        ...Object.keys(summonModifiers.resistanceBonuses ?? {}),
      ]);
      for (const key of keys) {
        const val = (base.resistances?.[key] ?? 0) + (summonModifiers.resistanceBonuses?.[key] ?? 0);
        if (Number.isFinite(val)) {
          effectiveResistances[key] = Math.min(1, val);
        }
      }
    }
    const abilities = normalizeEnemyAbilities(base);
    this.enemies.push({
      id,
      kind,
      pathIndex: this.resolvePathIndex(pathIndex),
      pathDistance,
      hp: effectiveHp,
      maxHp: effectiveHp,
      shieldHp: effectiveShieldHp,
      maxShieldHp: effectiveShieldHp,
      // Hard mode has a slightly lower global speed multiplier so its added
      // mechanics create pressure without making early leaks unavoidable.
      // Creator modes retain literal enemy speeds for predictable authoring.
      speed: base.speed * (this.mode.kind === "hard" ? 1.5 : this.mode.isCustom ? 1 : 1.75) * summonModifiers.speedMultiplier,
      damage: base.damage * summonModifiers.damageMultiplier,
      attackInterval: effectiveAttackInterval,
      telegraphDuration: Math.min(base.telegraphDuration * summonModifiers.attackIntervalMultiplier, effectiveAttackInterval),
      coreDamage: base.coreDamage * summonModifiers.coreDamageMultiplier,
      defense: effectiveDefense,
      protection: effectiveProtection,
      armor: effectiveArmor,
      superarmor: effectiveSuperarmor,
      resistances: effectiveResistances,
      hitCashMultiplier: summoned ? clamp(summonModifiers.hitCashMultiplier, 0, 10) : 1,
      summonModifiers,
      targetTowerId: null,
      attackTimer: effectiveAttackInterval,
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
      spawnScale: 0,
      summonTimer: base.summon?.interval ?? 0,
      abilityTimer: base.shockwave?.interval ?? 0,
      regenerationVfxTimer: 0,
      hasteCooldown: base.hastePulse?.interval ?? 0,
      hasteTimer: 0,
      hasteFactor: 1,
      drainCooldown: base.drain?.interval ?? 0,
      phaseCooldown: base.phase?.interval ?? 0,
      phaseTimer: 0,
      blinkCooldown: base.blink?.interval ?? 0,
      aliveTime: 0,
      lockTriggered: false,
      lockTimeRemaining: 0,
      lockWavesRemaining: 0,
      attackCooldowns: (base.attacks ?? []).map((attack) => attack.cooldown),
      attackUses: (base.attacks ?? []).map(() => 0),
      behaviorMovementLockTimer: 0,
      behaviorInvulnerableTimer: 0,
      behaviorSpeedFactor: 1,
      behaviorDamageFactor: 1,
      behaviorRuleUses: (base.behaviorRules ?? []).map(() => 0),
      behaviorRuleCooldowns: (base.behaviorRules ?? []).map(() => 0),
      behaviorActionQueue: [],
      behaviorEffects: [],
      abilityRuntime: createEnemyAbilityRuntime(abilities, { hp: effectiveHp, maxHp: effectiveHp }),
    });
    this.callbacks.onSimulationEvent?.({ kind: summoned ? "summon" : "spawn", entityId: id, position: this.pathForIndex(pathIndex).sample(pathDistance).point });
  }

  private updateControlledMecha(delta: number): void {
    for (const tower of this.towers) {
      if (tower.kind !== "mecha" || tower.mechaControlled !== true || tower.hp <= 0) continue;
      const input = this.mechaInputs.get(tower.id);
      if (!input) {
        tower.mechaFiring = false;
        tower.mechaSpeed = 0;
        continue;
      }
      if (input.remote) input.age += delta;
      const stale = input.remote && input.age > MECHA_INPUT_STALE_SECONDS;
      const inhibited = stale || tower.stunTimer > 0 || input.brake === true;
      const moveX = inhibited ? 0 : input.moveX;
      const moveY = inhibited ? 0 : input.moveY;
      tower.mechaFiring = inhibited ? false : input.firing;
      const control = TOWER_DEFINITIONS.mecha.control!;
      const bounds = mapWorldBounds(this.map.mapScale);
      advanceTankMotion(tower, moveX, moveY, delta, control, bounds, inhibited);
      this.updateMechaPathState(tower);
    }
  }

  private updateMechaPathState(tower: Tower): void {
    const candidates = this.paths.map((path, pathIndex) => ({ path, pathIndex, projected: path.closest(tower.position) }));
    const nearest = candidates.sort((left, right) => left.projected.offset - right.projected.offset)[0];
    if (!nearest) return;
    const routeWidth = this.map.paths[nearest.pathIndex]?.width ?? PATH_HALF_WIDTH * 2;
    const nextOnPath = nearest.projected.offset <= routeWidth / 2;
    const previousPathIndex = this.resolvePathIndex(tower.pathIndex);
    const pathChanged = nextOnPath && tower.onPath && previousPathIndex !== nearest.pathIndex;
    if ((tower.onPath && !nextOnPath) || pathChanged) this.releaseTowerEnemies(tower);
    tower.onPath = nextOnPath;
    tower.pathIndex = nearest.pathIndex;
    tower.pathDistance = nearest.projected.distance;
    tower.maxAggro = nextOnPath ? this.towerAggroLimit(tower, true) : 0;
    if (!nextOnPath) tower.autoCounter = false;
    // Enemy positions stay on their route when blocked; never use the moving
    // chassis as their position, or a distant engagement can never break.
    for (const enemyId of tower.engaged) {
      const enemy = this.enemies.find((candidate) => candidate.id === enemyId);
      if (!enemy || enemy.targetTowerId !== tower.id) {
        tower.engaged.delete(enemyId);
      } else if (!this.withinMechaEngagementRange(tower, enemy)) {
        enemy.targetTowerId = null;
        enemy.attackTimer = enemy.attackInterval;
        tower.engaged.delete(enemyId);
      }
    }
  }

  private withinMechaEngagementRange(tower: Tower, enemy: Enemy): boolean {
    if (!tower.onPath || tower.hp <= 0) return false;
    const range = TOWER_DEFINITIONS.mecha.control!.engagementRange + getEnemyDefinition(enemy.kind).radius;
    const samePath = this.resolvePathIndex(tower.pathIndex) === this.resolvePathIndex(enemy.pathIndex);
    if (samePath && Math.abs(tower.pathDistance - enemy.pathDistance) > range) return false;
    return distance(tower.position, this.pathForIndex(enemy.pathIndex).sample(enemy.pathDistance).point) <= range;
  }

  private enemyAbilityTarget(tower: Tower): EnemyAbilityEngineTarget {
    return {
      id: tower.id,
      position: { ...tower.position },
      hp: tower.hp,
      maxHp: tower.maxHp,
      stunned: tower.stunTimer > 0,
      pathDistance: tower.pathDistance,
    };
  }

  private enemyAbilitySource(enemy: Enemy): EnemyAbilityEngineSource {
    const sample = this.pathForIndex(enemy.pathIndex).sample(enemy.pathDistance);
    const selected = enemy.targetTowerId === null ? null : this.towers.find((tower) => tower.id === enemy.targetTowerId && tower.hp > 0) ?? null;
    return {
      id: enemy.id,
      kind: enemy.kind,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      age: enemy.aliveTime,
      pathDistance: enemy.pathDistance,
      blocked: selected !== null,
      position: { ...sample.point },
      direction: { ...sample.direction },
      selectedTarget: selected ? this.enemyAbilityTarget(selected) : null,
    };
  }

  private enemyAbilityAdapter(enemy: Enemy, definition: EnemyDefinition, delta: number): EnemyAbilityWorldAdapter {
    return {
      readSource: () => this.enemies.includes(enemy) ? this.enemyAbilitySource(enemy) : null,
      enumerateTargets: () => this.towers.filter((tower) => tower.hp > 0).map((tower) => this.enemyAbilityTarget(tower)),
      isKnownEnemyKind: (kind) => isKnownEnemyKind(kind),
      damageTarget: (targetId, amount) => {
        const tower = this.towers.find((candidate) => candidate.id === targetId && candidate.hp > 0);
        if (!tower) return false;
        this.damageTowerFromEnemy(enemy, tower, amount * enemy.behaviorDamageFactor);
        return true;
      },
      stunTarget: (targetId, duration) => {
        const tower = this.towers.find((candidate) => candidate.id === targetId && candidate.hp > 0);
        if (!tower) return false;
        tower.stunTimer = Math.max(tower.stunTimer, duration);
        return true;
      },
      summon: (kind, modifiers, offset) => {
        if (!isKnownEnemyKind(kind)) return;
        const childModifiers = combineSummonModifiers(enemy.summonModifiers, modifiers);
        this.spawnEnemy(kind, getEnemyDefinition(kind).hp, Math.max(0, enemy.pathDistance - 20 - offset * 14), this.resolvePathIndex(enemy.pathIndex), childModifiers, true);
      },
      healSource: (amount) => {
        if (!this.enemies.includes(enemy) || enemy.hp <= 0) return 0;
        const healing = Math.min(enemy.maxHp - enemy.hp, Math.max(0, amount));
        enemy.hp += healing;
        if (healing > 0 && enemy.regenerationVfxTimer <= 0) {
          this.spawnText(this.enemyPosition(enemy), `+${Math.max(1, Math.ceil(healing))} HP`, definition.sprite.accent);
          enemy.regenerationVfxTimer = 1;
        }
        return healing;
      },
      blinkSource: (amount) => {
        if (enemy.targetTowerId !== null) {
          this.towers.find((tower) => tower.id === enemy.targetTowerId)?.engaged.delete(enemy.id);
          enemy.targetTowerId = null;
          enemy.attackTimer = enemy.attackInterval;
        }
        const path = this.pathForIndex(enemy.pathIndex);
        enemy.pathDistance = Math.min(path.totalLength, enemy.pathDistance + amount);
        if (enemy.pathDistance >= path.totalLength) this.breach(enemy);
      },
      hasteNearby: (radius, duration, multiplier) => {
        const origin = this.enemyPosition(enemy);
        const recipients = this.enemies.filter((candidate) => candidate.hp > 0 && distance(origin, this.enemyPosition(candidate)) <= radius);
        recipients.forEach((candidate) => {
          if (candidate.hasteTimer <= 0 || multiplier > candidate.hasteFactor) candidate.hasteFactor = multiplier;
          candidate.hasteTimer = Math.max(candidate.hasteTimer, duration);
        });
        return recipients.length;
      },
      projectSourceState: (state) => {
        enemy.behaviorMovementLockTimer = state.movementLocked ? Math.max(delta * 2, 1 / 30) : 0;
        enemy.behaviorInvulnerableTimer = state.invulnerable ? Math.max(delta * 2, 1 / 30) : 0;
        enemy.phaseTimer = state.phased ? Math.max(delta * 2, 1 / 30) : 0;
        enemy.behaviorSpeedFactor = clamp(state.speedMultiplier, 0, 10);
        enemy.behaviorDamageFactor = clamp(state.damageMultiplier, 0, 10);
        enemy.lockTriggered = state.movementLocked;
        enemy.lockTimeRemaining = state.movementLocked ? Math.max(delta * 2, 1 / 30) : 0;
        enemy.lockWavesRemaining = state.movementLockWaves;
      },
      onLifecycle: (event, ability, action) => {
        if (event.code === "suppressed") return;
        const targets = event.targetIds.flatMap((id) => this.towers.find((tower) => tower.id === id) ?? []);
        if (event.phase === "telegraph" && ability.attack) this.presentEnemyAbilityVisual(enemy, ability, targets);
        if (event.phase === "action") {
          if (action?.type === "blink") this.spawnText(this.enemyPosition(enemy), `BLINK +${Math.round(action.distance)}`, definition.sprite.accent);
          else if (action?.type === "phase") this.spawnText(this.enemyPosition(enemy), "PHASE", definition.sprite.accent);
          else if (action?.type === "summon") this.spawnText(this.enemyPosition(enemy), "SUMMON", definition.sprite.accent);
          const position = this.enemyPosition(enemy);
          if (action?.type === "haste") this.callbacks.onSimulationEvent?.({ kind: "haste-pulse", entityId: enemy.id, position, color: definition.sprite.accent, value: action.radius, speed: action.multiplier, duration: action.duration, abilityId: ability.id, actionId: action.id, phase: event.phase });
          else if (action?.type === "drain") this.callbacks.onSimulationEvent?.({ kind: "drain", entityId: enemy.id, position, color: definition.sprite.accent, value: ability.attack?.range, count: event.targetIds.length, abilityId: ability.id, actionId: action.id, phase: event.phase });
          else if (action?.type === "phase") this.callbacks.onSimulationEvent?.({ kind: "phase", entityId: enemy.id, position, color: definition.sprite.accent, value: definition.radius + 26, duration: action.duration, abilityId: ability.id, actionId: action.id, phase: event.phase });
          else if (action?.type === "blink") this.callbacks.onSimulationEvent?.({ kind: "blink", entityId: enemy.id, from: event.position, position, color: definition.sprite.accent, value: action.distance, abilityId: ability.id, actionId: action.id, phase: event.phase });
          else if (action?.type === "stun" && ability.attack?.delivery.type === "radial") this.callbacks.onSimulationEvent?.({ kind: "shockwave", entityId: enemy.id, position, color: definition.sprite.accent, value: ability.attack.delivery.radius, duration: action.duration, abilityId: ability.id, actionId: action.id, phase: event.phase });
          else if (action && ["movement-lock", "invulnerability", "regeneration", "stat-change"].includes(action.type)) this.callbacks.onSimulationEvent?.({ kind: "behavior", entityId: enemy.id, position, color: definition.sprite.accent, label: action.type, abilityId: ability.id, actionId: action.id, phase: event.phase });
        }
        if (event.phase === "impact" && ability.attack && action && (action.type === "damage" || action.type === "stun" || action.type === "drain")) {
          this.callbacks.onSimulationEvent?.({ kind: "attack", entityId: enemy.id, targetId: event.targetIds[0], position: { ...event.position }, from: { ...event.position }, color: ability.attack.visuals[0]?.color ?? definition.sprite.accent, value: ability.attack.range, count: event.targetIds.length, label: ability.id, abilityId: ability.id, actionId: action.id, phase: event.phase });
        }
        this.callbacks.onSimulationEvent?.({
          kind: "ability",
          entityId: enemy.id,
          targetId: event.targetIds[0],
          position: { ...event.position },
          color: definition.sprite.accent,
          label: ability.name,
          abilityId: event.abilityId,
          actionId: event.actionId,
          phase: event.phase,
        });
      },
    };
  }

  private updateEnemyAbilities(enemy: Enemy, definition: EnemyDefinition, abilities: readonly EnemyAbilityDefinition[], delta: number): void {
    enemy.aliveTime += delta;
    enemy.abilityRuntime ??= createEnemyAbilityRuntime(abilities, { hp: enemy.hp, maxHp: enemy.maxHp });
    this.enemyAbilityEngine.step(this.enemyAbilityTick, delta, abilities, enemy.abilityRuntime, this.enemyAbilityAdapter(enemy, definition, delta));
  }

  private presentEnemyAbilityVisual(enemy: Enemy, ability: EnemyAbilityDefinition, targets: readonly Tower[]): void {
    if (!ability.attack) return;
    const attack: EnemyAttackDefinition = {
      id: ability.id,
      name: ability.name,
      cooldown: ability.cooldown,
      maxUses: ability.maxUses,
      minHp: null,
      maxHp: null,
      minAliveTime: null,
      maxAliveTime: null,
      targeting: ability.attack.targeting,
      range: ability.attack.range,
      maxTargets: ability.attack.maxTargets,
      delivery: ability.attack.delivery.type === "wave" ? "wave" : ability.attack.delivery.type === "cone" ? "forward" : "ranged",
      width: ability.attack.delivery.type === "wave" ? ability.attack.delivery.width : ability.attack.delivery.type === "radial" ? ability.attack.delivery.radius * 2 : 60,
      depth: ability.attack.delivery.type === "wave" || ability.attack.delivery.type === "cone" ? ability.attack.delivery.depth : ability.attack.range,
      angle: ability.attack.delivery.type === "cone" ? ability.attack.delivery.angle : 60,
      projectileSpeed: ability.attack.visuals.find((visual) => visual.type === "projectile")?.speed ?? 360,
      effects: [],
      visuals: ability.attack.visuals.map(({ id: _id, startOffset: _startOffset, ...visual }) => visual),
    };
    this.presentEnemyAttackVisual(enemy, attack, [...targets], ability.attack.visuals.map((visual) => visual.startOffset));
  }

  private advanceEnemyWaveLocks(): void {
    this.enemies.forEach((enemy) => {
      advanceEnemyAbilityWaveLocks(enemy.abilityRuntime);
      if (!enemy.lockTriggered || enemy.lockWavesRemaining <= 0) return;
      enemy.lockWavesRemaining = Math.max(0, enemy.lockWavesRemaining - 1);
    });
  }

  private updateEnemyMovementLock(enemy: Enemy, definition: EnemyDefinition, delta: number): void {
    if (!enemy.lockTriggered) {
      const configuredDistances = [definition.timeLock?.distance, definition.waveLock?.distance]
        .filter((value): value is number => value !== undefined);
      const triggerDistance = configuredDistances.length > 0 ? Math.max(...configuredDistances) : undefined;
      if (triggerDistance !== undefined && enemy.pathDistance >= triggerDistance) {
        enemy.lockTriggered = true;
        enemy.lockTimeRemaining = definition.timeLock?.duration ?? 0;
        enemy.lockWavesRemaining = definition.waveLock?.waves ?? 0;
        this.callbacks.onSimulationEvent?.({
          kind: "ability",
          entityId: enemy.id,
          position: this.enemyPosition(enemy),
          label: "movement-lock",
          value: enemy.lockTimeRemaining,
          count: enemy.lockWavesRemaining,
        });
      }
    }
    if (enemy.lockTriggered) enemy.lockTimeRemaining = Math.max(0, enemy.lockTimeRemaining - delta);
  }

  private enemyMovementLocked(enemy: Enemy): boolean {
    return enemy.lockTriggered && (enemy.lockTimeRemaining > 0 || enemy.lockWavesRemaining > 0);
  }

  private updateEnemies(delta: number): void {
    this.enemyAbilityTickAccumulator += delta * 30;
    this.enemyAbilityTick = Math.floor(this.enemyAbilityTickAccumulator + 1e-9);
    this.enemyAbilityEngine.advanceDetached(this.enemyAbilityTick);
    for (const enemy of this.enemies) {
      const definition = getEnemyDefinition(enemy.kind);
      const abilities = normalizeEnemyAbilities(definition);
      const usesAbilityEngine = abilities.length > 0;
      enemy.spawnScale = Math.min(1, enemy.spawnScale + delta * 4);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta * 5);
      enemy.stunTimer = Math.max(0, enemy.stunTimer - delta);
      enemy.regenerationVfxTimer -= delta;
      enemy.hasteCooldown = Math.max(0, enemy.hasteCooldown - delta);
      enemy.drainCooldown = Math.max(0, enemy.drainCooldown - delta);
      enemy.phaseCooldown = Math.max(0, enemy.phaseCooldown - delta);
      enemy.blinkCooldown = Math.max(0, enemy.blinkCooldown - delta);
      if (!usesAbilityEngine) this.updateEnemyMovementLock(enemy, definition, delta);
      const wasHasted = enemy.hasteTimer > 0;
      enemy.hasteTimer = Math.max(0, enemy.hasteTimer - delta);
      if (wasHasted && enemy.hasteTimer <= 0) enemy.hasteFactor = 1;
      enemy.phaseTimer = Math.max(0, enemy.phaseTimer - delta);
      if (usesAbilityEngine) this.updateEnemyAbilities(enemy, definition, abilities, delta);
      else if (this.updateEnemyBehavior(enemy, definition, delta)) continue;
      if (!usesAbilityEngine && definition.regeneration && enemy.hp > 0 && enemy.hp < enemy.maxHp) {
        const healing = Math.min(enemy.maxHp - enemy.hp, definition.regeneration.rate * delta);
        enemy.hp += healing;
        if (healing > 0 && enemy.regenerationVfxTimer <= 0) {
          const position = this.enemyPosition(enemy);
          this.spawnText(position, `+${Math.max(1, Math.ceil(healing))} HP`, definition.sprite.accent);
          this.spawnRing(position, definition.sprite.accent, 0.3, 3, definition.radius + 12);
          enemy.regenerationVfxTimer = 1;
        }
      }
      if (enemy.burnTimer > 0) {
        enemy.burnTimer = Math.max(0, enemy.burnTimer - delta);
        enemy.burnTickTimer -= delta;
        if (enemy.burnTickTimer <= 0) {
          this.damageEnemy(enemy, enemy.burnDamage, BURN_EFFECT_COLOR, enemy.burnOwnerId ?? this.localPlayerId, true, undefined, "fire");
          enemy.burnTickTimer = enemy.burnTickInterval > 0 ? enemy.burnTickInterval : enemy.burnDamage >= 4 ? 0.5 : 1;
          const position = this.enemyPosition(enemy);
          this.spawnSpark(position, BURN_EFFECT_COLOR, 24);
        }
        if (enemy.hp <= 0) continue;
      } else {
        enemy.burnDamage = 0;
        enemy.burnSlowFactor = 1;
        enemy.burnTickInterval = 1;
        enemy.burnSpeedFactor = 1;
      }
      const wasSlowed = enemy.slowTimer > 0;
      enemy.slowTimer = Math.max(0, enemy.slowTimer - delta);
      if (wasSlowed && enemy.slowTimer <= 0) {
        enemy.slowFactor = 1;
        enemy.shockStacks = 0;
      }
      if (!usesAbilityEngine && definition.summon) {
        enemy.summonTimer -= delta;
        if (enemy.summonTimer <= 0) {
          for (let index = 0; index < definition.summon.count; index += 1) {
            const guaranteesFullRoster = definition.summon.count >= definition.summon.kinds.length;
            const summonKind = guaranteesFullRoster && index < definition.summon.kinds.length
              ? definition.summon.kinds[index]
              : definition.summon.kinds[Math.floor(this.simulationRandom() * definition.summon.kinds.length)];
            if (!summonKind) continue;
            const childModifiers = combineSummonModifiers(
              enemy.summonModifiers,
              definition.summon!.modifiers ?? NO_CASH_SUMMON_MODIFIERS,
            );
            this.spawnEnemy(
              summonKind,
              getEnemyDefinition(summonKind).hp,
              Math.max(0, enemy.pathDistance - 20 - index * 14),
              this.resolvePathIndex(enemy.pathIndex),
              childModifiers,
              true,
            );
          }
          enemy.summonTimer = definition.summon.interval;
          const position = this.enemyPosition(enemy);
          this.spawnRing(position, definition.sprite.accent, 0.55, 6, 54);
          this.spawnText(position, "SUMMON", definition.sprite.accent);
        }
      }
      if (!usesAbilityEngine && definition.shockwave) {
        enemy.abilityTimer -= delta;
        if (enemy.abilityTimer <= 0 && enemy.pathDistance > 80) {
          const position = this.enemyPosition(enemy);
          const victims = this.towers.filter(
            (tower) => distance(tower.position, position) <= definition.shockwave!.radius,
          );
          victims.forEach((tower) => {
            tower.stunTimer = Math.max(tower.stunTimer, definition.shockwave!.stunDuration);
          });
          this.spawnRing(position, definition.sprite.accent, 0.75, 10, definition.shockwave.radius);
          this.spawnText(position, victims.length > 0 ? `SHOCKWAVE // ${victims.length} STUNNED` : "SHOCKWAVE", definition.sprite.accent);
          this.audio.enemyShockwave();
          this.callbacks.onSimulationEvent?.({ kind: "shockwave", entityId: enemy.id, position, value: definition.shockwave.radius });
          this.shake = Math.min(1, this.shake + 0.45);
          enemy.abilityTimer = definition.shockwave.interval;
        }
      }
      if (!usesAbilityEngine && definition.hastePulse && enemy.hasteCooldown <= 0 && enemy.pathDistance > 40) {
        const position = this.enemyPosition(enemy);
        const recipients = this.enemies.filter(
          (candidate) => candidate.hp > 0 && distance(position, this.enemyPosition(candidate)) <= definition.hastePulse!.radius,
        );
        recipients.forEach((candidate) => {
          const incomingFactor = definition.hastePulse!.multiplier;
          if (candidate.hasteTimer <= 0 || incomingFactor > candidate.hasteFactor) {
            candidate.hasteFactor = incomingFactor;
            candidate.hasteTimer = definition.hastePulse!.duration;
          } else if (incomingFactor === candidate.hasteFactor) {
            candidate.hasteTimer = Math.max(candidate.hasteTimer, definition.hastePulse!.duration);
          }
        });
        this.spawnRing(position, definition.sprite.accent, 0.55, 8, definition.hastePulse.radius);
        this.spawnText(position, `HASTE x${definition.hastePulse.multiplier.toFixed(2)} // ${recipients.length}`, definition.sprite.accent);
        this.callbacks.onSimulationEvent?.({ kind: "haste-pulse", entityId: enemy.id, position, color: definition.sprite.accent, value: definition.hastePulse.radius, speed: definition.hastePulse.multiplier, count: recipients.length, duration: definition.hastePulse.duration });
        this.audio.tone(330, 0.12, 0.08, 70, "enemies");
        enemy.hasteCooldown = definition.hastePulse.interval;
      }
      if (!usesAbilityEngine && definition.drain && enemy.drainCooldown <= 0 && enemy.pathDistance > 40) {
        const position = this.enemyPosition(enemy);
        const victims = this.towers.filter(
          (tower) => tower.hp > 0 && distance(position, tower.position) <= definition.drain!.radius,
        );
        const affectedVictims = victims.filter((tower) => this.damageTowerFromEnemy(enemy, tower, definition.drain!.damage));
        const healing = Math.min(enemy.maxHp - enemy.hp, definition.drain.healingPerTower * affectedVictims.length);
        enemy.hp += healing;
        this.spawnRing(position, definition.sprite.accent, 0.65, 10, definition.drain.radius);
        this.spawnText(position, affectedVictims.length > 0 ? `SIPHON x${affectedVictims.length} // +${Math.ceil(healing)} HP` : "SIPHON // NO TARGET", definition.sprite.accent);
        this.callbacks.onSimulationEvent?.({ kind: "drain", entityId: enemy.id, position, color: definition.sprite.accent, value: definition.drain.radius, count: affectedVictims.length });
        this.audio.tone(115, 0.2, 0.1, -35, "enemies");
        enemy.drainCooldown = definition.drain.interval;
      }
      if (!usesAbilityEngine && definition.phase && enemy.phaseCooldown <= 0 && enemy.phaseTimer <= 0 && enemy.targetTowerId === null && enemy.pathDistance > 40) {
        const position = this.enemyPosition(enemy);
        enemy.phaseTimer = definition.phase.duration;
        enemy.phaseCooldown = definition.phase.interval;
        this.spawnRing(position, definition.sprite.accent, 0.4, 6, definition.radius + 26);
        this.spawnText(position, "PHASE", definition.sprite.accent);
        this.callbacks.onSimulationEvent?.({ kind: "phase", entityId: enemy.id, position, color: definition.sprite.accent, value: definition.radius + 26, duration: definition.phase.duration });
        this.audio.tone(410, 0.1, 0.07, 90, "enemies");
      }
      if (!usesAbilityEngine && definition.blink && enemy.blinkCooldown <= 0 && enemy.targetTowerId === null && enemy.pathDistance > 40) {
        const enemyPath = this.pathForIndex(enemy.pathIndex);
        const from = this.enemyPosition(enemy);
        enemy.pathDistance = Math.min(enemyPath.totalLength, enemy.pathDistance + definition.blink.distance);
        const position = this.enemyPosition(enemy);
        enemy.blinkCooldown = definition.blink.interval;
        this.spawnBeam(from, position, definition.sprite.accent, 5, 0, "#ffffff", 0.18);
        this.spawnRing(position, definition.sprite.accent, 0.35, 6, definition.radius + 22);
        this.spawnText(position, `BLINK +${Math.round(definition.blink.distance)}`, definition.sprite.accent);
        this.callbacks.onSimulationEvent?.({ kind: "blink", entityId: enemy.id, position, from, color: definition.sprite.accent, value: definition.blink.distance });
        this.audio.tone(460, 0.08, 0.08, 120, "enemies");
        if (enemy.pathDistance >= enemyPath.totalLength) {
          this.breach(enemy);
          continue;
        }
      }
      if (enemy.stunTimer > 0) continue;
      if (!usesAbilityEngine) this.updateEnemyAttacks(enemy, definition, delta);

      if (enemy.targetTowerId !== null) {
        const tower = this.towers.find((candidate) => candidate.id === enemy.targetTowerId);
        if (!tower || tower.hp <= 0) {
          enemy.targetTowerId = null;
          continue;
        }
        enemy.attackTimer -= delta;
        if (this.tryAutomaticCounter(tower, enemy, true)) continue;
        if (enemy.attackTimer <= 0) this.landEnemyAttack(enemy, tower);
        continue;
      }

      const movementScale = Math.min(
        enemy.slowTimer > 0 ? enemy.slowFactor : 1,
        enemy.burnTimer > 0 ? enemy.burnSlowFactor : 1,
      ) * (enemy.burnTimer > 0 ? enemy.burnSpeedFactor : 1);
      const hasteScale = enemy.hasteTimer > 0 ? enemy.hasteFactor : 1;
      if (enemy.behaviorMovementLockTimer > 0 || this.enemyMovementLocked(enemy)) continue;
      const previous = enemy.pathDistance;
      const next = previous + enemy.speed * movementScale * hasteScale * enemy.behaviorSpeedFactor * delta;
      const enemyPathIndex = this.resolvePathIndex(enemy.pathIndex);
      const enemyPath = this.pathForIndex(enemyPathIndex);
      const blocker = enemy.phaseTimer > 0 ? undefined : this.towers
        .filter(
          (tower) => {
            if (!tower.onPath || tower.hp <= 0 || tower.engaged.size >= tower.maxAggro) return false;
            if (tower.kind === "mecha" && !this.withinMechaEngagementRange(tower, enemy)) return false;
            const samePath = this.resolvePathIndex(tower.pathIndex) === enemyPathIndex;
            if (samePath) return tower.pathDistance >= previous - 4 && tower.pathDistance <= next + 23;
            const towerRouteWidth = this.map.paths[this.resolvePathIndex(tower.pathIndex)]?.width ?? PATH_HALF_WIDTH * 2;
            const overlapRadius = towerRouteWidth / 2 + getEnemyDefinition(enemy.kind).radius;
            const currentPosition = enemyPath.sample(previous).point;
            const nextPosition = enemyPath.sample(next).point;
            return distance(tower.position, currentPosition) <= overlapRadius || distance(tower.position, nextPosition) <= overlapRadius;
          },
        )
        .sort((a, b) => a.pathDistance - b.pathDistance)[0];
      if (blocker && blocker.engaged.size < blocker.maxAggro) {
        const samePath = this.resolvePathIndex(blocker.pathIndex) === enemyPathIndex;
        enemy.targetTowerId = blocker.id;
        // A cross-path engagement must keep the enemy on its own route; the
        // tower's path distance is only meaningful for same-route blocking.
        enemy.pathDistance = samePath ? blocker.pathDistance - 25 : previous;
        enemy.attackTimer = Math.max(enemy.telegraphDuration + 0.38, enemy.attackInterval * 0.72);
        blocker.engaged.add(enemy.id);
        signalEnemyAbility(enemy.abilityRuntime, "blocked");
        this.spawnText(blocker.position, `${blocker.engaged.size}/${blocker.maxAggro} AGGRO`, "#ff806f");
      } else {
        enemy.pathDistance = next;
      }

      if (enemy.pathDistance >= enemyPath.totalLength) this.breach(enemy);
    }
  }

  private updateEnemyBehavior(enemy: Enemy, definition: EnemyDefinition, delta: number): boolean {
    enemy.aliveTime += delta;
    enemy.behaviorMovementLockTimer = Math.max(0, enemy.behaviorMovementLockTimer - delta);
    enemy.behaviorInvulnerableTimer = Math.max(0, enemy.behaviorInvulnerableTimer - delta);
    enemy.behaviorRuleCooldowns = enemy.behaviorRuleCooldowns.map((timer) => Math.max(0, timer - delta));

    const activeEffects: Enemy["behaviorEffects"] = [];
    for (const effect of enemy.behaviorEffects) {
      const elapsed = Math.min(delta, effect.remaining);
      if (effect.type === "regenerate") {
        const healing = effect.remaining <= elapsed
          ? effect.remainingAmount
          : effect.remainingAmount * elapsed / effect.remaining;
        const applied = Math.min(enemy.maxHp - enemy.hp, healing);
        enemy.hp += applied;
        effect.remainingAmount = Math.max(0, effect.remainingAmount - healing);
      }
      effect.remaining = Math.max(0, effect.remaining - delta);
      if (effect.type === "regenerate" && effect.remaining > 0 && effect.remainingAmount > 0) activeEffects.push(effect);
      else if (effect.type === "stat-change" && effect.remaining > 0) activeEffects.push(effect);
    }
    enemy.behaviorEffects = activeEffects;
    enemy.behaviorSpeedFactor = 1;
    enemy.behaviorDamageFactor = 1;
    for (const effect of activeEffects) {
      if (effect.type !== "stat-change") continue;
      enemy.behaviorSpeedFactor = clamp(enemy.behaviorSpeedFactor * effect.speedMultiplier, 0, 10);
      enemy.behaviorDamageFactor = clamp(enemy.behaviorDamageFactor * effect.damageMultiplier, 0, 10);
    }

    const queued = enemy.behaviorActionQueue;
    enemy.behaviorActionQueue = [];
    for (const pending of queued) {
      const timer = pending.timer - delta;
      const action = definition.behaviorRules?.[pending.ruleIndex]?.actions[pending.actionIndex];
      if (!action) continue;
      if (timer > 0) enemy.behaviorActionQueue.push({ ...pending, timer });
      else if (this.executeEnemyBehaviorAction(enemy, definition, action)) return true;
    }

    const rules = definition.behaviorRules ?? [];
    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
      const rule = rules[ruleIndex]!;
      const uses = enemy.behaviorRuleUses[ruleIndex] ?? 0;
      if ((rule.maxUses > 0 && uses >= rule.maxUses) || (enemy.behaviorRuleCooldowns[ruleIndex] ?? 0) > 0) continue;
      if (rule.minHp !== null && enemy.hp < rule.minHp || rule.maxHp !== null && enemy.hp > rule.maxHp) continue;
      if (rule.minAliveTime !== null && enemy.aliveTime < rule.minAliveTime || rule.maxAliveTime !== null && enemy.aliveTime > rule.maxAliveTime) continue;
      enemy.behaviorRuleUses[ruleIndex] = uses + 1;
      enemy.behaviorRuleCooldowns[ruleIndex] = rule.cooldown;
      for (let actionIndex = 0; actionIndex < rule.actions.length; actionIndex += 1) {
        const action = rule.actions[actionIndex]!;
        if (action.delay > 0) enemy.behaviorActionQueue.push({ ruleIndex, actionIndex, timer: action.delay });
        else if (this.executeEnemyBehaviorAction(enemy, definition, action)) return true;
      }
    }
    return false;
  }

  private executeEnemyBehaviorAction(
    enemy: Enemy,
    definition: EnemyDefinition,
    action: NonNullable<EnemyDefinition["behaviorRules"]>[number]["actions"][number],
  ): boolean {
    const position = this.enemyPosition(enemy);
    if (action.type === "stop") {
      enemy.behaviorMovementLockTimer = Math.max(enemy.behaviorMovementLockTimer, action.duration);
      this.spawnText(position, `STOP // ${action.duration.toFixed(1)}S`, definition.sprite.accent);
    } else if (action.type === "invulnerable") {
      enemy.behaviorInvulnerableTimer = Math.max(enemy.behaviorInvulnerableTimer, action.duration);
      this.spawnText(position, `INVULNERABLE // ${action.duration.toFixed(1)}S`, definition.sprite.accent);
    } else if (action.type === "regenerate") {
      enemy.behaviorEffects.push({ type: "regenerate", remaining: action.duration, remainingAmount: action.amount });
      this.spawnText(position, `REGEN +${Math.round(action.amount)}`, definition.sprite.accent);
    } else if (action.type === "stat-change") {
      enemy.behaviorEffects.push({ type: "stat-change", remaining: action.duration, speedMultiplier: action.speedMultiplier, damageMultiplier: action.damageMultiplier });
      enemy.behaviorSpeedFactor = clamp(enemy.behaviorSpeedFactor * action.speedMultiplier, 0, 10);
      enemy.behaviorDamageFactor = clamp(enemy.behaviorDamageFactor * action.damageMultiplier, 0, 10);
      this.spawnText(position, `STATS // SPD x${action.speedMultiplier} DMG x${action.damageMultiplier}`, definition.sprite.accent);
    } else if (action.type === "stomp") {
      const victims = this.towers.filter((tower) => tower.hp > 0 && distance(position, tower.position) <= action.radius);
      victims.forEach((tower) => {
        if (this.damageTowerFromEnemy(enemy, tower, action.damage)) tower.stunTimer = Math.max(tower.stunTimer, action.stunDuration);
      });
      this.spawnRing(position, definition.sprite.accent, 0.75, 11, action.radius);
      this.spawnText(position, victims.length > 0 ? `STOMP // ${victims.length} HIT` : "STOMP", definition.sprite.accent);
      this.shake = Math.min(1, this.shake + 0.6);
      this.audio.enemyShockwave();
      this.callbacks.onSimulationEvent?.({ kind: "behavior", entityId: enemy.id, position, color: definition.sprite.accent, value: action.radius, count: victims.length, duration: action.stunDuration, label: action.type });
      return false;
    } else {
      const enemyPath = this.pathForIndex(enemy.pathIndex);
      const from = position;
      if (enemy.targetTowerId !== null) {
        const blocker = this.towers.find((tower) => tower.id === enemy.targetTowerId);
        blocker?.engaged.delete(enemy.id);
        enemy.targetTowerId = null;
        enemy.attackTimer = enemy.attackInterval;
      }
      enemy.pathDistance = Math.min(enemyPath.totalLength, enemy.pathDistance + action.distance);
      const destination = this.enemyPosition(enemy);
      this.spawnBeam(from, destination, definition.sprite.accent, 5, 0, "#ffffff", 0.18);
      this.spawnText(destination, `BLINK +${Math.round(action.distance)}`, definition.sprite.accent);
      this.callbacks.onSimulationEvent?.({ kind: "behavior", entityId: enemy.id, position: destination, from, color: definition.sprite.accent, value: action.distance, label: action.type });
      if (enemy.pathDistance >= enemyPath.totalLength) {
        this.breach(enemy);
        return true;
      }
    }
    if (action.type !== "blink") {
      this.spawnRing(position, definition.sprite.accent, 0.45, 7, definition.radius + 24);
      this.callbacks.onSimulationEvent?.({ kind: "behavior", entityId: enemy.id, position, color: definition.sprite.accent, duration: "duration" in action ? action.duration : undefined, value: action.type === "regenerate" ? action.amount : undefined, speed: action.type === "stat-change" ? action.speedMultiplier : undefined, label: action.type });
    }
    return false;
  }

  private enemyAttackTargets(enemy: Enemy, attack: EnemyAttackDefinition): Tower[] {
    const origin = this.enemyPosition(enemy);
    const pathSample = this.pathForIndex(enemy.pathIndex).sample(enemy.pathDistance);
    const direction = pathSample.direction;
    const candidates = this.towers.filter((tower) => {
      if (tower.hp <= 0) return false;
      const relative = { x: tower.position.x - origin.x, y: tower.position.y - origin.y };
      const forward = relative.x * direction.x + relative.y * direction.y;
      const lateral = Math.abs(relative.x * -direction.y + relative.y * direction.x);
      const range = Math.hypot(relative.x, relative.y);
      if (attack.delivery === "ranged") return range <= attack.range;
      if (attack.delivery === "wave") return forward >= 0 && forward <= attack.depth && lateral <= attack.width / 2 && range <= attack.range;
      if (forward <= 0 || forward > attack.depth || range > attack.range) return false;
      return Math.abs(Math.atan2(lateral, Math.max(0.001, forward))) <= (attack.angle * Math.PI / 180) / 2;
    });
    candidates.sort((a, b) => {
      switch (attack.targeting) {
        case "last": return a.pathDistance - b.pathDistance || a.id - b.id;
        case "strongest": return b.maxHp - a.maxHp || b.hp - a.hp || a.id - b.id;
        case "weakest": return a.hp - b.hp || a.maxHp - b.maxHp || a.id - b.id;
        case "closest": return distance(a.position, origin) - distance(b.position, origin) || a.id - b.id;
        case "first":
        default: return b.pathDistance - a.pathDistance || a.id - b.id;
      }
    });
    return candidates.slice(0, attack.maxTargets);
  }

  private presentEnemyAttackVisual(enemy: Enemy, attack: EnemyAttackDefinition, targets = this.enemyAttackTargets(enemy, attack), playbackOffsets: readonly number[] = []): void {
    const origin = this.enemyPosition(enemy);
    const pathSample = this.pathForIndex(enemy.pathIndex).sample(enemy.pathDistance);
    const forwardEndpoint = {
      x: origin.x + pathSample.direction.x * attack.depth,
      y: origin.y + pathSample.direction.y * attack.depth,
    };
    const targetPoints = targets.map((tower) => tower.position);
    attack.visuals.forEach((visual, visualIndex) => {
      const width = visual.width * visual.size;
      const playbackOffset = playbackOffsets[visualIndex] ?? visualIndex * 0.025;
      if (visual.type === "projectile") {
        targetPoints.forEach((target, targetIndex) => {
          if (this.headless) {
            this.spawnBeam(origin, target, visual.color, width, playbackOffset + targetIndex * 0.015, "#ffffff", visual.duration);
            return;
          }
          this.visualProjectiles.push({
            position: { ...origin },
            targetId: null,
            start: { ...origin },
            endpoint: { ...target },
            // Enemy projectiles are presentation-only; use a neutral render
            // kind while retaining the recipe's own color and speed.
            kind: "bandit",
            speed: Math.max(40, visual.speed || attack.projectileSpeed),
            color: visual.color,
            splash: false,
            age: 0,
            hidden: false,
            scale: Math.max(0.45, visual.size),
          });
        });
      } else if (visual.type === "beam") {
        this.spawnBeam(origin, targetPoints[0] ?? forwardEndpoint, visual.color, width, playbackOffset, "#ffffff", visual.duration);
      } else if (visual.type === "explosion") {
        this.spawnExplosion(origin, visual.color, Math.max(24, attack.width * 0.35 * visual.size), Math.max(0.2, visual.speed / 360));
      } else if (visual.type === "lightning") {
        this.spawnLightningAuraArc(origin, Math.max(24, attack.range * 0.35 * visual.size), visual.color);
      } else if (visual.type === "wave") {
        this.spawnBeam(origin, forwardEndpoint, visual.color, width, playbackOffset, "#ffffff", visual.duration);
        this.spawnRing(forwardEndpoint, visual.color, visual.duration, Math.max(3, width / 2), attack.width * visual.size);
      } else if (visual.type === "slash") {
        targetPoints.forEach((target) => this.spawnSlash(origin, target, visual.color, attack.depth * visual.size, 0.45, playbackOffset, undefined, visual.duration));
      }
    });
  }

  private updateEnemyAttacks(enemy: Enemy, definition: EnemyDefinition, delta: number): void {
    const attacks = definition.attacks ?? [];
    attacks.forEach((attack, attackIndex) => {
      enemy.attackCooldowns[attackIndex] = Math.max(0, (enemy.attackCooldowns[attackIndex] ?? attack.cooldown) - delta);
      const uses = enemy.attackUses[attackIndex] ?? 0;
      if (enemy.attackCooldowns[attackIndex] > 0 || (attack.maxUses > 0 && uses >= attack.maxUses)) return;
      if (attack.minHp !== null && enemy.hp < attack.minHp || attack.maxHp !== null && enemy.hp > attack.maxHp) return;
      if (attack.minAliveTime !== null && enemy.aliveTime < attack.minAliveTime || attack.maxAliveTime !== null && enemy.aliveTime > attack.maxAliveTime) return;
      const targets = this.enemyAttackTargets(enemy, attack);
      if (targets.length === 0) return;
      targets.forEach((tower) => {
        if (this.tryAutomaticCounter(tower, enemy, false)) return;
        attack.effects.forEach((effect) => {
          if (effect.type === "damage") this.damageTowerFromEnemy(enemy, tower, effect.amount * enemy.behaviorDamageFactor, false);
          else tower.stunTimer = Math.max(tower.stunTimer, effect.duration);
        });
      });
      enemy.attackCooldowns[attackIndex] = attack.cooldown;
      enemy.attackUses[attackIndex] = uses + 1;
      this.presentEnemyAttackVisual(enemy, attack, targets);
      this.audio.hit();
      this.shake = Math.min(1, this.shake + 0.24);
      this.callbacks.onSimulationEvent?.({
        kind: "attack",
        entityId: enemy.id,
        targetId: targets[0]?.id,
        position: { ...this.enemyPosition(enemy) },
        from: { ...this.enemyPosition(enemy) },
        visual: attack.visuals.some((visual) => visual.type === "projectile") ? "projectile" : "hitscan",
        speed: attack.visuals.find((visual) => visual.type === "projectile")?.speed ?? attack.projectileSpeed,
        color: attack.visuals[0]?.color ?? definition.sprite.accent,
        value: attack.range,
        count: targets.length,
        duration: Math.max(...attack.visuals.map((visual) => visual.duration)),
        label: attack.id,
      });
    });
  }

  private tryAutomaticCounter(tower: Tower, enemy: Enemy, requireCounterWindow: boolean): boolean {
    if (!tower.autoCounter || !tower.onPath || tower.hp <= 0 || tower.stunTimer > 0 || tower.counterCooldown > 0 || tower.kind === "mecha" && tower.mechaControlled !== true) return false;
    if (requireCounterWindow && (enemy.targetTowerId !== tower.id || enemy.attackTimer > enemy.telegraphDuration || enemy.attackTimer > COMBAT_RULES.counterWindow)) return false;
    const attackers = this.incomingCounterAttackers(tower, [enemy]);
    return attackers.length > 0 && this.performCounter(tower, attackers);
  }

  private damageTowerFromEnemy(enemy: Enemy, tower: Tower, amount: number, allowAutomaticCounter = true): boolean {
    if (tower.hp <= 0) return false;
    if (allowAutomaticCounter && this.tryAutomaticCounter(tower, enemy, false)) return false;
    let incomingDamage = Math.max(0, amount);
    if (tower.fortifyCharges > 0) {
      incomingDamage *= 0.5;
      tower.fortifyCharges -= 1;
      this.spawnText(tower.position, "FORTIFIED", TOWER_DEFINITIONS[tower.kind].accent);
    }
    tower.hp -= Math.round(incomingDamage);
    tower.hurtFlash = 0.38;
    this.callbacks.onSimulationEvent?.({ kind: "impact", entityId: enemy.id, targetId: tower.id, position: { ...tower.position }, value: incomingDamage });
    if (tower.hp <= 0) this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].onPath.title} shattered under hostile pressure.`, "danger");
    return true;
  }

  /** Rebuild a local Tank pose from the latest authoritative checkpoint plus unacknowledged intent. */
  private reconcilePredictedTank(tower: Tower, previous: Tower | undefined, acknowledgements: readonly MultiplayerPilotInputAck[]): void {
    const acknowledgement = acknowledgements.find((ack) => ack.playerId === this.localPlayerId && ack.towerId === tower.id);
    const pending = this.pendingPilotInputs.get(tower.id) ?? [];
    if (acknowledgement) {
      const acknowledged = pending.filter((entry) => entry.input.sequence <= acknowledgement.sequence);
      if (acknowledged.length > 0) {
        this.pilotInputsAcknowledged += acknowledged.length;
        this.pilotInputAckDelayMs = Math.max(0, this.now() - acknowledged[acknowledged.length - 1]!.sentAt);
      }
      const remaining = pending.filter((entry) => entry.input.sequence > acknowledgement.sequence);
      if (remaining.length > 0) this.pendingPilotInputs.set(tower.id, remaining);
      else this.pendingPilotInputs.delete(tower.id);
    }
    const remaining = this.pendingPilotInputs.get(tower.id) ?? [];
    const liveInput = this.mechaInputs.get(tower.id);
    if (liveInput) {
      tower.aimPoint = { ...liveInput.aim };
      tower.mechaFiring = liveInput.firing;
    }
    const replay = { ...tower, position: { ...tower.position }, aimPoint: tower.aimPoint ? { ...tower.aimPoint } : tower.aimPoint };
    const bounds = mapWorldBounds(this.map.mapScale);
    const control = TOWER_DEFINITIONS.mecha.control!;
    const now = this.now();
    remaining.forEach((entry, index) => {
      const nextAt = index + 1 < remaining.length ? remaining[index + 1]!.sentAt : now;
      const duration = Math.min(0.12, Math.max(0, (nextAt - entry.sentAt) / 1_000));
      replay.aimPoint = { ...entry.input.aim };
      replay.mechaFiring = entry.input.firing;
      advanceTankMotion(replay, entry.input.moveX, entry.input.moveY, duration, control, bounds, entry.input.brake === true || replay.stunTimer > 0);
    });
    const target = { position: { ...replay.position }, mechaHullAngle: replay.mechaHullAngle, mechaTurretAngle: replay.mechaTurretAngle };
    this.mirrorTankPoses.set(tower.id, target);
    if (!previous) return;
    const correction = distance(previous.position, target.position);
    this.pilotCorrection = correction;
    if (correction > 200 || tower.stunTimer > 0) {
      tower.position = target.position;
      tower.mechaHullAngle = target.mechaHullAngle;
      tower.mechaTurretAngle = target.mechaTurretAngle;
      this.pilotCorrectionSnaps += 1;
      return;
    }
    // Preserve the immediately predicted render pose, then blend it toward the
    // replayed authoritative target in updateMirror.
    tower.position = { ...previous.position };
    tower.mechaHullAngle = previous.mechaHullAngle;
    tower.mechaTurretAngle = previous.mechaTurretAngle;
  }

  private landEnemyAttack(enemy: Enemy, tower: Tower): void {
    const incomingDamage = enemy.damage * enemy.behaviorDamageFactor;
    this.damageTowerFromEnemy(enemy, tower, incomingDamage, false);
    signalEnemyAbility(enemy.abilityRuntime, "attack");
    enemy.attackTimer = enemy.attackInterval;
    this.shake = Math.min(1, this.shake + 0.18);
    this.audio.hit();
    const target = tower.position;
    if (!this.headless) for (let index = 0; index < 6; index += 1) this.spawnSpark(target, "#ff665c", 70 + Math.random() * 80);
    if (tower.hp <= 0) {
      this.audio.breach("tower");
    }
  }

  private breach(enemy: Enemy): void {
    enemy.hp = -9999;
    const damage = enemy.coreDamage;
    this.integrity = Math.max(0, this.integrity - damage);
    this.shake = 1;
    this.audio.breach("core");
    this.callbacks.onLog(`CORE BREACH // -${damage} integrity.`, "danger");
    const base = this.map.paths[this.resolvePathIndex(enemy.pathIndex)]?.core ?? this.map.core;
    this.spawnText(base, `-${damage} BASE`, "#ff625d");
    if (this.integrity <= 0 && !this.gameOver) {
      this.gameOver = true;
      this.waveActive = false;
      this.audio.stopZenithCharges();
      this.audio.stopAmbience();
      this.audio.defeat();
      this.callbacks.onGameOver(this.waveNumber);
    }
  }

  private removeDestroyedTowers(): void {
    const destroyed = this.towers.filter((tower) => tower.hp <= 0);
    if (destroyed.length === 0) return;
    destroyed.forEach((tower) => {
      this.releaseTowerEnemies(tower);
      const totalRefund = Math.floor(tower.totalInvested * ECONOMY_RULES.casualtyRefundRate);
      const immediateRefund = Math.ceil(totalRefund / 2);
      const deferredRefund = totalRefund - immediateRefund;
      const runtime = this.runtimeFor(tower.ownerId);
      runtime.shards += immediateRefund;
      runtime.pendingCasualtyRefund += deferredRefund;
      this.spawnText(tower.position, `+$${immediateRefund} // +$${deferredRefund} PENDING`, "#f1d07a");
      this.callbacks.onLog(
        `${TOWER_DEFINITIONS[tower.kind].name} casualty recovery // +$${immediateRefund} now, +$${deferredRefund} next wave.`,
        "good",
      );
    });
    const destroyedIds = new Set(destroyed.map((tower) => tower.id));
    if (this.selectedTower?.kind === "mecha" && destroyedIds.has(this.selectedTower.id)) this.releaseMechaInput();
    this.towers = this.towers.filter((tower) => !destroyedIds.has(tower.id));
    destroyed.forEach((tower) => this.mechaInputs.delete(tower.id));
    if (destroyed.some((tower) => tower.kind === "mecha")) this.mechaKeys.clear();
    this.timedBombs = this.timedBombs.filter((bomb) => bomb.label === "mecha-missile" || bomb.sourceTowerId === undefined || !destroyedIds.has(bomb.sourceTowerId));
    this.admiralShots = this.admiralShots.filter((shot) => !destroyedIds.has(shot.towerId));
    if (this.selectedTowerId !== null && destroyedIds.has(this.selectedTowerId)) this.selectedTowerId = null;
    if (this.relocatingTowerId !== null && destroyedIds.has(this.relocatingTowerId)) {
      this.relocatingTowerId = null;
      this.placement = null;
    }
  }

  private releaseTowerEnemies(tower: Tower): void {
    tower.engaged.forEach((enemyId) => {
      const enemy = this.enemies.find((candidate) => candidate.id === enemyId);
      if (enemy) {
        enemy.targetTowerId = null;
        // A moving blocker must not teleport its pursuers forward on release.
        if (tower.kind !== "mecha") enemy.pathDistance = Math.max(enemy.pathDistance, tower.pathDistance + 10);
        enemy.attackTimer = enemy.attackInterval;
      }
    });
    tower.engaged.clear();
  }

  private invokeTowerArrivalBehavior(tower: Tower): void {
    const behavior = getTowerBehavior(tower.kind);
    if (!behavior?.onArrival) return;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const stats = this.towerStats(tower);
    const range = stats.range * RANGE_SCALE;
    const candidates = this.enemies.filter(
      (enemy) =>
        enemy.hp > 0 &&
        this.canTowerTarget(tower, enemy) &&
        distance(tower.position, this.enemyPosition(enemy)) <= range,
    );
    behavior.onArrival({
      tower,
      candidates,
      damage: stats.damage * tower.damageBuff,
      range,
      damageEnemy: (enemy, amount, damageType) => this.damageEnemy(enemy, amount, definition.accent, tower.ownerId, false, tower.id, damageType ?? definition.damageType ?? "bullet"),
      emitSlashVisual: (to, reach, halfAngle) => this.emitSlashVisual(
        tower.position,
        to,
        definition.accent,
        reach,
        halfAngle,
        tower.kind,
      ),
      spawnRing: (life, size, radius) => this.spawnRing(tower.position, "#ffffff", life, size, radius),
      spawnText: (text) => this.spawnText(tower.position, text, definition.accent),
      playAttackSound: () => this.audio.shoot(175, tower.kind),
    });
  }

  private cancelZenithCharge(tower: Tower): void {
    if ((tower.zenithChargeTimer ?? 0) <= 0) return;
    tower.zenithChargeTimer = 0;
    tower.zenithChargeTargetId = null;
    tower.zenithChargeAngle = undefined;
    tower.fireTimer = ZENITH_CANCEL_COOLDOWN;
    this.callbacks.onSimulationEvent?.({ kind: "charge", entityId: tower.id, position: { ...tower.position }, label: "cancel" });
    this.audio.zenithCharge(tower.id, false);
  }

  private updateTowers(delta: number): void {
    for (const tower of this.towers) {
      const towerBehavior = getTowerBehavior(tower.kind);
      const definition = TOWER_DEFINITIONS[tower.kind];
      const stats = this.towerStats(tower);
      tower.fireTimer -= delta;
      tower.counterCooldown = Math.max(0, tower.counterCooldown - delta);
      this.updateDamageBuff(tower, delta);
        const stanceWasActive = tower.abilityTimer > 0;
        const activeAbility = getTowerAbilityWithPerks(definition, tower.perks, "f");
        tower.abilityTimer = Math.max(0, tower.abilityTimer - delta);
      const cooldownPaused = Boolean(towerBehavior?.pauseAbilityCooldownWhileActive && stanceWasActive);
      if (stanceWasActive && tower.abilityTimer <= 0 && cooldownPaused) {
        tower.abilityCooldown = Math.max(tower.abilityCooldown, activeAbility?.cooldown ?? 0);
        if (tower.abilityCooldowns) tower.abilityCooldowns.f = tower.abilityCooldown;
      } else if (!cooldownPaused) {
        const fCooldown = Math.max(0, (tower.abilityCooldowns?.f ?? tower.abilityCooldown) - delta);
        tower.abilityCooldown = fCooldown;
        if (tower.abilityCooldowns) tower.abilityCooldowns.f = fCooldown;
        if (tower.abilityCooldowns) {
          Object.keys(tower.abilityCooldowns).forEach((key) => {
            const slot = key as TowerAbilitySlot;
            if (slot === "f") return;
            tower.abilityCooldowns![slot] = Math.max(0, (tower.abilityCooldowns![slot] ?? 0) - delta);
          });
        }
      }
      tower.meleeTimer -= delta;
      tower.idleTimer += delta;
      const damage = stats.damage * tower.damageBuff;
      const range = stats.range * RANGE_SCALE;
      // Build the shared attack context before behavior updates so controlled
      // towers can perform fixed-tick channels without duplicating Game state.
      const candidates = this.enemies.filter(
        (enemy) =>
          enemy.hp > 0 &&
          this.canTowerTarget(tower, enemy) &&
          distance(tower.position, this.enemyPosition(enemy)) <= range,
      );
      const towerBehaviorContext = this.towerAttackBehaviorContext(tower, candidates, damage, stats.fireRate, delta);
      towerBehavior?.update?.({
        tower,
        delta,
        attackContext: towerBehaviorContext,
        stanceWasActive,
        refreshDamageBuff: () => this.refreshDamageBuff(tower),
        nearbyTowers: this.towers.filter((candidate) => distance(candidate.position, tower.position) <= stats.range * RANGE_SCALE),
        applyDamageBuff: (candidate, multiplier, duration) => this.applyDamageBuff(candidate, multiplier, duration),
        spawnText: (text, color = definition.accent) => this.spawnText(tower.position, text, color),
        spawnRing: (life, size, radius, color = definition.accent) => this.spawnRing(tower.position, color, life, size, radius),
        healTower: (amount, text, color = definition.accent) => {
          tower.hp = Math.min(tower.maxHp, tower.hp + amount);
          this.spawnText(tower.position, text, color);
          this.spawnRing(tower.position, color, 0.38, 3, 36);
        },
        emitSimulationEvent: (event) => this.emitTowerBehaviorEvent(tower, event),
      });
      tower.counterFlash = Math.max(0, tower.counterFlash - delta * 1.4);
      tower.hurtFlash = Math.max(0, tower.hurtFlash - delta * 3);
      tower.selectedPulse = Math.max(0, tower.selectedPulse - delta);
      tower.stunTimer = Math.max(0, tower.stunTimer - delta);
      if (tower.stunTimer > 0) {
        if ((tower.zenithChargeTimer ?? 0) > 0) this.cancelZenithCharge(tower);
        continue;
      }

      if (towerBehavior?.beforeAttack && towerBehaviorContext) {
        if (towerBehavior.beforeAttack(towerBehaviorContext)) continue;
      }

      if (tower.fireTimer > 0) continue;
      const targetCandidates = towerBehavior?.filterTargets?.(tower, candidates) ?? candidates;
      const target = this.selectTarget(tower, targetCandidates);
      if (!target) continue;

      if (towerBehavior?.attack && towerBehaviorContext) {
        towerBehavior.attack(towerBehaviorContext, target);
        continue;
      }

    }
  }

  private enemiesInLine(tower: Tower, target: Enemy, range: number, beamWidth: number): Enemy[] {
    const targetPosition = this.enemyPosition(target);
    return this.enemiesInLineFrom(tower, tower.position, targetPosition, range, beamWidth);
  }

  private enemiesInLineFrom(tower: Tower, origin: Point, aim: Point, range: number, beamWidth: number): Enemy[] {
    const angle = Math.atan2(aim.y - origin.y, aim.x - origin.x);
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    return this.enemies
      .map((enemy) => {
        const position = this.enemyPosition(enemy);
        const relative = { x: position.x - origin.x, y: position.y - origin.y };
        return {
          enemy,
          forward: relative.x * direction.x + relative.y * direction.y,
          sideways: Math.abs(relative.x * direction.y - relative.y * direction.x),
        };
      })
      .filter(
        ({ enemy, forward, sideways }) =>
          enemy.hp > 0 &&
          this.canTowerTarget(tower, enemy) &&
          forward >= 0 &&
          forward <= range &&
          sideways <= beamWidth + getEnemyDefinition(enemy.kind).radius * 0.35,
      )
      .sort((left, right) => left.forward - right.forward || left.enemy.id - right.enemy.id)
      .map(({ enemy }) => enemy);
  }

  private emitZenithLanceVisual(tower: Tower, target: Enemy, range: number, beamVisualWidth: number, beamLife: number): void {
    const targetPosition = this.enemyPosition(target);
    const angle = Math.atan2(targetPosition.y - tower.position.y, targetPosition.x - tower.position.x);
    const endpoint = {
      x: tower.position.x + Math.cos(angle) * range,
      y: tower.position.y + Math.sin(angle) * range,
    };
    const coreLife = Math.min(0.24, beamLife * 0.8);
    const accent = TOWER_DEFINITIONS[tower.kind].accent;
    this.spawnBeam(tower.position, endpoint, accent, beamVisualWidth, 0, "#ffffff", beamLife);
    this.spawnBeam(tower.position, endpoint, "#ffffff", 2.4, 0.02, undefined, coreLife);
    this.spawnMuzzleFlash(tower.position, endpoint, accent, 34);
    this.callbacks.onSimulationEvent?.({
      kind: "attack",
      position: endpoint,
      from: { ...tower.position },
      color: accent,
      label: tower.kind,
      visual: "hitscan",
      value: beamVisualWidth,
      duration: beamLife,
      entityId: tower.id,
    });
  }

  private fireRateCooldown(tower: Tower, baseCooldown: number): number {
    return baseCooldown * getTowerPerkAttackIntervalMultiplier(tower) / (1 + tower.fireRateBuff);
  }

  private burstSpacingCooldown(tower: Tower, baseSpacing: number): number {
    return baseSpacing / (1 + tower.fireRateBuff * 0.25);
  }

  private startField(tower: Tower, duration: number, radius: number, eventLabel: string, text: string): void {
    tower.fieldTimer += duration;
    tower.fieldTickTimer = Math.min(tower.fieldTickTimer, 0.15);
    tower.fieldVfxTimer = Math.min(tower.fieldVfxTimer, 0.03);
    const color = TOWER_DEFINITIONS[tower.kind].accent;
    this.spawnRing(tower.position, color, 0.65, 9, radius);
    this.spawnText(tower.position, text, color);
    this.audio.towerEffect("tempest-field");
    this.callbacks.onSimulationEvent?.({
      kind: "ability",
      entityId: tower.id,
      position: { ...tower.position },
      color,
      duration,
      label: eventLabel,
    });
  }

  /** Compatibility helper for deterministic fixtures; field scheduling is behavior-owned. */
  startLightningField(tower: Tower, duration = 6): void {
    this.startField(tower, duration, 150, "tempest-field-start", "LIGHTNING FIELD");
  }

  /** Compatibility helper for deterministic fixtures; the behavior owns the field update itself. */
  updateLightningField(tower: Tower, delta: number): void {
    const behavior = getTowerBehavior(tower.kind);
    const stats = this.towerStats(tower);
    behavior?.beforeAttack?.(
      this.towerAttackBehaviorContext(tower, [], stats.damage * tower.damageBuff, stats.fireRate, delta),
    );
  }

  private emitTempestHit(tower: Tower, target: Enemy): void {
    const accent = TOWER_DEFINITIONS[tower.kind].accent;
    const impact = this.enemyPosition(target);
    this.spawnArc(tower.position, impact, accent);
    this.callbacks.onSimulationEvent?.({
      kind: "attack",
      targetId: target.id,
      position: { ...impact },
      from: { ...tower.position },
      color: accent,
      label: tower.kind,
      visual: "hitscan",
    });
    this.audio.towerEffect("tempest-arc");
  }
  private applyShock(enemy: Enemy, duration: number, initialFactor = 0.5, decay = 0.5): void {
    const baseFactor = initialFactor;
    const strength = (1 - baseFactor) * Math.pow(decay, enemy.shockStacks);
    enemy.slowTimer = Math.max(enemy.slowTimer, duration);
    enemy.slowFactor = Math.min(enemy.slowFactor, 1 - strength);
    enemy.shockStacks += 1;
  }

  private selectTarget(tower: Tower, candidates: readonly Enemy[]): Enemy | undefined {
    const hasAggroedCandidate = candidates.some((enemy) => tower.engaged.has(enemy.id) || enemy.targetTowerId === tower.id);
    let best: Enemy | undefined;
    const isPreferred = (candidate: Enemy, current: Enemy): boolean => {
      switch (tower.targeting) {
        case "first":
          return candidate.pathDistance > current.pathDistance ||
            (candidate.pathDistance === current.pathDistance && candidate.id < current.id);
        case "last":
          return candidate.pathDistance < current.pathDistance ||
            (candidate.pathDistance === current.pathDistance && candidate.id > current.id);
        case "strongest":
          return candidate.maxHp > current.maxHp ||
            (candidate.maxHp === current.maxHp && candidate.hp > current.hp);
        case "weakest":
          return candidate.hp < current.hp ||
            (candidate.hp === current.hp && candidate.maxHp < current.maxHp);
        case "closest":
          return distance(tower.position, this.enemyPosition(candidate)) < distance(tower.position, this.enemyPosition(current));
      }
    };
    candidates.forEach((candidate) => {
      if (hasAggroedCandidate && !tower.engaged.has(candidate.id) && candidate.targetTowerId !== tower.id) return;
      if (!best || isPreferred(candidate, best)) best = candidate;
    });
    return best;
  }

  private enemiesInCone(
    origin: Point,
    aim: Point,
    candidates: readonly Enemy[],
    range: number,
    halfAngle: number,
  ): Enemy[] {
    const facing = Math.atan2(aim.y - origin.y, aim.x - origin.x);
    return candidates.filter((enemy) => {
      const position = this.enemyPosition(enemy);
      if (distance(origin, position) > range) return false;
      const angle = Math.atan2(position.y - origin.y, position.x - origin.x);
      const difference = Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing));
      return Math.abs(difference) <= halfAngle;
    });
  }

  private canTowerTarget(tower: Tower, enemy: Enemy): boolean {
    // Path placement changes blocking/aggro behavior, but it does not limit a
    // tower's normal ranged targeting to one route.
    return this.canTowerKindTarget(tower.kind, tower.level, enemy);
  }

  private canTowerKindTarget(kind: TowerKind, level: number, enemy: Enemy): boolean {
    if (enemy.phaseTimer > 0 || enemy.behaviorInvulnerableTimer > 0) return false;
    if (!getEnemyDefinition(enemy.kind).hidden) return true;
    const detectionLevel = TOWER_DEFINITIONS[kind].hiddenDetectionLevel;
    return detectionLevel !== undefined && level >= detectionLevel;
  }

  private updateProjectiles(delta: number): void {
    const survivors: Projectile[] = [];
    for (const projectile of this.projectiles) {
      if (projectile.delay > 0) {
        projectile.delay = Math.max(0, projectile.delay - delta);
        survivors.push(projectile);
        continue;
      }
      getTowerBehavior(projectile.kind)?.onProjectileLaunch?.({
        projectile,
        playSound: (pitch, sound) => this.audio.shoot(pitch, projectile.kind, sound),
      });
      const target = this.enemies.find(
        (enemy) =>
          enemy.id === projectile.targetId &&
          enemy.hp > 0 &&
          this.canTowerKindTarget(projectile.kind, projectile.towerLevel, enemy),
      );
      if (!target) continue;
      const targetPosition = this.enemyPosition(target);
      const gap = distance(projectile.position, targetPosition);
      if (gap <= projectile.speed * delta + 7) {
        this.resolveProjectile(projectile, target);
        continue;
      }
      projectile.position.x += ((targetPosition.x - projectile.position.x) / gap) * projectile.speed * delta;
      projectile.position.y += ((targetPosition.y - projectile.position.y) / gap) * projectile.speed * delta;
      survivors.push(projectile);
    }
    this.projectiles = survivors;
  }

  private updateAdmiralShots(delta: number): void {
    const survivors: AdmiralShot[] = [];
    for (const shot of this.admiralShots) {
      shot.timer -= delta;
      if (shot.timer > 0) {
        survivors.push(shot);
        continue;
      }
      this.enemies
        .filter(
          (enemy) =>
            enemy.hp > 0 &&
            this.canTowerKindTarget("admiral", shot.towerLevel, enemy) &&
            distance(this.enemyPosition(enemy), shot.position) <= shot.radius,
        )
        .forEach((enemy) => this.damageEnemy(enemy, shot.damage, shot.color, shot.playerId, false, undefined, "explosive"));
      this.spawnExplosion(shot.position, shot.color, shot.radius, 1.5);
      this.spawnText(shot.position, "ADMIRAL IMPACT", shot.color);
      this.shake = Math.min(1, this.shake + 0.45);
      this.audio.breach("explosion", "admiral");
      this.callbacks.onSimulationEvent?.({
        kind: "explosion",
        position: { ...shot.position },
        color: shot.color,
        value: shot.radius,
        label: "admiral",
      });
    }
    this.admiralShots = survivors;
  }

  private updateVisualProjectiles(delta: number): void {
    if (this.headless) return;
    const survivors: VisualProjectile[] = [];
    for (const projectile of this.visualProjectiles) {
      let step = delta;
      if ((projectile.delay ?? 0) > 0) {
        step = Math.max(0, delta - projectile.delay!);
        projectile.delay = Math.max(0, projectile.delay! - delta);
        projectile.hidden = projectile.delay > 0;
        if (projectile.hidden) { survivors.push(projectile); continue; }
        // Staggered rockets stay attached to a moving chassis until launch;
        // their locked targets and authoritative impact deadlines do not move.
        const launcher = this.towers.find((tower) => tower.id === projectile.launchTowerId);
        if (launcher && projectile.style === "mecha-missile") {
          const aim = launcher.aimPoint ?? projectile.endpoint;
          const angle = launcher.mechaTurretAngle ?? Math.atan2(aim.y - launcher.position.y, aim.x - launcher.position.x);
          const side = projectile.launchSide ?? 0;
          projectile.start = {
            x: launcher.position.x + Math.cos(angle) * 32 - Math.sin(angle) * side,
            y: launcher.position.y + Math.sin(angle) * 32 + Math.cos(angle) * side,
          };
          projectile.position = { ...projectile.start };
        }
      }
      if (projectile.style === "admiral" || projectile.style === "mecha-missile") {
        if (projectile.style === "mecha-missile" && !projectile.launchSoundPlayed && step > 0) {
          projectile.launchSoundPlayed = true;
          if (!this.presentationSuspended) this.audio.tankMissileLaunch();
        }
        const duration = Math.max(0.05, projectile.flightDuration ?? distance(projectile.start, projectile.endpoint) / projectile.speed);
        projectile.age += step;
        if (projectile.age >= duration) {
          this.spawnImpactDust(projectile.endpoint, projectile.color);
          continue;
        }
        const progress = clamp(projectile.age / duration, 0, 1);
        const arcHeight = projectile.style === "mecha-missile" ? 26 : clamp(distance(projectile.start, projectile.endpoint) * 0.28, 55, 180);
        projectile.position.x = projectile.start.x + (projectile.endpoint.x - projectile.start.x) * progress;
        projectile.position.y = projectile.start.y + (projectile.endpoint.y - projectile.start.y) * progress - Math.sin(progress * Math.PI) * arcHeight;
        projectile.scale = 1;
        projectile.hidden = false;
        survivors.push(projectile);
        continue;
      }
      const target = projectile.targetId === null
        ? undefined
        : this.enemies.find((enemy) => enemy.id === projectile.targetId && enemy.hp > 0);
      if (projectile.targetId !== null && !target) continue;
      const targetPosition = target ? this.enemyPosition(target) : projectile.endpoint;
      const gap = distance(projectile.position, targetPosition);
      if (gap <= projectile.speed * delta + 8) {
        this.spawnImpactDust(targetPosition, projectile.color);
        continue;
      }
      projectile.position.x += ((targetPosition.x - projectile.position.x) / gap) * projectile.speed * delta;
      projectile.position.y += ((targetPosition.y - projectile.position.y) / gap) * projectile.speed * delta;
      survivors.push(projectile);
    }
    this.visualProjectiles = survivors;
  }

  private emitAttackVisual(
    tower: Tower,
    target: Enemy,
    visual: "hitscan" | "projectile" = "projectile",
    speed?: number,
    effectValue?: number,
  ): void {
    this.callbacks.onSimulationEvent?.({
      kind: "attack",
      targetId: target.id,
      position: this.enemyPosition(target),
      from: { ...tower.position },
      color: TOWER_DEFINITIONS[tower.kind].accent,
      label: tower.kind,
      visual,
      ...(speed === undefined ? {} : { speed }),
      ...(effectValue === undefined ? {} : { value: effectValue }),
    });
  }

  private emitHitscanVisual(tower: Tower, target: Enemy, width = 2.2): void {
    const position = this.enemyPosition(target);
    const color = TOWER_DEFINITIONS[tower.kind].accent;
    if (getTowerBehavior(tower.kind)?.hitscanVisual === "tracer") this.spawnBulletTracer(tower.position, position, color, width);
    else {
      this.spawnBeam(tower.position, position, color, width);
      this.spawnMuzzleFlash(tower.position, position, color, width >= 3 ? 20 : 15);
    }
    this.callbacks.onSimulationEvent?.({
      kind: "attack",
      targetId: target.id,
      position,
      from: { ...tower.position },
      color,
      label: tower.kind,
      visual: "hitscan",
    });
  }

  private emitSlashVisual(
    from: Point,
    to: Point,
    color: string,
    reach: number,
    spread: number,
    label?: TowerKind,
    direction = 1 as 1 | -1,
    duration = 0.24,
    sound?: TowerAttackSound,
  ): void {
    this.spawnSlash(from, to, color, reach, spread, 0, undefined, duration, direction);
    if (sound && label) this.audio.shoot(220, label, sound);
    this.callbacks.onSimulationEvent?.({
      kind: "slash",
      position: { ...to },
      from: { ...from },
      color,
      value: reach,
      label,
    });
  }

  private applyDamageBuff(tower: Tower, multiplier: number, duration: number): void {
    // Damage is a shared tower stat buff. Mercenary is currently its only
    // source, but the state intentionally does not depend on tower kind.
    if (tower.overdriveTimer <= 0) tower.overdriveMultiplier = 1;
    tower.overdriveTimer = Math.max(tower.overdriveTimer, duration);
    tower.overdriveMultiplier = Math.max(tower.overdriveMultiplier ?? 1, multiplier);
    this.refreshDamageBuff(tower);
  }

  private triggerMutinyBuff(source: Tower, multiplier: number, duration: number): void {
    const radius = this.towerStats(source).range * RANGE_SCALE;
    const recipients = this.towers.filter(
      (tower) => distance(tower.position, source.position) <= radius,
    );
    recipients.forEach((tower) => {
      this.applyDamageBuff(tower, multiplier, duration);
      this.spawnRing(tower.position, DAMAGE_BUFF_COLOR, 0.4, 3, 34);
    });
    const color = TOWER_PERK_DEFINITIONS.mutiny.accent;
    this.spawnRing(source.position, color, 0.8, 8, radius);
    this.spawnText(source.position, `MUTINY +${Math.round((multiplier - 1) * 100)}%`, color);
    this.callbacks.onSimulationEvent?.({
      kind: "ability",
      entityId: source.id,
      position: { ...source.position },
      color,
      value: radius,
      count: recipients.length,
      duration,
      label: "mutiny-trigger",
    });
    this.audio.towerAbility(source.kind);
  }

  private updateDamageBuff(tower: Tower, delta: number): void {
    tower.overdriveTimer = Math.max(0, tower.overdriveTimer - delta);
    if (tower.overdriveTimer <= 0) tower.overdriveMultiplier = 1;
    this.refreshDamageBuff(tower);
  }

  private refreshDamageBuff(tower: Tower): void {
    const sharedMultiplier = tower.overdriveTimer > 0
      ? (tower.overdriveMultiplier ?? tower.damageBuff)
      : 1;
    const stanceMultiplier = getTowerBehavior(tower.kind)?.damageMultiplier?.(tower) ?? 1;
    tower.damageBuff = sharedMultiplier * stanceMultiplier * getTowerPerkDamageMultiplier(tower);
  }

  private emitCrossSlashVisual(from: Point, to: Point, color: string, reach: number, label?: TowerKind, secondaryColor?: string): void {
    this.spawnCrossSlash(from, to, color, reach, secondaryColor);
    this.callbacks.onSimulationEvent?.({
      kind: "cross-slash",
      position: { ...to },
      from: { ...from },
      color,
      value: reach,
      label,
    });
  }

  private emitStrikeVisual(position: Point, color: string, label?: TowerKind): void {
    this.spawnSwordStrike(position, color);
    this.callbacks.onSimulationEvent?.({
      kind: "strike",
      position: { ...position },
      color,
      label,
    });
  }

  private emitVanguardMaceVisual(from: Point, to: Point, color: string): void {
    this.spawnVanguardMaceStrike(from, to, color);
    this.callbacks.onSimulationEvent?.({
      kind: "strike",
      position: { ...to },
      from: { ...from },
      color,
      label: "vanguard",
    });
  }

  private spawnVanguardMaceStrike(from: Point, to: Point, color: string): void {
    if (this.headless) return;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    this.spawnFlash(to, "#fff1c2", 25, angle);
    this.spawnRing(to, color, 0.16, 7, 28);
    this.spawnRing(to, "#fff1c2", 0.1, 3, 14);
    for (let index = 0; index < 6; index += 1) this.spawnSpark(to, color, 45 + Math.random() * 35);
  }

  private updateDelayedSlashes(delta: number): void {
    const survivors: DelayedSlash[] = [];
    for (const slash of this.delayedSlashes) {
      slash.timer -= delta;
      if (slash.timer > 0) {
        survivors.push(slash);
        continue;
      }
      const tower = this.towers.find((candidate) => candidate.id === slash.towerId && candidate.hp > 0);
      const target = this.enemies.find((enemy) => enemy.id === slash.targetId && enemy.hp > 0);
      if (!tower || !target || !this.canTowerTarget(tower, target)) continue;
      const impact = this.enemyPosition(target);
      this.damageEnemy(target, slash.damage, slash.color, tower.ownerId, false, tower.id, slash.damageType ?? "melee");
      this.emitStrikeVisual(impact, slash.color, tower.kind);
      this.audio.shoot(260, tower.kind);
    }
    this.delayedSlashes = survivors;
  }

  private resolveProjectile(projectile: Projectile, target: Enemy): void {
    if (!this.canTowerKindTarget(projectile.kind, projectile.towerLevel, target)) return;
    const accent = TOWER_DEFINITIONS[projectile.kind].accent;
    const damageAgainst = (enemy: Enemy): number => getTowerBehavior(projectile.kind)?.projectileDamage?.(projectile, enemy) ?? projectile.damage;
    const damageType = projectile.damageType ?? TOWER_DEFINITIONS[projectile.kind]?.damageType ?? "bullet";
    this.damageEnemy(target, damageAgainst(target), accent, projectile.ownerId, false, undefined, damageType);
    const impact = this.enemyPosition(target);
    if (projectile.splash > 0) {
      this.spawnExplosion(impact, accent, projectile.splash);
      this.callbacks.onSimulationEvent?.({
        kind: "explosion",
        entityId: target.id,
        position: { ...impact },
        color: accent,
        value: projectile.splash,
        label: projectile.kind,
      });
      const splashed = this.enemies
        .filter(
          (enemy) =>
            enemy.id !== target.id &&
            this.canTowerKindTarget(projectile.kind, projectile.towerLevel, enemy) &&
            distance(this.enemyPosition(enemy), impact) <= projectile.splash,
        );
      splashed.forEach((enemy) => this.damageEnemy(enemy, damageAgainst(enemy), accent, projectile.ownerId, false, undefined, damageType));
    } else {
      this.spawnImpactDust(impact, accent);
      this.callbacks.onSimulationEvent?.({ kind: "impact", entityId: target.id, position: { ...impact }, value: projectile.damage });
    }
  }

  private applyBurnStatus(
    enemy: Enemy,
    duration: number,
    damage: number,
    slowFactor: number,
    tickInterval: number,
    strength: number,
    damageBuff: number,
    ownerId: PlayerId,
    speedMultiplier: number,
  ): void {
    enemy.burnTimer = Math.max(enemy.burnTimer, duration);
    const appliedDamage = damage * strength * damageBuff;
    if (appliedDamage >= enemy.burnDamage) enemy.burnOwnerId = ownerId;
    enemy.burnDamage = Math.max(enemy.burnDamage, appliedDamage);
    enemy.burnSlowFactor = Math.min(enemy.burnSlowFactor, slowFactor);
    enemy.burnTickInterval = Math.min(enemy.burnTickInterval > 0 ? enemy.burnTickInterval : tickInterval, tickInterval);
    enemy.burnSpeedFactor = Math.max(enemy.burnSpeedFactor > 0 ? enemy.burnSpeedFactor : 1, speedMultiplier);
    if (enemy.burnTickTimer <= 0) enemy.burnTickTimer = tickInterval;
  }

  private updateTimedBombs(delta: number): void {
    const survivors: TimedBomb[] = [];
    for (const bomb of this.timedBombs) {
      const canBombTarget = (enemy: Enemy): boolean =>
        bomb.sourceKind === undefined || this.canTowerKindTarget(bomb.sourceKind, bomb.towerLevel ?? 0, enemy);
      const proximityTarget = bomb.proximity
        ? this.enemies.find(
          (enemy) =>
            enemy.hp > 0 &&
            canBombTarget(enemy) &&
            distance(this.enemyPosition(enemy), bomb.position) <= 27,
        )
        : undefined;
      if (!bomb.proximity) bomb.timer -= delta;
      if ((bomb.proximity && !proximityTarget) || (!bomb.proximity && bomb.timer > 0)) {
        survivors.push(bomb);
        continue;
      }
      this.enemies
        .filter(
          (enemy) =>
            canBombTarget(enemy) &&
            distance(this.enemyPosition(enemy), bomb.position) <= bomb.radius,
        )
        .forEach((enemy) => {
          const behavior = bomb.sourceKind === undefined ? undefined : getTowerBehavior(bomb.sourceKind);
          const baseDamage = behavior?.timedBombDamage
            ? behavior.timedBombDamage(bomb.towerLevel ?? 0, enemy, bomb.damage)
            : bomb.damage;
          this.damageEnemy(enemy, baseDamage, bomb.color, bomb.playerId, false, bomb.sourceTowerId, bomb.damageType ?? "explosive");
        });
      this.spawnExplosion(bomb.position, bomb.color, bomb.radius);
      if (bomb.label !== "mecha-missile") this.spawnText(bomb.position, bomb.proximity ? "PATH BOMB" : "TIME BOMB // 500", bomb.color);
      this.shake = Math.min(1, this.shake + (bomb.label === "mecha-missile" ? 0.16 : 0.8));
      this.audio.breach("explosion", bomb.sourceKind);
      this.callbacks.onSimulationEvent?.({
        kind: "explosion",
        position: { ...bomb.position },
        color: bomb.color,
        value: bomb.radius,
        label: bomb.label ?? bomb.sourceKind,
      });
    }
    this.timedBombs = survivors;
  }

  private damageEnemy(
    enemy: Enemy,
    amount: number,
    _color: string,
    ownerId: PlayerId = this.localPlayerId,
    statusEffect = false,
    sourceTowerId?: number,
    damageType: DamageType = "bullet",
  ): void {
    if (enemy.hp <= 0 || enemy.phaseTimer > 0 || enemy.behaviorInvulnerableTimer > 0) return;
    const resolution = resolveEnemyDamage({
      amount,
      defense: enemy.defense,
      protection: enemy.protection,
      armor: enemy.armor,
      superarmor: enemy.superarmor,
      statusEffect,
      damageType,
      resistances: enemy.resistances,
    });
    enemy.protection = resolution.remainingProtection;
    const incoming = resolution.mitigatedDamage;
    if (incoming <= 0) {
      enemy.hitFlash = 0.55;
      if (resolution.protectionTriggered) this.spawnText(this.enemyPosition(enemy), "PROTECTION", "#d8e5ff");
      this.audio.enemyHit(true);
      return;
    }

    // Shields are a complete first-hit buffer: any damage beyond the
    // remaining shield is discarded, and only a later hit can damage HP.
    if (enemy.shieldHp > 0) {
      enemy.shieldHp = Math.max(0, enemy.shieldHp - incoming);
      enemy.hitFlash = 1;
      this.audio.enemyHit(true);
      return;
    }

    const dealt = Math.min(enemy.hp, incoming);
    enemy.hp -= dealt;
    const abilityDefinition = getEnemyDefinition(enemy.kind);
    const hpAbilities = normalizeEnemyAbilities(abilityDefinition);
    if (hpAbilities.length > 0) {
      enemy.abilityRuntime ??= createEnemyAbilityRuntime(hpAbilities, { hp: enemy.hp + dealt, maxHp: enemy.maxHp });
      this.enemyAbilityEngine.step(this.enemyAbilityTick, 0, hpAbilities, enemy.abilityRuntime, this.enemyAbilityAdapter(enemy, abilityDefinition, 1 / 30));
    }
    const multiplayerMultiplier = this.multiplayerActive ? this.mode.multiplayerHitCashMultiplier : 1;
    const hitCashRuntimes = this.multiplayerActive
      ? [...this.playerRuntimes.values()]
      : [this.runtimeFor(ownerId)];
    for (const runtime of hitCashRuntimes) {
      runtime.damageIncomeRemainder += dealt * ECONOMY_RULES.damageCashPerHp * multiplayerMultiplier * enemy.hitCashMultiplier;
      const payout = Math.floor(runtime.damageIncomeRemainder);
      if (payout > 0) {
        runtime.shards += payout;
        runtime.damageIncomeRemainder -= payout;
      }
    }
    const sourceTower = sourceTowerId === undefined
      ? undefined
      : this.towers.find((tower) => tower.id === sourceTowerId);
    if (sourceTower) {
      const sourceStats = this.towerStats(sourceTower);
      getTowerBehavior(sourceTower.kind)?.onDamageDealt?.({
        tower: sourceTower,
        damage: dealt,
        killed: enemy.hp <= 0,
        baseDps: sourceStats.damage / Math.max(0.01, sourceStats.fireRate),
        triggerDamageBuff: (multiplier, duration) => this.triggerMutinyBuff(sourceTower, multiplier, duration),
      });
    }
    if (enemy.hp <= 0) {
      const definition = abilityDefinition;
      const abilities = hpAbilities;
      enemy.abilityRuntime ??= createEnemyAbilityRuntime(abilities, { hp: enemy.hp, maxHp: enemy.maxHp });
      this.enemyAbilityEngine.notifyDeath(this.enemyAbilityTick, abilities, enemy.abilityRuntime, this.enemyAbilityAdapter(enemy, definition, 1 / 30));
      this.towers
        .filter((tower) => tower.ownerId === ownerId && tower.hp < tower.maxHp && getTowerBehavior(tower.kind)?.onEnemyKilled)
        .forEach((killer) => {
          const healing = Math.min(killer.maxHp - killer.hp, 3 + killer.level);
          getTowerBehavior(killer.kind)?.onEnemyKilled?.({
            tower: killer,
            healing,
            accent: TOWER_DEFINITIONS[killer.kind].accent,
            spawnText: (text) => this.spawnText(killer.position, text, TOWER_DEFINITIONS[killer.kind].accent),
            spawnRing: () => this.spawnRing(killer.position, TOWER_DEFINITIONS[killer.kind].accent, 0.38, 3, 36),
          });
        });
    }
    enemy.hitFlash = 1;
    this.audio.enemyHit(false);
  }

  private removeDeadEnemies(): void {
    const dead = this.enemies.filter((enemy) => enemy.hp <= 0);
    dead.forEach((enemy) => {
      if (enemy.hp > -9990) this.audio.enemyDeath(Boolean(getEnemyDefinition(enemy.kind).boss));
      this.callbacks.onSimulationEvent?.({ kind: "death", entityId: enemy.id, position: this.enemyPosition(enemy) });
    });
    const deadIds = new Set(dead.map((enemy) => enemy.id));
    this.enemies = this.enemies.filter((enemy) => enemy.hp > 0);
    if (deadIds.size > 0) this.towers.forEach((tower) => deadIds.forEach((id) => tower.engaged.delete(id)));
  }

  private completeWave(): void {
    this.settleWave(false);
  }

  /** Applies all wave-end effects for both normal clears and accepted skips. */
  private settleWave(skipped: boolean): void {
    this.waveActive = false;
    this.nextWaveIndex += 1;
    const wave = this.mode.waves[this.waveNumber - 1];
    const bonus = wave?.cashReward ?? (ECONOMY_RULES.waveClearBase + ECONOMY_RULES.waveClearPerWave * this.waveNumber);
    this.playerRuntimes.forEach((runtime) => { runtime.shards += bonus; });
    this.towers.forEach((tower) => {
      if (tower.hp >= tower.maxHp) return;
      const missingHp = tower.maxHp - tower.hp;
      tower.hp = Math.min(tower.maxHp, tower.hp + missingHp * 0.7 + 4);
    });
    this.callbacks.onLog(
      `Wave ${this.waveNumber.toString().padStart(2, "0")} ${skipped ? "skipped" : "purged"} // +$${bonus}; towers repaired for 70% missing HP + 4.`,
      "good",
    );
    this.audio.waveClear();
    this.audio.setAmbienceIntensity(0.12);
    this.audio.stopZenithCharges();
    if (this.nextWaveIndex >= this.mode.waves.length) {
      this.modeComplete = true;
      this.audio.stopAmbience();
      this.audio.victory();
      this.callbacks.onLog(`${this.mode.name.toUpperCase()} COMPLETE // all ${this.mode.waves.length} waves cleared.`, "good");
      this.callbacks.onVictory(this.mode);
    } else if (skipped) {
      const totalRecovered = this.collectPendingCasualtyRefund();
      if (totalRecovered > 0) this.callbacks.onLog(`Casualty recovery arrived // $${totalRecovered} distributed to tower owners.`, "good");
      this.startWave(this.nextWaveIndex, true);
    } else {
      this.intermissionTimer = WAVE_INTERMISSION_SECONDS;
      this.callbacks.onLog(`Next wave begins automatically in ${WAVE_INTERMISSION_SECONDS} seconds.`);
    }
    this.emitUi();
  }

  private towerRenderBehaviorContext(
    tower: Tower,
    showSupplementalStats = false,
    addOverlay: (item: TowerOverlayItem) => void = () => undefined,
  ): TowerRenderBehaviorContext {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const mirrorCharge = this.isMirror ? this.mirrorZenithCharges.get(tower.id) : undefined;
    return {
      tower,
      context: this.context,
      elapsed: this.elapsed,
      canvasGlow: this.canvasGlow,
      accent: definition.accent,
      dimAccent: definition.dimAccent,
      selected: tower.id === this.selectedTowerId,
      hovered: this.pointer !== null && distance(tower.position, this.pointer) <= 31,
      showSupplementalStats,
      isMirror: this.isMirror,
      pointer: this.pointer ?? undefined,
      mirrorZenithCharge: mirrorCharge,
      enemyPosition: (enemy) => this.enemyPosition(enemy),
      findEnemy: (enemyId) => this.enemies.find((enemy) => enemy.id === enemyId && enemy.hp > 0),
      towerRange: this.towerStats(tower).range * RANGE_SCALE,
      towerSplash: getEffectiveTowerSplash(tower, this.towerStats(tower).splash ?? 0),
      towerFireRate: this.towerStats(tower).fireRate * getTowerPerkAttackIntervalMultiplier(tower),
      towerAmmoCapacity: this.towerStats(tower).ammo,
      addOverlay,
      drawOverlayBar: (x, centerY, width, height, value, color) => this.renderer.drawBar(x, centerY - height / 2, width, height, value, color),
      clampAimPoint: (point) => this.clampAdmiralAimPoint(tower, point),
    };
  }

  /** Compatibility helper for deterministic renderer fixtures. */
  drawZenithCharge(tower: Tower): void {
    this.renderer.drawZenithCharge(tower);
  }

  private towerStats(tower: Tower): TowerLevelStats {
    const stats = TOWER_DEFINITIONS[tower.kind].levels[tower.level];
    if (!stats) throw new Error(`Missing level ${tower.level} stats for ${tower.kind}`);
    return stats;
  }

  private towerAggroLimit(tower: Tower, onPath: boolean): number {
    if (!onPath) return 0;
    const definition = TOWER_DEFINITIONS[tower.kind];
    return definition.onPath.maxAggro + (tower.kind === "mecha" ? this.towerStats(tower).aggroBonus : 0);
  }

  private get selectedTower(): Tower | null {
    return this.towers.find((tower) => tower.id === this.selectedTowerId) ?? null;
  }

  private emitUi(): void {
    if (this.headless) return;
    const tower = this.selectedTower;
    const selectedDefinition = tower ? TOWER_DEFINITIONS[tower.kind] : undefined;
    const selectedStats = tower ? this.towerStats(tower) : undefined;
    const selectedBehavior = tower ? getTowerBehavior(tower.kind) : undefined;
    const selectedBaseAttackInterval = tower && selectedStats
      ? selectedBehavior?.getBaseAttackInterval?.(tower, selectedStats.fireRate) ?? selectedStats.fireRate
      : undefined;
    const incoming = tower
      ? this.enemies
          .filter((enemy) => enemy.targetTowerId === tower.id && enemy.attackTimer <= enemy.telegraphDuration)
          .sort((a, b) => a.attackTimer - b.attackTimer)[0]?.attackTimer ?? null
      : null;
    const bosses = this.enemies
      .filter((enemy) => enemy.hp > 0 && getEnemyDefinition(enemy.kind).boss)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id)
      .map((enemy) => {
        const definition = getEnemyDefinition(enemy.kind);
        return {
          // This is the individual enemy's ID, so identical boss classes remain dismissible independently.
          id: enemy.id,
          name: definition.name,
          accent: definition.sprite.accent,
          hp: enemy.hp,
          maxHp: enemy.maxHp,
          shieldHp: enemy.shieldHp,
          maxShieldHp: enemy.maxShieldHp,
        };
      });
    this.callbacks.onUi({
      integrity: this.integrity,
      maxIntegrity: this.maxIntegrity,
      shards: this.shards,
      pendingCasualtyRefund: this.pendingCasualtyRefund,
      infiniteCash: this.infiniteCash,
      copiesRemaining: { ...this.copiesRemaining },
      availableTowers: [...this.availableTowerKinds],
      availablePerks: [...this.availablePerkKinds],
      towerCount: this.towers.length,
      wave: this.waveNumber,
      totalWaves: this.mode.waves.length,
      modeName: this.mode.name,
      mapName: this.map.name,
      waveActive: this.waveActive,
      skipWaveAvailable: this.canSkipWave() && this.skipWaveDismissedWave !== this.waveNumber,
      skipWaveVoteCast: this.skipWaveVoteWave === this.waveNumber || this.skipWaveVotes.has(this.localPlayerId),
      intermissionRemaining: this.intermissionTimer,
      waveElapsed: this.waveElapsed,
      elapsed: this.elapsed,
      enemiesRemaining: this.enemies.length + this.spawnQueue.length,
      paused: this.paused,
      speed: this.speed,
      soundEnabled: this.audio.enabled,
      selectedKind: this.selectedKind,
      selectedTower: tower
        ? {
            tower,
            definition: selectedDefinition!,
            incomingAttack: incoming,
            inspector: buildTowerInspectorData({
              tower,
              definition: selectedDefinition!,
              levelStats: selectedStats!,
              baseAttackInterval: selectedBaseAttackInterval,
              damageMultiplier: tower.damageBuff,
              sellValue: this.towerSellValue(tower),
              incomingAttack: incoming,
              behaviorStats: selectedBehavior?.inspectorStats?.(tower, selectedStats!),
            }),
            abilityTargetInRange: selectedBehavior?.abilityTargetInRange?.(
              tower,
              this.enemies,
              (enemy) => this.canTowerTarget(tower, enemy),
              selectedStats!.range * RANGE_SCALE,
              (enemy) => this.enemyPosition(enemy),
            ) ?? false,
          }
        : null,
      placement: this.placement,
      relocating: this.relocatingTowerId !== null,
      started: this.started,
      gameOver: this.gameOver,
      modeComplete: this.modeComplete,
      bosses,
      multiplayer: this.multiplayerActive,
      mirror: this.isMirror,
      localPlayerId: this.localPlayerId,
      selectedOwned: tower?.ownerId === this.localPlayerId,
      teammates: [...this.playerProfiles.values()]
        .filter((player) => player.id !== this.localPlayerId)
        .map((player) => ({ ...player, shards: this.runtimeFor(player.id).shards })),
    });
  }

  private enemyPosition(enemy: Enemy): Point {
    const sample = this.pathForIndex(enemy.pathIndex).sample(enemy.pathDistance);
    if (enemy.targetTowerId === null) return sample.point;
    const tower = this.towers.find((candidate) => candidate.id === enemy.targetTowerId);
    if (!tower) return sample.point;
    const engaged = [...tower.engaged];
    const index = Math.max(0, engaged.indexOf(enemy.id));
    const spread = (index - (engaged.length - 1) / 2) * 17;
    return {
      x: sample.point.x - sample.direction.y * spread,
      y: sample.point.y + sample.direction.x * spread,
    };
  }

  private nextSlashDirection(kind: TowerKind): 1 | -1 {
    const positive = !(this.slashDirections.get(kind) ?? false);
    this.slashDirections.set(kind, positive);
    return positive ? 1 : -1;
  }

  private resolvePathIndex(pathIndex: number | undefined): number {
    return clamp(Math.round(pathIndex ?? 0), 0, Math.max(0, this.paths.length - 1));
  }

  private pathForIndex(pathIndex: number | undefined): Polyline {
    return this.paths[this.resolvePathIndex(pathIndex)] ?? this.path;
  }

  // Presentation effects are delegated to keep the simulation coordinator focused on game rules.
  private updateParticles(...args: Parameters<GameEffects["updateParticles"]>): ReturnType<GameEffects["updateParticles"]> {
    return this.effects.updateParticles(...args);
  }

  private spawnSpark(...args: Parameters<GameEffects["spawnSpark"]>): ReturnType<GameEffects["spawnSpark"]> {
    return this.effects.spawnSpark(...args);
  }

  private spawnRing(...args: Parameters<GameEffects["spawnRing"]>): ReturnType<GameEffects["spawnRing"]> {
    return this.effects.spawnRing(...args);
  }

  private spawnImpactDust(...args: Parameters<GameEffects["spawnImpactDust"]>): ReturnType<GameEffects["spawnImpactDust"]> {
    return this.effects.spawnImpactDust(...args);
  }

  private spawnText(...args: Parameters<GameEffects["spawnText"]>): ReturnType<GameEffects["spawnText"]> {
    return this.effects.spawnText(...args);
  }

  private spawnSlash(...args: Parameters<GameEffects["spawnSlash"]>): ReturnType<GameEffects["spawnSlash"]> {
    return this.effects.spawnSlash(...args);
  }

  private spawnWraithDashTrail(...args: Parameters<GameEffects["spawnWraithDashTrail"]>): ReturnType<GameEffects["spawnWraithDashTrail"]> {
    return this.effects.spawnWraithDashTrail(...args);
  }

  private spawnWraithFlurry(...args: Parameters<GameEffects["spawnWraithFlurry"]>): ReturnType<GameEffects["spawnWraithFlurry"]> {
    return this.effects.spawnWraithFlurry(...args);
  }

  private spawnWraithFlurrySlashes(...args: Parameters<GameEffects["spawnWraithFlurrySlashes"]>): ReturnType<GameEffects["spawnWraithFlurrySlashes"]> {
    return this.effects.spawnWraithFlurrySlashes(...args);
  }

  private spawnSwordStrike(...args: Parameters<GameEffects["spawnSwordStrike"]>): ReturnType<GameEffects["spawnSwordStrike"]> {
    return this.effects.spawnSwordStrike(...args);
  }

  private spawnTracer(...args: Parameters<GameEffects["spawnTracer"]>): ReturnType<GameEffects["spawnTracer"]> {
    return this.effects.spawnTracer(...args);
  }

  private spawnBulletTracer(...args: Parameters<GameEffects["spawnBulletTracer"]>): ReturnType<GameEffects["spawnBulletTracer"]> {
    return this.effects.spawnBulletTracer(...args);
  }

  private spawnArc(...args: Parameters<GameEffects["spawnArc"]>): ReturnType<GameEffects["spawnArc"]> {
    return this.effects.spawnArc(...args);
  }

  private startInfernusFlameStream(...args: Parameters<GameEffects["startInfernusFlameStream"]>): ReturnType<GameEffects["startInfernusFlameStream"]> {
    return this.effects.startInfernusFlameStream(...args);
  }

  private spawnRadialSpray(...args: Parameters<GameEffects["spawnRadialSpray"]>): ReturnType<GameEffects["spawnRadialSpray"]> {
    return this.effects.spawnRadialSpray(...args);
  }

  private spawnFlash(...args: Parameters<GameEffects["spawnFlash"]>): ReturnType<GameEffects["spawnFlash"]> {
    return this.effects.spawnFlash(...args);
  }

  private spawnLightningAuraArc(...args: Parameters<GameEffects["spawnLightningAuraArc"]>): ReturnType<GameEffects["spawnLightningAuraArc"]> {
    return this.effects.spawnLightningAuraArc(...args);
  }

  private spawnMuzzleFlash(...args: Parameters<GameEffects["spawnMuzzleFlash"]>): ReturnType<GameEffects["spawnMuzzleFlash"]> {
    return this.effects.spawnMuzzleFlash(...args);
  }

  private spawnBeam(...args: Parameters<GameEffects["spawnBeam"]>): ReturnType<GameEffects["spawnBeam"]> {
    return this.effects.spawnBeam(...args);
  }

  private spawnCyborgBeam(...args: Parameters<GameEffects["spawnCyborgBeam"]>): ReturnType<GameEffects["spawnCyborgBeam"]> {
    return this.effects.spawnCyborgBeam(...args);
  }

  private spawnExplosion(...args: Parameters<GameEffects["spawnExplosion"]>): ReturnType<GameEffects["spawnExplosion"]> {
    return this.effects.spawnExplosion(...args);
  }

  private spawnCrossSlash(...args: Parameters<GameEffects["spawnCrossSlash"]>): ReturnType<GameEffects["spawnCrossSlash"]> {
    return this.effects.spawnCrossSlash(...args);
  }

  private spawnShieldFlash(...args: Parameters<GameEffects["spawnShieldFlash"]>): ReturnType<GameEffects["spawnShieldFlash"]> {
    return this.effects.spawnShieldFlash(...args);
  }

  private spawnVanguardSmash(...args: Parameters<GameEffects["spawnVanguardSmash"]>): ReturnType<GameEffects["spawnVanguardSmash"]> {
    return this.effects.spawnVanguardSmash(...args);
  }

  private spawnCounterBurst(...args: Parameters<GameEffects["spawnCounterBurst"]>): ReturnType<GameEffects["spawnCounterBurst"]> {
    return this.effects.spawnCounterBurst(...args);
  }

}
