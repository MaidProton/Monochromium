import {
  ENEMY_ABILITY_TICK_HZ,
  EnemyAbilityEngine,
  createEnemyAbilityRuntime,
  signalEnemyAbility,
  type EnemyAbilityEngineSource,
  type EnemyAbilityEngineTarget,
  type EnemyAbilityScheduleSnapshot,
  type EnemyAbilityTraceEvent,
  type EnemyAbilityWorldAdapter,
} from "../../game/enemyAbilities.ts";
import type { CustomEnemyDraftV4 } from "../../game/customEnemies.ts";
import type { EnemyAbilityRuntimeState } from "../../game/types.ts";

export interface EnemyLabTower {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stunTimer: number;
  blocking: boolean;
}

export interface EnemyLabState {
  tick: number;
  hp: number;
  maxHp: number;
  age: number;
  pathDistance: number;
  blocked: boolean;
  stunned: boolean;
  invulnerable: boolean;
  phased: boolean;
  movementLocked: boolean;
  speedMultiplier: number;
  damageMultiplier: number;
  summons: number;
  towers: EnemyLabTower[];
}

export type EnemyLabCommand =
  | { readonly tick: number; readonly type: "hp" | "age" | "blocked" | "stunned"; readonly value: number | boolean }
  | { readonly tick: number; readonly type: "base-attack" }
  | { readonly tick: number; readonly type: "tower-add"; readonly tower: EnemyLabTower }
  | { readonly tick: number; readonly type: "tower-move"; readonly id: number; readonly x: number; readonly y: number }
  | { readonly tick: number; readonly type: "tower-hp" | "tower-blocking"; readonly id: number; readonly value: number | boolean }
  | { readonly tick: number; readonly type: "tower-remove"; readonly id: number };
type UntimedEnemyLabCommand = EnemyLabCommand extends infer Command ? Command extends { readonly tick: number } ? Omit<Command, "tick"> : never : never;

interface EnemyLabCheckpoint {
  readonly tick: number;
  readonly state: EnemyLabState;
  readonly runtime: EnemyAbilityRuntimeState;
  readonly schedules: readonly EnemyAbilityScheduleSnapshot[];
  readonly traceLength: number;
  readonly nextTowerId: number;
  readonly deathNotified: boolean;
}

const clone = <T>(value: T): T => structuredClone(value);
const MAX_LAB_TICKS = 300 * ENEMY_ABILITY_TICK_HZ;

export const explainEnemyAbilityTrace = (trace: EnemyAbilityTraceEvent): string => {
  if (trace.code === "triggered") return "Trigger crossed and the ability activated.";
  if (trace.code === "suppressed") return "Trigger crossed, but a condition, target, cooldown, limit, or exclusive group prevented activation.";
  if (trace.code === "target-locked") return `Target locked${trace.targetIds.length ? `: ${trace.targetIds.join(", ")}` : "."}`;
  if (trace.code === "telegraph") return "Attack telegraph started.";
  if (trace.code === "impact") return "Attack impacted.";
  if (trace.code === "action-ineffective") return "Action had no valid source or target.";
  if (trace.code === "complete") return "Ability completed.";
  return trace.message;
};

/** Isolated deterministic 30 Hz scenario runner shared by the modal and pure tests. */
export class EnemyAbilityLab {
  readonly commands: EnemyLabCommand[] = [];
  readonly traces: EnemyAbilityTraceEvent[] = [];
  private readonly engine = new EnemyAbilityEngine();
  private runtime: EnemyAbilityRuntimeState;
  private checkpoints: EnemyLabCheckpoint[] = [];
  private nextTowerId = 10;
  private maximumTick = 0;
  private deathNotified = false;
  state: EnemyLabState;

  constructor(readonly draft: CustomEnemyDraftV4) {
    this.state = this.initialState();
    this.runtime = createEnemyAbilityRuntime(draft.abilities, this.source());
    this.checkpoints = [this.checkpoint()];
  }

  private initialState(): EnemyLabState {
    return { tick: 0, hp: this.draft.hp, maxHp: this.draft.hp, age: 0, pathDistance: 0, blocked: false, stunned: false, invulnerable: false, phased: false, movementLocked: false, speedMultiplier: 1, damageMultiplier: 1, summons: 0, towers: [] };
  }

