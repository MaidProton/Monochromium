import type { TowerAttackSound } from "../audio.ts";
import type { SimulationEvent } from "../simulationProtocol.ts";
import type { TowerOverlayItem } from "../towerOverlay.ts";
import type {
  Enemy,
  PlacementPreview,
  Point,
  Projectile,
  Tower,
  TowerAbilitySlot,
  TowerInspectorStat,
  TowerLevelStats,
  TowerKind,
  DamageType,
} from "../types.ts";

export type TowerSimulationEvent = Omit<SimulationEvent, "id" | "tick" | "cosmeticSeed">;

/**
 * The small slice of shared simulation state a tower behavior may use.
 * Target eligibility and tower state remain owned by Game; behaviors only
 * choose the tower-specific action and call back into shared mechanics.
 */
export interface TowerAttackBehaviorContext {
  readonly tower: Tower;
  readonly accent: string;
  readonly candidates: readonly Enemy[];
  readonly chainCandidates: readonly Enemy[];
  readonly coneCandidates: readonly Enemy[];
  readonly baseDamage: number;
  readonly damage: number;
  readonly fireRate: number;
  readonly ammoCapacity?: number;
  readonly reloadDuration?: number;
  readonly delta: number;
  readonly range: number;
  readonly selectTarget: (candidates: readonly Enemy[]) => Enemy | undefined;
  readonly enemyPosition: (enemy: Enemy) => Point;
  readonly enemiesInCone: (
    aim: Point,
    candidates: readonly Enemy[],
    range: number,
    halfAngle: number,
  ) => readonly Enemy[];
  readonly enemiesInLineFrom: (origin: Point, aim: Point, range: number, width: number) => readonly Enemy[];
  readonly enemiesInLine: (target: Enemy, range: number, width: number) => readonly Enemy[];
  readonly areaTargets: (radius: number) => readonly Enemy[];
  readonly damageEnemy: (enemy: Enemy, amount: number, damageType?: DamageType) => void;
  readonly damageEnemiesInRadius: (center: Point, radius: number, amount: number, damageType?: DamageType) => void;
  readonly damageEnemiesInRadiusExcluding: (center: Point, radius: number, amount: number, excludedId: number, damageType?: DamageType) => void;
  readonly applyBurn: (enemy: Enemy, duration: number, damage: number, slowFactor: number, tickInterval: number, strength?: number, speedMultiplier?: number) => void;
  readonly applyStun: (enemy: Enemy, duration: number) => void;
  readonly emitHitscanVisual: (enemy: Enemy, width?: number) => void;
  readonly emitMaceVisual: (enemy: Enemy) => void;
  readonly emitSmashVisual: (target: Enemy, radius: number, multiplier: number) => void;
  readonly emitPrismChainVisual: (from: Point, enemy: Enemy, hitIndex: number, width: number) => void;
  readonly emitFlameVisual: (target: Enemy, range: number, value: number, duration: number) => void;
  readonly emitShotgunVisual: (target: Enemy, spreadStep: number, range: number) => void;
  readonly enemyRadius: (enemy: Enemy) => number;
  readonly triggerReload: () => void;
  readonly spawnProjectile: (target: Enemy, damage: number, speed: number, splash: number, damageType?: DamageType) => void;
  readonly emitProjectileVisual: (target: Enemy, speed: number) => void;
  readonly pathBombCount: () => number;
  readonly canPlacePathBomb: (position: Point, minDistance: number) => boolean;
  readonly spawnPathBomb: (position: Point, radius: number, damageType?: DamageType) => void;
  readonly fireAdmiralShot: (damage: number) => void;
  readonly areaTargetsAround: (center: Point, radius: number) => readonly Enemy[];
  readonly nearbyEnemies: (radius: number) => readonly TowerDashTarget[];
  readonly closestPathDistance: (pathIndex: number | undefined, point: Point) => number;
  readonly pathProjection: (pathIndex: number | undefined, point: Point) => TowerPathProjection;
  readonly samplePath: (pathIndex: number | undefined, pathDistance: number) => TowerPathSample;
  readonly placementAt: (point: Point, relocatingTowerId?: number) => PlacementPreview;
  readonly commitRelocation: (placement: PlacementPreview) => void;
  readonly spawnDashTrail: (from: Point, to: Point, color: string, distance: number) => void;
  readonly emitSimulationEvent: (event: TowerSimulationEvent) => void;
  readonly addShake: (amount: number) => void;
  readonly spawnImpactDust: (position: Point) => void;
  readonly applyShock: (enemy: Enemy, duration: number, initialFactor?: number, decay?: number) => void;
  readonly emitTempestHit: (target: Enemy) => void;
  readonly emitTempestFieldEnd: () => void;
  readonly emitTempestFieldArc: () => void;
  readonly startField: (duration: number, radius: number, eventLabel: string, text: string) => void;
  readonly emitCyborgAttackVisual: (target: Enemy, isHowitzer: boolean) => void;
  readonly spawnCyborgRocketVolley: () => void;
  readonly triggerCyborgReload: () => void;
  readonly playCyborgShotSound: (isHowitzer: boolean) => void;
  readonly reload: (label: string, resetAttackRamp: boolean, setFireTimer: boolean) => void;
  readonly emitWraithFlurryPulse: (radius: number, victimCount: number) => void;
  readonly findEnemy: (id: number) => Enemy | undefined;
  readonly cancelZenithCharge: () => void;
  readonly updateZenithChargeProgress: (progress: number) => void;
  readonly finishZenithCharge: () => void;
  readonly startZenithCharge: (target: Enemy) => void;
  readonly emitZenithLance: (target: Enemy, range: number, visualWidth: number, beamLife: number) => void;
  readonly emitZenithLanceHit: (enemy: Enemy) => void;
  readonly emitSlashVisual: (enemy: Enemy, reach: number, halfAngle: number, direction?: 1 | -1, duration?: number, sound?: TowerAttackSound) => void;
  readonly nextSlashDirection: () => 1 | -1;
  readonly emitStrikeVisual: (enemy: Enemy) => void;
  readonly scheduleDelayedStrike: (enemy: Enemy, damage: number, delay: number) => void;
  readonly fireRateCooldown: (baseCooldown: number) => number;
  readonly burstSpacingCooldown: (baseSpacing: number) => number;
  readonly spawnRing: (position: Point, life: number, size: number, radius: number) => void;
  readonly spawnText: (position: Point, text: string) => void;
  readonly spawnMuzzleFlash: (enemy: Enemy, size: number) => void;
  readonly playAttackSound: () => void;
}

