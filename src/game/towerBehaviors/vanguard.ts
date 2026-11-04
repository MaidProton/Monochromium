import type { Enemy } from "../types.ts";
import type { TowerAttackBehaviorContext, TowerBehavior, TowerCounterBehaviorContext } from "./types.ts";

const smashRadius = (level: number): number => level >= 5 ? 112 : level >= 3 ? 96 : 82;
const smashMultiplier = (level: number): number => level >= 4 ? 3 : 2;
const smashCooldown = (level: number): number => level >= 3 ? 3 : 4;

const performSmash = (
  context: TowerAttackBehaviorContext | TowerCounterBehaviorContext,
  target: Enemy,
): void => {
  const radius = smashRadius(context.tower.level);
  const multiplier = smashMultiplier(context.tower.level);
  const impact = context.enemyPosition(target);
  context.damageEnemiesInRadius(impact, radius, context.damage * multiplier);
  context.emitSmashVisual(target, radius, multiplier);
  context.tower.fireTimer = Math.max(context.tower.fireTimer, context.fireRateCooldown(context.fireRate));
  context.tower.abilityCooldown = smashCooldown(context.tower.level);
  if (context.tower.abilityCooldowns) context.tower.abilityCooldowns.f = context.tower.abilityCooldown;
};

export const VANGUARD_BEHAVIOR: TowerBehavior = {
  counterName: "CHARGED SMASH",
  counterScope: "range",
  attackSound: { pitch: 180, sound: "blade" },
  abilityTargetInRange: (tower, enemies, canTarget, range, enemyPosition) => enemies.some(
    (enemy) => enemy.hp > 0 && canTarget(enemy) && Math.hypot(tower.position.x - enemyPosition(enemy).x, tower.position.y - enemyPosition(enemy).y) <= range,
  ),
  drawSupplemental: ({ tower, accent, showSupplementalStats, addOverlay, drawOverlayBar }) => {
    if (!showSupplementalStats || tower.level < 1) return;
    const smashDuration = tower.level >= 3 ? 3 : 4;
    const smashProgress = tower.abilityCooldown <= 0 ? 1 : 1 - tower.abilityCooldown / smashDuration;
    addOverlay({
      key: "vanguard-smash",
      side: "below",
      priority: 780,
      height: 20,
      render: ({ context: overlayContext, x, centerY }) => {
        overlayContext.save();
        overlayContext.font = "700 9px ui-monospace, monospace";
        overlayContext.textAlign = "center";
        overlayContext.textBaseline = "middle";
        overlayContext.fillStyle = accent;
        overlayContext.fillText(smashProgress >= 1 ? "SMASH READY" : `SMASH ${Math.max(0, tower.abilityCooldown).toFixed(1)}s`, x, centerY - 6);
        overlayContext.restore();
        drawOverlayBar(x - 26, centerY + 4, 52, 4, smashProgress, accent);
      },
    });
  },

  presentEvent: (context) => {
    if (context.event.kind === "strike" && context.position) {
      context.spawnVanguardMaceStrike(context.event.from ?? context.position, context.position, context.color);
      return true;
    }
    if (context.event.kind === "smash" && context.position) {
      context.spawnVanguardSmash(context.position, context.color, context.event.value ?? 82);
      context.playAbility("vanguard");
      return true;
    }
    return false;
  },

  ability: (context) => {
    context.spawnAbilityText(context.tower.position, "AUTO // CHARGED SMASH");
    return false;
  },

  beforeAttack: (context) => {
    if (context.tower.level < 1 || context.tower.abilityCooldown > 0 || context.candidates.length === 0) return false;
    const target = context.selectTarget(context.candidates);
    if (!target) return false;
    performSmash(context, target);
    return true;
  },

  attack: (context, target) => {
    context.damageEnemy(target, context.damage);
    context.emitMaceVisual(target);
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.playAttackSound();
  },

  counter: (context) => {
    if (context.tower.level < 1 || context.tower.abilityCooldown > 0) return;
    const target = context.selectTarget(context.victims);
    if (target) performSmash(context, target);
  },
};
