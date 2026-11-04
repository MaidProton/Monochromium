import type { DamageType, EnemyResistances } from "./damageTypes.ts";
export type { DamageType, EnemyResistances } from "./damageTypes.ts";
export { DAMAGE_TYPES, DAMAGE_TYPE_LABELS } from "./damageTypes.ts";

export type Point = Readonly<{ x: number; y: number }>;
export type PlayerId = string;

export type TowerKind =
  | "bandit"
  | "samurai"
  | "tempest"
  | "cyborg"
  | "mercenary"
  | "infernus"
  | "bomber"
  | "recon"
  | "gunner"
  | "warrior"
  | "wraith"
  | "admiral"
  | "vanguard"
  | "latch"
  | "prism"
  | "zenith"
  | "mecha";
export type OfficialEnemyKind =
  | "dummy"
  | "speedy"
  | "slow"
  | "rusher"
  | "dummyBoss"
  | "transparentDummy"
  | "tough"
  | "dummymancer"
  | "necromancerBoss"
  | "slowBoss"
  | "transparentBoss"
  | "eliteRusher"
  | "speedyBoss"
  | "toughBoss"
  | "bigDummy"
  | "platedDummy"
  | "bulwark"
  | "phaseRunner"
  | "warDrummer"
  | "siegeColossus"
  | "hardenedDummy"
  | "swiftRusher"
  | "aegisRunner"
  | "regenerator"
  | "signalCaptain"
  | "siphonWarden"
  | "phaseBrute"
  | "blinkStalker"
  | "aegisBehemoth"
  | "overseer";
export type CustomEnemyKind = `custom-enemy:${string}`;
export type EnemyKind = OfficialEnemyKind | CustomEnemyKind;
export type ModeKind = "normal" | "hard" | `custom:${string}`;
export type OfficialMapKind = "sector07" | "switchback" | "overpass";
export type CustomMapKind = `custom-map:${string}`;
export type MapKind = OfficialMapKind | CustomMapKind;
export type TargetingMode = "first" | "last" | "strongest" | "weakest" | "closest";

export type EnemySpriteShape = "circle" | "square" | "diamond" | "hexagon" | "polygon";
export type EnemyAppearanceMode = "procedural" | "drawing";

export type EnemyAttackDelivery = "ranged" | "wave" | "forward";
export type EnemyAttackVisualType = "projectile" | "beam" | "explosion" | "lightning" | "wave" | "slash";

export type EnemyAttackEffectDefinition =
  | { readonly type: "damage"; readonly amount: number }
  | { readonly type: "stun"; readonly duration: number };

export interface EnemyAttackVisualDefinition {
  readonly type: EnemyAttackVisualType;
  readonly color: string;
  readonly size: number;
  readonly width: number;
  readonly duration: number;
  readonly speed: number;
}

export interface EnemyAttackDefinition {
  readonly id: string;
  readonly name: string;
  readonly cooldown: number;
  /** Zero means unlimited uses. */
  readonly maxUses: number;
  readonly minHp: number | null;
  readonly maxHp: number | null;
  readonly minAliveTime: number | null;
  readonly maxAliveTime: number | null;
  readonly targeting: TargetingMode;
  readonly range: number;
  readonly maxTargets: number;
  readonly delivery: EnemyAttackDelivery;
  readonly width: number;
  readonly depth: number;
  /** Forward-cone angle in degrees. */
  readonly angle: number;
  readonly projectileSpeed: number;
  readonly effects: readonly EnemyAttackEffectDefinition[];
  readonly visuals: readonly EnemyAttackVisualDefinition[];
}

export type EnemyAbilityEditorMode = "basic" | "advanced";
export type EnemyAbilityLifecyclePhase = "trigger" | "telegraph" | "target-lock" | "impact" | "action" | "complete";

export interface EnemyAbilityHpOperand {
  readonly unit: "absolute" | "percent";
  readonly value: number;
}

export type EnemyAbilityTrigger =
  | { readonly type: "spawn" }
  | { readonly type: "elapsed-time"; readonly at: number }
  | { readonly type: "interval"; readonly every: number; readonly initialDelay: number }
  | { readonly type: "hp-threshold"; readonly direction: "below" | "above"; readonly threshold: EnemyAbilityHpOperand }
  | { readonly type: "blocked" }
  | { readonly type: "stunned" }
  | { readonly type: "attack" }
  | { readonly type: "death" };

