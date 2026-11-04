import { distance } from "../math.ts";
import { getHighNoonEffect, towerHasPerk } from "../towerPerks.ts";
import type { Enemy } from "../types.ts";
import type { TowerAttackBehaviorContext, TowerBehavior } from "./types.ts";

const BANDIT_MELEE_RANGE = 92;
const BANDIT_MELEE_SPREAD = Math.PI / 2;

export const BANDIT_BEHAVIOR: TowerBehavior = {
  counterName: "QUICKDRAW",
  pauseAbilityCooldownWhileActive: true,
  attackSound: { pitch: 360, sound: "pistol" },
  activeGlow: (tower) => towerHasPerk(tower, "high-noon") && tower.abilityTimer > 0,

  drawSupplemental: ({ tower, accent, showSupplementalStats, addOverlay, drawOverlayBar }) => {
    if (!showSupplementalStats || !towerHasPerk(tower, "high-noon") || tower.level < 2) return;
    const effect = getHighNoonEffect(tower.level);
    const prep = tower.perkPrepTimer ?? 0;
    const progress = prep > 0
      ? 1 - prep / effect.prepDuration
      : tower.abilityTimer > 0
        ? tower.abilityTimer / effect.duration
        : tower.abilityCooldown <= 0 ? 1 : 1 - tower.abilityCooldown / effect.cooldown;
    addOverlay({
      key: "high-noon",
      side: "below",
      priority: 805,
      height: 20,
      render: ({ context, x, centerY }) => {
        context.save();
        context.font = "700 9px ui-monospace, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = accent;
        context.fillText(prep > 0 ? `PREP ${prep.toFixed(1)}s` : tower.abilityTimer > 0 ? `OVERDRIVE ${tower.abilityTimer.toFixed(1)}s` : tower.abilityCooldown > 0 ? `COOLDOWN ${tower.abilityCooldown.toFixed(1)}s` : "HIGH NOON READY", x, centerY - 6);
        context.restore();
        drawOverlayBar(x - 26, centerY + 4, 52, 4, Math.max(0, Math.min(1, progress)), accent);
      },
    });
  },

  drawRange: ({ tower, context, accent }) => {
    if (tower.level < 2 || towerHasPerk(tower, "high-noon")) return;
    context.save();
    context.beginPath();
    context.arc(tower.position.x, tower.position.y, 92, 0, Math.PI * 2);
    context.setLineDash([3, 6]);
    context.strokeStyle = `${accent}88`;
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.restore();
  },

  presentEvent: (context) => {
    if (context.event.kind !== "slash" || !context.event.from || !context.position) return false;
    context.spawnSlash(context.event.from, context.position, context.color, context.event.value ?? 90, Math.PI * 80 / 180, 0, undefined, 0.4, 1);
    context.playShoot(220, "bandit-blade");
    return true;
  },

  beforeAttack: (context) => {
    const { tower } = context;
    if (towerHasPerk(tower, "high-noon") && tower.level >= 2) {
      if ((tower.perkPrepTimer ?? 0) > 0) return true;
      if (context.candidates.length > 0 && tower.abilityTimer <= 0 && tower.abilityCooldown <= 0) {
        const effect = getHighNoonEffect(tower.level);
        tower.perkPrepTimer = effect.prepDuration;
        context.spawnText(tower.position, "HIGH NOON PREP");
        context.emitSimulationEvent({
          kind: "ability",
          entityId: tower.id,
          position: { ...tower.position },
          label: "high-noon-prep",
          duration: effect.prepDuration,
        });
        return true;
      }
    }

    if (tower.burstShotsRemaining > 0) {
      tower.burstTimer -= context.delta;
      if (tower.burstTimer > 0) return true;
      const burstTarget = context.selectTarget(context.candidates);
      if (!burstTarget) {
        // Keep the burst alive and look again shortly if its previous target died.
        tower.burstTimer = 0.05;
        return true;
      }
      tower.burstTargetId = burstTarget.id;
      firePistolShot(context, burstTarget);
      tower.burstShotsRemaining -= 1;
      if (tower.burstShotsRemaining > 0) {
        tower.burstTimer = tower.burstSpacing;
      } else {
        tower.burstTargetId = null;
        tower.burstSpacing = 0;
      }
      return true;
    }

    if (!towerHasPerk(tower, "high-noon") && tower.level >= 2 && tower.meleeTimer <= 0) {
      const innerTargets = context.candidates.filter(
        (enemy) => distance(tower.position, context.enemyPosition(enemy)) <= BANDIT_MELEE_RANGE,
      );
      const slashTarget = context.selectTarget(innerTargets);
      if (slashTarget) {
        context.enemiesInCone(
          context.enemyPosition(slashTarget),
          innerTargets,
          BANDIT_MELEE_RANGE,
          BANDIT_MELEE_SPREAD,
        ).forEach((enemy) => context.damageEnemy(enemy, context.damage * 2, "melee"));
        context.emitSlashVisual(slashTarget, BANDIT_MELEE_RANGE, Math.PI * 80 / 180, context.nextSlashDirection(), 0.4, "bandit-blade");
        tower.meleeTimer = 3.5;
      }
    }
    return false;
  },

  update: ({ tower, delta, stanceWasActive, refreshDamageBuff, spawnText, emitSimulationEvent }) => {
    if (!towerHasPerk(tower, "high-noon") || tower.level < 2) return;
    if ((tower.perkPrepTimer ?? 0) > 0) {
      tower.perkPrepTimer = Math.max(0, (tower.perkPrepTimer ?? 0) - delta);
      if (tower.perkPrepTimer <= 0) {
        const effect = getHighNoonEffect(tower.level);
        tower.abilityTimer = effect.duration;
        tower.overdriveTimer = effect.duration;
        tower.overdriveMultiplier = 1 + effect.damageBonus;
        tower.fireRateBuff = effect.fireRateBonus;
        refreshDamageBuff();
        spawnText("HIGH NOON ACTIVE");
        emitSimulationEvent({
          kind: "ability",
          entityId: tower.id,
          position: { ...tower.position },
          label: "high-noon-active",
          duration: effect.duration,
          value: effect.damageBonus,
        });
      }
    } else if (stanceWasActive && tower.abilityTimer <= 0) {
      tower.fireRateBuff = 0;
      tower.overdriveMultiplier = 1;
      tower.overdriveTimer = 0;
      refreshDamageBuff();
    }
  },

  attack: (context, target) => {
    const shots = context.tower.level >= 3 ? 2 : 1;
    firePistolShot(context, target);
    context.tower.burstShotsRemaining = shots - 1;
    context.tower.burstSpacing = context.burstSpacingCooldown(0.3);
    context.tower.burstTimer = shots > 1 ? context.tower.burstSpacing : 0;
    context.tower.burstTargetId = shots > 1 ? target.id : null;
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
  },

  counter: (context) => {
    const shots = context.tower.level >= 3 ? 2 : 1;
    context.victims.forEach((enemy) => {
      const impact = context.enemyPosition(enemy);
      context.damageEnemy(enemy, context.damage * shots);
      context.emitHitscanVisual(enemy, 4);
      context.spawnImpactDust(impact);
    });
    context.spawnText(`QUICKDRAW x${Math.max(1, context.victims.length * shots)}`);
    context.tower.meleeTimer = 0;
  },
};

const firePistolShot = (context: TowerAttackBehaviorContext, target: Enemy): void => {
  context.damageEnemy(target, context.damage);
  context.emitHitscanVisual(target, 2.2);
  context.playAttackSound();
};
