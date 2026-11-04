import type { Enemy } from "../types.ts";
import { distance } from "../math.ts";
import type { TowerAttackBehaviorContext, TowerBehavior, TowerCounterBehaviorContext } from "./types.ts";

type PrismContext = TowerAttackBehaviorContext | TowerCounterBehaviorContext;

const maxTargets = (level: number): number => level >= 5 ? 5 : level >= 4 ? 4 : level >= 2 ? 3 : 2;
const retention = (level: number): number => level >= 3 ? 0.8 : 0.72;
const bounceRange = (level: number): number => level >= 5 ? 135 : level >= 3 ? 120 : 105;

const firePrismChain = (context: PrismContext, target: Enemy, baseDamage: number): void => {
  const visited = new Set<number>();
  let current: Enemy | undefined = target;
  let origin = context.tower.position;
  let hits = 0;
  while (current && hits < maxTargets(context.tower.level)) {
    const impact = context.enemyPosition(current);
    const width = Math.max(2.2, 4.2 - hits * 0.45);
    context.damageEnemy(current, baseDamage * retention(context.tower.level) ** hits);
    context.emitPrismChainVisual(origin, current, hits, width);
    visited.add(current.id);
    hits += 1;
    origin = impact;
    current = context.chainCandidates
      .filter(
        (enemy) =>
          enemy.hp > 0 &&
          !visited.has(enemy.id) &&
          distance(origin, context.enemyPosition(enemy)) <= bounceRange(context.tower.level),
      )
      .sort((left, right) => {
        const gap = distance(origin, context.enemyPosition(left)) - distance(origin, context.enemyPosition(right));
        return gap || right.pathDistance - left.pathDistance || left.id - right.id;
      })[0];
  }
};

export const PRISM_BEHAVIOR: TowerBehavior = {
  counterName: "TOTAL REFLECTION",
  attackSound: { pitch: 580, sound: "lightning" },
  inspectorStats: (tower) => [
    { key: "chain-targets", label: "CHAIN TARGETS", value: `${maxTargets(tower.level)}`, group: "advanced" },
    { key: "chain-retention", label: "CHAIN RETENTION", value: `${Math.round(retention(tower.level) * 100)}% PER BOUNCE`, group: "advanced" },
    { key: "chain-range", label: "BOUNCE RANGE", value: `${bounceRange(tower.level)}`, group: "advanced" },
  ],

  presentEvent: (context) => {
    if (context.event.kind !== "attack" || !context.event.from || !(context.target ? context.enemyPosition(context.target) : context.position)) return false;
    const target = context.target ? context.enemyPosition(context.target) : context.position!;
    context.spawnBeam(context.event.from, target, context.color, Math.max(1, Math.min(8, context.event.value ?? 3.2)));
    context.spawnFlash(target, context.color, 16);
    context.playShoot(580, "lightning");
    return true;
  },

  attack: (context, target) => {
    firePrismChain(context, target, context.damage);
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.playAttackSound();
  },

  counter: (context) => {
    const target = context.selectTarget(context.victims);
    if (target) firePrismChain(context, target, context.damage * 2);
    context.spawnText("TOTAL REFLECTION");
  },
};