export type EnemyAbilityTargetState =
  | "blocked"
  | "unblocked"
  | "target-present"
  | "target-missing"
  | "target-stunned"
  | "target-not-stunned"
  | "target-damaged"
  | "target-full-health";

export type EnemyAbilityCondition =
  | { readonly type: "hp"; readonly minimum: EnemyAbilityHpOperand | null; readonly maximum: EnemyAbilityHpOperand | null }
  | { readonly type: "age"; readonly minimum: number | null; readonly maximum: number | null }
  | { readonly type: "path-distance"; readonly minimum: number | null; readonly maximum: number | null }
  | { readonly type: "target-state"; readonly state: EnemyAbilityTargetState }
  | { readonly type: "cooldown-ready" }
  | { readonly type: "uses-remaining" };

export type EnemyAbilityDelivery =
  | { readonly type: "targeted" }
  | { readonly type: "cone"; readonly depth: number; readonly angle: number }
  | { readonly type: "wave"; readonly depth: number; readonly width: number }
  | { readonly type: "radial"; readonly radius: number };

export interface EnemyAbilityVisualLayer {
  readonly id: string;
  readonly type: EnemyAttackVisualType;
  readonly color: string;
  readonly size: number;
  readonly width: number;
  readonly duration: number;
  readonly speed: number;
  /** Seconds after activation at which this visual begins. */
  readonly startOffset: number;
}

export interface EnemyAbilityAttackDefinition {
  readonly targeting: TargetingMode;
  readonly range: number;
  readonly maxTargets: number;
  readonly delivery: EnemyAbilityDelivery;
  readonly telegraphDuration: number;
  readonly targetLock: "activation" | "impact";
  /** Seconds after activation at which target-bound effects begin. */
  readonly impactTime: number;
  readonly visuals: readonly EnemyAbilityVisualLayer[];
}

export type EnemyAbilityActionDefinition =
  | { readonly id: string; readonly type: "damage"; readonly delay: number; readonly amount: number }
  | { readonly id: string; readonly type: "stun"; readonly delay: number; readonly duration: number }
  | { readonly id: string; readonly type: "summon"; readonly delay: number; readonly count: number; readonly kinds: readonly EnemyKind[]; readonly modifiers: EnemySummonModifiers }
  | { readonly id: string; readonly type: "regeneration"; readonly delay: number; readonly mode: "total" | "rate"; readonly amount: number; readonly duration: number | null }
  | { readonly id: string; readonly type: "movement-lock"; readonly delay: number; readonly duration: number; readonly waves: number }
  | { readonly id: string; readonly type: "blink"; readonly delay: number; readonly distance: number }
  | { readonly id: string; readonly type: "invulnerability"; readonly delay: number; readonly duration: number }
  | { readonly id: string; readonly type: "stat-change"; readonly delay: number; readonly duration: number; readonly speedMultiplier: number; readonly damageMultiplier: number }
  | { readonly id: string; readonly type: "haste"; readonly delay: number; readonly radius: number; readonly duration: number; readonly multiplier: number }
  | { readonly id: string; readonly type: "drain"; readonly delay: number; readonly damage: number; readonly healingPerTarget: number }
  | { readonly id: string; readonly type: "phase"; readonly delay: number; readonly duration: number };

export interface EnemyAbilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly editorMode: EnemyAbilityEditorMode;
  readonly priority: number;
  readonly cooldown: number;
  /** Zero means unlimited uses. */
  readonly maxUses: number;
  readonly exclusiveGroup: string | null;
  readonly trigger: EnemyAbilityTrigger;
  readonly conditions: readonly EnemyAbilityCondition[];
  readonly attack: EnemyAbilityAttackDefinition | null;
  readonly actions: readonly EnemyAbilityActionDefinition[];
}

export interface EnemyAbilityRuntimeEntry {
  uses: number;
  cooldownRemaining: number;
  intervalRemaining: number;
  intervalArmed: boolean;
  elapsedTriggered: boolean;
  hpWasPastThreshold: boolean;
}

export interface EnemyAbilityActiveEffect {
  readonly abilityId: string;
  readonly actionId: string;
  readonly type: "regeneration" | "movement-lock" | "invulnerability" | "stat-change" | "phase";
  remaining: number;
  waves: number;
  remainingAmount: number;
  rate: number;
  speedMultiplier: number;
  damageMultiplier: number;
}

