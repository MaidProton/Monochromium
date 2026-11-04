import { getTankHeatCap, TOWER_DEFINITIONS, RANGE_SCALE } from "../config.ts";
import { tankWeaponEndpoint } from "../tankMotion.ts";
import { drawTankPlasmaBeam, tankCannonRecoil } from "../tankPresentation.ts";
import type { Point, TowerInspectorStat } from "../types.ts";
import type { TowerAttackBehaviorContext, TowerBehavior, TowerBehaviorUpdateContext, TowerCounterBehaviorContext, TowerPresentationBehaviorContext, TowerRenderBehaviorContext } from "./types.ts";

const MECHA = TOWER_DEFINITIONS.mecha;
const CONTROL = MECHA.control!;
const TAU = Math.PI * 2;
const OVERHEAT_RECOVERY_SCALE = 0.35;
const degrees = (value: number): number => value * Math.PI / 180;
const levelValue = <T>(values: readonly T[], level: number): T => values[Math.max(0, Math.min(values.length - 1, level))]!;

const aimEndpoint = tankWeaponEndpoint;

const addHeat = (tower: TowerAttackBehaviorContext["tower"], amount: number): boolean => {
  const heatCap = getTankHeatCap(tower.level);
  tower.mechaHeat = Math.min(heatCap, (tower.mechaHeat ?? 0) + Math.max(0, amount));
  if ((tower.mechaHeat ?? 0) < heatCap) return false;
  const vent = levelValue(CONTROL.heat.ventPerSecond, tower.level);
  const recoveryTime = Math.max(0, ((tower.mechaHeat ?? 0) - CONTROL.heat.recoverAt) / Math.max(0.0001, vent) * OVERHEAT_RECOVERY_SCALE);
  tower.mechaOverheatTimer = Math.max(tower.mechaOverheatTimer ?? 0, CONTROL.heat.overheatLock, recoveryTime);
  return true;
};

const isOverheated = (tower: TowerAttackBehaviorContext["tower"]): boolean =>
  (tower.mechaOverheatTimer ?? 0) > 0 || (tower.mechaHeat ?? 0) >= getTankHeatCap(tower.level);

const muzzle = (tower: TowerAttackBehaviorContext["tower"], side = 0): Point => {
  const end = aimEndpoint(tower, 1);
  const dx = end.x - tower.position.x;
  const dy = end.y - tower.position.y;
  return { x: tower.position.x + dx * 32 - dy * side, y: tower.position.y + dy * 32 + dx * side };
};

const stopChannel = (context: TowerBehaviorUpdateContext, label: string): void => {
  const tower = context.tower;
  if (!tower.mechaActiveAbility) return;
  tower.mechaActiveAbility = null;
  tower.mechaAbilityTimer = 0;
  tower.fieldTickTimer = 0;
  context.attackContext.emitSimulationEvent({
    kind: "behavior",
    entityId: tower.id,
    position: { ...tower.position },
    color: MECHA.accent,
    label,
    phase: "complete",
  });
};

