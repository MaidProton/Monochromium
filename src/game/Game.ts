import { AudioSystem } from "./audio.ts";
import {
  COMBAT_RULES,
  ECONOMY_RULES,
  MAP_DEFINITIONS,
  NORMAL_MODE,
  PATH_HALF_WIDTH,
  RANGE_SCALE,
  TOWER_DEFINITIONS,
  TOWER_ORDER,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./config.ts";
import { getEnemyDefinition } from "./enemyRegistry.ts";
import { clamp, distance, Polyline } from "./math.ts";
import type {
  Enemy,
  EnemyKind,
  MapDefinition,
  MapKind,
  ModeDefinition,
  Particle,
  PlacementPreview,
  Point,
  Projectile,
  SelectedTowerView,
  TargetingMode,
  Tower,
  TowerKind,
  TowerLevelStats,
} from "./types.ts";

export interface GameUiState {
  readonly integrity: number;
  readonly maxIntegrity: number;
  readonly shards: number;
  readonly pendingCasualtyRefund: number;
  readonly infiniteCash: boolean;
  readonly copiesRemaining: Readonly<Record<TowerKind, number>>;
  readonly availableTowers: readonly TowerKind[];
  readonly wave: number;
  readonly totalWaves: number;
  readonly modeName: string;
  readonly mapName: string;
  readonly waveActive: boolean;
  readonly intermissionRemaining: number;
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
}

interface GameCallbacks {
  readonly onUi: (state: GameUiState) => void;
  readonly onLog: (message: string, tone?: "neutral" | "good" | "danger") => void;
  readonly onGameOver: (wave: number) => void;
  readonly onVictory: (mode: ModeDefinition) => void;
}

interface TimedBomb {
  readonly position: Point;
  readonly damage: number;
  readonly radius: number;
  readonly color: string;
  readonly ownerId?: number;
  readonly proximity?: boolean;
  readonly towerLevel?: number;
  timer: number;
}

interface DelayedSlash {
  readonly towerId: number;
  readonly origin: Point;
  readonly aim: Point;
  readonly range: number;
  readonly spread: number;
  readonly damage: number;
  readonly color: string;
  timer: number;
}

const TAU = Math.PI * 2;
const WAVE_INTERMISSION_SECONDS = 3;

const mixHexColors = (start: string, end: string, amount: number): string => {
  const parse = (color: string): [number, number, number] | null => {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match?.[1]) return null;
    return [
      Number.parseInt(match[1].slice(0, 2), 16),
      Number.parseInt(match[1].slice(2, 4), 16),
      Number.parseInt(match[1].slice(4, 6), 16),
    ];
  };
  const from = parse(start);
  const to = parse(end);
  if (!from || !to) return start;
  const channel = (index: number): number => Math.round(from[index]! + (to[index]! - from[index]!) * clamp(amount, 0, 1));
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

export class Game {
  private readonly context: CanvasRenderingContext2D;
  private map: MapDefinition = MAP_DEFINITIONS.sector07;
  private path = new Polyline(this.map.path);
  private readonly audio = new AudioSystem();
  private readonly callbacks: GameCallbacks;
  private mode: ModeDefinition = NORMAL_MODE;

  private towers: Tower[] = [];
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private timedBombs: TimedBomb[] = [];
  private delayedSlashes: DelayedSlash[] = [];
  private spawnQueue: Array<{ kind: EnemyKind; spawnAt: number; hp: number }> = [];
  private nextId = 1;
  private lastTimestamp = 0;
  private uiTimer = 0;
  private animationFrame = 0;
  private pointer: Point | null = null;
  private placement: PlacementPreview | null = null;
  private selectedKind: TowerKind | null = "bandit";
  private selectedTowerId: number | null = null;
  private relocatingTowerId: number | null = null;
  private waveElapsed = 0;
  private nextWaveIndex = 0;
  private waveNumber = 0;
  private waveActive = false;
  private intermissionTimer = 0;
  private integrity = this.mode.coreIntegrity;
  private maxIntegrity = this.mode.coreIntegrity;
  private shards = this.mode.startingCash;
  private pendingCasualtyRefund = 0;
  private infiniteCash = false;
  private damageIncomeRemainder = 0;
  private availableTowerKinds = new Set<TowerKind>(["bandit"]);
  private copiesRemaining = this.freshTowerStock();
  private tempestPlacementTriggered = false;
  private paused = false;
  private speed = 1;
  private started = false;
  private gameOver = false;
  private modeComplete = false;
  private elapsed = 0;
  private shake = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    callbacks: GameCallbacks,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not supported by this browser.");
    this.context = context;
    this.callbacks = callbacks;
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.emitUi();
    this.animationFrame = requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
  }

  private freshTowerStock(): Record<TowerKind, number> {
    return Object.fromEntries(
      TOWER_ORDER.map((kind) => [kind, TOWER_DEFINITIONS[kind].copyLimit]),
    ) as Record<TowerKind, number>;
  }

  startRun(mapKind: MapKind, unlockedTowers: readonly TowerKind[], mode: ModeDefinition = NORMAL_MODE): void {
    this.map = MAP_DEFINITIONS[mapKind];
    this.path = new Polyline(this.map.path);
    this.mode = mode;
    this.availableTowerKinds = new Set(unlockedTowers);
    this.availableTowerKinds.add("bandit");
    this.maxIntegrity = this.mode.coreIntegrity;
    this.restart();
    this.callbacks.onLog(
      `${this.map.name} loaded // ${this.mode.name}, ${this.mode.waves.length} finite waves.`,
      "good",
    );
  }

  leaveRun(): void {
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.timedBombs = [];
    this.delayedSlashes = [];
    this.spawnQueue = [];
    this.started = false;
    this.waveActive = false;
    this.intermissionTimer = 0;
    this.paused = false;
    this.selectedKind = null;
    this.selectedTowerId = null;
    this.relocatingTowerId = null;
    this.placement = null;
    this.emitUi();
  }

  setAvailableTowers(unlockedTowers: readonly TowerKind[]): void {
    this.availableTowerKinds = new Set(unlockedTowers);
    this.availableTowerKinds.add("bandit");
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
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.timedBombs = [];
    this.delayedSlashes = [];
    this.spawnQueue = [];
    this.integrity = this.maxIntegrity;
    this.shards = this.mode.startingCash;
    this.pendingCasualtyRefund = 0;
    this.infiniteCash = false;
    this.damageIncomeRemainder = 0;
    this.copiesRemaining = this.freshTowerStock();
    this.tempestPlacementTriggered = false;
    this.waveNumber = 0;
    this.nextWaveIndex = 0;
    this.waveActive = false;
    this.intermissionTimer = WAVE_INTERMISSION_SECONDS;
    this.waveElapsed = 0;
    this.selectedTowerId = null;
    this.relocatingTowerId = null;
    this.selectedKind = "bandit";
    this.gameOver = false;
    this.modeComplete = false;
    this.paused = false;
    this.started = true;
    this.callbacks.onLog("Timeline restored. Core integrity nominal.", "good");
    this.emitUi();
  }

  selectKind(kind: TowerKind): void {
    if (this.gameOver) return;
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
    if (this.selectedTowerId === null) return;
    this.selectedTowerId = null;
    this.emitUi();
  }

  private callWave(): void {
    if (!this.started || this.waveActive || this.intermissionTimer > 0 || this.gameOver || this.modeComplete) return;
    const definition = this.mode.waves[this.nextWaveIndex];
    if (!definition) return;
    if (this.pendingCasualtyRefund > 0) {
      const recovered = this.pendingCasualtyRefund;
      this.pendingCasualtyRefund = 0;
      this.shards += recovered;
      this.callbacks.onLog(`Casualty recovery arrived // +$${recovered}.`, "good");
    }
    this.waveNumber = this.nextWaveIndex + 1;
    const queuedEnemies: Array<{ kind: EnemyKind; spawnAt: number }> = [];
    if (definition.blocks) {
      let blockStart = 0.12;
      definition.blocks.forEach((block) => {
        if (block.command === "enemyGroup") {
          for (let index = 0; index < block.count; index += 1) {
            queuedEnemies.push({ kind: block.enemy, spawnAt: blockStart + index * block.spawnDelay });
          }
        }
        blockStart += block.nextBlockDelay;
      });
    } else {
      let spawnAt = 0.12;
      const groups = definition.groups ?? [];
      groups.forEach((group, groupIndex) => {
        for (let index = 0; index < group.count; index += 1) {
          queuedEnemies.push({ kind: group.kind, spawnAt });
          if (index < group.count - 1) spawnAt += group.gap;
        }
        if (groupIndex < groups.length - 1) spawnAt += 1.65;
      });
    }
    this.spawnQueue = queuedEnemies.sort((a, b) => a.spawnAt - b.spawnAt).map((enemy) => ({
      ...enemy,
      hp: getEnemyDefinition(enemy.kind).hp,
    }));
    this.waveElapsed = 0;
    this.waveActive = true;
    this.callbacks.onLog(`Wave ${this.waveNumber.toString().padStart(2, "0")} // breach signatures detected.`, "danger");
    if (definition.message) this.callbacks.onLog(definition.message, "danger");
    this.audio.tone(155, 0.18, 0.028, 90);
    this.emitUi();
  }

  togglePause(): void {
    if (!this.started || this.gameOver) return;
    this.paused = !this.paused;
    this.callbacks.onLog(this.paused ? "Simulation suspended." : "Simulation resumed.");
    this.emitUi();
  }

  cycleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : 1;
    this.callbacks.onLog(`Simulation clock set to ${this.speed}×.`);
    this.emitUi();
  }

  toggleSound(): void {
    const enabled = this.audio.toggle();
    this.callbacks.onLog(`Audio ${enabled ? "enabled" : "muted"}.`);
    this.emitUi();
  }

  toggleInfiniteCash(): void {
    this.infiniteCash = !this.infiniteCash;
    this.callbacks.onLog(`Debug // infinite cash ${this.infiniteCash ? "enabled" : "disabled"}.`, "good");
    this.emitUi();
  }

  debugAddCash(amount = 1000): void {
    this.shards += amount;
    this.callbacks.onLog(`Debug // +$${amount.toLocaleString()} cash.`, "good");
    this.emitUi();
  }

  debugHealCore(): void {
    this.integrity = this.maxIntegrity;
    this.callbacks.onLog("Debug // core integrity restored.", "good");
    this.emitUi();
  }

  debugClearWave(): void {
    this.towers.forEach((tower) => tower.engaged.clear());
    this.enemies = [];
    this.projectiles = [];
    this.delayedSlashes = [];
    this.spawnQueue = [];
    if (this.waveActive) this.completeWave();
    else {
      this.callbacks.onLog("Debug // no active wave to clear.");
      this.emitUi();
    }
  }

  debugRestock(): void {
    this.copiesRemaining = this.freshTowerStock();
    this.callbacks.onLog("Debug // all deployment stock restored.", "good");
    this.emitUi();
  }

  debugMaxSelected(): void {
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
      tower.maxAggro = definition.onPath.maxAggro;
    }
    tower.ammo = stats.ammo ?? -1;
    tower.counterCooldown = 0;
    tower.abilityCooldown = 0;
    tower.regenTimer = 7;
    if (tower.kind === "tempest") this.startLightningField(tower);
    this.spawnText(tower.position, "DEBUG MAX", definition.accent);
    this.callbacks.onLog(`Debug // ${definition.name} advanced to maximum level.`, "good");
    this.emitUi();
  }

  sellSelected(): void {
    const tower = this.selectedTower;
    if (!tower || this.gameOver) return;
    const refundRate = tower.kind === "cyborg" && tower.level >= 5 ? 0.8 : 0.5;
    const refund = Math.floor(tower.totalInvested * refundRate);
    this.releaseTowerEnemies(tower);
    this.towers = this.towers.filter((candidate) => candidate.id !== tower.id);
    this.timedBombs = this.timedBombs.filter((bomb) => bomb.ownerId !== tower.id);
    this.shards += refund;
    this.selectedTowerId = null;
    if (this.relocatingTowerId === tower.id) this.relocatingTowerId = null;
    this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].name} sold // +$${refund}; copy expended.`, "good");
    this.audio.tone(280, 0.12, 0.02, -120);
    this.emitUi();
  }

  upgradeSelected(): void {
    const tower = this.selectedTower;
    if (!tower || this.gameOver) return;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const upgrade = definition.upgrades[tower.level];
    if (!upgrade) return;
    if (!this.infiniteCash && this.shards < upgrade.cost) {
      this.callbacks.onLog(`Insufficient cash // $${upgrade.cost} required for ${upgrade.title}.`, "danger");
      this.audio.fail();
      return;
    }

    const previousMaxHp = tower.maxHp;
    if (!this.infiniteCash) this.shards -= upgrade.cost;
    tower.totalInvested += upgrade.cost;
    tower.level = upgrade.level;
    const levelStats = this.towerStats(tower);
    tower.maxHp = Math.round(definition.onPath.hp * levelStats.hpMultiplier);
    tower.hp = Math.min(tower.maxHp, tower.hp + tower.maxHp - previousMaxHp);
    if (tower.onPath) {
      tower.maxAggro = definition.onPath.maxAggro;
    }
    if (tower.kind === "cyborg" || tower.kind === "recon") tower.ammo = levelStats.ammo ?? -1;
    if (tower.kind === "gunner" && tower.level < 4) {
      tower.attackRamp = 0;
      tower.rampTimer = 0;
    }
    if (tower.kind === "tempest") this.startLightningField(tower);
    if (tower.kind === "warrior" && tower.level === 2) tower.regenTimer = 7;
    tower.fireTimer = Math.min(tower.fireTimer, 0.18);
    tower.counterFlash = 0.8;
    this.spawnRing(tower.position, definition.accent, 0.7, 8);
    this.spawnText(tower.position, `LEVEL ${tower.level} // ${upgrade.title.toUpperCase()}`, definition.accent);
    this.callbacks.onLog(`${definition.name} upgraded to level ${tower.level} // ${upgrade.title} unlocked.`, "good");
    this.audio.counter();
    this.emitUi();
  }

  startMoveSelected(): void {
    const tower = this.selectedTower;
    if (!tower || this.gameOver) return;
    if (!this.infiniteCash && this.shards < ECONOMY_RULES.relocationCost) {
      this.callbacks.onLog(`Insufficient cash // $${ECONOMY_RULES.relocationCost} required to relocate.`, "danger");
      this.audio.fail();
      return;
    }
    this.selectedKind = null;
    this.relocatingTowerId = tower.id;
    this.updatePlacement();
    this.callbacks.onLog(`Relocating ${TOWER_DEFINITIONS[tower.kind].name} // choose any valid path or field site.`);
    this.audio.tone(360, 0.08, 0.014, 80);
    this.emitUi();
  }

  setSelectedTargeting(targeting: TargetingMode): void {
    const tower = this.selectedTower;
    if (!tower || tower.targeting === targeting) return;
    tower.targeting = targeting;
    this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].name} target priority // ${targeting.toUpperCase()}.`);
    this.audio.tone(410, 0.06, 0.012, 60);
    this.emitUi();
  }

  counterSelected(): void {
    const tower = this.selectedTower;
    if (!tower || this.gameOver || this.paused) {
      this.audio.fail();
      return;
    }
    if (tower.stunTimer > 0) {
      this.spawnText(tower.position, `STUNNED ${tower.stunTimer.toFixed(1)}s`, "#ffc866");
      this.audio.fail();
      return;
    }
    if (!tower.onPath) {
      this.audio.fail();
      return;
    }
    if (tower.counterCooldown > 0) {
      this.spawnText(tower.position, "RECHARGING", "#9ba1a3");
      this.audio.fail();
      return;
    }
    const attackers = this.enemies
      .filter((enemy) => enemy.targetTowerId === tower.id && enemy.attackTimer <= enemy.telegraphDuration)
      .sort((a, b) => a.attackTimer - b.attackTimer);
    const imminent = attackers[0];
    if (!imminent) {
      tower.counterCooldown = 0.7;
      this.spawnText(tower.position, "NO SIGNAL", "#a7abad");
      this.callbacks.onLog("Counter missed // no incoming strike signature.");
      this.audio.fail();
      this.emitUi();
      return;
    }
    if (imminent.attackTimer > COMBAT_RULES.counterWindow) {
      tower.counterCooldown = 0.45;
      this.spawnText(tower.position, "TOO EARLY", "#e2a662");
      this.callbacks.onLog("Counter mistimed // wait for the ring to close.");
      this.audio.fail();
      this.emitUi();
      return;
    }

    tower.counterCooldown = COMBAT_RULES.counterCooldown;
    tower.counterFlash = 0.8;
    attackers.forEach((enemy) => {
      enemy.attackTimer = enemy.attackInterval + 0.45;
      enemy.stunTimer = Math.max(enemy.stunTimer, 0.4);
    });
    this.executeCounter(tower);
    this.shake = Math.min(1, this.shake + 0.32);
    this.spawnText(tower.position, "PERFECT COUNTER", TOWER_DEFINITIONS[tower.kind].accent);
    this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].onPath.title} answered with ${this.counterName(tower.kind)}.`, "good");
    this.audio.counter();
    this.emitUi();
  }

  activateSelectedAbility(): void {
    const tower = this.selectedTower;
    if (!tower || this.gameOver || this.paused) {
      this.audio.fail();
      return;
    }
    const ability = TOWER_DEFINITIONS[tower.kind].ability;
    if (!ability || tower.level < ability.unlockLevel) {
      this.spawnText(tower.position, "NO ABILITY", "#9ba1a3");
      this.audio.fail();
      return;
    }
    if (tower.stunTimer > 0) {
      this.spawnText(tower.position, `STUNNED ${tower.stunTimer.toFixed(1)}s`, "#ffc866");
      this.audio.fail();
      return;
    }
    if (tower.kind === "samurai") {
      if (tower.abilityTimer > 0) {
        tower.abilityTimer = 0;
        tower.focus = 0;
        this.spawnText(tower.position, "STANCE ENDED", TOWER_DEFINITIONS.samurai.dimAccent);
        this.callbacks.onLog("Samurai sheathed the blade early // the full charge is still consumed.");
      } else this.activateSamurai(tower);
    } else if (tower.kind === "mercenary") this.activateOnslaught(tower);
    else if (tower.kind === "bomber") this.activateTimeBomb(tower);
    this.emitUi();
  }

  private counterName(kind: TowerKind): string {
    switch (kind) {
      case "bandit":
        return "QUICKDRAW";
      case "samurai":
        return "IAI PARRY";
      case "tempest":
        return "THUNDER BREAK";
      case "cyborg":
        return "MAGNUM DUMP";
      case "mercenary":
        return "RALLY FIRE";
      case "infernus":
        return "FLASHOVER";
      case "bomber":
        return "DEAD MAN'S SWITCH";
      case "recon":
        return "BREACH LOAD";
      case "gunner":
        return "REDLINE RETURN";
      case "warrior":
        return "RIPOSTE";
    }
  }

  private executeCounter(tower: Tower): void {
    const definition = TOWER_DEFINITIONS[tower.kind];
    const accent = definition.accent;
    const stats = this.towerStats(tower);
    const damage = stats.damage * tower.damageBuff;
    this.spawnCounterBurst(tower.position, accent);
    switch (tower.kind) {
      case "bandit": {
        const victims = this.enemies.filter(
          (enemy) => enemy.targetTowerId === tower.id && this.canTowerTarget(tower, enemy),
        );
        const shots = tower.level >= 3 ? 2 : 1;
        victims.forEach((enemy) => {
          const impact = this.enemyPosition(enemy);
          this.damageEnemy(enemy, damage * shots, accent);
          this.spawnMuzzleFlash(tower.position, impact, "#fff3bd", 20);
          this.spawnBeam(tower.position, impact, accent, 4);
          this.spawnImpactDust(impact, accent);
        });
        this.spawnText(tower.position, `QUICKDRAW x${Math.max(1, victims.length * shots)}`, accent);
        tower.meleeTimer = 0;
        break;
      }
      case "samurai": {
        const victims = this.enemies.filter(
          (enemy) => enemy.targetTowerId === tower.id && this.canTowerTarget(tower, enemy),
        );
        victims.forEach((enemy) => this.damageEnemy(enemy, damage * (tower.level >= 4 ? 3 : 2), accent));
        const aim = victims[0] ? this.enemyPosition(victims[0]) : { x: tower.position.x + 90, y: tower.position.y };
        this.spawnCrossSlash(tower.position, aim, accent, stats.range * RANGE_SCALE);
        this.spawnBeam(
          { x: tower.position.x - 55, y: tower.position.y },
          { x: tower.position.x + 55, y: tower.position.y },
          "#ffffff",
          6,
        );
        break;
      }
      case "tempest": {
        this.startLightningField(tower);
        this.applyShockAround(tower, tower.level >= 4 ? 0.1 : 0.5, 2.2);
        this.enemies
          .filter((enemy) => distance(tower.position, this.enemyPosition(enemy)) <= stats.range * RANGE_SCALE + 45)
          .forEach((enemy) => {
            this.spawnArc(tower.position, this.enemyPosition(enemy), "#e8fcff");
            this.spawnFlash(this.enemyPosition(enemy), accent, 24);
          });
        break;
      }
      case "cyborg": {
        const victims = this.enemies.filter(
          (enemy) => enemy.targetTowerId === tower.id && this.canTowerTarget(tower, enemy),
        );
        const rounds = stats.ammo ? Math.min(stats.ammo, 8) : 8;
        victims.forEach((enemy) => {
          const impact = this.enemyPosition(enemy);
          this.damageEnemy(enemy, damage * rounds, accent);
          for (let round = 0; round < Math.min(rounds, 6); round += 1) {
            this.spawnBeam(tower.position, impact, round % 2 === 0 ? accent : "#ffffff", 2.5, round * 0.025);
          }
          this.spawnMuzzleFlash(tower.position, impact, accent, 26);
          this.spawnImpactDust(impact, accent);
        });
        this.spawnRadialSpray(tower.position, "#f3f5f2", "#777f7b", 12, 75);
        tower.shotCounter = Math.max(tower.shotCounter, tower.level >= 5 ? 19 : 29);
        break;
      }
      case "mercenary": {
        const victims = this.enemies.filter((enemy) => enemy.targetTowerId === tower.id && this.canTowerTarget(tower, enemy));
        victims.forEach((enemy) => {
          const impact = this.enemyPosition(enemy);
          this.damageEnemy(enemy, damage * 2, accent);
          this.spawnMuzzleFlash(tower.position, impact, "#fff1b5", 19);
          this.spawnBeam(tower.position, impact, accent, 4);
          this.spawnRing(impact, accent, 0.34, 3, 24);
        });
        this.spawnText(tower.position, "RALLY FIRE", accent);
        break;
      }
      case "infernus": {
        const range = stats.range * RANGE_SCALE;
        const victims = this.enemies.filter(
          (enemy) => distance(tower.position, this.enemyPosition(enemy)) <= range,
        );
        victims.forEach((enemy) => {
          this.damageEnemy(enemy, Math.max(2, damage * 3), accent);
          this.applyBurn(enemy, tower, 1.5);
        });
        this.spawnRadialSpray(tower.position, "#ffe66d", "#ed352f", 46, range);
        this.spawnRing(tower.position, "#ff4a32", 0.6, 8, range);
        break;
      }
      case "bomber": {
        const victims = this.enemies.filter((enemy) => enemy.targetTowerId === tower.id);
        victims.forEach((enemy) => {
          const impact = this.enemyPosition(enemy);
          this.enemies
            .filter((candidate) => distance(this.enemyPosition(candidate), impact) <= 72)
            .forEach((candidate) => this.damageEnemy(candidate, Math.max(20, damage * 5), accent));
          this.spawnExplosion(impact, accent, 72);
        });
        break;
      }
      case "recon": {
        const victims = this.enemies.filter(
          (enemy) => enemy.targetTowerId === tower.id && this.canTowerTarget(tower, enemy),
        );
        victims.forEach((enemy) => {
          const impact = this.enemyPosition(enemy);
          this.damageEnemy(enemy, damage * 5, accent);
          for (let pellet = 0; pellet < 5; pellet += 1) {
            this.spawnBeam(tower.position, impact, pellet === 2 ? "#ffffff" : accent, 2.4, pellet * 0.025);
          }
          this.spawnMuzzleFlash(tower.position, impact, accent, 30);
          this.spawnImpactDust(impact, accent);
        });
        tower.ammo = stats.ammo ?? 5;
        tower.attackRamp = 0;
        tower.idleTimer = 0;
        tower.fireTimer = 0;
        this.spawnText(tower.position, "BREACH LOAD x5", accent);
        break;
      }
      case "gunner": {
        const victims = this.enemies.filter(
          (enemy) => enemy.targetTowerId === tower.id && this.canTowerTarget(tower, enemy),
        );
        const burst = tower.level >= 5 ? 6 : tower.level >= 4 ? 4 : 3;
        const spacing = tower.level >= 5 ? 0.1 : 0.2;
        victims.forEach((enemy) => {
          const impact = this.enemyPosition(enemy);
          this.damageEnemy(enemy, damage * burst, accent);
          for (let shot = 0; shot < burst; shot += 1) {
            this.spawnBeam(tower.position, impact, shot % 2 === 0 ? accent : "#ffffff", 2.2, shot * spacing);
          }
          this.spawnMuzzleFlash(tower.position, impact, accent, 24);
          this.spawnImpactDust(impact, accent);
        });
        if (tower.level >= 4) {
          tower.attackRamp = Math.min(4, tower.attackRamp + 0.5);
          tower.rampTimer = tower.level >= 5 ? 22 : 18;
        }
        this.spawnText(tower.position, tower.level >= 4 ? "REDLINE +50%" : `RETURN BURST x${burst}`, accent);
        break;
      }
      case "warrior": {
        const victims = this.enemies.filter(
          (enemy) => distance(tower.position, this.enemyPosition(enemy)) <= stats.range * RANGE_SCALE,
        );
        victims.forEach((enemy) => this.damageEnemy(enemy, damage * (tower.level >= 4 ? 4 : 2), accent));
        const aim = victims[0] ? this.enemyPosition(victims[0]) : { x: tower.position.x + 1, y: tower.position.y };
        this.spawnCrossSlash(tower.position, aim, accent, stats.range * RANGE_SCALE);
        this.spawnShieldFlash(tower.position, accent, stats.range * RANGE_SCALE);
        break;
      }
    }
  }

  private activateSamurai(tower: Tower): void {
    if (tower.abilityCooldown > 0) {
      this.spawnText(tower.position, `STANCE ${tower.abilityCooldown.toFixed(1)}s`, "#9ba1a3");
      this.audio.fail();
      return;
    }
    const definition = TOWER_DEFINITIONS.samurai;
    tower.abilityTimer = 15;
    tower.abilityCooldown = 30;
    tower.counterFlash = 0.8;
    if (tower.level >= 3) {
      const stats = this.towerStats(tower);
      this.enemies
        .filter(
          (enemy) =>
            this.canTowerTarget(tower, enemy) &&
            distance(this.enemyPosition(enemy), tower.position) <= stats.range * RANGE_SCALE,
        )
        .forEach((enemy) => {
          this.damageEnemy(enemy, stats.damage * 10, definition.accent);
          this.spawnSlash(
            tower.position,
            this.enemyPosition(enemy),
            definition.accent,
            stats.range * RANGE_SCALE,
            0.42,
          );
        });
      this.spawnRing(tower.position, definition.accent, 0.45, 8, stats.range * RANGE_SCALE);
      this.spawnText(tower.position, "BLADESTORM", definition.accent);
    } else {
      this.spawnText(tower.position, "BLADE STANCE", definition.accent);
    }
    this.callbacks.onLog(`Samurai drew the blade // 15 seconds of active combat.`, "good");
    this.audio.counter();
  }

  private activateOnslaught(tower: Tower): void {
    if (tower.abilityCooldown > 0) {
      this.spawnText(tower.position, `ONSLAUGHT ${tower.abilityCooldown.toFixed(1)}s`, "#9ba1a3");
      this.audio.fail();
      return;
    }
    const levelSix = tower.level >= 6;
    const duration = levelSix ? 10 : 8;
    const buff = levelSix ? 1.35 : 1.25;
    const radius = this.towerStats(tower).range * RANGE_SCALE;
    this.towers
      .filter((candidate) => distance(candidate.position, tower.position) <= radius)
      .forEach((candidate) => {
        candidate.overdriveTimer = Math.max(candidate.overdriveTimer, duration);
        candidate.damageBuff = Math.max(candidate.damageBuff, buff);
        this.spawnRing(candidate.position, TOWER_DEFINITIONS.mercenary.accent, 0.4, 3, 34);
      });
    tower.abilityCooldown = levelSix ? 30 : 40;
    this.spawnRing(tower.position, TOWER_DEFINITIONS.mercenary.accent, 0.8, 8, radius);
    this.spawnText(tower.position, `ONSLAUGHT +${Math.round((buff - 1) * 100)}%`, TOWER_DEFINITIONS.mercenary.accent);
    this.callbacks.onLog(`Mercenary activated Onslaught // nearby towers gain ${Math.round((buff - 1) * 100)}% damage.`, "good");
    this.audio.counter();
  }

  private activateTimeBomb(tower: Tower): void {
    if (tower.abilityCooldown > 0) {
      this.spawnText(tower.position, `TIME BOMB ${tower.abilityCooldown.toFixed(1)}s`, "#9ba1a3");
      this.audio.fail();
      return;
    }
    const range = this.towerStats(tower).range * RANGE_SCALE;
    const target = this.selectTarget(
      tower,
      this.enemies.filter(
        (enemy) => this.canTowerTarget(tower, enemy) && distance(tower.position, this.enemyPosition(enemy)) <= range,
      ),
    );
    if (!target) {
      this.spawnText(tower.position, "NO TARGET", "#a7abad");
      this.audio.fail();
      return;
    }
    const position = this.enemyPosition(target);
    this.timedBombs.push({
      position: { ...position },
      damage: 500 * tower.damageBuff,
      radius: 105,
      color: TOWER_DEFINITIONS.bomber.accent,
      timer: 5,
    });
    tower.abilityCooldown = 60;
    this.spawnTracer(tower.position, position, TOWER_DEFINITIONS.bomber.accent);
    this.spawnText(position, "TIME BOMB // 5", TOWER_DEFINITIONS.bomber.accent);
    this.callbacks.onLog("Bomber planted a Time Bomb // detonation in 5 seconds.", "danger");
    this.audio.tone(180, 0.16, 0.025, -40);
  }

  private bindInput(): void {
    this.canvas.addEventListener("pointermove", (event) => {
      this.pointer = this.eventToWorld(event);
      this.updatePlacement();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.placement = null;
      this.emitUi();
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 2) {
        this.cancelPlacement();
        return;
      }
      if (event.button !== 0 || !this.started || this.gameOver) return;
      const point = this.eventToWorld(event);
      if (this.relocatingTowerId !== null && this.placement) {
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
        this.audio.tone(420, 0.05, 0.012, 40);
        this.emitUi();
        return;
      }
      if (this.selectedKind && this.placement) this.deploy(this.selectedKind, this.placement);
      else {
        this.selectedTowerId = null;
        this.emitUi();
      }
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private eventToWorld(event: PointerEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    const viewport = this.viewport;
    const pixelX = (event.clientX - bounds.left) * (this.canvas.width / bounds.width);
    const pixelY = (event.clientY - bounds.top) * (this.canvas.height / bounds.height);
    return {
      x: (pixelX - viewport.x) / viewport.scale,
      y: (pixelY - viewport.y) / viewport.scale,
    };
  }

  private get viewport(): { readonly x: number; readonly y: number; readonly scale: number } {
    const scale = Math.min(this.canvas.width / WORLD_WIDTH, this.canvas.height / WORLD_HEIGHT);
    return {
      x: (this.canvas.width - WORLD_WIDTH * scale) / 2,
      y: (this.canvas.height - WORLD_HEIGHT * scale) / 2,
      scale,
    };
  }

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    this.canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  }

  private updatePlacement(): void {
    const relocatingTower = this.towers.find((tower) => tower.id === this.relocatingTowerId) ?? null;
    if (!this.pointer || (!this.selectedKind && !relocatingTower)) {
      this.placement = null;
      return;
    }
    const projected = this.path.closest(this.pointer);
    const onPath = projected.offset <= PATH_HALF_WIDTH;
    const position = onPath ? projected.point : this.pointer;
    const towerClear = this.towers.every(
      (tower) => tower.id === relocatingTower?.id || distance(tower.position, position) >= 72,
    );
    const boundsClear = position.x > 42 && position.x < WORLD_WIDTH - 42 && position.y > 42 && position.y < WORLD_HEIGHT - 42;
    const pathClear = !onPath || (projected.distance > 135 && projected.distance < this.path.totalLength - 135);
    this.placement = {
      position,
      onPath,
      valid: towerClear && boundsClear && pathClear,
      pathDistance: projected.distance,
    };
  }

  private relocateTower(placement: PlacementPreview): void {
    const tower = this.towers.find((candidate) => candidate.id === this.relocatingTowerId);
    if (!tower) {
      this.cancelPlacement();
      return;
    }
    if (!placement.valid) {
      this.callbacks.onLog("Relocation rejected // construct collision or restricted zone.", "danger");
      this.audio.fail();
      return;
    }
    if (!this.infiniteCash && this.shards < ECONOMY_RULES.relocationCost) {
      this.callbacks.onLog(`Insufficient cash // $${ECONOMY_RULES.relocationCost} required to relocate.`, "danger");
      this.audio.fail();
      return;
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
    tower.pathDistance = placement.pathDistance;
    tower.maxAggro = placement.onPath ? definition.onPath.maxAggro : 0;
    tower.selectedPulse = 1;
    this.relocatingTowerId = null;
    this.placement = null;
    this.spawnRing(oldPosition, definition.dimAccent, 0.35, 4, 45);
    this.spawnRing(tower.position, definition.accent, 0.5, 6, 62);
    if (tower.kind === "warrior" && tower.level >= 4) this.performWarriorArrivalSlash(tower);
    const form = placement.onPath ? definition.onPath.title : definition.offPath.title;
    this.callbacks.onLog(
      `${definition.name} relocated as ${form} // ${this.infiniteCash ? "debug override" : `-$${ECONOMY_RULES.relocationCost}`}.`,
      "good",
    );
    this.audio.deploy();
    this.emitUi();
  }

  private deploy(kind: TowerKind, placement: PlacementPreview): void {
    const definition = TOWER_DEFINITIONS[kind];
    if (!placement.valid) {
      this.callbacks.onLog("Deployment rejected // construct collision or restricted zone.", "danger");
      this.audio.fail();
      return;
    }
    if (this.copiesRemaining[kind] <= 0) {
      this.callbacks.onLog(`${definition.name} stock exhausted // destroyed or sold copies cannot be replaced.`, "danger");
      this.audio.fail();
      return;
    }
    if (!this.infiniteCash && this.shards < definition.cost) {
      this.callbacks.onLog(`Insufficient cash // $${definition.cost} required.`, "danger");
      this.audio.fail();
      return;
    }
    const pathStats = definition.onPath;
    const levelStats = definition.levels[0];
    if (!levelStats) return;
    const tower: Tower = {
      id: this.nextId++,
      kind,
      position: placement.position,
      onPath: placement.onPath,
      pathDistance: placement.pathDistance,
      level: 0,
      totalInvested: definition.cost,
      targeting: "first",
      hp: pathStats.hp,
      maxHp: pathStats.hp,
      maxAggro: placement.onPath ? pathStats.maxAggro : 0,
      engaged: new Set<number>(),
      fireTimer: 0.25,
      counterCooldown: 0,
      counterFlash: 0,
      hurtFlash: 0,
      selectedPulse: 1,
      fortifyCharges: 0,
      overdriveTimer: 0,
      damageBuff: 1,
      abilityTimer: 0,
      abilityCooldown: kind === "samurai" ? 30 : 0,
      focus: 0,
      meleeTimer: 0,
      ammo: levelStats.ammo ?? -1,
      shotCounter: 0,
      attackRamp: 0,
      rampTimer: 0,
      idleTimer: 0,
      rocketTimer: 8,
      fieldTimer: 0,
      fieldTickTimer: 0,
      fieldVfxTimer: 0,
      regenTimer: 7,
      burstTimer: 0,
      burstTargetId: null,
      stunTimer: 0,
    };
    this.towers.push(tower);
    if (!this.infiniteCash) this.shards -= definition.cost;
    this.copiesRemaining[kind] -= 1;
    this.selectedTowerId = tower.id;
    this.selectedKind = null;
    this.placement = null;
    const form = placement.onPath ? definition.onPath.title : definition.offPath.title;
    this.callbacks.onLog(`${definition.name} deployed as ${form} // ${this.copiesRemaining[kind]} copies remain.`, "good");
    this.audio.deploy();
    this.spawnRing(tower.position, definition.accent, 0.45, 5);
    if (kind === "tempest") {
      if (!this.tempestPlacementTriggered) {
        this.tempestPlacementTriggered = true;
        const nearby = this.enemies.filter(
          (enemy) => this.canTowerTarget(tower, enemy) && distance(this.enemyPosition(enemy), tower.position) <= 150,
        );
        nearby.forEach((enemy) => {
          this.damageEnemy(enemy, 200, definition.accent);
          this.spawnArc(tower.position, this.enemyPosition(enemy), definition.accent);
          enemy.slowTimer = Math.max(enemy.slowTimer, 4);
          enemy.slowFactor = Math.min(enemy.slowFactor, 0.5);
        });
        if (nearby.length > 0) this.spawnText(tower.position, "100 + 100 THUNDER", definition.accent);
      }
      this.startLightningField(tower);
    }
    this.emitUi();
  }

  private frame(timestamp: number): void {
    const rawDelta = this.lastTimestamp === 0 ? 0 : (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    const delta = Math.min(rawDelta, 0.05) * this.speed;
    this.elapsed += rawDelta;
    if (this.started && !this.paused && !this.gameOver) this.update(delta);
    else this.updateParticles(Math.min(rawDelta, 0.05));
    this.draw();
    this.uiTimer -= rawDelta;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.08;
      this.emitUi();
    }
    this.animationFrame = requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
  }

  private update(delta: number): void {
    if (!this.waveActive && this.intermissionTimer > 0 && !this.modeComplete) {
      this.intermissionTimer = Math.max(0, this.intermissionTimer - delta);
      if (this.intermissionTimer <= 0) this.callWave();
    }
    if (this.waveActive) this.updateSpawns(delta);
    this.updateEnemies(delta);
    this.removeDestroyedTowers();
    this.updateTowers(delta);
    this.updateProjectiles(delta);
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
      if (queued) this.spawnEnemy(queued.kind, queued.hp);
    }
  }

  private spawnEnemy(kind: EnemyKind, hp: number, pathDistance = 0): void {
    const base = getEnemyDefinition(kind);
    this.enemies.push({
      id: this.nextId++,
      kind,
      pathDistance,
      hp,
      maxHp: hp,
      speed: base.speed,
      damage: base.damage,
      attackInterval: base.attackInterval,
      telegraphDuration: base.telegraphDuration,
      targetTowerId: null,
      attackTimer: base.attackInterval,
      stunTimer: 0,
      slowTimer: 0,
      slowFactor: 1,
      shockStacks: 0,
      burnTimer: 0,
      burnTickTimer: 0,
      burnDamage: 0,
      burnSlowFactor: 1,
      hitFlash: 0,
      spawnScale: 0,
      summonTimer: base.summon?.interval ?? 0,
      abilityTimer: base.shockwave?.interval ?? 0,
    });
  }

  private updateEnemies(delta: number): void {
    for (const enemy of this.enemies) {
      const definition = getEnemyDefinition(enemy.kind);
      enemy.spawnScale = Math.min(1, enemy.spawnScale + delta * 4);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta * 5);
      enemy.stunTimer = Math.max(0, enemy.stunTimer - delta);
      if (enemy.burnTimer > 0) {
        enemy.burnTimer = Math.max(0, enemy.burnTimer - delta);
        enemy.burnTickTimer -= delta;
        if (enemy.burnTickTimer <= 0) {
          this.damageEnemy(enemy, enemy.burnDamage, TOWER_DEFINITIONS.infernus.accent);
          enemy.burnTickTimer = enemy.burnDamage >= 4 ? 0.5 : 1;
          const position = this.enemyPosition(enemy);
          this.spawnSpark(position, TOWER_DEFINITIONS.infernus.accent, 24);
        }
        if (enemy.hp <= 0) continue;
      } else {
        enemy.burnDamage = 0;
        enemy.burnSlowFactor = 1;
      }
      const wasSlowed = enemy.slowTimer > 0;
      enemy.slowTimer = Math.max(0, enemy.slowTimer - delta);
      if (wasSlowed && enemy.slowTimer <= 0) {
        enemy.slowFactor = 1;
        enemy.shockStacks = 0;
      }
      if (definition.summon) {
        enemy.summonTimer -= delta;
        if (enemy.summonTimer <= 0) {
          for (let index = 0; index < definition.summon.count; index += 1) {
            const guaranteesFullRoster = definition.summon.count >= definition.summon.kinds.length;
            const summonKind = guaranteesFullRoster && index < definition.summon.kinds.length
              ? definition.summon.kinds[index]
              : definition.summon.kinds[Math.floor(Math.random() * definition.summon.kinds.length)];
            if (!summonKind) continue;
            this.spawnEnemy(
              summonKind,
              getEnemyDefinition(summonKind).hp,
              Math.max(0, enemy.pathDistance - 20 - index * 14),
            );
          }
          enemy.summonTimer = definition.summon.interval;
          const position = this.enemyPosition(enemy);
          this.spawnRing(position, definition.sprite.accent, 0.55, 6, 54);
          this.spawnText(position, "SUMMON", definition.sprite.accent);
        }
      }
      if (definition.shockwave) {
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
          this.shake = Math.min(1, this.shake + 0.45);
          enemy.abilityTimer = definition.shockwave.interval;
        }
      }
      if (enemy.stunTimer > 0) continue;

      if (enemy.targetTowerId !== null) {
        const tower = this.towers.find((candidate) => candidate.id === enemy.targetTowerId);
        if (!tower || tower.hp <= 0) {
          enemy.targetTowerId = null;
          continue;
        }
        enemy.attackTimer -= delta;
        if (enemy.attackTimer <= 0) this.landEnemyAttack(enemy, tower);
        continue;
      }

      const movementScale = Math.min(
        enemy.slowTimer > 0 ? enemy.slowFactor : 1,
        enemy.burnTimer > 0 ? enemy.burnSlowFactor : 1,
      );
      const previous = enemy.pathDistance;
      const next = previous + enemy.speed * movementScale * delta;
      const blocker = this.towers
        .filter(
          (tower) =>
            tower.onPath &&
            tower.hp > 0 &&
            tower.pathDistance >= previous - 4 &&
            tower.pathDistance <= next + 23,
        )
        .sort((a, b) => a.pathDistance - b.pathDistance)[0];
      if (blocker && blocker.engaged.size < blocker.maxAggro) {
        enemy.targetTowerId = blocker.id;
        enemy.pathDistance = blocker.pathDistance - 25;
        enemy.attackTimer = Math.max(enemy.telegraphDuration + 0.38, enemy.attackInterval * 0.72);
        blocker.engaged.add(enemy.id);
        this.spawnText(blocker.position, `${blocker.engaged.size}/${blocker.maxAggro} AGGRO`, "#ff806f");
      } else {
        enemy.pathDistance = next;
      }

      if (enemy.pathDistance >= this.path.totalLength) this.breach(enemy);
    }
  }

  private landEnemyAttack(enemy: Enemy, tower: Tower): void {
    let incomingDamage = enemy.damage;
    if (tower.fortifyCharges > 0) {
      incomingDamage *= 0.5;
      tower.fortifyCharges -= 1;
      this.spawnText(tower.position, "FORTIFIED", TOWER_DEFINITIONS[tower.kind].accent);
    }
    tower.hp -= Math.round(incomingDamage);
    tower.hurtFlash = 0.38;
    enemy.attackTimer = enemy.attackInterval;
    this.shake = Math.min(1, this.shake + 0.18);
    this.audio.hit();
    const target = tower.position;
    for (let index = 0; index < 6; index += 1) this.spawnSpark(target, "#ff665c", 70 + Math.random() * 80);
    if (tower.hp <= 0) {
      this.callbacks.onLog(`${TOWER_DEFINITIONS[tower.kind].onPath.title} shattered under hostile pressure.`, "danger");
      this.audio.breach();
    }
  }

  private breach(enemy: Enemy): void {
    enemy.hp = -9999;
    const damage = getEnemyDefinition(enemy.kind).coreDamage;
    this.integrity = Math.max(0, this.integrity - damage);
    this.shake = 1;
    this.audio.breach();
    this.callbacks.onLog(`CORE BREACH // -${damage} integrity.`, "danger");
    this.spawnText(this.map.core, `-${damage} CORE`, "#ff625d");
    if (this.integrity <= 0 && !this.gameOver) {
      this.gameOver = true;
      this.waveActive = false;
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
      this.shards += immediateRefund;
      this.pendingCasualtyRefund += deferredRefund;
      this.spawnText(tower.position, `+$${immediateRefund} // +$${deferredRefund} PENDING`, "#f1d07a");
      this.callbacks.onLog(
        `${TOWER_DEFINITIONS[tower.kind].name} casualty recovery // +$${immediateRefund} now, +$${deferredRefund} next wave.`,
        "good",
      );
    });
    const destroyedIds = new Set(destroyed.map((tower) => tower.id));
    this.towers = this.towers.filter((tower) => !destroyedIds.has(tower.id));
    this.timedBombs = this.timedBombs.filter((bomb) => bomb.ownerId === undefined || !destroyedIds.has(bomb.ownerId));
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
        enemy.pathDistance = Math.max(enemy.pathDistance, tower.pathDistance + 10);
        enemy.attackTimer = enemy.attackInterval;
      }
    });
    tower.engaged.clear();
  }

  private performWarriorArrivalSlash(tower: Tower): void {
    const definition = TOWER_DEFINITIONS.warrior;
    const stats = this.towerStats(tower);
    const range = stats.range * RANGE_SCALE;
    const damage = stats.damage * tower.damageBuff;
    this.enemies
      .filter(
        (enemy) =>
          enemy.hp > 0 &&
          this.canTowerTarget(tower, enemy) &&
          distance(tower.position, this.enemyPosition(enemy)) <= range,
      )
      .forEach((enemy) => this.damageEnemy(enemy, damage, definition.accent));
    for (let arc = 0; arc < 4; arc += 1) {
      const angle = (arc / 4) * TAU;
      const aim = {
        x: tower.position.x + Math.cos(angle) * range,
        y: tower.position.y + Math.sin(angle) * range,
      };
      this.spawnSlash(tower.position, aim, definition.accent, range, Math.PI / 4 + 0.05);
    }
    this.spawnRing(tower.position, "#ffffff", 0.55, 7, range);
    this.spawnText(tower.position, "ARRIVAL SLASH", definition.accent);
    this.audio.shoot(175);
  }

  private updateTowers(delta: number): void {
    for (const tower of this.towers) {
      tower.fireTimer -= delta;
      tower.counterCooldown = Math.max(0, tower.counterCooldown - delta);
      tower.overdriveTimer = Math.max(0, tower.overdriveTimer - delta);
      if (tower.overdriveTimer <= 0) tower.damageBuff = 1;
      const stanceWasActive = tower.abilityTimer > 0;
      tower.abilityTimer = Math.max(0, tower.abilityTimer - delta);
      tower.abilityCooldown = Math.max(0, tower.abilityCooldown - delta);
      if (stanceWasActive && tower.abilityTimer <= 0 && tower.kind === "samurai") tower.focus = 0;
      if (tower.kind === "samurai" && tower.level >= 4 && tower.abilityTimer <= 0) {
        tower.focus = Math.max(0, tower.focus - delta * 2);
      } else if (tower.kind === "samurai" && tower.level >= 1 && tower.abilityTimer <= 0 && tower.abilityCooldown <= 0) {
        tower.focus = Math.min(tower.level >= 3 ? 1 : 0.6, tower.focus + delta * 0.02);
      }
      tower.meleeTimer -= delta;
      tower.idleTimer += delta;
      if (tower.kind === "cyborg" && tower.idleTimer > 2) tower.attackRamp = 0;
      if (tower.kind === "recon" && tower.idleTimer > 0.65) {
        tower.attackRamp = Math.max(0, tower.attackRamp - delta * 1.45);
      }
      if (tower.kind === "gunner") {
        tower.rampTimer = Math.max(0, tower.rampTimer - delta);
        if (tower.rampTimer <= 0) tower.attackRamp = 0;
      }
      tower.counterFlash = Math.max(0, tower.counterFlash - delta * 1.4);
      tower.hurtFlash = Math.max(0, tower.hurtFlash - delta * 3);
      tower.selectedPulse = Math.max(0, tower.selectedPulse - delta);
      tower.stunTimer = Math.max(0, tower.stunTimer - delta);
      if (tower.kind === "warrior" && tower.level >= 2) {
        tower.regenTimer -= delta;
        if (tower.regenTimer <= 0) {
          if (tower.hp < tower.maxHp) {
            const healing = Math.min(tower.maxHp - tower.hp, tower.maxHp * 0.07);
            tower.hp += healing;
            this.spawnText(tower.position, `+${Math.ceil(healing)} HP`, TOWER_DEFINITIONS.warrior.accent);
            this.spawnRing(tower.position, TOWER_DEFINITIONS.warrior.accent, 0.38, 3, 36);
          }
          tower.regenTimer = 7;
        }
      }
      if (tower.stunTimer > 0) continue;
      if (tower.kind === "tempest") {
        this.updateLightningField(tower, delta);
        this.updateTempestBurst(tower, delta);
      }

      const definition = TOWER_DEFINITIONS[tower.kind];
      const stats = this.towerStats(tower);
      const damage = stats.damage * tower.damageBuff;
      const range = stats.range * RANGE_SCALE;
      // Pathbound placement adds blocking, HP, aggro, and a counter. It never
      // replaces the tower's normal targeting or ranged/area attack behavior.
      const candidates = this.enemies.filter(
        (enemy) =>
          enemy.hp > 0 &&
          this.canTowerTarget(tower, enemy) &&
          distance(tower.position, this.enemyPosition(enemy)) <= range,
      );

      if (tower.kind === "bomber" && candidates.length === 0 && tower.meleeTimer <= 0) {
        const maxBombs = tower.level >= 5 ? 6 : tower.level >= 3 ? 4 : 3;
        const existingBombs = this.timedBombs.filter((bomb) => bomb.proximity && bomb.ownerId === tower.id);
        const pathSite = this.path.closest(tower.position);
        if (existingBombs.length < maxBombs && pathSite.offset <= range) {
          const spacing = (existingBombs.length - (maxBombs - 1) / 2) * 32;
          const site = this.path.sample(clamp(pathSite.distance + spacing, 45, this.path.totalLength - 45)).point;
          if (this.timedBombs.every((bomb) => distance(bomb.position, site) >= 25)) {
            this.timedBombs.push({
              position: { ...site },
              damage,
              radius: tower.level >= 1 ? 60 : 46,
              color: definition.accent,
              ownerId: tower.id,
              proximity: true,
              towerLevel: tower.level,
              timer: Number.POSITIVE_INFINITY,
            });
            this.spawnText(site, "PATH BOMB", definition.accent);
          }
        }
        tower.meleeTimer = 1.4;
      }

      if (tower.kind === "bandit" && tower.level >= 2 && tower.meleeTimer <= 0) {
        const innerTargets = candidates.filter((enemy) => distance(tower.position, this.enemyPosition(enemy)) <= 92);
        const slashTarget = this.selectTarget(tower, innerTargets);
        if (slashTarget) {
          const impact = this.enemyPosition(slashTarget);
          this.enemiesInCone(tower.position, impact, innerTargets, 92, 0.62)
            .forEach((enemy) => this.damageEnemy(enemy, damage * 2, definition.accent));
          this.spawnSlash(tower.position, impact, definition.accent, 92, 0.62);
          tower.meleeTimer = 3.5;
        }
      }

      if (tower.kind === "cyborg" && tower.level >= 5) {
        tower.rocketTimer -= delta;
        if (tower.rocketTimer <= 0 && candidates.length > 0) {
          const ordered = [...candidates].sort((a, b) => b.pathDistance - a.pathDistance);
          for (let index = 0; index < 3; index += 1) {
            const target = ordered[index % ordered.length];
            if (!target) continue;
            this.projectiles.push({
              position: { ...tower.position },
              delay: index * 0.09,
              targetId: target.id,
              damage: 175 * tower.damageBuff,
              kind: "cyborg",
              speed: 430,
              splash: 52,
              chain: 0,
              towerLevel: tower.level,
            });
          }
          tower.rocketTimer = 8;
          this.spawnText(tower.position, "JETSTREAM x3", definition.accent);
        }
      }

      if (tower.fireTimer > 0) continue;
      if (tower.kind === "samurai" && tower.level < 4 && tower.abilityTimer <= 0) continue;
      const unburned = tower.kind === "infernus" ? candidates.filter((enemy) => enemy.burnTimer <= 0) : [];
      const target = this.selectTarget(tower, unburned.length > 0 ? unburned : candidates);
      if (!target) continue;

      switch (tower.kind) {
        case "bandit": {
          const shots = tower.level >= 3 ? 2 : 1;
          for (let shot = 0; shot < shots; shot += 1) {
            this.projectiles.push({
              position: { ...tower.position }, delay: shot * 0.14, targetId: target.id, damage, kind: tower.kind,
              speed: 560, splash: 0, chain: 0, towerLevel: tower.level,
            });
          }
          tower.fireTimer = stats.fireRate;
          this.audio.shoot(360);
          break;
        }
        case "samurai": {
          const impact = this.enemyPosition(target);
          const meleeRange = stats.range * RANGE_SCALE;
          const areaTargets = this.enemiesInCone(tower.position, impact, candidates, meleeRange, 0.58);
          const baseDamage = tower.level >= 5 ? 32 : stats.damage;
          const splitDamage = tower.level >= 5 ? 200 / Math.max(1, areaTargets.length) : 0;
          areaTargets.forEach((enemy) => {
            const hpPercent = tower.level >= 4 ? 0.1 : tower.level >= 2 ? 0.02 : 0;
            const scalingCap = tower.level >= 5 ? 6 : 3;
            const stanceMultiplier = tower.abilityTimer > 0 ? (tower.level >= 5 ? 2 : tower.level >= 4 ? 1.5 : 1) : 1;
            const soulDamage = splitDamage * (tower.abilityTimer > 0 ? 0.33 : 1);
            const rawDamage = baseDamage + soulDamage;
            const hpBonus = Math.min(enemy.hp * hpPercent, rawDamage * (scalingCap - 1));
            this.damageEnemy(enemy, (rawDamage + hpBonus) * stanceMultiplier * tower.damageBuff, definition.accent);
          });
          this.spawnSlash(tower.position, impact, definition.accent, meleeRange, 0.58);
          tower.fireTimer = stats.fireRate / (1 + tower.focus);
          this.audio.shoot(240);
          break;
        }
        case "tempest": {
          this.resolveTempestHit(tower, target);
          tower.burstTimer = 0.6;
          tower.burstTargetId = target.id;
          tower.shotCounter += 1;
          if (tower.level >= 3 && tower.shotCounter % 6 === 0) this.startLightningField(tower);
          tower.fireTimer = 2;
          this.audio.shoot(620);
          break;
        }
        case "cyborg": {
          tower.shotCounter += 1;
          const magazineFinal = tower.level === 3 && tower.ammo === 1;
          const howitzerInterval = tower.level >= 5 ? 20 : 30;
          const reactorHowitzer = tower.level >= 4 && tower.shotCounter % howitzerInterval === 0;
          const isHowitzer = magazineFinal || reactorHowitzer;
          const shotDamage = damage * (isHowitzer ? 10 : 1);
          this.projectiles.push({
            position: { ...tower.position }, delay: 0, targetId: target.id, damage: shotDamage, kind: tower.kind,
            speed: 620, splash: isHowitzer ? 46 : 0, chain: 0, towerLevel: tower.level,
          });
          if (isHowitzer) this.spawnText(tower.position, "HOWITZER", definition.accent);
          tower.idleTimer = 0;
          if (tower.level >= 3) tower.attackRamp = Math.min(1, tower.attackRamp + 0.08);
          const rampedRate = tower.level >= 4
            ? 0.3 - tower.attackRamp * 0.2
            : tower.level >= 3
              ? 0.15 - tower.attackRamp * 0.05
              : stats.fireRate;
          tower.fireTimer = rampedRate;
          if (stats.ammo !== undefined) {
            tower.ammo -= 1;
            if (tower.ammo <= 0) {
              tower.ammo = stats.ammo;
              tower.fireTimer = stats.reload ?? 2;
              tower.attackRamp = 0;
              this.spawnText(tower.position, "RELOAD", definition.dimAccent);
            }
          }
          this.audio.shoot(isHowitzer ? 190 : 520);
          break;
        }
        case "mercenary": {
          this.projectiles.push({
            position: { ...tower.position }, delay: 0, targetId: target.id, damage, kind: tower.kind,
            speed: 600, splash: 0, chain: 0, towerLevel: tower.level,
          });
          tower.fireTimer = stats.fireRate;
          this.audio.shoot(430);
          break;
        }
        case "infernus": {
          const impact = this.enemyPosition(target);
          const halfAngle = tower.level >= 3 ? 0.58 : tower.level >= 1 ? 0.48 : 0.38;
          const victims = this.enemiesInCone(tower.position, impact, candidates, range, halfAngle);
          victims.forEach((enemy) => {
            if (damage > 0) this.damageEnemy(enemy, damage, definition.accent);
            this.applyBurn(enemy, tower);
          });
          this.spawnSpray(
            tower.position,
            impact,
            "#ffe66d",
            tower.level >= 5 ? "#d71920" : "#f04a32",
            tower.level >= 4 ? 11 : 8,
            halfAngle,
            range,
          );
          tower.fireTimer = stats.fireRate;
          this.audio.shoot(170);
          break;
        }
        case "bomber": {
          tower.shotCounter += 1;
          const critical = tower.level >= 3 && tower.shotCounter % 4 === 0;
          this.projectiles.push({
            position: { ...tower.position }, delay: 0, targetId: target.id, damage: damage * (critical ? 3 : 1), kind: tower.kind,
            speed: 330, splash: tower.level >= 1 ? 60 : 46, chain: 0, towerLevel: tower.level,
          });
          if (critical) this.spawnText(tower.position, "DYNAMITE x3", definition.accent);
          tower.fireTimer = stats.fireRate;
          this.audio.shoot(205);
          break;
        }
        case "recon": {
          const aim = this.enemyPosition(target);
          const aimAngle = Math.atan2(aim.y - tower.position.y, aim.x - tower.position.x);
          const spreadStep = 0.065 + tower.attackRamp * 0.12;
          const pelletOffsets = [-2, -1, 0, 1, 2] as const;
          pelletOffsets.forEach((offset, pellet) => {
            const angle = aimAngle + offset * spreadStep;
            const end = {
              x: tower.position.x + Math.cos(angle) * range,
              y: tower.position.y + Math.sin(angle) * range,
            };
            const direction = { x: Math.cos(angle), y: Math.sin(angle) };
            const hits = candidates
              .map((enemy) => {
                const position = this.enemyPosition(enemy);
                const relative = { x: position.x - tower.position.x, y: position.y - tower.position.y };
                const forward = relative.x * direction.x + relative.y * direction.y;
                const sideways = Math.abs(relative.x * direction.y - relative.y * direction.x);
                const hitWidth = getEnemyDefinition(enemy.kind).radius + (tower.level >= 3 ? 8 : 5);
                return { enemy, forward, sideways, hitWidth };
              })
              .filter(({ forward, sideways, hitWidth }) => forward >= 0 && forward <= range && sideways <= hitWidth)
              .sort((a, b) => a.forward - b.forward)
              .slice(0, tower.level >= 3 ? 3 : 2);
            hits.forEach(({ enemy }) => this.damageEnemy(enemy, damage, definition.accent));
            this.spawnBeam(tower.position, end, pellet === 2 ? "#eafffb" : definition.accent, 2, pellet * 0.018);
          });
          this.spawnMuzzleFlash(tower.position, aim, definition.accent, 26);
          tower.idleTimer = 0;
          tower.attackRamp = Math.min(1, tower.attackRamp + 0.25);
          tower.shotCounter += 1;
          tower.ammo -= 1;
          tower.fireTimer = stats.fireRate;
          if (tower.ammo <= 0) {
            tower.ammo = stats.ammo ?? 5;
            tower.fireTimer = (stats.reload ?? 4) + stats.fireRate;
            this.spawnText(tower.position, "SHOTGUN RELOAD", definition.dimAccent);
          }
          this.audio.shoot(285);
          break;
        }
        case "gunner": {
          const burst = tower.level >= 5 ? 6 : tower.level >= 4 ? 4 : 3;
          const burstSpacing = tower.level >= 5 ? 0.1 : 0.2;
          let shotDelay = 0;
          let resultingRamp = tower.attackRamp;
          for (let shot = 0; shot < burst; shot += 1) {
            this.projectiles.push({
              position: { ...tower.position }, delay: shotDelay, targetId: target.id, damage,
              kind: tower.kind, speed: 640, splash: 0, chain: 0, towerLevel: tower.level,
            });
            if (tower.level >= 4) resultingRamp = Math.min(4, resultingRamp + 0.02);
            if (shot < burst - 1) shotDelay += burstSpacing / (1 + resultingRamp);
          }
          if (tower.level >= 4) {
            tower.attackRamp = resultingRamp;
            tower.rampTimer = tower.level >= 5 ? 22 : 18;
          }
          tower.fireTimer = shotDelay + stats.fireRate / (1 + tower.attackRamp);
          this.spawnMuzzleFlash(tower.position, this.enemyPosition(target), definition.accent, 22);
          this.audio.shoot(455);
          break;
        }
        case "warrior": {
          const impact = this.enemyPosition(target);
          const victims = this.enemiesInCone(tower.position, impact, candidates, range, 0.72);
          victims.forEach((enemy) => this.damageEnemy(enemy, damage, definition.accent));
          this.spawnSlash(tower.position, impact, definition.accent, range, 0.72);
          if (tower.level >= 4) {
            this.delayedSlashes.push({
              towerId: tower.id,
              origin: { ...tower.position },
              aim: { ...impact },
              range,
              spread: 0.72,
              damage,
              color: "#ffffff",
              timer: 0.18,
            });
          }
          tower.fireTimer = stats.fireRate;
          this.audio.shoot(210);
          break;
        }
      }
    }
  }

  private startLightningField(tower: Tower): void {
    const duration = tower.level >= 5 ? 9 : 6;
    tower.fieldTimer += duration;
    tower.fieldTickTimer = Math.min(tower.fieldTickTimer, 0.15);
    tower.fieldVfxTimer = Math.min(tower.fieldVfxTimer, 0.03);
    this.spawnRing(tower.position, TOWER_DEFINITIONS.tempest.accent, 0.65, 9, 150);
    this.spawnText(tower.position, "LIGHTNING FIELD", TOWER_DEFINITIONS.tempest.accent);
  }

  private updateTempestBurst(tower: Tower, delta: number): void {
    if (tower.burstTimer <= 0) return;
    tower.burstTimer -= delta;
    if (tower.burstTimer > 0) return;
    const target = this.enemies.find((enemy) => enemy.id === tower.burstTargetId && enemy.hp > 0);
    tower.burstTargetId = null;
    if (target) this.resolveTempestHit(tower, target);
  }

  private resolveTempestHit(tower: Tower, target: Enemy): void {
    const stats = this.towerStats(tower);
    const accent = TOWER_DEFINITIONS.tempest.accent;
    const radius = tower.level >= 4 ? 60 : tower.level >= 2 ? 30 : 0;
    const damage = stats.damage * tower.damageBuff;
    this.damageEnemy(target, damage, accent);
    const impact = this.enemyPosition(target);
    if (radius > 0) {
      this.enemies
        .filter((enemy) => enemy.id !== target.id && enemy.hp > 0 && distance(this.enemyPosition(enemy), impact) <= radius)
        .forEach((enemy) => this.damageEnemy(enemy, damage, accent));
    }
    if (tower.level >= 2) this.applyShockAround(tower, tower.level >= 4 ? 0.1 : 0.5, 2);
    this.spawnArc(tower.position, impact, accent);
  }

  private updateLightningField(tower: Tower, delta: number): void {
    if (tower.fieldTimer <= 0) return;
    tower.fieldTimer = Math.max(0, tower.fieldTimer - delta);
    tower.fieldVfxTimer -= delta;
    while (tower.fieldVfxTimer <= 0) {
      this.spawnLightningAuraArc(tower.position, 150, TOWER_DEFINITIONS.tempest.accent);
      tower.fieldVfxTimer += tower.level >= 4 ? 0.09 : 0.13;
    }
    tower.fieldTickTimer -= delta;
    if (tower.fieldTickTimer > 0) return;
    tower.fieldTickTimer = 1;
    const duration = tower.level >= 5 ? 9 : 6;
    const minFieldDamage = 28;
    const maxFieldDamage = 200;
    this.enemies
      .filter((enemy) => enemy.hp > 0 && distance(this.enemyPosition(enemy), tower.position) <= 150)
      .forEach((enemy) => {
        const totalDamage = clamp(enemy.hp * 0.08, minFieldDamage, maxFieldDamage);
        this.damageEnemy(enemy, (totalDamage / duration) * tower.damageBuff, TOWER_DEFINITIONS.tempest.accent);
        if (tower.level >= 2) this.applyShock(enemy, tower, 2);
      });
  }

  private applyShockAround(tower: Tower, slowFactor: number, duration: number): void {
    const range = this.towerStats(tower).range * RANGE_SCALE + 45;
    this.enemies
      .filter(
        (enemy) => this.canTowerTarget(tower, enemy) && distance(this.enemyPosition(enemy), tower.position) <= range,
      )
      .forEach((enemy) => this.applyShock(enemy, tower, duration, slowFactor));
  }

  private applyShock(enemy: Enemy, tower: Tower, duration: number, initialFactor?: number): void {
    const baseFactor = initialFactor ?? (tower.level >= 4 ? 0.1 : 0.5);
    const decay = tower.level >= 4 ? 0.85 : 0.5;
    const strength = (1 - baseFactor) * Math.pow(decay, enemy.shockStacks);
    enemy.slowTimer = Math.max(enemy.slowTimer, duration);
    enemy.slowFactor = Math.min(enemy.slowFactor, 1 - strength);
    enemy.shockStacks += 1;
  }

  private selectTarget(tower: Tower, candidates: readonly Enemy[]): Enemy | undefined {
    return [...candidates].sort((a, b) => {
      switch (tower.targeting) {
        case "first":
          return b.pathDistance - a.pathDistance || a.id - b.id;
        case "last":
          return a.pathDistance - b.pathDistance || b.id - a.id;
        case "strongest":
          return b.maxHp - a.maxHp || b.hp - a.hp;
        case "weakest":
          return a.hp - b.hp || a.maxHp - b.maxHp;
        case "closest":
          return distance(tower.position, this.enemyPosition(a)) - distance(tower.position, this.enemyPosition(b));
      }
    })[0];
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
    if (!getEnemyDefinition(enemy.kind).hidden) return true;
    if (tower.kind === "infernus") return true;
    const detectionLevel = TOWER_DEFINITIONS[tower.kind].hiddenDetectionLevel;
    return detectionLevel !== undefined && tower.level >= detectionLevel;
  }

  private updateProjectiles(delta: number): void {
    const survivors: Projectile[] = [];
    for (const projectile of this.projectiles) {
      if (projectile.delay > 0) {
        projectile.delay = Math.max(0, projectile.delay - delta);
        survivors.push(projectile);
        continue;
      }
      const target = this.enemies.find((enemy) => enemy.id === projectile.targetId && enemy.hp > 0);
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

  private updateDelayedSlashes(delta: number): void {
    const survivors: DelayedSlash[] = [];
    for (const slash of this.delayedSlashes) {
      slash.timer -= delta;
      if (slash.timer > 0) {
        survivors.push(slash);
        continue;
      }
      const tower = this.towers.find((candidate) => candidate.id === slash.towerId && candidate.hp > 0);
      this.spawnSlash(slash.origin, slash.aim, slash.color, slash.range * 0.9, slash.spread);
      if (!tower) continue;
      const candidates = this.enemies.filter(
        (enemy) =>
          enemy.hp > 0 &&
          this.canTowerTarget(tower, enemy) &&
          distance(slash.origin, this.enemyPosition(enemy)) <= slash.range,
      );
      this.enemiesInCone(slash.origin, slash.aim, candidates, slash.range, slash.spread)
        .forEach((enemy) => this.damageEnemy(enemy, slash.damage, slash.color));
      this.audio.shoot(260);
    }
    this.delayedSlashes = survivors;
  }

  private resolveProjectile(projectile: Projectile, target: Enemy): void {
    const accent = TOWER_DEFINITIONS[projectile.kind].accent;
    const damageAgainst = (enemy: Enemy): number => {
      if (projectile.kind !== "bomber" || projectile.towerLevel < 1 || enemy.burnTimer <= 0) return projectile.damage;
      return projectile.damage * (projectile.towerLevel >= 5 && enemy.burnDamage >= 7 ? 3 : 2);
    };
    this.damageEnemy(target, damageAgainst(target), accent);
    const impact = this.enemyPosition(target);
    if (projectile.splash > 0) {
      this.spawnExplosion(impact, accent, projectile.splash);
      const splashed = this.enemies
        .filter((enemy) => enemy.id !== target.id && distance(this.enemyPosition(enemy), impact) <= projectile.splash);
      splashed.forEach((enemy) => this.damageEnemy(enemy, damageAgainst(enemy), accent));
    } else this.spawnImpactDust(impact, accent);
  }

  private applyBurn(enemy: Enemy, tower: Tower, strength = 1): void {
    const level = tower.level;
    const duration = level >= 5 ? 10 : level >= 2 ? 6 : 3;
    const damage = level >= 5 ? 10 : level >= 4 ? 4 : level >= 3 ? 3 : 1;
    const slowFactor = level >= 5 ? 0.75 : level >= 2 ? 0.85 : 1;
    enemy.burnTimer = Math.max(enemy.burnTimer, duration);
    enemy.burnDamage = Math.max(enemy.burnDamage, damage * strength * tower.damageBuff);
    enemy.burnSlowFactor = Math.min(enemy.burnSlowFactor, slowFactor);
    if (enemy.burnTickTimer <= 0) enemy.burnTickTimer = level >= 4 ? 0.5 : 1;
  }

  private updateTimedBombs(delta: number): void {
    const survivors: TimedBomb[] = [];
    for (const bomb of this.timedBombs) {
      const proximityTarget = bomb.proximity
        ? this.enemies.find((enemy) => enemy.hp > 0 && distance(this.enemyPosition(enemy), bomb.position) <= 27)
        : undefined;
      if (!bomb.proximity) bomb.timer -= delta;
      if ((bomb.proximity && !proximityTarget) || (!bomb.proximity && bomb.timer > 0)) {
        survivors.push(bomb);
        continue;
      }
      this.enemies
        .filter((enemy) => distance(this.enemyPosition(enemy), bomb.position) <= bomb.radius)
        .forEach((enemy) => {
          const canExploitBurn = !bomb.proximity || (bomb.towerLevel ?? 0) >= 1;
          const burningMultiplier = canExploitBurn && enemy.burnTimer > 0
            ? ((bomb.towerLevel ?? 5) >= 5 && enemy.burnDamage >= 7 ? 3 : 2)
            : 1;
          this.damageEnemy(enemy, bomb.damage * burningMultiplier, bomb.color);
        });
      this.spawnExplosion(bomb.position, bomb.color, bomb.radius);
      this.spawnText(bomb.position, bomb.proximity ? "PATH BOMB" : "TIME BOMB // 500", bomb.color);
      this.shake = Math.min(1, this.shake + 0.8);
      this.audio.breach();
    }
    this.timedBombs = survivors;
  }

  private damageEnemy(enemy: Enemy, amount: number, _color: string): void {
    if (enemy.hp <= 0) return;
    const dealt = Math.min(enemy.hp, Math.max(0, amount));
    enemy.hp -= dealt;
    this.damageIncomeRemainder += dealt * ECONOMY_RULES.damageCashPerHp;
    const payout = Math.floor(this.damageIncomeRemainder);
    if (payout > 0) {
      this.shards += payout;
      this.damageIncomeRemainder -= payout;
    }
    enemy.hitFlash = 1;
  }

  private removeDeadEnemies(): void {
    const deadIds = new Set(this.enemies.filter((enemy) => enemy.hp <= 0).map((enemy) => enemy.id));
    this.enemies = this.enemies.filter((enemy) => enemy.hp > 0);
    if (deadIds.size > 0) this.towers.forEach((tower) => deadIds.forEach((id) => tower.engaged.delete(id)));
  }

  private completeWave(): void {
    this.waveActive = false;
    this.nextWaveIndex += 1;
    const wave = this.mode.waves[this.waveNumber - 1];
    const bonus = wave?.cashReward ?? (ECONOMY_RULES.waveClearBase + ECONOMY_RULES.waveClearPerWave * this.waveNumber);
    this.shards += bonus;
    this.towers.forEach((tower) => {
      if (!tower.onPath || tower.hp >= tower.maxHp) return;
      const missingHp = tower.maxHp - tower.hp;
      tower.hp = Math.min(tower.maxHp, tower.hp + missingHp * 0.7 + 4);
    });
    this.callbacks.onLog(`Wave ${this.waveNumber.toString().padStart(2, "0")} purged // +$${bonus}; blockers repaired for 70% missing HP + 4.`, "good");
    this.audio.tone(280, 0.18, 0.024, 220);
    if (this.nextWaveIndex >= this.mode.waves.length) {
      this.modeComplete = true;
      this.callbacks.onLog(`${this.mode.name.toUpperCase()} COMPLETE // all ${this.mode.waves.length} waves cleared.`, "good");
      this.callbacks.onVictory(this.mode);
    } else {
      this.intermissionTimer = WAVE_INTERMISSION_SECONDS;
      this.callbacks.onLog(`Next wave begins automatically in ${WAVE_INTERMISSION_SECONDS} seconds.`);
    }
    this.emitUi();
  }

  private towerStats(tower: Tower): TowerLevelStats {
    const stats = TOWER_DEFINITIONS[tower.kind].levels[tower.level];
    if (!stats) throw new Error(`Missing level ${tower.level} stats for ${tower.kind}`);
    return stats;
  }

  private get selectedTower(): Tower | null {
    return this.towers.find((tower) => tower.id === this.selectedTowerId) ?? null;
  }

  private emitUi(): void {
    const tower = this.selectedTower;
    const incoming = tower
      ? this.enemies
          .filter((enemy) => enemy.targetTowerId === tower.id && enemy.attackTimer <= enemy.telegraphDuration)
          .sort((a, b) => a.attackTimer - b.attackTimer)[0]?.attackTimer ?? null
      : null;
    this.callbacks.onUi({
      integrity: this.integrity,
      maxIntegrity: this.maxIntegrity,
      shards: this.shards,
      pendingCasualtyRefund: this.pendingCasualtyRefund,
      infiniteCash: this.infiniteCash,
      copiesRemaining: { ...this.copiesRemaining },
      availableTowers: TOWER_ORDER.filter((kind) => this.availableTowerKinds.has(kind)),
      wave: this.waveNumber,
      totalWaves: this.mode.waves.length,
      modeName: this.mode.name,
      mapName: this.map.name,
      waveActive: this.waveActive,
      intermissionRemaining: this.intermissionTimer,
      enemiesRemaining: this.enemies.length + this.spawnQueue.length,
      paused: this.paused,
      speed: this.speed,
      soundEnabled: this.audio.enabled,
      selectedKind: this.selectedKind,
      selectedTower: tower
        ? { tower, definition: TOWER_DEFINITIONS[tower.kind], incomingAttack: incoming }
        : null,
      placement: this.placement,
      relocating: this.relocatingTowerId !== null,
      started: this.started,
      gameOver: this.gameOver,
      modeComplete: this.modeComplete,
    });
  }

  private enemyPosition(enemy: Enemy): Point {
    const sample = this.path.sample(enemy.pathDistance);
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

  private updateParticles(delta: number): void {
    this.particles.forEach((particle) => {
      if ((particle.delay ?? 0) > 0) {
        particle.delay = Math.max(0, (particle.delay ?? 0) - delta);
        return;
      }
      particle.life -= delta;
      particle.position.x += particle.velocity.x * delta;
      particle.position.y += particle.velocity.y * delta;
      particle.rotation = (particle.rotation ?? 0) + (particle.angularVelocity ?? 0) * delta;
      const damping = Math.pow(particle.drag ?? 0.96, delta * 60);
      particle.velocity.x *= damping;
      particle.velocity.y *= damping;
    });
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private spawnSpark(position: Point, color: string, speed: number): void {
    const angle = Math.random() * TAU;
    const life = 0.28 + Math.random() * 0.2;
    this.particles.push({
      position: { ...position },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life,
      maxLife: life,
      color,
      size: 2 + Math.random() * 2,
      type: "spark",
    });
  }

  private spawnRing(position: Point, color: string, life: number, size: number, radius = 82): void {
    this.particles.push({
      position: { ...position },
      velocity: { x: 0, y: 0 },
      life,
      maxLife: life,
      color,
      size,
      radius,
      type: "ring",
    });
  }

  private spawnImpactDust(position: Point, color: string): void {
    for (let index = 0; index < 3; index += 1) {
      this.spawnSpark(position, color, 18 + Math.random() * 24);
    }
  }

  private spawnText(position: Point, text: string, color: string): void {
    this.particles.push({
      position: { x: position.x, y: position.y - 32 },
      velocity: { x: 0, y: -24 },
      life: 0.9,
      maxLife: 0.9,
      color,
      size: 11,
      type: "text",
      text,
    });
  }

  private spawnSlash(from: Point, to: Point, color: string, reach?: number, spread = 0.58): void {
    const life = 0.24;
    this.particles.push({
      position: { ...from },
      velocity: { x: 0, y: 0 },
      life,
      maxLife: life,
      color,
      size: 8,
      radius: reach ?? clamp(distance(from, to), 36, 135),
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      spread,
      type: "slash",
    });
    this.spawnImpactDust(to, color);
  }

  private spawnTracer(from: Point, to: Point, color: string): void {
    const steps = 9;
    for (let index = 1; index < steps; index += 1) {
      const amount = index / steps;
      this.particles.push({
        position: {
          x: from.x + (to.x - from.x) * amount,
          y: from.y + (to.y - from.y) * amount,
        },
        velocity: { x: 0, y: 0 },
        life: 0.09,
        maxLife: 0.09,
        color,
        size: 2,
        type: "spark",
      });
    }
  }

  private spawnArc(from: Point, to: Point, color: string): void {
    const steps = 7;
    for (let index = 1; index < steps; index += 1) {
      const amount = index / steps;
      const point = {
        x: from.x + (to.x - from.x) * amount + (Math.random() - 0.5) * 12,
        y: from.y + (to.y - from.y) * amount + (Math.random() - 0.5) * 12,
      };
      this.particles.push({
        position: point,
        velocity: { x: 0, y: 0 },
        life: 0.13,
        maxLife: 0.13,
        color,
        size: 2.5,
        type: "spark",
      });
    }
  }

  private spawnSpray(
    from: Point,
    to: Point,
    startColor: string,
    endColor: string,
    count: number,
    spread: number,
    reach: number,
  ): void {
    const facing = Math.atan2(to.y - from.y, to.x - from.x);
    for (let index = 0; index < count; index += 1) {
      const angle = facing + (Math.random() * 2 - 1) * spread;
      const life = 0.36 + Math.random() * 0.22;
      const muzzleOffset = 8 + Math.random() * 8;
      const rangeCoverage = index % 4 === 0 ? 1 : 0.84 + Math.random() * 0.16;
      const speed = (Math.max(1, reach - muzzleOffset) / life) * rangeCoverage;
      this.particles.push({
        position: {
          x: from.x + Math.cos(angle) * muzzleOffset,
          y: from.y + Math.sin(angle) * muzzleOffset,
        },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life,
        maxLife: life,
        color: startColor,
        endColor,
        size: 5 + Math.random() * 6,
        rotation: Math.random() * TAU,
        angularVelocity: (Math.random() * 2 - 1) * 10,
        drag: 1,
        type: "spray",
      });
    }
  }

  private spawnRadialSpray(position: Point, startColor: string, endColor: string, count: number, reach: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const life = 0.38 + Math.random() * 0.28;
      const rangeCoverage = index % 4 === 0 ? 1 : 0.68 + Math.random() * 0.32;
      const speed = (reach / life) * rangeCoverage;
      this.particles.push({
        position: { ...position },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life,
        maxLife: life,
        color: startColor,
        endColor,
        size: 5 + Math.random() * 7,
        rotation: Math.random() * TAU,
        angularVelocity: (Math.random() * 2 - 1) * 12,
        drag: 1,
        type: "spray",
      });
    }
  }

  private spawnFlash(position: Point, color: string, size: number, angle = 0, delay = 0): void {
    this.particles.push({
      position: { ...position },
      velocity: { x: 0, y: 0 },
      delay,
      life: 0.18,
      maxLife: 0.18,
      color,
      size,
      angle,
      type: "flash",
    });
  }

  private spawnLightningAuraArc(center: Point, radius: number, color: string): void {
    const randomPoint = (): Point => {
      const angle = Math.random() * TAU;
      const radialDistance = Math.sqrt(Math.random()) * radius * 0.92;
      return {
        x: center.x + Math.cos(angle) * radialDistance,
        y: center.y + Math.sin(angle) * radialDistance,
      };
    };
    const start = randomPoint();
    const end = randomPoint();
    const points: Point[] = [];
    const segments = 6;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const perpendicular = { x: -Math.sin(angle), y: Math.cos(angle) };
    for (let segment = 0; segment <= segments; segment += 1) {
      const progress = segment / segments;
      const jitter = segment === 0 || segment === segments ? 0 : (Math.random() - 0.5) * 24;
      const point = {
        x: start.x + (end.x - start.x) * progress + perpendicular.x * jitter,
        y: start.y + (end.y - start.y) * progress + perpendicular.y * jitter,
      };
      const offsetX = point.x - center.x;
      const offsetY = point.y - center.y;
      const pointDistance = Math.hypot(offsetX, offsetY);
      if (pointDistance > radius) {
        point.x = center.x + (offsetX / pointDistance) * radius;
        point.y = center.y + (offsetY / pointDistance) * radius;
      }
      points.push(point);
    }
    this.particles.push({
      position: { ...center },
      velocity: { x: 0, y: 0 },
      life: 0.17,
      maxLife: 0.17,
      color,
      size: 3,
      points,
      type: "lightning",
    });
  }

  private spawnMuzzleFlash(from: Point, to: Point, color: string, size: number): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const muzzle = { x: from.x + Math.cos(angle) * 25, y: from.y + Math.sin(angle) * 25 };
    this.spawnFlash(muzzle, color, size, angle);
    for (let index = 0; index < 5; index += 1) this.spawnSpark(muzzle, color, 55 + Math.random() * 70);
  }

  private spawnBeam(from: Point, to: Point, color: string, width: number, delay = 0): void {
    this.particles.push({
      position: { ...from },
      velocity: { x: 0, y: 0 },
      delay,
      life: 0.13,
      maxLife: 0.13,
      color,
      size: width,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      length: distance(from, to),
      type: "beam",
    });
  }

  private spawnSmoke(position: Point, color = "#626866", count = 8): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const life = 0.55 + Math.random() * 0.45;
      this.particles.push({
        position: { ...position },
        velocity: { x: Math.cos(angle) * (18 + Math.random() * 42), y: Math.sin(angle) * (18 + Math.random() * 42) - 18 },
        life,
        maxLife: life,
        color,
        size: 8 + Math.random() * 12,
        type: "smoke",
      });
    }
  }

  private spawnExplosion(position: Point, color: string, radius: number): void {
    this.spawnFlash(position, "#fff1a8", Math.min(52, radius * 0.7));
    this.spawnRing(position, color, 0.5, 10, radius);
    this.spawnRing(position, "#ffffff", 0.24, 4, radius * 0.65);
    this.spawnRadialSpray(position, "#ffe477", "#e14c2d", 18, radius);
    this.spawnSmoke(position, "#545959", 9);
    for (let index = 0; index < 12; index += 1) this.spawnSpark(position, color, 80 + Math.random() * 150);
  }

  private spawnCrossSlash(from: Point, to: Point, color: string, reach: number): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    for (const offset of [-0.48, 0.48]) {
      const aim = { x: from.x + Math.cos(angle + offset) * reach, y: from.y + Math.sin(angle + offset) * reach };
      this.spawnSlash(from, aim, offset < 0 ? color : "#ffffff", reach, 0.38);
    }
    this.spawnFlash(from, color, 34, angle);
  }

  private spawnShieldFlash(position: Point, color: string, radius: number): void {
    this.spawnRing(position, color, 0.42, 8, radius);
    this.spawnRing(position, "#ffffff", 0.25, 3, radius * 0.6);
    this.spawnFlash(position, color, 30);
  }

  private spawnCounterBurst(position: Point, color: string): void {
    this.spawnRing(position, color, 0.7, 10, 92);
    this.spawnRing(position, "#ffffff", 0.3, 4, 54);
    this.spawnFlash(position, color, 38);
  }

  private draw(): void {
    const context = this.context;
    const viewport = this.viewport;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#07090a";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 8 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 8 : 0;
    context.save();
    context.translate(shakeX, shakeY);
    this.drawField();
    this.drawPath();
    this.drawCore();
    this.drawTowerRanges();
    this.projectiles.filter((projectile) => projectile.delay <= 0).forEach((projectile) => this.drawProjectile(projectile));
    this.timedBombs.forEach((bomb) => this.drawTimedBomb(bomb));
    this.towers.forEach((tower) => this.drawTower(tower));
    this.enemies.forEach((enemy) => this.drawEnemy(enemy));
    this.drawBossHealthbars();
    this.drawPlacement();
    this.drawParticles();
    context.restore();
    this.drawVignette();
  }

  private drawField(): void {
    const context = this.context;
    context.fillStyle = this.map.palette.field;
    context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const glow = context.createRadialGradient(650, 350, 20, 650, 350, 650);
    glow.addColorStop(0, this.map.palette.glow);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    context.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += 40) {
      context.strokeStyle = x % 200 === 0 ? "rgba(177,187,184,.08)" : "rgba(177,187,184,.035)";
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, WORLD_HEIGHT);
      context.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 40) {
      context.strokeStyle = y % 200 === 0 ? "rgba(177,187,184,.08)" : "rgba(177,187,184,.035)";
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(WORLD_WIDTH, y);
      context.stroke();
    }
    context.fillStyle = "rgba(207, 218, 213, 0.035)";
    [
      [72, 76, 210, 66],
      [505, 65, 185, 54],
      [815, 566, 242, 64],
      [235, 580, 180, 48],
    ].forEach(([x = 0, y = 0, width = 0, height = 0]) => context.fillRect(x, y, width, height));
  }

  private drawPath(): void {
    const context = this.context;
    context.save();
    context.lineCap = "butt";
    context.lineJoin = "round";
    context.beginPath();
    this.map.path.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
    context.strokeStyle = "rgba(0, 0, 0, .58)";
    context.lineWidth = PATH_HALF_WIDTH * 2 + 18;
    context.stroke();
    context.strokeStyle = this.map.palette.path;
    context.lineWidth = PATH_HALF_WIDTH * 2;
    context.stroke();
    context.setLineDash([10, 13]);
    context.lineDashOffset = -this.elapsed * 11;
    context.strokeStyle = `${this.map.palette.accent}33`;
    context.lineWidth = 2;
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = "rgba(235, 238, 229, .12)";
    context.lineWidth = PATH_HALF_WIDTH * 2 - 14;
    context.stroke();
    context.globalCompositeOperation = "destination-over";
    context.strokeStyle = "rgba(255,255,255,.02)";
    context.lineWidth = PATH_HALF_WIDTH * 2 - 18;
    context.stroke();
    context.restore();

    context.save();
    context.font = "600 13px ui-monospace, monospace";
    context.fillStyle = "rgba(218, 224, 218, .25)";
    context.textAlign = "center";
    context.fillText("ENTRY // 00", this.map.entryLabel.x, this.map.entryLabel.y);
    context.fillText("PATHBOUND ZONE", this.map.pathLabel.x, this.map.pathLabel.y);
    context.restore();
  }

  private drawCore(): void {
    const context = this.context;
    const core = this.map.core;
    context.save();
    context.translate(core.x, core.y);
    context.rotate(this.elapsed * 0.18);
    context.strokeStyle = this.integrity <= 6 ? "#f25e57" : "#d5d9d2";
    context.lineWidth = 2;
    for (let size = 25; size <= 43; size += 9) {
      context.strokeRect(-size, -size, size * 2, size * 2);
      context.rotate(Math.PI / 8);
    }
    context.fillStyle = this.integrity <= 6 ? "rgba(242,94,87,.2)" : "rgba(213,217,210,.1)";
    context.fillRect(-19, -19, 38, 38);
    context.restore();
    context.fillStyle = "rgba(231,235,227,.55)";
    context.font = "600 13px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("CORE", core.x, core.y + 64);
  }

  private drawTowerRanges(): void {
    const tower = this.selectedTower;
    if (!tower) return;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const context = this.context;
    context.save();
    context.beginPath();
    const range = this.towerStats(tower).range * RANGE_SCALE;
    context.arc(tower.position.x, tower.position.y, range, 0, TAU);
    context.fillStyle = `${definition.accent}0b`;
    context.fill();
    context.setLineDash([5, 7]);
    context.strokeStyle = `${definition.accent}55`;
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  private drawTower(tower: Tower): void {
    const context = this.context;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const selected = tower.id === this.selectedTowerId;
    const pulse = 1 + Math.sin(this.elapsed * 4 + tower.id) * 0.04;
    context.save();
    context.translate(tower.position.x, tower.position.y);
    context.scale(pulse, pulse);
    if (tower.stunTimer > 0) {
      context.beginPath();
      context.arc(0, 0, 37, 0, TAU);
      context.setLineDash([3, 5]);
      context.lineDashOffset = -this.elapsed * 18;
      context.strokeStyle = "#ffc866";
      context.lineWidth = 2;
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#ffc866";
      context.font = "700 10px ui-monospace, monospace";
      context.textAlign = "center";
      context.fillText(`STUN ${tower.stunTimer.toFixed(1)}`, 0, -43);
    }
    if (tower.kind === "tempest" && tower.fieldTimer > 0) {
      context.beginPath();
      context.arc(0, 0, 150, 0, TAU);
      context.fillStyle = `${definition.accent}08`;
      context.fill();
      context.setLineDash([7, 11]);
      context.strokeStyle = `${definition.accent}44`;
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }
    if (tower.overdriveTimer > 0) {
      context.beginPath();
      context.arc(0, 0, 31 + Math.sin(this.elapsed * 7) * 2, 0, TAU);
      context.strokeStyle = `${TOWER_DEFINITIONS.mercenary.accent}bb`;
      context.lineWidth = 2;
      context.stroke();
    }
    if (tower.kind === "gunner" && tower.level >= 4 && tower.rampTimer > 0) {
      context.beginPath();
      context.arc(0, 0, 30 + Math.sin(this.elapsed * 10) * 1.5, 0, TAU);
      context.strokeStyle = `${definition.accent}${Math.round(70 + Math.min(1, tower.attackRamp / 4) * 120).toString(16).padStart(2, "0")}`;
      context.lineWidth = 1.5 + Math.min(2, tower.attackRamp / 2);
      context.stroke();
    }
    if (selected) {
      context.beginPath();
      context.arc(0, 0, 34 + Math.sin(this.elapsed * 6) * 2, 0, TAU);
      context.strokeStyle = `${definition.accent}99`;
      context.lineWidth = 1.5;
      context.setLineDash([4, 4]);
      context.stroke();
      context.setLineDash([]);
    }
    if (tower.counterFlash > 0 || (tower.kind === "samurai" && tower.abilityTimer > 0)) {
      context.shadowBlur = 28;
      context.shadowColor = definition.accent;
    }
    context.fillStyle = tower.hurtFlash > 0 ? "#fff4ef" : "#111617";
    context.strokeStyle = definition.accent;
    context.lineWidth = 2.5;
    context.beginPath();
    if (tower.onPath) {
      context.rect(-23, -23, 46, 46);
    } else {
      context.arc(0, 0, 23, 0, TAU);
    }
    context.fill();
    context.stroke();
    context.rotate(tower.onPath ? Math.PI / 4 : this.elapsed * 0.22);
    context.strokeStyle = `${definition.accent}88`;
    context.lineWidth = 1;
    context.strokeRect(-13, -13, 26, 26);
    context.rotate(tower.onPath ? -Math.PI / 4 : -this.elapsed * 0.22);
    context.fillStyle = definition.accent;
    context.font = "700 18px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(definition.glyph, 0, 1);
    if (tower.kind === "recon" && tower.attackRamp > 0.01) {
      const gap = 30 + tower.attackRamp * 18;
      const arm = 7;
      context.beginPath();
      context.moveTo(-gap - arm, 0);
      context.lineTo(-gap, 0);
      context.moveTo(gap, 0);
      context.lineTo(gap + arm, 0);
      context.moveTo(0, -gap - arm);
      context.lineTo(0, -gap);
      context.moveTo(0, gap);
      context.lineTo(0, gap + arm);
      context.strokeStyle = `${definition.accent}aa`;
      context.lineWidth = 1.5;
      context.stroke();
    }
    const counterReady = tower.onPath && tower.counterCooldown <= 0;
    const abilityReady = Boolean(
      definition.ability && tower.level >= definition.ability.unlockLevel && tower.abilityCooldown <= 0,
    );
    if (counterReady) {
      context.beginPath();
      context.arc(0, 0, 28, -Math.PI / 2, -Math.PI / 2 + TAU * (0.82 + Math.sin(this.elapsed * 3) * 0.05));
      context.strokeStyle = `${definition.accent}99`;
      context.lineWidth = 2;
      context.stroke();
    }
    if (abilityReady) {
      context.beginPath();
      context.setLineDash([3, 4]);
      context.lineDashOffset = -this.elapsed * 12;
      context.arc(0, 0, 32, 0, TAU);
      context.strokeStyle = "rgba(241,208,122,.8)";
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }
    context.restore();

    context.save();
    context.font = "700 9px ui-monospace, monospace";
    context.textAlign = "center";
    const levelCount = definition.levels.length;
    const pipStart = tower.position.x - ((levelCount - 1) * 8 + 5) / 2;
    for (let index = 0; index < levelCount; index += 1) {
      context.fillStyle = index <= tower.level ? definition.accent : "rgba(255,255,255,.14)";
      context.fillRect(pipStart + index * 8, tower.position.y + (tower.onPath ? 41 : 32), 5, 3);
    }
    context.restore();

    if (tower.kind === "cyborg" || tower.kind === "recon") {
      const stats = this.towerStats(tower);
      context.save();
      context.font = "700 9px ui-monospace, monospace";
      context.textAlign = "center";
      context.fillStyle = definition.accent;
      context.fillText(
        tower.kind === "cyborg" && stats.ammo === undefined
          ? `REACTOR ${tower.shotCounter % (tower.level >= 5 ? 20 : 30)}`
          : `AMMO ${tower.ammo}/${stats.ammo ?? 5}`,
        tower.position.x,
        tower.position.y + (tower.onPath ? 56 : 47),
      );
      context.restore();
    }
    if (tower.kind === "gunner" && tower.level >= 4) {
      context.save();
      context.font = "700 9px ui-monospace, monospace";
      context.textAlign = "center";
      context.fillStyle = definition.accent;
      context.fillText(
        tower.rampTimer > 0 ? `ULTRABURST +${Math.round(tower.attackRamp * 100)}% // ${tower.rampTimer.toFixed(1)}s` : "ULTRABURST IDLE",
        tower.position.x,
        tower.position.y + (tower.onPath ? 56 : 47),
      );
      context.restore();
    }

    if (tower.onPath) {
      this.drawBar(tower.position.x - 26, tower.position.y + 32, 52, 5, tower.hp / tower.maxHp, definition.accent);
      this.drawAggro(tower);
    }
  }

  private drawAggro(tower: Tower): void {
    const context = this.context;
    const width = tower.maxAggro * 9 - 3;
    const y = tower.position.y - 42;
    context.save();
    context.textAlign = "center";
    context.font = "600 11px ui-monospace, monospace";
    context.fillStyle = tower.engaged.size >= tower.maxAggro ? "#ff776d" : "rgba(231,235,227,.62)";
    context.fillText(`AGGRO ${tower.engaged.size}/${tower.maxAggro}`, tower.position.x, y - 6);
    for (let index = 0; index < tower.maxAggro; index += 1) {
      context.fillStyle = index < tower.engaged.size ? "#ff6c62" : "rgba(255,255,255,.11)";
      context.fillRect(tower.position.x - width / 2 + index * 9, y, 6, 3);
    }
    context.restore();
  }

  private drawEnemy(enemy: Enemy): void {
    const context = this.context;
    const position = this.enemyPosition(enemy);
    const definition = getEnemyDefinition(enemy.kind);
    const { sprite, radius } = definition;
    context.save();
    context.translate(position.x, position.y);
    context.scale(enemy.spawnScale, enemy.spawnScale);

    if (enemy.burnTimer > 0) {
      context.beginPath();
      context.arc(0, 0, radius + 7 + Math.sin(this.elapsed * 9 + enemy.id) * 2, 0, TAU);
      context.strokeStyle = "rgba(255,124,62,.78)";
      context.lineWidth = 2;
      context.shadowBlur = 10;
      context.shadowColor = TOWER_DEFINITIONS.infernus.accent;
      context.stroke();
      context.shadowBlur = 0;
    }

    if (enemy.targetTowerId !== null && enemy.attackTimer <= enemy.telegraphDuration) {
      const progress = clamp(enemy.attackTimer / enemy.telegraphDuration, 0, 1);
      const ringRadius = radius + 5 + progress * 42;
      context.beginPath();
      context.arc(0, 0, ringRadius, 0, TAU);
      context.strokeStyle = `rgba(255, 74, 67, ${0.55 + (1 - progress) * 0.4})`;
      context.lineWidth = 2.4 + (1 - progress) * 2;
      context.shadowBlur = 13;
      context.shadowColor = "#ff3d37";
      context.stroke();
      context.shadowBlur = 0;
      context.beginPath();
      context.arc(0, 0, radius + 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - progress));
      context.strokeStyle = "rgba(255, 99, 89, .9)";
      context.lineWidth = 2;
      context.stroke();
    }

    context.beginPath();
    context.arc(0, 0, radius + (definition.boss ? 7 : 4), 0, TAU);
    context.strokeStyle = `${sprite.accent}${definition.boss ? "dd" : "99"}`;
    context.lineWidth = definition.boss ? 2.5 : 1.25;
    if (definition.hidden) {
      context.setLineDash([3, 4]);
      context.lineDashOffset = -this.elapsed * 14;
    }
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = enemy.hitFlash > 0 ? "#ffffff" : enemy.stunTimer > 0 ? "#9ae6ed" : sprite.fill;
    context.strokeStyle = enemy.targetTowerId !== null ? "#ff6a62" : sprite.stroke;
    context.lineWidth = 2;
    context.beginPath();
    if (sprite.shape === "circle") {
      context.arc(0, 0, radius, 0, TAU);
    } else if (sprite.shape === "square") {
      context.rect(-radius, -radius, radius * 2, radius * 2);
    } else if (sprite.shape === "diamond") {
      context.moveTo(0, -radius);
      context.lineTo(radius, 0);
      context.lineTo(0, radius);
      context.lineTo(-radius, 0);
      context.closePath();
    } else {
      const sides = sprite.shape === "polygon" ? Math.round(clamp(sprite.sides ?? 6, 3, 12)) : 6;
      for (let side = 0; side < sides; side += 1) {
        const angle = -Math.PI / 2 + (side / sides) * TAU;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (side === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
    }
    context.fill();
    context.stroke();
    context.fillStyle = enemy.hitFlash > 0 ? "#202425" : sprite.accent;
    context.font = `700 ${Math.max(8, radius * 0.72)}px ui-monospace, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(sprite.glyph, 0, 1);
    context.restore();
    context.save();
    context.fillStyle = sprite.accent;
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText(definition.name.toUpperCase(), position.x, position.y - radius - 12);
    context.restore();
    this.drawBar(position.x - radius, position.y - radius - 9, radius * 2, definition.boss ? 5 : 4, enemy.hp / enemy.maxHp, sprite.accent);
  }

  private drawBossHealthbars(): void {
    const bosses = this.enemies
      .filter((enemy) => enemy.hp > 0 && (
        enemy.kind === "necromancerBoss"
        || enemy.kind === "bigDummy"
        || (enemy.kind.startsWith("custom-enemy:") && getEnemyDefinition(enemy.kind).boss)
      ))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
    const context = this.context;
    bosses.slice(0, 3).forEach((enemy, index) => {
      const definition = getEnemyDefinition(enemy.kind);
      const width = 560;
      const height = 17;
      const x = (WORLD_WIDTH - width) / 2;
      const y = 58 + index * 48;
      context.save();
      context.fillStyle = "rgba(5,7,8,.9)";
      context.strokeStyle = `${definition.sprite.accent}aa`;
      context.lineWidth = 2;
      context.fillRect(x - 10, y - 27, width + 20, 39);
      context.strokeRect(x - 10, y - 27, width + 20, 39);
      context.font = "800 14px ui-monospace, monospace";
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.fillStyle = definition.sprite.accent;
      context.fillText(`${definition.name.toUpperCase()} // BOSS`, x, y - 7);
      context.textAlign = "right";
      context.fillStyle = "#f2f4ef";
      context.fillText(`${Math.ceil(enemy.hp).toLocaleString()} / ${enemy.maxHp.toLocaleString()} HP`, x + width, y - 7);
      this.drawBar(x, y, width, height, enemy.hp / enemy.maxHp, definition.sprite.accent);
      context.restore();
    });
  }

  private drawProjectile(projectile: Projectile): void {
    const context = this.context;
    const accent = TOWER_DEFINITIONS[projectile.kind].accent;
    context.save();
    context.translate(projectile.position.x, projectile.position.y);
    context.shadowBlur = 12;
    context.shadowColor = accent;
    context.fillStyle = accent;
    context.beginPath();
    context.arc(0, 0, projectile.splash > 0 ? 4 : 3, 0, TAU);
    context.fill();
    context.restore();
  }

  private drawTimedBomb(bomb: TimedBomb): void {
    const context = this.context;
    const pulse = 1 + Math.sin(this.elapsed * 12) * 0.1;
    context.save();
    context.translate(bomb.position.x, bomb.position.y);
    context.scale(pulse, pulse);
    context.beginPath();
    context.arc(0, 0, 15, 0, TAU);
    context.fillStyle = "#17120b";
    context.fill();
    context.strokeStyle = bomb.color;
    context.lineWidth = 3;
    context.shadowBlur = 14;
    context.shadowColor = bomb.color;
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = "#fff0bd";
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(bomb.proximity ? "P" : Math.ceil(bomb.timer).toString(), 0, 1);
    context.beginPath();
    context.arc(0, 0, bomb.radius, -Math.PI / 2, bomb.proximity ? -Math.PI / 2 + TAU : -Math.PI / 2 + TAU * (bomb.timer / 5));
    context.strokeStyle = `${bomb.color}66`;
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }

  private drawPlacement(): void {
    const relocatingTower = this.towers.find((tower) => tower.id === this.relocatingTowerId) ?? null;
    const kind = this.selectedKind ?? relocatingTower?.kind;
    if (!this.placement || !kind) return;
    const context = this.context;
    const definition = TOWER_DEFINITIONS[kind];
    const { position, onPath, valid } = this.placement;
    const color = valid ? definition.accent : "#ff5f57";
    context.save();
    context.globalAlpha = 0.72;
    context.fillStyle = `${color}18`;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    context.beginPath();
    if (onPath) context.rect(position.x - 25, position.y - 25, 50, 50);
    else context.arc(position.x, position.y, 25, 0, TAU);
    context.fill();
    context.stroke();
    context.beginPath();
    const previewStats = relocatingTower ? this.towerStats(relocatingTower) : definition.levels[0];
    context.arc(position.x, position.y, (previewStats?.range ?? 8) * RANGE_SCALE, 0, TAU);
    context.strokeStyle = `${color}55`;
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.font = "600 12px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillStyle = color;
    const label = valid
      ? `${relocatingTower ? "MOVE // " : ""}${onPath ? definition.onPath.title : definition.offPath.title}`
      : "INVALID SITE";
    context.fillText(label.toUpperCase(), position.x, position.y - 37);
    context.restore();
  }

  private drawParticles(): void {
    const context = this.context;
    for (const particle of this.particles) {
      if ((particle.delay ?? 0) > 0) continue;
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      const progress = 1 - alpha;
      const displayColor = particle.endColor
        ? mixHexColors(particle.color, particle.endColor, progress)
        : particle.color;
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = displayColor;
      context.fillStyle = displayColor;
      if (particle.type === "spark") {
        context.fillRect(particle.position.x - particle.size / 2, particle.position.y - particle.size / 2, particle.size, particle.size);
      } else if (particle.type === "ring") {
        const finalRadius = particle.radius ?? 82;
        context.beginPath();
        context.arc(
          particle.position.x,
          particle.position.y,
          particle.size + progress * Math.max(0, finalRadius - particle.size),
          0,
          TAU,
        );
        context.lineWidth = Math.max(1, 4 * alpha);
        context.stroke();
      } else if (particle.type === "slash") {
        const angle = particle.angle ?? 0;
        const spread = particle.spread ?? 0.58;
        const radius = (particle.radius ?? 72) * (0.9 + progress * 0.1);
        const start = angle - spread;
        const sweep = clamp(progress * 3.8, 0.08, 1);
        const end = start + spread * 2 * sweep;

        context.globalAlpha = alpha * 0.13;
        context.beginPath();
        context.moveTo(particle.position.x, particle.position.y);
        context.arc(particle.position.x, particle.position.y, radius, start, end);
        context.closePath();
        context.fill();

        context.globalAlpha = alpha;
        context.lineCap = "round";
        context.shadowBlur = 15 * alpha;
        context.shadowColor = displayColor;
        context.beginPath();
        context.arc(particle.position.x, particle.position.y, radius, start, end);
        context.lineWidth = Math.max(1.5, particle.size * alpha);
        context.stroke();

        context.globalAlpha = alpha * 0.5;
        context.beginPath();
        context.arc(particle.position.x, particle.position.y, radius * 0.72, start + 0.09, end - 0.09);
        context.lineWidth = Math.max(1, particle.size * 0.35 * alpha);
        context.stroke();
      } else if (particle.type === "spray") {
        context.translate(particle.position.x, particle.position.y);
        context.rotate(particle.rotation ?? 0);
        const scale = 0.7 + progress * 0.75;
        context.shadowBlur = 10 * alpha;
        context.shadowColor = displayColor;
        context.fillRect(-particle.size * scale / 2, -particle.size * scale / 2, particle.size * scale, particle.size * scale);
      } else if (particle.type === "smoke") {
        context.globalAlpha = alpha * 0.38;
        context.beginPath();
        context.arc(particle.position.x, particle.position.y, particle.size * (0.55 + progress * 0.9), 0, TAU);
        context.fill();
      } else if (particle.type === "flash") {
        context.translate(particle.position.x, particle.position.y);
        context.rotate(particle.angle ?? 0);
        context.globalCompositeOperation = "lighter";
        context.shadowBlur = 18 * alpha;
        context.shadowColor = displayColor;
        context.beginPath();
        const points = 12;
        for (let point = 0; point < points; point += 1) {
          const angle = (point / points) * TAU;
          const radius = point % 2 === 0 ? particle.size * (0.7 + alpha * 0.5) : particle.size * 0.25;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        context.fill();
      } else if (particle.type === "beam") {
        const angle = particle.angle ?? 0;
        const endX = particle.position.x + Math.cos(angle) * (particle.length ?? 0);
        const endY = particle.position.y + Math.sin(angle) * (particle.length ?? 0);
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";
        context.shadowBlur = 12;
        context.shadowColor = displayColor;
        context.beginPath();
        context.moveTo(particle.position.x, particle.position.y);
        context.lineTo(endX, endY);
        context.lineWidth = Math.max(1, particle.size * alpha);
        context.stroke();
        context.globalAlpha = alpha * 0.7;
        context.strokeStyle = "#ffffff";
        context.lineWidth = Math.max(0.75, particle.size * 0.3 * alpha);
        context.stroke();
      } else if (particle.type === "lightning") {
        const points = particle.points ?? [];
        const first = points[0];
        if (first) {
          context.globalCompositeOperation = "lighter";
          context.lineJoin = "round";
          context.lineCap = "round";
          context.shadowBlur = 7;
          context.shadowColor = displayColor;
          context.beginPath();
          context.moveTo(first.x, first.y);
          points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
          context.lineWidth = Math.max(1, particle.size * alpha);
          context.stroke();
          context.globalAlpha = alpha * 0.8;
          context.strokeStyle = "#ffffff";
          context.lineWidth = Math.max(0.75, particle.size * 0.32 * alpha);
          context.stroke();
        }
      } else if (particle.type === "text") {
        context.font = "700 13px ui-monospace, monospace";
        context.textAlign = "center";
        context.fillText(particle.text ?? "", particle.position.x, particle.position.y);
      }
      context.restore();
    }
  }

  private drawBar(x: number, y: number, width: number, height: number, value: number, color: string): void {
    const context = this.context;
    context.fillStyle = "rgba(0,0,0,.72)";
    context.fillRect(x - 1, y - 1, width + 2, height + 2);
    context.fillStyle = "rgba(255,255,255,.1)";
    context.fillRect(x, y, width, height);
    context.fillStyle = color;
    context.fillRect(x, y, width * clamp(value, 0, 1), height);
  }

  private drawVignette(): void {
    const context = this.context;
    const gradient = context.createRadialGradient(
      this.canvas.width / (this.canvas.width / WORLD_WIDTH) / 2,
      this.canvas.height / (this.canvas.height / WORLD_HEIGHT) / 2,
      160,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      690,
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,.56)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }
}