export interface EnemyAbilityRuntimeState {
  entries: Record<string, EnemyAbilityRuntimeEntry>;
  groupLocks: Record<string, number>;
  signals: Array<"spawn" | "blocked" | "stunned" | "attack">;
  previousHp: number;
  activeEffects: EnemyAbilityActiveEffect[];
  pendingActions: Array<{
    readonly abilityId: string;
    readonly actionId: string;
    readonly dueTick: number;
    readonly lockedTargetIds: readonly number[];
    readonly sourceId: number;
    readonly sourceKind: EnemyKind;
    readonly sourcePosition: Point;
    readonly sourceDirection: Point;
    readonly sourcePathDistance: number;
  }>;
}

export interface EnemySummonModifiers {
  /** Multiplier applied to hitcash earned from damage dealt to the summoned enemy. */
  readonly hitCashMultiplier: number;
  readonly hpMultiplier: number;
  readonly shieldMultiplier: number;
  readonly speedMultiplier: number;
  readonly damageMultiplier: number;
  /** Lower values make the summoned enemy attack more quickly. */
  readonly attackIntervalMultiplier: number;
  readonly coreDamageMultiplier: number;
  readonly defenseBonus: number;
  readonly protectionBonus: number;
  readonly armorBonus: number;
  readonly superarmorBonus: number;
  readonly resistanceBonuses?: EnemyResistances;
}

export type EnemyBehaviorActionDefinition =
  | { readonly type: "stop"; readonly delay: number; readonly duration: number }
  | { readonly type: "invulnerable"; readonly delay: number; readonly duration: number }
  | { readonly type: "regenerate"; readonly delay: number; readonly amount: number; readonly duration: number }
  | { readonly type: "stomp"; readonly delay: number; readonly radius: number; readonly damage: number; readonly stunDuration: number }
  | { readonly type: "stat-change"; readonly delay: number; readonly duration: number; readonly speedMultiplier: number; readonly damageMultiplier: number }
  | { readonly type: "blink"; readonly delay: number; readonly distance: number };

export interface EnemyBehaviorRuleDefinition {
  readonly id: string;
  readonly name: string;
  /** Inclusive HP bounds. Null means the bound is disabled. */
  readonly minHp: number | null;
  readonly maxHp: number | null;
  /** Inclusive seconds-alive bounds. Null means the bound is disabled. */
  readonly minAliveTime: number | null;
  readonly maxAliveTime: number | null;
  readonly cooldown: number;
  /** Zero means unlimited uses. */
  readonly maxUses: number;
  readonly actions: readonly EnemyBehaviorActionDefinition[];
}

export interface EnemyDefinition {
  readonly kind: EnemyKind;
  readonly name: string;
  readonly hp: number;
  /** A separate damage buffer that does not award hitcash or spill into HP. */
  readonly shieldHp: number;
  readonly speed: number;
  readonly damage: number;
  readonly attackInterval: number;
  readonly telegraphDuration: number;
  readonly coreDamage: number;
  readonly radius: number;
  readonly hidden?: boolean;
  readonly boss?: boolean;
  readonly defense?: number;
  readonly protection?: number;
  readonly armor?: number;
  readonly superarmor?: number;
  readonly resistances?: EnemyResistances;
  readonly summon?: {
    readonly interval: number;
    readonly count: number;
    readonly kinds: readonly EnemyKind[];
    readonly modifiers?: EnemySummonModifiers;
  };
  readonly attacks?: readonly EnemyAttackDefinition[];
  /** Unified v4 abilities. Official definitions may keep legacy fields and are normalized at runtime. */
  readonly abilities?: readonly EnemyAbilityDefinition[];
  readonly timeLock?: { readonly distance: number; readonly duration: number };
  readonly waveLock?: { readonly distance: number; readonly waves: number };
  readonly shockwave?: {
    readonly interval: number;
    readonly radius: number;
    readonly stunDuration: number;
  };
  readonly regeneration?: {
    readonly rate: number;
  };
  readonly hastePulse?: {
    readonly interval: number;
    readonly radius: number;
    readonly duration: number;
    readonly multiplier: number;
  };
  readonly drain?: {
    readonly interval: number;
    readonly radius: number;
    readonly damage: number;
    readonly healingPerTower: number;
  };
  readonly phase?: {
    readonly interval: number;
    readonly duration: number;
  };
  readonly blink?: {
    readonly interval: number;
    readonly distance: number;
  };
  readonly behaviorRules?: readonly EnemyBehaviorRuleDefinition[];
  readonly sprite: {
    readonly shape: EnemySpriteShape;
    readonly fill: string;
    readonly stroke: string;
    readonly accent: string;
    readonly glyph: string;
    readonly sides?: number;
    readonly appearance?: EnemyAppearanceMode;
    readonly drawing?: string;
    readonly opacity?: number;
  };
}

