import { TOWER_DEFINITIONS } from "../config.ts";
import type { TowerBehavior } from "./types.ts";

const bladeStanceCooldown = TOWER_DEFINITIONS.samurai.abilities?.f?.cooldown ?? 30;
const bladeStanceDuration = TOWER_DEFINITIONS.samurai.abilities?.f?.duration ?? 15;

export const SAMURAI_BEHAVIOR: TowerBehavior = {
  counterName: "IAI PARRY",
  pauseAbilityCooldownWhileActive: true,
  attackSound: { pitch: 240, sound: "samurai-blade" },
  activeGlow: (tower) => tower.abilityTimer > 0,

  drawSupplemental: ({ tower, accent, showSupplementalStats, addOverlay, drawOverlayBar }) => {
    if (!showSupplementalStats) return;
    const bladeCooldownProgress = tower.abilityTimer > 0
      ? Math.max(0, Math.min(1, tower.abilityTimer / bladeStanceDuration))
      : 1 - Math.max(0, Math.min(1, tower.abilityCooldown / bladeStanceCooldown));
    addOverlay({
      key: "samurai-focus",
      side: "below",
      priority: 800,
      height: 6,
      render: ({ x, centerY }) => drawOverlayBar(x - 26, centerY, 52, 4, bladeCooldownProgress, accent),
    });
  },

  presentEvent: (context) => {
    if (context.event.kind === "slash" && context.event.from && context.position) {
      const direction = context.event.label === "samurai" ? 1 : 1;
      context.spawnSlash(context.event.from, context.position, context.color, context.event.value ?? 90, Math.PI * 80 / 180, 0, undefined, 0.4, direction);
      return true;
    }
    if (context.event.kind === "counter" && context.position) {
      context.spawnBeam({ x: context.position.x - 55, y: context.position.y }, { x: context.position.x + 55, y: context.position.y }, "#ffffff", 6);
      context.playCounter();
      return true;
    }
    return false;
  },

  onCreate: ({ tower, abilityCooldownFor }) => {
    tower.abilityCooldown = abilityCooldownFor("f");
    if (tower.abilityCooldowns) tower.abilityCooldowns.f = tower.abilityCooldown;
  },

  filterTargets: (tower, candidates) =>
    tower.abilityTimer > 0 || tower.senselessStance ? candidates : [],

  update: ({ tower, delta, stanceWasActive, refreshDamageBuff }) => {
    if (stanceWasActive && tower.abilityTimer <= 0) {
      tower.focus = 0;
      tower.fireRateBuff = 0;
      tower.samuraiFocusDecayTimer = 0;
    }
    if (tower.level >= 4 && tower.senselessStance) {
      tower.samuraiFocusDecayTimer = (tower.samuraiFocusDecayTimer ?? 0) + delta;
      const decayTickDuration = 0.125;
      const decayTicks = Math.floor(tower.samuraiFocusDecayTimer / decayTickDuration);
      if (decayTicks > 0) {
        tower.focus = Math.max(0, tower.focus - decayTicks * 0.01);
        tower.samuraiFocusDecayTimer -= decayTicks * decayTickDuration;
      }
    } else if (tower.level >= 1 && tower.abilityTimer <= 0 && tower.abilityCooldown <= 0) {
      tower.samuraiFocusDecayTimer = 0;
      tower.focus = Math.min(tower.level >= 3 ? 1 : 0.6, tower.focus + delta * 0.02);
    } else {
      tower.samuraiFocusDecayTimer = 0;
    }
    tower.fireRateBuff = tower.focus;
    refreshDamageBuff();
  },

  damageMultiplier: (tower) => tower.abilityTimer > 0
    ? tower.level >= 5 ? 2 : tower.level >= 4 ? 1.5 : 1
    : 1,

  attack: (context, target) => {
    const impact = context.enemyPosition(target);
    const areaTargets = context.enemiesInCone(impact, context.candidates, context.range, Math.PI / 2);
    const baseDamage = context.tower.level >= 5 ? 32 : context.baseDamage;
    const splitDamage = context.tower.level >= 5 ? 200 / Math.max(1, areaTargets.length) : 0;
    areaTargets.forEach((enemy) => {
      const hpPercent = context.tower.level >= 4 ? 0.1 : context.tower.level >= 2 ? 0.02 : 0;
      const scalingCap = context.tower.level >= 5 ? 6 : 3;
      const soulDamage = splitDamage * (context.tower.abilityTimer > 0 ? 0.33 : 1);
      const rawDamage = baseDamage + soulDamage;
      const hpBonus = Math.min(enemy.hp * hpPercent, rawDamage * (scalingCap - 1));
      context.damageEnemy(enemy, (rawDamage + hpBonus) * context.tower.damageBuff);
    });
    context.emitSlashVisual(target, context.range, Math.PI * 80 / 180, context.nextSlashDirection(), 0.4);
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.playAttackSound();
  },

  counter: (context) => {
    context.victims.forEach((enemy) => {
      context.damageEnemy(enemy, context.damage * (context.tower.level >= 4 ? 3 : 2));
    });
    const aim = context.victims[0]
      ? context.enemyPosition(context.victims[0])
      : { x: context.tower.position.x + 90, y: context.tower.position.y };
    context.emitSamuraiCounterVisual(aim, context.range);
  },

  ability: (context) => {
    if (context.slot === "g") {
      if (context.tower.abilityTimer > 0) {
        context.spawnAbilityText(context.tower.position, "BLADE STANCE ACTIVE");
        context.failAbility();
        return false;
      }
      context.tower.senselessStance = !context.tower.senselessStance;
      context.tower.samuraiFocusDecayTimer = 0;
      if (context.tower.senselessStance) {
        context.tower.fireRateBuff = context.tower.focus;
        context.spawnAbilityText(context.tower.position, "SENSELESS STANCE");
        context.log("Samurai entered Senseless Stance // normal attacks enabled, Mental Focus disabled.");
      } else {
        context.spawnAbilityText(context.tower.position, "SENSELESS ENDED", "#6a3035");
        context.log("Samurai left Senseless Stance // Mental Focus can charge again.");
      }
      context.playAbilitySound();
      return;
    }

    if (context.tower.senselessStance) {
      context.spawnAbilityText(context.tower.position, "SENSELESS STANCE ACTIVE");
      context.failAbility();
      return false;
    }
    if (context.tower.abilityTimer > 0) {
      context.tower.abilityTimer = 0;
      context.tower.focus = 0;
      context.tower.fireRateBuff = 0;
      context.tower.abilityCooldown = context.abilityCooldown;
      if (context.tower.abilityCooldowns) context.tower.abilityCooldowns.f = context.abilityCooldown;
      context.refreshDamageBuff();
      context.spawnAbilityText(context.tower.position, "STANCE ENDED", "#6a3035");
      context.log("Samurai sheathed the blade early // the full charge is still consumed.");
      return;
    }

    context.tower.senselessStance = false;
    context.tower.abilityTimer = bladeStanceDuration;
    context.tower.fireRateBuff = context.tower.focus;
    context.tower.abilityCooldown = 0;
    if (context.tower.abilityCooldowns) context.tower.abilityCooldowns.f = 0;
    context.tower.counterFlash = 0.8;
    context.refreshDamageBuff();
    if (context.tower.level >= 3 && context.tower.focus >= 0.6) {
      context.abilityCandidates.forEach((enemy) => {
        context.damageEnemy(enemy, context.baseDamage * 10 * context.tower.damageBuff);
        context.emitSlashVisual(enemy, context.radius, Math.PI * 80 / 180, context.nextSlashDirection(), 0.4);
      });
      context.spawnAbilityRing(context.radius);
      context.spawnAbilityText(context.tower.position, "BLADESTORM");
    } else {
      context.spawnAbilityText(context.tower.position, "BLADE STANCE");
    }
    context.log(`Samurai drew the blade // ${bladeStanceDuration} seconds of active combat.`);
    context.playAbilitySound();
  },
};
