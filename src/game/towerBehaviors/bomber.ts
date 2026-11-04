import { clamp } from "../math.ts";
import type { TowerAttackBehaviorContext, TowerBehavior } from "./types.ts";

const plantPathBomb = (context: TowerAttackBehaviorContext): void => {
  const maxBombs = context.tower.level >= 5 ? 6 : context.tower.level >= 3 ? 4 : 3;
  const projection = context.pathProjection(context.tower.pathIndex, context.tower.position);
  if (context.pathBombCount() >= maxBombs || projection.offset > context.range) return;
  const spacing = (context.pathBombCount() - (maxBombs - 1) / 2) * 32;
  const site = context.samplePath(
    context.tower.pathIndex,
    clamp(projection.distance + spacing, 45, projection.totalLength - 45),
  ).point;
  if (!context.canPlacePathBomb(site, 25)) return;
  context.spawnPathBomb(site, context.tower.level >= 1 ? 60 : 46);
  context.spawnText(site, "PATH BOMB");
};

export const BOMBER_BEHAVIOR: TowerBehavior = {
  counterName: "DEAD MAN'S SWITCH",
  attackSound: { pitch: 205, sound: "bomb" },

  presentEvent: (context) => {
    if (context.event.kind === "attack" && context.event.visual === "projectile" && context.event.from && context.position) {
      const speed = Math.max(40, Math.min(2_000, context.event.speed ?? 330));
      const count = Math.max(1, Math.min(16, context.event.count ?? 1));
      for (let shot = 0; shot < count; shot += 1) context.enqueueVisualProjectile({
          start: context.event.from,
          endpoint: context.position,
          targetId: context.event.targetId ?? null,
          speed,
          color: context.color,
          splash: true,
          scale: 1,
        });
      context.spawnMuzzleFlash(context.event.from, context.position, context.color, 18);
      context.playShoot(205, "bomb");
      return true;
    }
    if (context.event.kind === "explosion" && context.position && context.event.label === "bomber") {
      context.spawnExplosion(context.position, context.color, context.event.value ?? 70);
      context.playBreach("bomber");
      return true;
    }
    return false;
  },

  projectileDamage: (projectile, enemy) => {
    if (projectile.towerLevel < 1 || enemy.burnTimer <= 0) return projectile.damage;
    return projectile.damage * (projectile.towerLevel >= 5 && enemy.burnDamage >= 7 ? 3 : 2);
  },

  timedBombDamage: (towerLevel, enemy, baseDamage) => {
    if (towerLevel < 1 || enemy.burnTimer <= 0) return baseDamage;
    return baseDamage * (towerLevel >= 5 && enemy.burnDamage >= 7 ? 3 : 2);
  },

  beforeAttack: (context) => {
    if (context.candidates.length > 0 || context.tower.meleeTimer > 0) return false;
    plantPathBomb(context);
    context.tower.meleeTimer = 1.4;
    return true;
  },

  attack: (context, target) => {
    context.tower.shotCounter += 1;
    const critical = context.tower.level >= 3 && context.tower.shotCounter % 4 === 0;
    context.spawnProjectile(target, context.damage * (critical ? 3 : 1), 330, context.tower.level >= 1 ? 60 : 46);
    context.emitProjectileVisual(target, 330);
    if (critical) context.spawnText(context.tower.position, "DYNAMITE x3");
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.playAttackSound();
  },

  counter: (context) => {
    context.victims.forEach((enemy) => {
      const impact = context.enemyPosition(enemy);
      context.damageEnemiesInRadius(impact, 72, Math.max(20, context.damage * 5));
      context.emitExplosionCounterVisual(enemy, 72);
    });
  },

  ability: (context) => {
    const target = context.selectTarget(context.abilityCandidates);
    if (!target) {
      context.spawnAbilityText(context.tower.position, "NO TARGET", "#a7abad");
      context.failAbility();
      return;
    }
    context.spawnTimedBomb(target, 500 * context.tower.damageBuff, 105, 5);
    context.tower.abilityCooldown = 60;
    if (context.tower.abilityCooldowns) context.tower.abilityCooldowns.f = 60;
    context.spawnAbilityTracer(target);
    context.spawnAbilityText(context.enemyPosition(target), "TIME BOMB // 5");
    context.logDanger("Bomber planted a Time Bomb // detonation in 5 seconds.");
    context.playAbilityTone();
  },
};