export interface TowerUpgradeDefinition {
  readonly level: number;
  readonly cost: number;
  readonly title: string;
  readonly onPathSkill: string;
  readonly offPathSkill: string;
}

export interface TowerAbilityDefinition {
  readonly name: string;
  readonly description: string;
  readonly unlockLevel: number;
  readonly cooldown: number;
  readonly duration?: number;
  /** Automatic abilities are passive status modules, never manual F/G/H commands. */
  readonly automatic?: boolean;
}

export type TowerPerkKind = "backdraft" | "high-noon" | "glass-cannon" | "cold-chamber" | "mutiny";
export type TowerPerkCurrency = "coins" | "tokens";

export type TowerPerkEffect =
  | {
      readonly type: "backdraft";
      readonly burnTickRateMultiplier: number;
      readonly hasteByLevel: readonly number[];
    }
  | {
      readonly type: "high-noon";
      readonly prepDuration: number;
      readonly cooldown: number;
      readonly damageBonusByLevel: readonly number[];
      readonly fireRateBonusByLevel: readonly number[];
      readonly durationByLevel: readonly number[];
      readonly ability: TowerAbilityDefinition;
    }
  | {
      readonly type: "glass-cannon";
      readonly damageMultiplier: number;
      readonly attackIntervalMultiplier: number;
      readonly splashMultiplier: number;
    }
  | {
      readonly type: "cold-chamber";
      readonly damageMultiplier: number;
      readonly chargedShotEvery: number;
      readonly chargedShotStunDuration: number;
    }
  | {
      readonly type: "mutiny";
      readonly damageMultiplier: number;
      readonly killTargetByLevel: readonly number[];
      readonly damageTriggerSeconds: number;
      readonly damageBonusByLevel: readonly number[];
      readonly durationByLevel: readonly number[];
    };

export interface TowerPerkDefinition {
  readonly kind: TowerPerkKind;
  readonly name: string;
  readonly target: TowerKind;
  readonly currency: TowerPerkCurrency;
  readonly cost: number;
  readonly accent: string;
  readonly description: string;
  readonly tradeoff: string;
  readonly effect: TowerPerkEffect;
}

export interface TowerLevelStats {
  readonly damage: number;
  readonly fireRate: number;
  readonly range: number;
  readonly splash?: number;
  readonly hpMultiplier: number;
  readonly aggroBonus: number;
  readonly ammo?: number;
  readonly reload?: number;
}

export interface TowerControlDefinition {
  readonly movementSpeed: readonly number[];
  readonly acceleration: readonly number[];
  readonly braking: readonly number[];
  /** Radians per second; hull and weapon aiming are independent. */
  readonly hullTurnRate: readonly number[];
  readonly turretTurnRate: readonly number[];
  readonly bodyRadius: number;
  /** Maximum blocking reach in world units, plus the enemy's body radius. */
  readonly engagementRange: number;
  readonly cannonWidth: readonly number[];
  readonly cannonPierce: readonly number[];
  readonly heat: {
    readonly max: readonly number[];
    readonly cannonPerShot: readonly number[];
    readonly missile: readonly number[];
    readonly beamPerSecond: readonly number[];
    readonly flamePerSecond: readonly number[];
    readonly ventPerSecond: readonly number[];
    readonly overheatLock: number;
    readonly recoverAt: number;
  };
  readonly missiles: {
    readonly volley: readonly number[];
    readonly damage: readonly number[];
    readonly radius: readonly number[];
    readonly fuse: number;
    readonly speed: number;
    readonly launchSpacing: number;
    readonly spread: number;
  };
  readonly beam: {
    readonly duration: readonly number[];
    readonly damage: readonly number[];
    readonly width: readonly number[];
    readonly tickInterval: number;
  };
  readonly flame: {
    readonly duration: readonly number[];
    readonly damage: readonly number[];
    readonly range: readonly number[];
    readonly halfAngle: readonly number[];
    readonly burnDuration: readonly number[];
    readonly burnDamage: readonly number[];
    readonly burnTickInterval: number;
    readonly tickInterval: number;
  };
}

