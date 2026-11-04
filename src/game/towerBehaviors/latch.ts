import type { TowerBehavior } from "./types.ts";

const tetherInterval = (level: number): number => level >= 4 ? 4 : 5;
const tetherDuration = (level: number): number => level >= 4 ? 0.6 : level >= 2 ? 0.45 : 0.3;
const counterStunDuration = (level: number): number => level >= 4 ? 1 : 0.75;

export const LATCH_BEHAVIOR: TowerBehavior = {
  counterName: "TRIPWIRE",
  attackSound: { pitch: 500, sound: "pistol" },

  attack: (context, target) => {
    const { tower } = context;
    tower.shotCounter += 1;
    context.damageEnemy(target, context.damage);
    context.emitHitscanVisual(target, 2);
    if (tower.shotCounter % tetherInterval(tower.level) === 0 && target.hp > 0) {
      context.applyStun(target, tetherDuration(tower.level));
      const impact = context.enemyPosition(target);
      context.spawnRing(impact, 0.28, 4, 24);
      context.spawnText(impact, "TETHERED");
    }
    tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.playAttackSound();
  },

  counter: (context) => {
    const stun = counterStunDuration(context.tower.level);
    context.victims.forEach((enemy) => {
      context.damageEnemy(enemy, context.damage * 2);
      context.applyStun(enemy, stun);
      context.emitHitscanVisual(enemy, 4);
    });
    context.spawnText("TRIPWIRE");
  },
};
