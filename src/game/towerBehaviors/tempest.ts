import type { TowerBehavior } from "./types.ts";

const fieldDuration = (level: number): number => level >= 5 ? 9 : 6;
const fieldRadius = 150;

const resolveTempestHit = (context: Parameters<NonNullable<TowerBehavior["attack"]>>[0], target: Parameters<NonNullable<TowerBehavior["attack"]>>[1]): void => {
  const radius = context.tower.level >= 4 ? 60 : context.tower.level >= 2 ? 30 : 0;
  context.damageEnemy(target, context.damage);
  const impact = context.enemyPosition(target);
  if (radius > 0) context.areaTargetsAround(impact, radius)
    .filter((enemy) => enemy.id !== target.id)
    .forEach((enemy) => context.damageEnemy(enemy, context.damage));
  if (context.tower.level >= 2) {
      context.areaTargetsAround(context.tower.position, context.range + 45)
      .forEach((enemy) => context.applyShock(enemy, 2, context.tower.level >= 4 ? 0.1 : 0.5, context.tower.level >= 4 ? 0.85 : 0.5));
  }
  context.emitTempestHit(target);
};

export const TEMPEST_BEHAVIOR: TowerBehavior = {
  counterName: "THUNDER BREAK",
  attackSound: { pitch: 620, sound: "lightning" },
  persistentFieldDuration: (tower) => tower.fieldTimer,
  persistentEvent: (event) => event.kind === "ability" && (event.label === "tempest-field-start" || event.label === "tempest-field-end"),

  drawWorld: ({ tower, context, accent }) => {
    if (tower.fieldTimer <= 0) return;
    context.save();
    context.beginPath();
    context.arc(tower.position.x, tower.position.y, 150, 0, Math.PI * 2);
    context.fillStyle = `${accent}08`;
    context.fill();
    context.setLineDash([7, 11]);
    context.strokeStyle = `${accent}44`;
    context.lineWidth = 1.5;
    context.stroke();
    context.setLineDash([]);
    context.restore();
  },

  presentEvent: (context) => {
    const { event, position, color } = context;
    if (event.kind === "counter" && position) {
      context.spawnRing(position, color, 0.65, 9, 150);
      for (let arc = 0; arc < 5; arc += 1) context.spawnLightningAuraArc(position, event.value ?? 150, color);
      context.playCounter();
      return true;
    }
    if (event.kind === "ability" && event.entityId !== undefined && (event.label === "tempest-field-start" || event.label === "tempest-field-end")) {
      if (event.label === "tempest-field-start") {
        const duration = Math.max(0.1, Math.min(60, event.duration ?? event.value ?? 6));
        context.setTempestField(event.entityId, duration, color);
        if (position) {
          context.spawnRing(position, color, 0.65, 9, 150);
          context.spawnText(position, "LIGHTNING FIELD", color);
        }
        context.playEffect("tempest-field");
      } else context.clearTempestField(event.entityId);
      return true;
    }
    if (event.kind === "attack" && event.from && (context.target ? context.enemyPosition(context.target) : context.position)) {
      const targetPosition = context.target ? context.enemyPosition(context.target) : context.position!;
      context.spawnArc(event.from, targetPosition, color);
      context.playEffect("tempest-arc");
      return true;
    }
    return false;
  },

  beforeAttack: (context) => {
    if (context.tower.fieldTimer > 0) {
      context.tower.fieldTimer = Math.max(0, context.tower.fieldTimer - context.delta);
      if (context.tower.fieldTimer <= 0) context.emitTempestFieldEnd();
      else {
        context.tower.fieldVfxTimer -= context.delta;
        while (context.tower.fieldVfxTimer <= 0) {
          context.emitTempestFieldArc();
          context.tower.fieldVfxTimer += context.tower.level >= 4 ? 0.09 : 0.13;
        }
        context.tower.fieldTickTimer -= context.delta;
        if (context.tower.fieldTickTimer <= 0) {
          context.tower.fieldTickTimer = 1;
          const duration = fieldDuration(context.tower.level);
          context.areaTargetsAround(context.tower.position, fieldRadius).forEach((enemy) => {
            const totalDamage = Math.max(28, Math.min(200, enemy.hp * 0.08));
            context.damageEnemy(enemy, (totalDamage / duration) * context.tower.damageBuff);
            if (context.tower.level >= 2) context.applyShock(enemy, 2, context.tower.level >= 4 ? 0.1 : 0.5, context.tower.level >= 4 ? 0.85 : 0.5);
          });
        }
      }
    }
    if (context.tower.burstTimer > 0) {
      context.tower.burstTimer -= context.delta;
      if (context.tower.burstTimer <= 0) {
        const target = context.findEnemy(context.tower.burstTargetId ?? -1);
        context.tower.burstTargetId = null;
        if (target) resolveTempestHit(context, target);
      }
    }
    return false;
  },

  onDeploy: ({ tower, startField, triggerFirstTempestPlacement }) => {
    triggerFirstTempestPlacement();
    startField(fieldDuration(tower.level), fieldRadius, "tempest-field-start", "LIGHTNING FIELD");
  },

  onUpgrade: ({ tower, startField }) => {
    startField(fieldDuration(tower.level), fieldRadius, "tempest-field-start", "LIGHTNING FIELD");
  },

  onDebugMax: ({ tower, startField }) => {
    startField(fieldDuration(tower.level), fieldRadius, "tempest-field-start", "LIGHTNING FIELD");
  },

  attack: (context, target) => {
    resolveTempestHit(context, target);
    context.tower.burstTimer = 0.6;
    context.tower.burstTargetId = target.id;
    context.tower.shotCounter += 1;
    if (context.tower.level >= 3 && context.tower.shotCounter % 6 === 0) context.startField(fieldDuration(context.tower.level), fieldRadius, "tempest-field-start", "LIGHTNING FIELD");
    context.tower.fireTimer = context.fireRateCooldown(2);
    context.playAttackSound();
  },

  counter: (context) => {
    context.startField(fieldDuration(context.tower.level), fieldRadius, "tempest-field-start", "LIGHTNING FIELD");
    context.areaTargetsAround(context.tower.position, context.range + 45)
      .forEach((enemy) => context.applyShock(enemy, 2.2, context.tower.level >= 4 ? 0.1 : 0.5, context.tower.level >= 4 ? 0.85 : 0.5));
    context.emitTempestCounterVisual();
  },
};