export interface TowerDefinition {
  readonly kind: TowerKind;
  readonly name: string;
  readonly glyph: string;
  readonly cost: number;
  readonly unlockCost: number;
  readonly copyLimit: number;
  readonly accent: string;
  readonly dimAccent: string;
  readonly damageType?: DamageType;
  readonly hiddenDetectionLevel?: number;
  readonly onPath: {
    readonly title: string;
    readonly description: string;
    readonly hp: number;
    readonly maxAggro: number;
  };
  readonly offPath: {
    readonly title: string;
    readonly description: string;
  };
  readonly counter: string;
  /** New slot-based abilities. Legacy `ability` is treated as the F slot. */
  readonly abilities?: Partial<Record<TowerAbilitySlot, TowerAbilityDefinition>>;
  readonly ability?: TowerAbilityDefinition;
  readonly control?: TowerControlDefinition;
  readonly levels: readonly TowerLevelStats[];
  readonly upgrades: readonly TowerUpgradeDefinition[];
}

export interface TowerInspectorStat {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly group: "combat" | "targeting" | "systems" | "advanced";
}

export type TowerInspectorPopoverKey = "damage" | "fire-rate" | "range" | "dps";

export interface TowerInspectorPopoverRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly tone?: "normal" | "accent" | "total";
}

export interface TowerInspectorPopover {
  readonly key: TowerInspectorPopoverKey;
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly TowerInspectorPopoverRow[];
}

export interface TowerInspectorData {
  readonly stats: readonly TowerInspectorStat[];
  readonly sellValue: number;
  readonly popovers: readonly TowerInspectorPopover[];
}

export const getTowerAbility = (
  definition: TowerDefinition,
  slot: TowerAbilitySlot,
): TowerAbilityDefinition | undefined => definition.abilities?.[slot] ?? (slot === "f" ? definition.ability : undefined);

export const getTowerAbilitySlots = (definition: TowerDefinition): readonly TowerAbilitySlot[] =>
  TOWER_ABILITY_SLOTS.filter((slot) => getTowerAbility(definition, slot) !== undefined);

export interface Tower {
  readonly id: number;
  readonly ownerId: PlayerId;
  readonly kind: TowerKind;
  /** Profile perks captured at deployment; changing the profile cannot mutate an active run. */
  readonly perks: readonly TowerPerkKind[];
  position: Point;
  onPath: boolean;
  /** Route this pathbound tower is assigned to, when a map has multiple paths. */
  pathIndex?: number;
  pathDistance: number;
  level: number;
  totalInvested: number;
  targeting: TargetingMode;
  hp: number;
  maxHp: number;
  maxAggro: number;
  readonly engaged: Set<number>;
  fireTimer: number;
  counterCooldown: number;
  autoCounter: boolean;
  counterFlash: number;
  hurtFlash: number;
  selectedPulse: number;
  fortifyCharges: number;
  /** Remaining duration of the shared temporary damage buff. */
  overdriveTimer: number;
  /** Source multiplier for the shared temporary damage buff. */
  overdriveMultiplier?: number;
  /** Combined damage multiplier from active buffs; 1 means no buff. */
  damageBuff: number;
  abilityTimer: number;
  /** Level 4 Samurai's alternate stance. */
  senselessStance?: boolean;
  abilityCooldown: number;
  /** Independent cooldowns for slot-based abilities. */
  abilityCooldowns?: Partial<Record<TowerAbilitySlot, number>>;
  /** High Noon preparation timer. The automatic ability uses the normal ability timer for uptime. */
  perkPrepTimer?: number;
  /** Manual aim state used by towers such as Admiral. */
  aimPoint?: Point | null;
  aiming?: boolean;
  focus: number;
  /** Accumulator for Samurai's discrete Mental Focus decay ticks. */
  samuraiFocusDecayTimer?: number;
  meleeTimer: number;
  ammo: number;
  shotCounter: number;
  attackRamp: number;
  rampTimer: number;
  rampStackTimers: number[];
  fireRateBuff: number;
  idleTimer: number;
  rocketTimer: number;
  fieldTimer: number;
  fieldTickTimer: number;
  fieldVfxTimer: number;
  regenTimer: number;
  burstTimer: number;
  burstTargetId: number | null;
  burstShotsRemaining: number;
  burstSpacing: number;
  stunTimer: number;
  /** Zenith's locked pre-fire charge. Optional for compatibility with older snapshots. */
  zenithChargeTimer?: number;
  zenithChargeTargetId?: number | null;
  zenithChargeAngle?: number;
  /** Mutiny's two trigger meters and independently decaying buff stacks. */
  mutinyKillProgress?: number;
  mutinyDamageProgress?: number;
  mutinyStackTimers?: number[];
  /** Tank pilot state; the legacy mecha ID preserves existing saves/loadouts. */
  mechaControlled?: boolean;
  mechaFiring?: boolean;
  mechaActiveAbility?: Exclude<TowerAbilitySlot, "f"> | null;
  mechaAbilityTimer?: number;
  mechaHeat?: number;
  mechaOverheatTimer?: number;
  mechaHullAngle?: number;
  mechaTurretAngle?: number;
  mechaSpeed?: number;
}