export interface TowerCounterBehaviorContext {
  readonly tower: Tower;
  readonly victims: readonly Enemy[];
  readonly chainCandidates: readonly Enemy[];
  readonly damage: number;
  readonly baseDamage: number;
  readonly fireRate: number;
  readonly range: number;
  readonly selectTarget: (candidates: readonly Enemy[]) => Enemy | undefined;
  readonly enemyPosition: (enemy: Enemy) => Point;
  readonly damageEnemy: (enemy: Enemy, amount: number, damageType?: DamageType) => void;
  readonly damageEnemiesInRadius: (center: Point, radius: number, amount: number, damageType?: DamageType) => void;
  readonly applyBurn: (enemy: Enemy, duration: number, damage: number, slowFactor: number, tickInterval: number, strength?: number, speedMultiplier?: number) => void;
  readonly fireRateCooldown: (baseCooldown: number) => number;
  readonly applyStun: (enemy: Enemy, duration: number) => void;
  readonly emitHitscanVisual: (enemy: Enemy, width?: number) => void;
  readonly emitSlashVisual: (enemy: Enemy, reach: number, halfAngle: number, direction?: 1 | -1, duration?: number, sound?: TowerAttackSound) => void;
  readonly emitCrossSlashVisual: (aim: Point, reach: number) => void;
  readonly spawnShieldFlash: (reach: number) => void;
  readonly emitSmashVisual: (target: Enemy, radius: number, multiplier: number) => void;
  readonly emitPrismChainVisual: (from: Point, enemy: Enemy, hitIndex: number, width: number) => void;
  readonly emitFlameCounterVisual: (range: number) => void;
  readonly emitExplosionCounterVisual: (enemy: Enemy, radius: number) => void;
  readonly emitSamuraiCounterVisual: (aim: Point, reach: number) => void;
  readonly emitWraithCounterVisual: () => void;
  readonly enemiesInLine: (target: Enemy, range: number, width: number) => readonly Enemy[];
  readonly emitZenithLance: (target: Enemy, range: number, visualWidth: number, beamLife: number) => void;
  readonly emitZenithLanceHit: (enemy: Enemy) => void;
  readonly fireAdmiralSupport: (damage: number) => void;
  readonly startField: (duration: number, radius: number, eventLabel: string, text: string) => void;
  readonly areaTargetsAround: (center: Point, radius: number) => readonly Enemy[];
  readonly applyShock: (enemy: Enemy, duration: number, initialFactor?: number, decay?: number) => void;
  readonly emitTempestCounterVisual: () => void;
  readonly counterRounds: number;
  readonly emitCyborgCounterVisual: (victims: readonly Enemy[], rounds: number) => void;
  readonly emitRallyFireVisual: (enemy: Enemy) => void;
  readonly emitShotgunCounterVisual: (enemy: Enemy) => void;
  readonly resetMagazine: () => void;
  readonly emitBurstCounterVisual: (enemy: Enemy, burst: number) => void;
  readonly spawnImpactDust: (position: Point) => void;
  readonly spawnText: (text: string) => void;
}