const channelAttack = (context: TowerBehaviorUpdateContext): void => {
  const tower = context.tower;
  const level = tower.level;
  const endpoint = aimEndpoint(tower, context.attackContext.range);
  if (tower.mechaActiveAbility === "g") {
    const width = levelValue(CONTROL.beam.width, level);
    const victims = context.attackContext.enemiesInLineFrom(tower.position, endpoint, context.attackContext.range, width);
    victims.forEach((enemy) => context.attackContext.damageEnemy(enemy, levelValue(CONTROL.beam.damage, level) * tower.damageBuff, "energy"));
    context.attackContext.emitSimulationEvent({
      kind: "behavior",
      entityId: tower.id,
      position: endpoint,
      from: muzzle(tower),
      color: MECHA.accent,
      label: "mecha-beam",
      value: width,
      duration: CONTROL.beam.tickInterval,
      phase: "action",
    });
    return;
  }
  if (tower.mechaActiveAbility === "h") {
    const range = levelValue(CONTROL.flame.range, level);
    const halfAngle = degrees(levelValue(CONTROL.flame.halfAngle, level));
    const victims = context.attackContext.enemiesInCone(endpoint, context.attackContext.coneCandidates, range, halfAngle);
    victims.forEach((enemy) => {
      context.attackContext.damageEnemy(enemy, levelValue(CONTROL.flame.damage, level) * tower.damageBuff, "fire");
      context.attackContext.applyBurn(enemy, levelValue(CONTROL.flame.burnDuration, level), levelValue(CONTROL.flame.burnDamage, level) * tower.damageBuff, 1, CONTROL.flame.burnTickInterval);
    });
    context.attackContext.emitSimulationEvent({
      kind: "flame",
      entityId: tower.id,
      position: { x: tower.position.x + (endpoint.x - tower.position.x) * Math.min(1, range / Math.max(1, context.attackContext.range)), y: tower.position.y + (endpoint.y - tower.position.y) * Math.min(1, range / Math.max(1, context.attackContext.range)) },
      from: muzzle(tower),
      color: MECHA.accent,
      label: "mecha-flame",
      value: halfAngle,
      speed: range,
      duration: CONTROL.flame.tickInterval,
      phase: "action",
    });
  }
};

const drawAimLine = (context: TowerRenderBehaviorContext, endpoint: Point, alpha: number, width: number): void => {
  const canvas = context.context;
  canvas.save();
  canvas.globalAlpha = alpha;
  canvas.setLineDash([6, 7]);
  canvas.strokeStyle = context.accent;
  canvas.lineWidth = width;
  canvas.beginPath();
  canvas.moveTo(context.tower.position.x, context.tower.position.y);
  canvas.lineTo(endpoint.x, endpoint.y);
  canvas.stroke();
  canvas.setLineDash([]);
  canvas.beginPath();
  canvas.arc(endpoint.x, endpoint.y, 8, 0, TAU);
  canvas.stroke();
  canvas.restore();
};