  private selectedTower(): EnemyLabTower | null {
    return this.state.towers.filter((tower) => tower.hp > 0 && tower.blocking).sort((left, right) => left.id - right.id)[0] ?? null;
  }

  private target(tower: EnemyLabTower): EnemyAbilityEngineTarget {
    return { id: tower.id, position: { x: tower.x, y: tower.y }, hp: tower.hp, maxHp: tower.maxHp, stunned: tower.stunTimer > 0, pathDistance: tower.x };
  }

  private source(): EnemyAbilityEngineSource {
    const selected = this.selectedTower();
    return { id: 1, kind: this.draft.id, hp: this.state.hp, maxHp: this.state.maxHp, age: this.state.age, pathDistance: this.state.pathDistance, blocked: this.state.blocked || selected !== null, position: { x: this.state.pathDistance, y: 120 }, direction: { x: 1, y: 0 }, selectedTarget: selected ? this.target(selected) : null };
  }

  private adapter(): EnemyAbilityWorldAdapter {
    return {
      readSource: () => this.state.hp > 0 || !this.deathNotified ? this.source() : null,
      enumerateTargets: () => this.state.towers.filter((tower) => tower.hp > 0).map((tower) => this.target(tower)),
      isKnownEnemyKind: () => true,
      damageTarget: (id, amount) => { const tower = this.state.towers.find((candidate) => candidate.id === id && candidate.hp > 0); if (!tower) return false; tower.hp = Math.max(0, tower.hp - Math.max(0, amount)); return true; },
      stunTarget: (id, duration) => { const tower = this.state.towers.find((candidate) => candidate.id === id && candidate.hp > 0); if (!tower) return false; tower.stunTimer = Math.max(tower.stunTimer, duration); return true; },
      summon: () => { this.state.summons += 1; },
      healSource: (amount) => { if (this.state.hp <= 0) return 0; const healing = Math.min(this.state.maxHp - this.state.hp, Math.max(0, amount)); this.state.hp += healing; return healing; },
      blinkSource: (distance) => { this.state.pathDistance += distance; },
      hasteNearby: (_radius, _duration, _multiplier) => 1,
      projectSourceState: (projection) => { this.state.movementLocked = projection.movementLocked; this.state.invulnerable = projection.invulnerable; this.state.phased = projection.phased; this.state.speedMultiplier = projection.speedMultiplier; this.state.damageMultiplier = projection.damageMultiplier; },
      onLifecycle: (trace) => { this.traces.push(trace); if (this.traces.length > 4_000) this.traces.splice(0, this.traces.length - 4_000); },
    };
  }

  private checkpoint(): EnemyLabCheckpoint {
    return { tick: this.state.tick, state: clone(this.state), runtime: clone(this.runtime), schedules: clone(this.engine.snapshotSchedules(1)), traceLength: this.traces.length, nextTowerId: this.nextTowerId, deathNotified: this.deathNotified };
  }

  private truncateFuture(): void {
    if (this.state.tick >= this.maximumTick) return;
    for (let index = this.commands.length - 1; index >= 0; index -= 1) if ((this.commands[index]?.tick ?? 0) > this.state.tick) this.commands.splice(index, 1);
    this.checkpoints = this.checkpoints.filter((checkpoint) => checkpoint.tick <= this.state.tick);
    this.traces.splice(this.traces.findIndex((trace) => trace.tick > this.state.tick) < 0 ? this.traces.length : this.traces.findIndex((trace) => trace.tick > this.state.tick));
    this.maximumTick = this.state.tick;
  }

