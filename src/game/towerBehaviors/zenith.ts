import type { TowerAttackBehaviorContext, TowerBehavior, TowerCounterBehaviorContext } from "./types.ts";

const hpPercent = [0.015, 0.022, 0.029, 0.036, 0.043, 0.05] as const;
const hpCap = [120, 180, 270, 390, 600, 700] as const;

const fireLance = (
  context: TowerAttackBehaviorContext | TowerCounterBehaviorContext,
  target: Parameters<NonNullable<TowerBehavior["attack"]>>[1],
  multiplier = 1,
  widthBonus = 0,
): void => {
  const beamWidth = 16 + context.tower.level * 3 + widthBonus;
  const beamVisualWidth = 8.2 + context.tower.level * 0.8;
  const beamLife = 0.2 + context.tower.level * 0.015;
  const victims = context.enemiesInLine(target, context.range, beamWidth);
  victims.forEach((enemy) => {
    const bossDamage = Math.min(enemy.maxHp * (hpPercent[context.tower.level] ?? 0.05), hpCap[context.tower.level] ?? 700);
    context.damageEnemy(enemy, (context.baseDamage + bossDamage) * multiplier * context.tower.damageBuff);
    context.emitZenithLanceHit(enemy);
  });
  context.emitZenithLance(target, context.range, beamVisualWidth, beamLife);
};

export const ZENITH_BEHAVIOR: TowerBehavior = {
  counterName: "EVENT HORIZON",
  mirrorCharge: true,
  persistentEvent: (event) => event.kind === "charge",

  drawWorld: ({ tower, context, accent, elapsed, isMirror, mirrorZenithCharge, findEnemy, enemyPosition, towerRange }) => {
    const remaining = isMirror ? (mirrorZenithCharge?.remaining ?? 0) : (tower.zenithChargeTimer ?? 0);
    if (remaining <= 0) return;
    const targetId = isMirror ? mirrorZenithCharge?.targetId : tower.zenithChargeTargetId;
    const target = targetId == null ? undefined : findEnemy(targetId);
    const angle = target
      ? Math.atan2(enemyPosition(target).y - tower.position.y, enemyPosition(target).x - tower.position.x)
      : (isMirror ? mirrorZenithCharge?.angle : tower.zenithChargeAngle);
    if (angle === undefined) return;
    const progress = Math.max(0, Math.min(1, 1 - remaining / (2 + 3 * Math.max(0, Math.min(5, tower.level)) / 5)));
    const endpoint = { x: tower.position.x + Math.cos(angle) * towerRange, y: tower.position.y + Math.sin(angle) * towerRange };
    const radius = 12 + (1 - progress) * 68;
    const secondaryRadius = 9 + ((1 - ((progress + 0.34) % 1)) * 50);
    const muzzle = { x: tower.position.x + Math.cos(angle) * 24, y: tower.position.y + Math.sin(angle) * 24 };
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.26 + progress * 0.74;
    context.strokeStyle = accent;
    context.lineWidth = 1.5;
    context.setLineDash([8, 10]);
    context.lineDashOffset = -elapsed * 22;
    context.beginPath();
    context.moveTo(tower.position.x, tower.position.y);
    context.lineTo(endpoint.x, endpoint.y);
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = accent;
    context.lineWidth = 2.8 + progress * 4.2;
    context.beginPath();
    context.arc(tower.position.x, tower.position.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 0.12 + progress * 0.32;
    context.lineWidth = 1.4 + progress * 1.6;
    context.beginPath();
    context.arc(tower.position.x, tower.position.y, secondaryRadius, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 0.12 + progress * 0.26;
    const halo = context.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, 20 + progress * 12);
    halo.addColorStop(0, "#ffffff");
    halo.addColorStop(0.2, accent);
    halo.addColorStop(1, `${accent}00`);
    context.fillStyle = halo;
    context.beginPath();
    context.arc(muzzle.x, muzzle.y, 20 + progress * 12, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.76 + progress * 0.24;
    context.strokeStyle = "#fffbe0";
    context.lineWidth = 1.4 + progress * 2;
    context.beginPath();
    context.arc(muzzle.x, muzzle.y, 3 + progress * 5, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  },

  presentEvent: (context) => {
    if (context.event.kind === "charge" && context.event.entityId !== undefined) {
      if (context.event.label === "start" && context.event.targetId !== undefined && context.event.from && context.position) {
        const duration = Math.max(0.1, Math.min(10, context.event.duration ?? 2));
        context.setZenithCharge(
          context.event.entityId,
          context.event.targetId,
          duration,
          Math.atan2(context.position.y - context.event.from.y, context.position.x - context.event.from.x),
        );
      } else context.clearZenithCharge(context.event.entityId);
      return true;
    }
    if (context.event.kind === "attack" && context.event.from && (context.target ? context.enemyPosition(context.target) : context.position)) {
      const target = context.target ? context.enemyPosition(context.target) : context.position!;
      const beamLife = Math.max(0.1, Math.min(0.5, context.event.duration ?? 0.2));
      context.clearZenithCharge(context.event.entityId ?? -1);
      context.spawnBeam(context.event.from, target, context.color, Math.max(3, Math.min(16, context.event.value ?? 9)), 0, "#ffffff", beamLife);
      context.spawnBeam(context.event.from, target, "#ffffff", 2.4, 0.02, undefined, Math.min(0.35, beamLife * 0.8));
      context.spawnMuzzleFlash(context.event.from, target, context.color, 34);
      context.playShoot(125, "rail");
      return true;
    }
    return false;
  },

  beforeAttack: (context) => {
    if ((context.tower.zenithChargeTimer ?? 0) <= 0) return false;
    const chargeDuration = 2 + (5 - 2) * Math.max(0, Math.min(5, context.tower.level)) / 5;
    const chargedTarget = context.findEnemy(context.tower.zenithChargeTargetId ?? -1);
    if (!chargedTarget) {
      context.cancelZenithCharge();
      return true;
    }
    context.tower.zenithChargeTimer = Math.max(0, (context.tower.zenithChargeTimer ?? 0) - context.delta);
    context.tower.zenithChargeAngle = Math.atan2(
      context.enemyPosition(chargedTarget).y - context.tower.position.y,
      context.enemyPosition(chargedTarget).x - context.tower.position.x,
    );
    const progress = Math.max(0, Math.min(1, 1 - context.tower.zenithChargeTimer / chargeDuration));
    if (context.tower.zenithChargeTimer > 0) {
      context.updateZenithChargeProgress(progress);
      return true;
    }
    fireLance(context, chargedTarget);
    context.finishZenithCharge();
    return true;
  },

  attack: (context, target) => {
    context.startZenithCharge(target);
  },

  counter: (context) => {
    const target = context.selectTarget(context.victims);
    if (target) fireLance(context, target, 1.75, 10);
    context.spawnText("EVENT HORIZON");
  },
};