const MECHA_BEHAVIOR: TowerBehavior = {
  counterName: "EMP CORE BURST",
  counterScope: "range",
  inspectorStats: (tower): readonly TowerInspectorStat[] => [
    { key: "pilot-mode", label: "PILOT MODE", value: tower.mechaControlled ? "ACTIVE" : "DORMANT", group: "systems" },
    { key: "heat", label: "HEAT", value: `${Math.round((tower.mechaHeat ?? 0) / getTankHeatCap(tower.level) * 100)}%`, group: "systems" },
    { key: "channel", label: "CHANNEL", value: tower.mechaActiveAbility ? tower.mechaActiveAbility.toUpperCase() : "CANNON", group: "advanced" },
    { key: "hull-turn", label: "HULL TURN", value: `${Math.round(levelValue(CONTROL.hullTurnRate, tower.level) * 180 / Math.PI)}°/s`, group: "systems" },
    { key: "turret-turn", label: "TURRET TURN", value: `${Math.round(levelValue(CONTROL.turretTurnRate, tower.level) * 180 / Math.PI)}°/s`, group: "systems" },
    { key: "heat-vent", label: "HEAT VENT", value: `${levelValue(CONTROL.heat.ventPerSecond, tower.level)}/s`, group: "systems" },
  ],
  drawWorld: ({ tower, context, accent, elapsed, chassisPose }: TowerRenderBehaviorContext) => {
    const endpoint = aimEndpoint(tower, statsRange(tower));
    const angle = Math.atan2(endpoint.y - tower.position.y, endpoint.x - tower.position.x);
    context.save();
    context.translate(tower.position.x, tower.position.y);
    // Lower chassis follows travel; the upper weapon mount rotates independently.
    context.save();
    context.rotate(tower.mechaHullAngle ?? chassisPose?.angle ?? 0);
    context.fillStyle = "#101d25";
    context.strokeStyle = `${accent}88`;
    context.lineWidth = 2;
    context.fillRect(-26, -22, 52, 44);
    context.strokeRect(-26, -22, 52, 44);
    context.fillStyle = `${accent}cc`;
    context.beginPath();
    context.moveTo(31, 0);
    context.lineTo(22, -7);
    context.lineTo(22, 7);
    context.closePath();
    context.fill();
    for (const side of [-1, 1]) {
      const y = side * 29 - 7;
      context.fillStyle = "#080e12";
      context.fillRect(-31, y, 62, 14);
      context.strokeRect(-31, y, 62, 14);
      context.save();
      context.beginPath();
      context.rect(-29, y + 2, 58, 10);
      context.clip();
      context.fillStyle = `${accent}${tower.mechaControlled ? "99" : "44"}`;
      for (let tread = -36; tread < 36; tread += 8) context.fillRect(tread + (chassisPose?.treadOffset ?? 0), y + 3, 3, 8);
      context.restore();
    }
    context.restore();
    context.rotate(angle);
    drawTankPlasmaBeam(context, tower, statsRange(tower));
    if (tower.mechaControlled && tower.mechaActiveAbility === "h") {
      const range = levelValue(CONTROL.flame.range, tower.level);
      const spread = Math.tan(degrees(levelValue(CONTROL.flame.halfAngle, tower.level))) * range;
      const flame = context.createLinearGradient(30, 0, range, 0);
      flame.addColorStop(0, "#fff7c9e6");
      flame.addColorStop(0.25, "#ffc144b3");
      flame.addColorStop(0.65, "#ff681b66");
      flame.addColorStop(1, "#e83f0900");
      context.save();
      context.globalCompositeOperation = "lighter";
      context.fillStyle = flame;
      for (let tongue = -2; tongue <= 2; tongue += 1) {
        const reach = range * (0.84 + Math.sin(elapsed * 14 + tongue * 2) * 0.08);
        const edge = spread * tongue * 0.33;
        context.beginPath();
        context.moveTo(30, -5);
        context.bezierCurveTo(range * 0.35, edge * 0.3 - 16, reach * 0.8, edge - 24, reach, edge);
        context.bezierCurveTo(reach * 0.7, edge + 24, range * 0.3, edge * 0.3 + 16, 30, 5);
        context.closePath();
        context.fill();
      }
      context.restore();
    }
    context.strokeStyle = `${accent}${tower.mechaControlled ? "cc" : "66"}`;
    context.lineWidth = tower.mechaControlled ? 3 : 2;
    // Twin shoulder racks line up with the actual missile launch origins.
    for (const side of [-1, 1]) {
      context.fillStyle = "#101d25";
      context.fillRect(-9, side * 21 - 7, 38, 14);
      context.strokeRect(-9, side * 21 - 7, 38, 14);
      context.fillStyle = tower.level >= 1 ? "#ffb85c" : "#526675";
      for (let port = 0; port < 3; port += 1) context.fillRect(2 + port * 8, side * 21 - 3, 4, 6);
    }
    context.fillStyle = `${accent}${tower.mechaControlled ? "ee" : "99"}`;
    const recoil = tankCannonRecoil(tower);
    context.fillRect(10 - recoil, -5, 28, 10);
    context.fillStyle = "#081418";
    context.fillRect(16 - recoil, -2, 22, 4);
    context.fillStyle = (tower.mechaOverheatTimer ?? 0) > 0 ? "#ff665c" : tower.mechaControlled ? "#a2f4ff" : "#526675";
    context.fillRect(-7, -5, 11, 10);
    context.restore();
  },
  drawAim: (context) => {
    const tower = context.tower;
    if (tower.kind !== "mecha" || !tower.mechaControlled) return;
    const endpoint = aimEndpoint(tower, context.towerRange);
    const desired = tower.aimPoint ?? endpoint;
    const target = aimEndpoint(tower, Math.min(context.towerRange, Math.hypot(desired.x - tower.position.x, desired.y - tower.position.y)));
    drawAimLine(context, target, 0.5, 1.2);
    // The small cross is the requested mouse aim; the ring is actual barrel aim.
    context.context.save();
    context.context.strokeStyle = "#ffffff88";
    context.context.beginPath();
    context.context.moveTo(desired.x - 5, desired.y);
    context.context.lineTo(desired.x + 5, desired.y);
    context.context.moveTo(desired.x, desired.y - 5);
    context.context.lineTo(desired.x, desired.y + 5);
    context.context.stroke();
    context.context.restore();
    if (tower.level >= 1 && !tower.mechaActiveAbility) {
      const canvas = context.context;
      canvas.save();
      canvas.strokeStyle = "#ffb85c";
      canvas.globalAlpha = 0.2;
      canvas.setLineDash([4, 9]);
      canvas.beginPath();
      canvas.arc(target.x, target.y, levelValue(CONTROL.missiles.radius, tower.level), 0, TAU);
      canvas.stroke();
      canvas.restore();
    }
    if (tower.mechaActiveAbility === "h") {
      const canvas = context.context;
      const angle = Math.atan2(endpoint.y - tower.position.y, endpoint.x - tower.position.x);
      const range = levelValue(CONTROL.flame.range, tower.level);
      const halfAngle = degrees(levelValue(CONTROL.flame.halfAngle, tower.level));
      canvas.save();
      canvas.globalAlpha = 0.05;
      canvas.fillStyle = "#ff9b36";
      canvas.beginPath();
      canvas.moveTo(tower.position.x, tower.position.y);
      canvas.arc(tower.position.x, tower.position.y, range, angle - halfAngle, angle + halfAngle);
      canvas.closePath();
      canvas.fill();
      canvas.restore();
    }
  },
  drawSupplemental: ({ tower, accent, addOverlay, drawOverlayBar }: TowerRenderBehaviorContext) => {
    if (tower.kind !== "mecha") return;
    addOverlay({
      key: "mecha-heat",
      side: "below",
      priority: 820,
      height: 20,
      render: ({ context, x, centerY }) => {
        context.save();
        context.font = "700 9px ui-monospace, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = accent;
        const heatCap = getTankHeatCap(tower.level);
        const heatPercent = Math.round(Math.max(0, Math.min(1, (tower.mechaHeat ?? 0) / heatCap)) * 100);
        context.fillText(tower.mechaOverheatTimer && tower.mechaOverheatTimer > 0 ? "OVERHEAT" : `HEAT ${heatPercent}%`, x, centerY - 6);
        drawOverlayBar(x - 26, centerY + 4, 52, 4, heatPercent / 100, accent);
        context.restore();
      },
    });
  },
  presentEvent: (context: TowerPresentationBehaviorContext) => {
    const event = context.event;
    if (event.label === "mecha-cannon" && event.from && context.position) {
      context.spawnBulletTracer(event.from, context.position, "#ffe3a1", Math.max(2.5, (event.value ?? 10) * 0.3));
      context.spawnMuzzleFlash(event.from, context.position, "#ffbb68", 26);
      context.spawnFlash(context.position, "#ffe3a1", 10);
      context.playShoot(540, "machine");
      return true;
    }
    if (event.label === "mecha-beam" && event.from && context.position) {
      if (event.phase !== "action") return true;
      // The beam itself follows replicated channel state every rendered frame.
      // Damage events retain only a restrained endpoint spark and electrical hum.
      context.spawnFlash(context.position, "#78f0ff", 7);
      context.playTone(180, 0.12, 0.018, 25, "towers");
      return true;
    }
    if (event.label === "mecha-flame" && event.from && context.position) {
      if (event.phase !== "action") return true;
      context.spawnFlameCone(event.from, context.position, event.value ?? 0.5);
      return true;
    }
    if (event.label === "mecha-missile" && event.phase === "trigger" && event.from && context.position) {
      context.enqueueVisualProjectile({ start: event.from, endpoint: context.position, targetId: null, speed: event.speed ?? CONTROL.missiles.speed, color: "#ffbc73", splash: true, style: "mecha-missile", flightDuration: event.duration, delay: (event.count ?? 0) * CONTROL.missiles.launchSpacing, launchTowerId: event.entityId, launchSide: (event.count ?? 0) % 2 === 0 ? -21 : 21, scale: 1 });
      return true;
    }
    if (event.kind === "explosion" && event.label === "mecha-missile") {
      context.spawnExplosion(event.position ?? context.position ?? { x: 0, y: 0 }, context.color, event.value ?? 80, 1.15);
      context.playBreach("mecha");
      return true;
    }
    return false;
  },
  onCreate: ({ tower, stats }) => {
    tower.mechaHullAngle = 0;
    tower.mechaTurretAngle = 0;
    tower.mechaSpeed = 0;
    tower.mechaControlled = false;
    tower.mechaFiring = false;
    tower.mechaActiveAbility = null;
    tower.mechaAbilityTimer = 0;
    tower.mechaHeat = 0;
    tower.mechaOverheatTimer = 0;
    tower.aimPoint = { x: tower.position.x + stats.range * RANGE_SCALE, y: tower.position.y };
  },
  ability: (context) => {
    const tower = context.tower;
    if (tower.kind !== "mecha" || tower.mechaControlled !== true || !tower.aimPoint || isOverheated(tower)) {
      context.spawnText("PILOT MODE / COOLING REQUIRED");
      context.failAbility();
      return false;
    }
    if ((tower.mechaActiveAbility ?? null) !== null) {
      context.spawnText("CHANNEL ALREADY ACTIVE");
      context.failAbility();
      return false;
    }
    const level = tower.level;
    tower.abilityCooldowns ??= { f: tower.abilityCooldown };
    tower.abilityCooldowns[context.slot] = context.abilityCooldown;
    if (context.slot === "f") {
      const aim = aimEndpoint(tower, Math.min(statsRange(tower), Math.hypot(tower.aimPoint.x - tower.position.x, tower.aimPoint.y - tower.position.y)));
      const volley = levelValue(CONTROL.missiles.volley, level);
      const damage = levelValue(CONTROL.missiles.damage, level) * tower.damageBuff;
      const radius = levelValue(CONTROL.missiles.radius, level);
      for (let index = 0; index < volley; index += 1) {
        const angle = index / volley * TAU;
        const endpoint = { x: aim.x + Math.cos(angle) * CONTROL.missiles.spread, y: aim.y + Math.sin(angle) * CONTROL.missiles.spread };
        const from = muzzle(tower, index % 2 === 0 ? -21 : 21);
        const flight = CONTROL.missiles.fuse + Math.hypot(endpoint.x - from.x, endpoint.y - from.y) / CONTROL.missiles.speed;
        context.spawnTimedBombAt(endpoint, damage, radius, flight + index * CONTROL.missiles.launchSpacing, "mecha-missile");
        context.emitSimulationEvent({ kind: "attack", entityId: tower.id, position: endpoint, from, color: MECHA.accent, label: "mecha-missile", visual: "projectile", speed: CONTROL.missiles.speed, duration: flight, count: index, phase: "trigger" });
      }
      tower.abilityCooldown = context.abilityCooldown;
      addHeat(tower, levelValue(CONTROL.heat.missile, level));
      context.spawnAbilityText(tower.position, `MISSILE RACK x${volley}`);
      context.playAbilitySound();
      return true;
    }
    tower.mechaActiveAbility = context.slot;
    tower.mechaAbilityTimer = context.slot === "g" ? levelValue(CONTROL.beam.duration, level) : levelValue(CONTROL.flame.duration, level);
    tower.fieldTickTimer = 0;
    context.emitSimulationEvent({ kind: "behavior", entityId: tower.id, position: { ...tower.position }, from: { ...tower.position }, color: MECHA.accent, label: context.slot === "g" ? "mecha-beam" : "mecha-flame", duration: tower.mechaAbilityTimer, phase: "trigger" });
    context.spawnAbilityText(tower.position, context.slot === "g" ? "PLASMA BEAM" : "FLAMETHROWER");
    context.playAbilitySound();
    return true;
  },
  update: (context) => {
    const tower = context.tower;
    if (tower.kind !== "mecha") return;
    const level = tower.level;
    tower.mechaOverheatTimer = Math.max(0, (tower.mechaOverheatTimer ?? 0) - context.delta);
    const channel = tower.mechaActiveAbility;
    if (channel) {
      if (tower.stunTimer > 0 || tower.mechaControlled !== true) {
        stopChannel(context, tower.stunTimer > 0 ? "mecha-stunned" : "mecha-control-exit");
        return;
      }
      tower.mechaAbilityTimer = Math.max(0, (tower.mechaAbilityTimer ?? 0) - context.delta);
      addHeat(tower, (channel === "g" ? levelValue(CONTROL.heat.beamPerSecond, level) : levelValue(CONTROL.heat.flamePerSecond, level)) * context.delta);
      tower.fieldTickTimer -= context.delta;
      while (tower.fieldTickTimer <= 0 && tower.mechaAbilityTimer > 0 && !isOverheated(tower)) {
        channelAttack(context);
        tower.fieldTickTimer += channel === "g" ? CONTROL.beam.tickInterval : CONTROL.flame.tickInterval;
      }
      if (tower.mechaAbilityTimer <= 0 || isOverheated(tower)) stopChannel(context, tower.mechaAbilityTimer <= 0 ? "mecha-channel-complete" : "mecha-overheat");
    } else if (!tower.mechaControlled || !tower.mechaFiring || isOverheated(tower) || tower.stunTimer > 0) {
      tower.mechaHeat = Math.max(0, (tower.mechaHeat ?? 0) - levelValue(CONTROL.heat.ventPerSecond, level) * context.delta);
    }
  },
  beforeAttack: (context) => {
    const tower = context.tower;
    if (tower.kind !== "mecha") return false;
    if (tower.mechaControlled !== true || tower.mechaFiring !== true || tower.mechaActiveAbility || tower.fireTimer > 0 || isOverheated(tower)) return true;
    const endpoint = aimEndpoint(tower, context.range);
    const width = levelValue(CONTROL.cannonWidth, tower.level);
    const victims = context.enemiesInLineFrom(tower.position, endpoint, context.range, width).slice(0, levelValue(CONTROL.cannonPierce, tower.level));
    victims.forEach((enemy) => context.damageEnemy(enemy, context.damage));
    const impact = victims.length >= levelValue(CONTROL.cannonPierce, tower.level) ? context.enemyPosition(victims[victims.length - 1]!) : endpoint;
    context.emitSimulationEvent({ kind: "attack", entityId: tower.id, position: impact, from: muzzle(tower), color: MECHA.accent, label: "mecha-cannon", visual: "hitscan", value: width, count: victims.length, duration: 0.1 });
    addHeat(tower, levelValue(CONTROL.heat.cannonPerShot, tower.level));
    tower.fireTimer = context.fireRateCooldown(context.fireRate);
    tower.idleTimer = 0;
    return true;
  },
  counter: (context: TowerCounterBehaviorContext) => {
    const radius = Math.min(220, context.range + 40);
    const victims = context.victims.filter((enemy) => (context.tower.engaged.has(enemy.id) || enemy.targetTowerId === context.tower.id) && enemy.hp > 0 && Math.hypot(context.enemyPosition(enemy).x - context.tower.position.x, context.enemyPosition(enemy).y - context.tower.position.y) <= radius);
    victims.forEach((enemy) => {
      context.damageEnemy(enemy, context.damage * 2.5, "energy");
      context.applyStun(enemy, 0.8);
    });
    const firstVictim = victims[0];
    if (firstVictim) context.emitHitscanVisual(firstVictim, radius);
    context.spawnText("EMP CORE BURST");
  },
};

const statsRange = (tower: TowerAttackBehaviorContext["tower"]): number => tower.level >= 0 ? (MECHA.levels[tower.level]?.range ?? MECHA.levels[0]!.range) * RANGE_SCALE : 0;

export { MECHA_BEHAVIOR };