  private mutate(command: EnemyLabCommand): void {
    if (command.type === "hp") this.state.hp = Math.max(0, Math.min(this.state.maxHp, Number(command.value)));
    else if (command.type === "age") this.state.age = Math.max(0, Number(command.value));
    else if (command.type === "blocked") { const previous = this.state.blocked; this.state.blocked = Boolean(command.value); if (!previous && this.state.blocked) signalEnemyAbility(this.runtime, "blocked"); }
    else if (command.type === "stunned") { const previous = this.state.stunned; this.state.stunned = Boolean(command.value); if (!previous && this.state.stunned) signalEnemyAbility(this.runtime, "stunned"); }
    else if (command.type === "base-attack") signalEnemyAbility(this.runtime, "attack");
    else if (command.type === "tower-add") this.state.towers.push(clone(command.tower));
    else if (command.type === "tower-move") { const tower = this.state.towers.find((candidate) => candidate.id === command.id); if (tower) { tower.x = command.x; tower.y = command.y; } }
    else if (command.type === "tower-hp") { const tower = this.state.towers.find((candidate) => candidate.id === command.id); if (tower) tower.hp = Math.max(0, Math.min(tower.maxHp, Number(command.value))); }
    else if (command.type === "tower-blocking") { const tower = this.state.towers.find((candidate) => candidate.id === command.id); if (tower) { const wasBlocked = this.selectedTower() !== null; tower.blocking = Boolean(command.value); if (!wasBlocked && this.selectedTower()) signalEnemyAbility(this.runtime, "blocked"); } }
    else if (command.type === "tower-remove") this.state.towers = this.state.towers.filter((tower) => tower.id !== command.id);
  }

  command(command: UntimedEnemyLabCommand): void {
    this.truncateFuture();
    const timed = { ...command, tick: this.state.tick } as EnemyLabCommand;
    this.commands.push(timed);
    this.mutate(timed);
  }

  addTower(x: number, y: number): number {
    const id = this.nextTowerId++;
    this.command({ type: "tower-add", tower: { id, x, y, hp: 100, maxHp: 100, stunTimer: 0, blocking: false } });
    return id;
  }

  step(): boolean {
    if (this.state.tick >= MAX_LAB_TICKS || this.state.hp <= 0 && this.deathNotified && this.engine.snapshotSchedules(1).length === 0) return false;
    this.state.tick += 1;
    this.engine.advanceDetached(this.state.tick);
    this.state.age += 1 / ENEMY_ABILITY_TICK_HZ;
    this.state.towers.forEach((tower) => { tower.stunTimer = Math.max(0, tower.stunTimer - 1 / ENEMY_ABILITY_TICK_HZ); });
    if (this.state.hp > 0) this.engine.step(this.state.tick, 1 / ENEMY_ABILITY_TICK_HZ, this.draft.abilities, this.runtime, this.adapter());
    if (!this.state.stunned && !this.state.movementLocked && !this.state.blocked) this.state.pathDistance += this.draft.speed * this.state.speedMultiplier / ENEMY_ABILITY_TICK_HZ;
    if (this.state.hp <= 0 && !this.deathNotified) { const adapter = this.adapter(); this.engine.notifyDeath(this.state.tick, this.draft.abilities, this.runtime, adapter); this.deathNotified = true; }
    this.maximumTick = Math.max(this.maximumTick, this.state.tick);
    if (this.state.tick % 30 === 0) this.checkpoints.push(this.checkpoint());
    if (this.checkpoints.length > 301) this.checkpoints.shift();
    return true;
  }

  scrub(targetTick: number): void {
    const bounded = Math.max(0, Math.min(this.maximumTick, Math.round(targetTick)));
    const checkpoint = [...this.checkpoints].reverse().find((candidate) => candidate.tick <= bounded) ?? this.checkpoints[0]!;
    this.state = clone(checkpoint.state);
    this.runtime = clone(checkpoint.runtime);
    this.nextTowerId = checkpoint.nextTowerId;
    this.deathNotified = checkpoint.deathNotified;
    this.traces.splice(checkpoint.traceLength);
    this.engine.reset();
    this.engine.restoreSchedules(1, checkpoint.schedules, this.draft.abilities, this.adapter());
    while (this.state.tick < bounded) {
      this.commands.filter((command) => command.tick === this.state.tick).forEach((command) => this.mutate(command));
      if (!this.step()) break;
    }
  }

  reset(): void {
    this.engine.reset(); this.commands.length = 0; this.traces.length = 0; this.state = this.initialState(); this.runtime = createEnemyAbilityRuntime(this.draft.abilities, this.source()); this.checkpoints = [this.checkpoint()]; this.maximumTick = 0; this.nextTowerId = 10; this.deathNotified = false;
  }

  get maxTick(): number { return this.maximumTick; }
  get runtimeState(): EnemyAbilityRuntimeState { return clone(this.runtime); }
}