export const TOWER_ABILITY_SLOTS = ["f", "g", "h"] as const;
export type TowerAbilitySlot = (typeof TOWER_ABILITY_SLOTS)[number];

export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  /** Route used by this enemy. Optional for legacy snapshots and tests. */
  pathIndex?: number;
  pathDistance: number;
  hp: number;
  readonly maxHp: number;
  shieldHp: number;
  readonly maxShieldHp: number;
  readonly speed: number;
  readonly damage: number;
  readonly attackInterval: number;
  readonly telegraphDuration: number;
  readonly coreDamage: number;
  readonly defense: number;
  protection: number;
  readonly armor: number;
  readonly superarmor: number;
  readonly resistances?: EnemyResistances;
  readonly hitCashMultiplier: number;
  readonly summonModifiers: EnemySummonModifiers;
  targetTowerId: number | null;
  attackTimer: number;
  stunTimer: number;
  slowTimer: number;
  slowFactor: number;
  shockStacks: number;
  burnTimer: number;
  burnTickTimer: number;
  burnDamage: number;
  burnOwnerId: PlayerId | null;
  burnSlowFactor: number;
  burnTickInterval: number;
  burnSpeedFactor: number;
  hitFlash: number;
  spawnScale: number;
  summonTimer: number;
  abilityTimer: number;
  regenerationVfxTimer: number;
  hasteCooldown: number;
  hasteTimer: number;
  hasteFactor: number;
  drainCooldown: number;
  phaseCooldown: number;
  phaseTimer: number;
  blinkCooldown: number;
  aliveTime: number;
  lockTriggered: boolean;
  lockTimeRemaining: number;
  lockWavesRemaining: number;
  attackCooldowns: number[];
  attackUses: number[];
  behaviorMovementLockTimer: number;
  behaviorInvulnerableTimer: number;
  behaviorSpeedFactor: number;
  behaviorDamageFactor: number;
  behaviorRuleUses: number[];
  behaviorRuleCooldowns: number[];
  behaviorActionQueue: Array<{ ruleIndex: number; actionIndex: number; timer: number }>;
  behaviorEffects: Array<
    | { type: "regenerate"; remaining: number; remainingAmount: number }
    | { type: "stat-change"; remaining: number; speedMultiplier: number; damageMultiplier: number }
  >;
  /** ID-keyed authoritative v4 ability state. Internal timers are removed from guest projections. */
  abilityRuntime?: EnemyAbilityRuntimeState;
}

export interface Projectile {
  position: { x: number; y: number };
  delay: number;
  soundPlayed?: boolean;
  readonly targetId: number;
  readonly ownerId: PlayerId;
  readonly damage: number;
  readonly kind: TowerKind;
  readonly speed: number;
  readonly splash: number;
  readonly chain: number;
  readonly towerLevel: number;
  readonly damageType?: DamageType;
}

