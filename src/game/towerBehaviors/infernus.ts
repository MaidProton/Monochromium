import type { Enemy } from "../types.ts";
import { getBackdraftEffect, towerHasPerk } from "../towerPerks.ts";
import type { TowerAttackBehaviorContext, TowerBehavior, TowerCounterBehaviorContext } from "./types.ts";

const halfAngle = (level: number): number => level >= 3 ? 0.58 : level >= 1 ? 0.48 : 0.38;
const flameValue = (level: number): number => level >= 4 ? 11 : 8;

const applyInfernusBurn = (context: TowerAttackBehaviorContext | TowerCounterBehaviorContext, enemy: Enemy, strength = 1): void => {
  const level = context.tower.level;
  const backdraft = towerHasPerk(context.tower, "backdraft");
  const backdraftEffect = getBackdraftEffect();
  const normalSlowFactor = level >= 5 ? 0.75 : level >= 2 ? 0.85 : 1;
  const hasteFactor = backdraft ? (backdraftEffect.hasteByLevel[Math.min(5, level)] ?? 1) : 1;
  context.applyBurn(
    enemy,
    level >= 5 ? 10 : level >= 2 ? 6 : 3,
    level >= 5 ? 10 : level >= 4 ? 4 : level >= 3 ? 3 : 1,
    backdraft ? 1 : normalSlowFactor,
    (level >= 4 ? 0.5 : 1) / (backdraft ? backdraftEffect.burnTickRateMultiplier : 1),
    strength,
    hasteFactor,
  );
};

export const INFERNUS_BEHAVIOR: TowerBehavior = {
  counterName: "FLASHOVER",
  flameStream: true,

  presentEvent: (context) => {
    if (context.event.kind !== "flame" || !context.event.from || !context.position) return false;
    if (!context.tower) return false;
    context.startInfernusFlameStream(context.tower, context.position);
    return true;
  },

  filterTargets: (_tower, candidates) => {
    const unburned = candidates.filter((enemy) => enemy.burnTimer <= 0);
    return unburned.length > 0 ? unburned : candidates;
  },

  attack: (context, target) => {
    const impact = context.enemyPosition(target);
    const flameInterval = Math.max(0.08, Math.min(1, context.fireRateCooldown(context.fireRate)));
    const victims = context.enemiesInCone(impact, context.coneCandidates, context.range, halfAngle(context.tower.level));
    victims.forEach((enemy) => {
      if (context.damage > 0) context.damageEnemy(enemy, context.damage);
      applyInfernusBurn(context, enemy);
    });
    context.emitFlameVisual(target, context.range, flameValue(context.tower.level), flameInterval);
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
  },

  counter: (context) => {
    context.victims.forEach((enemy) => {
      context.damageEnemy(enemy, Math.max(2, context.damage * 3));
      applyInfernusBurn(context, enemy, 1.5);
    });
    context.emitFlameCounterVisual(context.range);
  },
};