export interface TowerBehavior {
  readonly counterName: string;
  readonly counterScope?: "engaged" | "range";
  readonly attackSound?: { readonly pitch: number; readonly sound: TowerAttackSound };
  readonly hitscanVisual?: "tracer" | "beam";
  readonly onProjectileLaunch?: (context: TowerProjectileLaunchBehaviorContext) => void;
  readonly presentEvent?: (context: TowerPresentationBehaviorContext) => boolean;
  readonly persistentEvent?: (event: SimulationEvent) => boolean;
  readonly persistentFieldDuration?: (tower: Tower) => number;
  readonly mirrorCharge?: boolean;
  readonly flameStream?: boolean;
  /** Returns the tower's current base attack interval before shared fire-rate buffs. */
  readonly getBaseAttackInterval?: (tower: Tower, configuredInterval: number) => number;
  readonly abilityTargetInRange?: (tower: Tower, enemies: readonly Enemy[], canTarget: (enemy: Enemy) => boolean, range: number, enemyPosition: (enemy: Enemy) => Point) => boolean;
  readonly activeGlow?: (tower: Tower) => boolean;
  readonly drawRange?: (context: TowerRenderBehaviorContext) => void;
  readonly drawWorld?: (context: TowerRenderBehaviorContext) => void;
  /** Registers dynamic above/below tower readouts into the shared overlay layout. */
  readonly drawSupplemental?: (context: TowerRenderBehaviorContext) => void;
  readonly drawAim?: (context: TowerRenderBehaviorContext) => void;
  readonly pauseAbilityCooldownWhileActive?: boolean;
  readonly onCreate?: (context: TowerLifecycleBehaviorContext) => void;
  readonly onDeploy?: (context: TowerLifecycleBehaviorContext) => void;
  readonly onUpgrade?: (context: TowerLifecycleBehaviorContext) => void;
  readonly onDebugMax?: (context: TowerLifecycleBehaviorContext) => void;
  readonly sellRefundRate?: (tower: Tower) => number;
  /** Optional tower-specific readouts for the detailed inspector. */
  readonly inspectorStats?: (tower: Tower, stats: TowerLevelStats) => readonly TowerInspectorStat[];
  readonly filterTargets?: (tower: Tower, candidates: readonly Enemy[]) => readonly Enemy[];
  readonly damageMultiplier?: (tower: Tower) => number;
  readonly onDamageDealt?: (context: TowerDamageDealtBehaviorContext) => void;
  readonly onEnemyKilled?: (context: TowerEnemyKilledBehaviorContext) => void;
  readonly aim?: (context: TowerAimBehaviorContext) => boolean;
  readonly cancelAim?: (context: TowerAimBehaviorContext) => boolean;
  readonly projectileDamage?: (projectile: Projectile, enemy: Enemy) => number;
  readonly timedBombDamage?: (towerLevel: number, enemy: Enemy, baseDamage: number) => number;
  readonly ability?: (context: TowerAbilityBehaviorContext) => boolean | void;
  readonly update?: (context: TowerBehaviorUpdateContext) => void;
  readonly onArrival?: (context: TowerArrivalBehaviorContext) => void;
  /** Return true when the shared attack loop should skip the rest of this tick. */
  readonly beforeAttack?: (context: TowerAttackBehaviorContext) => boolean;
  readonly attack?: (context: TowerAttackBehaviorContext, target: Enemy) => void;
  readonly counter?: (context: TowerCounterBehaviorContext) => void;
}

export interface TowerProjectileLaunchBehaviorContext {
  readonly projectile: Projectile;
  readonly playSound: (pitch: number, sound: TowerAttackSound) => void;
}

export interface TowerVisualProjectileSpec {
  readonly start: Point;
  readonly endpoint: Point;
  readonly targetId: number | null;
  readonly speed: number;
  readonly color: string;
  readonly splash: boolean;
  readonly style?: "admiral" | "mecha-missile";
  readonly delay?: number;
  readonly launchTowerId?: number;
  readonly launchSide?: number;
  readonly flightDuration?: number;
  readonly scale: number;
}

export interface TowerDashTarget {
  readonly enemy: Enemy;
  readonly position: Point;
  readonly radius: number;
}

