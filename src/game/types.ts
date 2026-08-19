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
  | "warrior";
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
  | "bigDummy";
export type CustomEnemyKind = `custom-enemy:${string}`;
export type EnemyKind = OfficialEnemyKind | CustomEnemyKind;
export type ModeKind = "normal" | `custom:${string}`;
export type OfficialMapKind = "sector07" | "switchback" | "overpass";
export type CustomMapKind = `custom-map:${string}`;
export type MapKind = OfficialMapKind | CustomMapKind;
export type TargetingMode = "first" | "last" | "strongest" | "weakest" | "closest";

export type EnemySpriteShape = "circle" | "square" | "diamond" | "hexagon" | "polygon";

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
  readonly summon?: {
    readonly interval: number;
    readonly count: number;
    readonly kinds: readonly EnemyKind[];
  };
  readonly shockwave?: {
    readonly interval: number;
    readonly radius: number;
    readonly stunDuration: number;
  };
  readonly sprite: {
    readonly shape: EnemySpriteShape;
    readonly fill: string;
    readonly stroke: string;
    readonly accent: string;
    readonly glyph: string;
    readonly sides?: number;
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
}

export interface TowerLevelStats {
  readonly damage: number;
  readonly fireRate: number;
  readonly range: number;
  readonly hpMultiplier: number;
  readonly aggroBonus: number;
  readonly ammo?: number;
  readonly reload?: number;
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
  readonly ability?: TowerAbilityDefinition;
  readonly levels: readonly TowerLevelStats[];
  readonly upgrades: readonly TowerUpgradeDefinition[];
}

export interface Tower {
  readonly id: number;
  readonly ownerId: PlayerId;
  readonly kind: TowerKind;
  position: Point;
  onPath: boolean;
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
  counterFlash: number;
  hurtFlash: number;
  selectedPulse: number;
  fortifyCharges: number;
  overdriveTimer: number;
  damageBuff: number;
  abilityTimer: number;
  abilityCooldown: number;
  focus: number;
  meleeTimer: number;
  ammo: number;
  shotCounter: number;
  attackRamp: number;
  rampTimer: number;
  idleTimer: number;
  rocketTimer: number;
  fieldTimer: number;
  fieldTickTimer: number;
  fieldVfxTimer: number;
  regenTimer: number;
  burstTimer: number;
  burstTargetId: number | null;
  stunTimer: number;
}

export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  pathDistance: number;
  hp: number;
  readonly maxHp: number;
  shieldHp: number;
  readonly maxShieldHp: number;
  readonly speed: number;
  readonly damage: number;
  readonly attackInterval: number;
  readonly telegraphDuration: number;
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
  hitFlash: number;
  spawnScale: number;
  summonTimer: number;
  abilityTimer: number;
}

export interface Projectile {
  position: { x: number; y: number };
  delay: number;
  readonly targetId: number;
  readonly ownerId: PlayerId;
  readonly damage: number;
  readonly kind: TowerKind;
  readonly speed: number;
  readonly splash: number;
  readonly chain: number;
  readonly towerLevel: number;
}

export interface Particle {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  delay?: number;
  life: number;
  readonly maxLife: number;
  readonly color: string;
  readonly size: number;
  readonly radius?: number;
  readonly angle?: number;
  readonly spread?: number;
  rotation?: number;
  readonly angularVelocity?: number;
  readonly drag?: number;
  readonly startColor?: string;
  readonly endColor?: string;
  readonly length?: number;
  readonly points?: readonly Point[];
  readonly type: "spark" | "ring" | "slash" | "strike" | "text" | "spray" | "smoke" | "flash" | "beam" | "lightning";
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
  readonly path: readonly Point[];
  readonly core: Point;
  readonly entryLabel: Point;
  readonly pathLabel: Point;
  readonly blockedZones: readonly BlockedZone[];
  readonly palette: {
    readonly field: string;
    readonly glow: string;
    readonly path: string;
    readonly accent: string;
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
  readonly pathDistance: number;
}

export interface SelectedTowerView {
  readonly tower: Tower;
  readonly definition: TowerDefinition;
  readonly incomingAttack: number | null;
}
