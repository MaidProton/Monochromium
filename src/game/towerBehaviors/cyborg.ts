import type { Tower } from "../types.ts";
import type { TowerBehavior } from "./types.ts";

const cyborgBaseAttackInterval = (tower: Tower, configuredInterval: number): number => {
  if (tower.level < 3) return configuredInterval;
  const baseInterval = tower.level >= 4 ? 0.3 : 0.15;
  const rampStrength = tower.level >= 4 ? 0.2 : 0.05;
  return Math.max(0.01, baseInterval - tower.attackRamp * rampStrength);
};

export const CYBORG_BEHAVIOR: TowerBehavior = {
  counterName: "MAGNUM DUMP",
  getBaseAttackInterval: cyborgBaseAttackInterval,

  update: ({ tower }) => {
    if (tower.idleTimer > 2) tower.attackRamp = 0;
  },

  onUpgrade: ({ tower, stats }) => {
    tower.ammo = stats.ammo ?? -1;
  },

  sellRefundRate: (tower) => tower.level >= 5 ? 0.8 : 0.5,

  drawSupplemental: ({ tower, accent, showSupplementalStats, towerAmmoCapacity, addOverlay }) => {
    if (!showSupplementalStats) return;
    addOverlay({
      key: "cyborg-ammo",
      side: "below",
      priority: 780,
      height: 12,
      render: ({ context: overlayContext, x, centerY }) => {
        overlayContext.save();
        overlayContext.font = "700 9px ui-monospace, monospace";
        overlayContext.textAlign = "center";
        overlayContext.textBaseline = "middle";
        overlayContext.fillStyle = accent;
        overlayContext.fillText(
          towerAmmoCapacity === undefined ? `REACTOR ${tower.shotCounter % (tower.level >= 5 ? 20 : 30)}` : `AMMO ${tower.ammo}/${towerAmmoCapacity}`,
          x,
          centerY,
        );
        overlayContext.restore();
      },
    });
  },

  onProjectileLaunch: ({ projectile, playSound }) => {
    if (projectile.soundPlayed) return;
    projectile.soundPlayed = true;
    playSound(160, "rocket");
  },

  presentEvent: (context) => {
    if (context.event.kind === "counter" && context.position) {
      context.spawnRing(context.position, "#f3f5f2", 0.42, 6, 75);
      context.playCounter();
      return true;
    }
    if (context.event.kind !== "attack" || !context.event.from || !(context.target ? context.enemyPosition(context.target) : context.position) || context.event.visual === "projectile") return false;
    const target = context.target ? context.enemyPosition(context.target) : context.position!;
    const radius = context.event.value && context.event.value > 0 ? Math.max(1, Math.min(300, context.event.value)) : 0;
    const rounds = radius === 0 ? Math.max(1, Math.min(8, Math.round(context.event.speed ?? context.event.count ?? 1))) : 1;
    for (let round = 0; round < rounds; round += 1) context.spawnCyborgBeam(context.event.from, target, round % 2 === 0 ? context.color : "#ffffff", radius > 0 ? 7 : 3.6);
    context.spawnMuzzleFlash(context.event.from, target, context.color, radius > 0 || rounds > 1 ? 26 : 18);
    if (radius > 0) {
      context.spawnExplosion(target, context.color, radius);
      context.spawnText(context.event.from, "HOWITZER", context.color);
      context.playBreach("cyborg");
    }
    context.playShoot(radius > 0 ? 190 : 520, radius > 0 ? "howitzer" : "machine");
    return true;
  },

  beforeAttack: (context) => {
    if (context.ammoCapacity !== undefined && context.reloadDuration !== undefined) {
      if (context.tower.ammo > 0 && context.tower.ammo < context.ammoCapacity && context.tower.idleTimer >= 5) {
        context.reload("IDLE RELOAD", true, true);
        context.tower.idleTimer = 0;
      }
      if (context.tower.ammo <= 0) {
        if (context.tower.fireTimer > 0) return true;
        context.reload("RELOAD READY", true, false);
      }
    }
    if (context.tower.level < 5) return false;
    context.tower.rocketTimer -= context.delta;
    if (context.tower.rocketTimer > 0 || context.candidates.length === 0) return false;
    context.spawnCyborgRocketVolley();
    context.tower.rocketTimer = 8;
    context.tower.idleTimer = 0;
    return false;
  },

  attack: (context, target) => {
    context.tower.shotCounter += 1;
    const magazineFinal = context.tower.level === 3 && context.tower.ammo === 1;
    const howitzerInterval = context.tower.level >= 5 ? 20 : 30;
    const reactorHowitzer = context.tower.level >= 4 && context.tower.shotCounter % howitzerInterval === 0;
    const isHowitzer = magazineFinal || reactorHowitzer;
    const shotDamage = context.damage * (isHowitzer ? 10 : 1);
    const impact = context.enemyPosition(target);
    context.damageEnemy(target, shotDamage);
    context.emitCyborgAttackVisual(target, isHowitzer);
    if (isHowitzer) context.damageEnemiesInRadiusExcluding(impact, 46, shotDamage, target.id, "explosive");
    if (isHowitzer) context.spawnText(context.tower.position, "HOWITZER");
    context.tower.idleTimer = 0;
    if (context.tower.level >= 3) context.tower.attackRamp = Math.min(1, context.tower.attackRamp + 0.08);
    const rampedRate = cyborgBaseAttackInterval(context.tower, context.fireRate);
    context.tower.fireTimer = context.fireRateCooldown(rampedRate);
    if (context.tower.ammo >= 0) {
      context.tower.ammo -= 1;
      if (context.tower.ammo <= 0) {
        context.tower.ammo = 0;
        context.tower.attackRamp = 0;
        context.triggerCyborgReload();
      }
    }
    context.playCyborgShotSound(isHowitzer);
  },

  counter: (context) => {
    context.victims.forEach((enemy) => context.damageEnemy(enemy, context.damage * context.counterRounds));
    context.emitCyborgCounterVisual(context.victims, context.counterRounds);
    context.tower.shotCounter = Math.max(context.tower.shotCounter, context.tower.level >= 5 ? 19 : 29);
  },
};