export interface Particle {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  delay?: number;
  sound?: "wraith-flurry";
  life: number;
  readonly maxLife: number;
  readonly color: string;
  readonly size: number;
  readonly radius?: number;
  readonly angle?: number;
  readonly direction?: 1 | -1;
  readonly spread?: number;
  rotation?: number;
  readonly angularVelocity?: number;
  readonly drag?: number;
  readonly startColor?: string;
  readonly endColor?: string;
  readonly length?: number;
  readonly points?: readonly Point[];
  readonly type: "spark" | "ring" | "slash" | "strike" | "text" | "spray" | "smoke" | "flash" | "beam" | "lightning" | "flame-stream" | "flame-plume";
  readonly text?: string;
}

export interface WaveGroup {
  readonly kind: EnemyKind;
  readonly count: number;
  readonly gap: number;
}

export interface EnemyGroupWaveBlock {
  readonly command: "enemyGroup";
  readonly enemy: EnemyKind;
  readonly count: number;
  /** Seconds between enemies spawned by this block. */
  readonly spawnDelay: number;
  /** Seconds after this block starts before the following block starts. */
  readonly nextBlockDelay: number;
  /** Optional 0-based path index this group will spawn on. Clamped to highest available path if map has fewer paths. Suppresses multiplication on multiply maps. */
  readonly spawnPathIndex?: number;
}

export type WaveBlock = EnemyGroupWaveBlock;

export interface WaveDefinition {
  /** Official modes can retain their compact sequential group format. */
  readonly groups?: readonly WaveGroup[];
  /** Creator modes use independently scheduled command blocks. */
  readonly blocks?: readonly WaveBlock[];
  /** Cash awarded when this wave is cleared. Falls back to the official formula. */
  readonly cashReward?: number;
  readonly message?: string;
  readonly referenceHealth: number;
  readonly waveTimeSeconds: number | null;
}

export interface ModeDefinition {
  readonly kind: ModeKind;
  readonly name: string;
  readonly index: number;
  readonly isCustom: boolean;
  readonly description: string;
  readonly startingCash: number;
  readonly coreIntegrity: number;
  /** Multiplayer hit cash earned per point of damage, relative to solo hit cash. */
  readonly multiplayerHitCashMultiplier: number;
  readonly reward: {
    readonly coins: number;
    readonly tokens: number;
  };
  readonly waves: readonly WaveDefinition[];
}

export interface MapDefinition {
  readonly kind: MapKind;
  readonly name: string;
  readonly index: number;
  readonly isCustom: boolean;
  readonly difficulty: "Easy" | "Medium" | "Hard";
  readonly description: string;
  readonly rewardMultiplier: number;
  readonly mapScale: number;
  readonly enemyRouting?: "split" | "multiply";
  /** Authored routes. `path` and the primary-node fields remain for legacy consumers. */
  readonly paths: readonly MapPathDefinition[];
  readonly path: readonly Point[];
  readonly core: Point;
  readonly entryLabel: Point;
  readonly pathLabel: Point;
  readonly blockedZones: readonly BlockedZone[];
  readonly pathBlockers: readonly PathPlacementBlocker[];
  readonly palette: {
    readonly field: string;
    readonly glow: string;
    readonly path: string;
    readonly accent: string;
    readonly blockerOpacity?: number;
  };
}

export interface BlockedZone {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacementPreview {
  readonly position: Point;
  readonly onPath: boolean;
  readonly valid: boolean;
  readonly pathIndex?: number;
  readonly pathDistance: number;
}

export interface PathPlacementBlocker {
  readonly id: string;
  readonly pathIndex: number;
  readonly startDistance: number;
  readonly length: number;
}

export interface SelectedTowerView {
  readonly tower: Tower;
  readonly definition: TowerDefinition;
  readonly incomingAttack: number | null;
  readonly abilityTargetInRange?: boolean;
  readonly inspector: TowerInspectorData;
}

export interface MapPathDefinition {
  readonly id: string;
  readonly path: readonly Point[];
  /** Full corridor width in world units. */
  readonly width: number;
  readonly pathOpacity?: number;
  readonly pathType: MapPathType;
  readonly pathSurface: MapPathSurface;
  readonly core: Point;
  readonly entryLabel: Point;
  readonly pathLabel: Point;
}

export type MapPathType = "round" | "sharp" | "rubble";
export type MapPathSurface = "solid" | "edges";
