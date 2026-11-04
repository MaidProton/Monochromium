import { TOWER_DEFINITIONS } from "../config.ts";
import { getMutinyEffect, mutinyIsUnlocked } from "../towerPerks.ts";
import type { TowerBehavior } from "./types.ts";

const MUTINY_STACK_LIMIT = 256;

const mercenaryBaseDps = (level: number): number => {
  const stats = TOWER_DEFINITIONS.mercenary.levels[level] ?? TOWER_DEFINITIONS.mercenary.levels[0]!;
  return stats.damage / Math.max(0.01, stats.fireRate);
};

export const MERCENARY_BEHAVIOR: TowerBehavior = {
  counterName: "RALLY FIRE",
  attackSound: { pitch: 430, sound: "rifle" },
  hitscanVisual: "tracer",

  drawSupplemental: ({ tower, accent, showSupplementalStats, addOverlay, drawOverlayBar }) => {
    if (!showSupplementalStats || !mutinyIsUnlocked(tower)) return;
    const effect = getMutinyEffect(tower.level, mercenaryBaseDps(tower.level));
    const killProgress = Math.max(0, Math.min(1, (tower.mutinyKillProgress ?? 0) / effect.killTarget));
    const damageProgress = Math.max(0, Math.min(1, (tower.mutinyDamageProgress ?? 0) / effect.damageThreshold));
    addOverlay({
      key: "mutiny-triggers",
      side: "below",
      priority: 805,
      height: 13,
      render: ({ x, centerY }) => {
        drawOverlayBar(x - 26, centerY - 3, 52, 2, killProgress, accent);
        drawOverlayBar(x - 26, centerY + 3, 52, 2, damageProgress, "#ff5c64");
      },
    });
  },

  presentEvent: (context) => {
    if (context.event.kind === "ability" && context.event.label === "mutiny-trigger" && context.position) {
      context.spawnRing(context.position, context.color, 0.8, 8, context.event.value ?? 300);
      context.spawnText(context.position, "MUTINY", context.color);
      context.playAbility("mercenary");
      return true;
    }
    if (context.event.kind !== "attack" || !context.event.from || !(context.target ? context.enemyPosition(context.target) : context.position)) return false;
    const target = context.target ? context.enemyPosition(context.target) : context.position!;
    context.spawnBulletTracer(context.event.from, target, context.color, 2.6);
    context.playShoot(430, "rifle");
    return true;
  },

  update: ({ tower, delta, nearbyTowers, applyDamageBuff }) => {
    if (!mutinyIsUnlocked(tower)) {
      tower.mutinyKillProgress = 0;
      tower.mutinyDamageProgress = 0;
      tower.mutinyStackTimers = [];
      return;
    }
    tower.mutinyStackTimers = (tower.mutinyStackTimers ?? [])
      .map((timer) => timer - delta)
      .filter((timer) => timer > 0);
    const activeDuration = Math.max(0, ...(tower.mutinyStackTimers ?? []));
    if (activeDuration <= 0) return;
    const effect = getMutinyEffect(tower.level, mercenaryBaseDps(tower.level));
    nearbyTowers.forEach((candidate) => applyDamageBuff(candidate, 1 + effect.damageBonus, activeDuration));
  },

  attack: (context, target) => {
    context.damageEnemy(target, context.damage);
    context.emitHitscanVisual(target, 2.6);
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.playAttackSound();
  },

  onDamageDealt: ({ tower, damage, killed, baseDps, triggerDamageBuff }) => {
    if (!mutinyIsUnlocked(tower)) return;
    const effect = getMutinyEffect(tower.level, baseDps);
    tower.mutinyDamageProgress = (tower.mutinyDamageProgress ?? 0) + damage;
    if (killed) tower.mutinyKillProgress = (tower.mutinyKillProgress ?? 0) + 1;
    if ((tower.mutinyKillProgress ?? 0) < effect.killTarget && (tower.mutinyDamageProgress ?? 0) < effect.damageThreshold) return;

    tower.mutinyKillProgress = 0;
    tower.mutinyDamageProgress = 0;
    const stacks = tower.mutinyStackTimers ?? (tower.mutinyStackTimers = []);
    if (stacks.length < MUTINY_STACK_LIMIT) stacks.push(effect.duration);
    triggerDamageBuff(1 + effect.damageBonus, effect.duration);
  },

  counter: (context) => {
    context.victims.forEach((enemy) => {
      context.damageEnemy(enemy, context.damage * 2);
      context.emitRallyFireVisual(enemy);
    });
    context.spawnText("RALLY FIRE");
  },

  ability: (context) => {
    if (mutinyIsUnlocked(context.tower)) {
      context.failAbility();
      return false;
    }
    const levelSix = context.tower.level >= 6;
    const duration = levelSix ? 10 : 8;
    const buff = levelSix ? 1.35 : 1.25;
    context.nearbyTowers.forEach((tower) => {
      context.applyDamageBuff(tower, buff, duration);
      context.spawnBuffRing(tower);
    });
    context.tower.abilityCooldown = levelSix ? 30 : 40;
    if (context.tower.abilityCooldowns) context.tower.abilityCooldowns.f = context.tower.abilityCooldown;
    context.spawnAbilityRing(context.radius);
    context.spawnText(`ONSLAUGHT +${Math.round((buff - 1) * 100)}%`);
    context.log(`Mercenary activated Onslaught // nearby towers gain ${Math.round((buff - 1) * 100)}% damage.`);
    context.playAbilitySound();
  },
};
