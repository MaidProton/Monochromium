import { getColdChamberEffect, towerHasPerk } from "../towerPerks.ts";
import type { Tower } from "../types.ts";
import type { TowerBehavior, TowerAttackBehaviorContext } from "./types.ts";

const burstCount = (level: number): number => level >= 5 ? 6 : level >= 4 ? 4 : 3;
const burstSpacing = (level: number): number => level >= 5 ? 0.1 : 0.2;
const gunnerStackCap = (level: number): number => level >= 5 ? 150 : 75;
const GUNNER_STACK_BUFF = 0.02;

const addGunnerStacks = (tower: Tower, count: number): void => {
  const duration = tower.level >= 5 ? 22 : 18;
  const available = Math.max(0, gunnerStackCap(tower.level) - tower.rampStackTimers.length);
  if (available <= 0) return;
  tower.rampStackTimers.push(...Array(Math.min(count, available)).fill(duration));
  // Cap the self-applied stacks only; fireRateBuff remains available for
  // external modifiers that may raise the final fire-rate bonus further.
  tower.fireRateBuff = tower.rampStackTimers.length * GUNNER_STACK_BUFF;
};

const fireGunnerShot = (context: TowerAttackBehaviorContext, target: Parameters<NonNullable<TowerBehavior["attack"]>>[1]): void => {
  context.tower.shotCounter += 1;
  const coldChamber = towerHasPerk(context.tower, "cold-chamber");
  const coldEffect = coldChamber ? getColdChamberEffect() : undefined;
  const charged = Boolean(coldEffect && context.tower.shotCounter % coldEffect.chargedShotEvery === 0);
  const targets = charged ? context.enemiesInLine(target, context.range, 16) : [target];
  targets.forEach((enemy) => {
    context.damageEnemy(enemy, context.damage);
    if (charged) context.applyStun(enemy, coldEffect!.chargedShotStunDuration);
    context.emitHitscanVisual(enemy, charged ? 4.5 : 2.1);
  });
  if (charged) context.spawnText(context.tower.position, "COLD CHAMBER");
  context.playAttackSound();
  if (context.tower.level >= 4 && !coldChamber) addGunnerStacks(context.tower, 1);
};

export const GUNNER_BEHAVIOR: TowerBehavior = {
  counterName: "REDLINE RETURN",
  attackSound: { pitch: 455, sound: "burst" },

  onUpgrade: ({ tower }) => {
    if (tower.level >= 4) return;
    tower.attackRamp = 0;
    tower.rampTimer = 0;
    tower.rampStackTimers = [];
    tower.fireRateBuff = 0;
  },

  update: ({ tower, delta }) => {
    if (towerHasPerk(tower, "cold-chamber")) {
      tower.rampStackTimers = [];
      tower.fireRateBuff = 0;
    } else if (tower.level >= 4) {
      tower.rampStackTimers = tower.rampStackTimers
        .map((timer) => timer - delta)
        .filter((timer) => timer > 0);
      tower.fireRateBuff = Math.min(gunnerStackCap(tower.level), tower.rampStackTimers.length) * GUNNER_STACK_BUFF;
    } else {
      tower.rampStackTimers = [];
      tower.fireRateBuff = 0;
    }
    tower.rampTimer = 0;
  },

  beforeAttack: (context) => {
    const { tower } = context;
    if (tower.burstShotsRemaining <= 0) return false;
    tower.burstTimer -= context.delta;
    if (tower.burstTimer > 0) return true;
    const burstTarget = context.selectTarget(context.candidates);
    if (!burstTarget) {
      // Keep the burst alive and look again shortly if its previous target died.
      tower.burstTimer = 0.05;
      return true;
    }
    tower.burstTargetId = burstTarget.id;
    fireGunnerShot(context, burstTarget);
    tower.burstShotsRemaining -= 1;
    if (tower.burstShotsRemaining > 0) {
      tower.burstTimer = tower.burstSpacing;
    } else {
      tower.burstTargetId = null;
      tower.burstSpacing = 0;
    }
    return true;
  },

  attack: (context, target) => {
    const burst = burstCount(context.tower.level);
    const spacing = context.burstSpacingCooldown(burstSpacing(context.tower.level));
    fireGunnerShot(context, target);
    context.tower.burstShotsRemaining = burst - 1;
    context.tower.burstSpacing = spacing;
    context.tower.burstTimer = spacing;
    context.tower.burstTargetId = target.id;
    context.tower.fireTimer = spacing * (burst - 1) + context.fireRateCooldown(context.fireRate);
    context.spawnMuzzleFlash(target, 22);
  },

  counter: (context) => {
    const burst = burstCount(context.tower.level);
    context.victims.forEach((enemy) => {
      context.damageEnemy(enemy, context.damage * burst);
      context.emitBurstCounterVisual(enemy, burst);
    });
    if (context.tower.level >= 4 && !towerHasPerk(context.tower, "cold-chamber")) addGunnerStacks(context.tower, 25);
    context.spawnText(context.tower.level >= 4 ? "REDLINE +50%" : `RETURN BURST x${burst}`);
  },
};