export interface TowerPathSample {
  readonly point: Point;
  readonly direction: Point;
  readonly totalLength: number;
}

export interface TowerPathProjection {
  readonly distance: number;
  readonly offset: number;
  readonly totalLength: number;
}

export interface TowerPresentationBehaviorContext {
  readonly event: SimulationEvent;
  readonly tower?: Tower;
  readonly target?: Enemy;
  readonly position?: Point;
  readonly enemyPosition: (enemy: Enemy) => Point;
  readonly spawnLightningAuraArc: (position: Point, radius: number, color: string) => void;
  readonly color: string;
  readonly spawnRing: (position: Point, color: string, life: number, size: number, radius: number) => void;
  readonly spawnBeam: (from: Point, to: Point, color: string, width: number, delay?: number, secondaryColor?: string, life?: number) => void;
  readonly spawnMuzzleFlash: (from: Point, to: Point, color: string, size: number) => void;
  readonly spawnArc: (from: Point, to: Point, color: string) => void;
  readonly spawnFlash: (position: Point, color: string, size: number) => void;
  readonly spawnExplosion: (position: Point, color: string, radius: number, scale?: number) => void;
  readonly spawnImpactDust: (position: Point, color: string) => void;
  readonly spawnSlash: (from: Point, to: Point, color: string, reach: number, spread: number, delay?: number, sound?: "wraith-flurry", life?: number, direction?: 1 | -1) => void;
  readonly spawnCrossSlash: (from: Point, to: Point, color: string, reach: number, secondaryColor?: string) => void;
  readonly spawnCyborgBeam: (from: Point, to: Point, color: string, width: number) => void;
  readonly spawnBulletTracer: (from: Point, to: Point, color: string, width: number) => void;
  readonly spawnFlameCone: (from: Point, to: Point, halfAngle: number) => void;
  readonly spawnWraithDashTrail: (from: Point, to: Point, color: string, distance: number) => void;
  readonly spawnWraithFlurry: (position: Point, color: string, radius: number) => void;
  readonly spawnWraithFlurrySlashes: (position: Point, color: string, radius: number) => void;
  readonly spawnShieldFlash: (position: Point, color: string, reach: number) => void;
  readonly spawnVanguardMaceStrike: (from: Point, to: Point, color: string) => void;
  readonly spawnVanguardSmash: (position: Point, color: string, radius: number) => void;
  readonly startInfernusFlameStream: (tower: Tower, target: Point) => void;
  readonly spawnText: (position: Point, text: string, color: string) => void;
  readonly enqueueVisualProjectile: (spec: TowerVisualProjectileSpec) => void;
  readonly playShoot: (pitch: number, sound?: TowerAttackSound) => void;
  readonly playCounter: () => void;
  readonly playAbility: (kind?: TowerKind) => void;
  readonly playEffect: (effect: "tempest-arc" | "tempest-field") => void;
  readonly playBreach: (kind?: TowerKind) => void;
  readonly playTone: (pitch: number, duration: number, volume: number, detune: number, bus: "ui" | "enemies" | "towers") => void;
  readonly clearZenithCharge: (entityId: number) => void;
  readonly setZenithCharge: (entityId: number, targetId: number, duration: number, angle: number) => void;
  readonly setTempestField: (entityId: number, duration: number, color: string) => void;
  readonly clearTempestField: (entityId: number) => void;
}

export interface TowerRenderBehaviorContext {
  readonly chassisPose?: { readonly angle: number; readonly treadOffset: number };
  readonly tower: Tower;
  readonly context: CanvasRenderingContext2D;
  readonly elapsed: number;
  readonly canvasGlow: boolean;
  readonly accent: string;
  readonly dimAccent: string;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly showSupplementalStats: boolean;
  readonly isMirror: boolean;
  readonly pointer?: Point;
  readonly mirrorZenithCharge?: { readonly remaining: number; readonly targetId: number; readonly angle?: number };
  readonly findEnemy: (id: number) => Enemy | undefined;
  readonly enemyPosition: (enemy: Enemy) => Point;
  readonly towerRange: number;
  readonly towerSplash: number;
  readonly towerFireRate: number;
  readonly towerAmmoCapacity?: number;
  readonly addOverlay: (item: TowerOverlayItem) => void;
  /** Draws a centered bar inside an already-laid-out overlay item. */
  readonly drawOverlayBar: (x: number, centerY: number, width: number, height: number, value: number, color: string) => void;
  readonly clampAimPoint: (point: Point) => Point;
}

