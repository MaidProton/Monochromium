import type { TowerBehavior } from "./types.ts";

const WARRIOR_ARRIVAL_LEVEL = 4;
const WARRIOR_ARRIVAL_SLASH_HALF_ANGLE = Math.PI / 4 + 0.05;

export const WARRIOR_BEHAVIOR: TowerBehavior = {
  counterName: "RIPOSTE",
  counterScope: "range",
  attackSound: { pitch: 210, sound: "blade" },

  presentEvent: (context) => {
    if (context.event.kind !== "counter" || !context.position) return false;
    context.spawnShieldFlash(context.position, context.color, context.event.value ?? 90);
    context.playCounter();
    return true;
  },

  onUpgrade: ({ tower }) => {
    if (tower.level === 2) tower.regenTimer = 7;
  },

  update: ({ tower, delta, healTower }) => {
    if (tower.level < 2) return;
    tower.regenTimer -= delta;
    if (tower.regenTimer > 0) return;
    if (tower.hp < tower.maxHp) healTower(Math.min(tower.maxHp - tower.hp, tower.maxHp * 0.07), `+${Math.ceil(Math.min(tower.maxHp - tower.hp, tower.maxHp * 0.07))} HP`);
    tower.regenTimer = 7;
  },

  attack: (context, target) => {
    context.damageEnemy(target, context.damage);
    context.emitStrikeVisual(target);
    if (context.tower.level >= WARRIOR_ARRIVAL_LEVEL) {
      context.scheduleDelayedStrike(target, context.damage, 0.18);
    }
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.playAttackSound();
  },

  counter: (context) => {
    const multiplier = context.tower.level >= WARRIOR_ARRIVAL_LEVEL ? 4 : 2;
    context.victims.forEach((enemy) => context.damageEnemy(enemy, context.damage * multiplier));
    const aim = context.victims[0]
      ? context.enemyPosition(context.victims[0])
      : { x: context.tower.position.x + 1, y: context.tower.position.y };
    context.emitCrossSlashVisual(aim, context.range);
    context.spawnShieldFlash(context.range);
  },

  onArrival: (context) => {
    if (context.tower.level < WARRIOR_ARRIVAL_LEVEL) return;
    context.candidates.forEach((enemy) => context.damageEnemy(enemy, context.damage));
    for (let arc = 0; arc < 4; arc += 1) {
      const angle = (arc / 4) * Math.PI * 2;
      context.emitSlashVisual(
        {
          x: context.tower.position.x + Math.cos(angle) * context.range,
          y: context.tower.position.y + Math.sin(angle) * context.range,
        },
        context.range,
        WARRIOR_ARRIVAL_SLASH_HALF_ANGLE,
      );
    }
    context.spawnRing(0.55, 7, context.range);
    context.spawnText("ARRIVAL SLASH");
    context.playAttackSound();
  },
};