export interface TowerBehaviorUpdateContext {
  readonly tower: Tower;
  readonly delta: number;
  readonly attackContext: TowerAttackBehaviorContext;
  readonly stanceWasActive: boolean;
  readonly refreshDamageBuff: () => void;
  readonly nearbyTowers: readonly Tower[];
  readonly applyDamageBuff: (tower: Tower, multiplier: number, duration: number) => void;
  readonly spawnText: (text: string, color?: string) => void;
  readonly spawnRing: (life: number, size: number, radius: number, color?: string) => void;
  readonly healTower: (amount: number, text: string, color?: string) => void;
  readonly emitSimulationEvent: (event: TowerSimulationEvent) => void;
}

export interface TowerLifecycleBehaviorContext {
  readonly tower: Tower;
  readonly stats: TowerLevelStats;
  readonly placement?: PlacementPreview;
  readonly accent: string;
  readonly dimAccent: string;
  readonly startField: (duration: number, radius: number, eventLabel: string, text: string) => void;
  readonly triggerFirstTempestPlacement: () => boolean;
  readonly fireRateCooldown: (baseCooldown: number) => number;
  readonly abilityCooldownFor: (slot: TowerAbilitySlot) => number;
}

export interface TowerEnemyKilledBehaviorContext {
  readonly tower: Tower;
  readonly healing: number;
  readonly accent: string;
  readonly spawnText: (text: string) => void;
  readonly spawnRing: () => void;
}

export interface TowerDamageDealtBehaviorContext {
  readonly tower: Tower;
  /** Actual HP damage after defense, armor, and overkill clamping. */
  readonly damage: number;
  readonly killed: boolean;
  readonly baseDps: number;
  readonly triggerDamageBuff: (multiplier: number, duration: number) => void;
}

export interface TowerAimBehaviorContext {
  readonly tower: Tower;
  readonly point?: Point;
  readonly clampPoint: (point: Point) => Point;
  readonly accent: string;
  readonly dimAccent: string;
  readonly spawnText: (point: Point, text: string, color?: string) => void;
  readonly log: (message: string, tone?: "neutral" | "good" | "danger") => void;
  readonly playAbilitySound: () => void;
  readonly playFailSound: () => void;
  readonly emitUi: () => void;
}

export interface TowerArrivalBehaviorContext {
  readonly tower: Tower;
  readonly candidates: readonly Enemy[];
  readonly damage: number;
  readonly range: number;
  readonly damageEnemy: (enemy: Enemy, amount: number, damageType?: DamageType) => void;
  readonly emitSlashVisual: (to: Point, reach: number, halfAngle: number) => void;
  readonly spawnRing: (life: number, size: number, radius: number) => void;
  readonly spawnText: (text: string) => void;
  readonly playAttackSound: () => void;
}

export interface TowerAbilityBehaviorContext {
  readonly tower: Tower;
  readonly slot: TowerAbilitySlot;
  readonly abilityCooldown: number;
  readonly nearbyTowers: readonly Tower[];
  readonly radius: number;
  readonly baseDamage: number;
  readonly abilityCandidates: readonly Enemy[];
  readonly abilityTargets: (radius: number) => readonly Enemy[];
  readonly startAimMode: () => void;
  readonly selectTarget: (candidates: readonly Enemy[]) => Enemy | undefined;
  readonly enemyPosition: (enemy: Enemy) => Point;
  readonly applyDamageBuff: (tower: Tower, multiplier: number, duration: number) => void;
  readonly spawnBuffRing: (tower: Tower) => void;
  readonly spawnAbilityRing: (radius: number) => void;
  readonly spawnText: (text: string) => void;
  readonly spawnAbilityText: (position: Point, text: string, color?: string) => void;
  readonly damageEnemy: (enemy: Enemy, amount: number, damageType?: DamageType) => void;
  readonly emitSlashVisual: (enemy: Enemy, reach: number, halfAngle: number, direction?: 1 | -1, duration?: number, sound?: TowerAttackSound) => void;
  readonly nextSlashDirection: () => 1 | -1;
  readonly refreshDamageBuff: () => void;
  readonly emitWraithFlurryStart: (radius: number) => void;
  readonly log: (message: string) => void;
  readonly playAbilitySound: () => void;
  readonly spawnTimedBomb: (target: Enemy, damage: number, radius: number, timer: number, damageType?: DamageType) => void;
  readonly spawnTimedBombAt: (position: Point, damage: number, radius: number, timer: number, label?: string, damageType?: DamageType) => void;
  readonly spawnAbilityTracer: (target: Enemy) => void;
  readonly emitSimulationEvent: (event: TowerSimulationEvent) => void;
  readonly logDanger: (message: string) => void;
  readonly playAbilityTone: () => void;
  readonly failAbility: () => void;
}
