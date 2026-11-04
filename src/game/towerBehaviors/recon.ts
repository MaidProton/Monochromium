import type { TowerBehavior } from "./types.ts";

const pelletOffsets = [-2, -1, 0, 1, 2] as const;
const RECON_BASE_SPREAD = 0.065 * 1.5;
const RECON_MAX_SPREAD = 0.065 + 0.36;
const RECON_SPREAD_PER_RAMP = RECON_MAX_SPREAD - RECON_BASE_SPREAD;
const RECON_SPREAD_DECAY = 1;

export const RECON_BEHAVIOR: TowerBehavior = {
  counterName: "BREACH LOAD",
  attackSound: { pitch: 285, sound: "shotgun" },

  drawSupplemental: ({ tower, accent, showSupplementalStats, towerAmmoCapacity, addOverlay }) => {
    if (!showSupplementalStats) return;
    addOverlay({
      key: "recon-ammo",
      side: "below",
      priority: 780,
      height: 12,
      render: ({ context: overlayContext, x, centerY }) => {
        overlayContext.save();
        overlayContext.font = "700 9px ui-monospace, monospace";
        overlayContext.textAlign = "center";
        overlayContext.textBaseline = "middle";
        overlayContext.fillStyle = accent;
        overlayContext.fillText(`AMMO ${tower.ammo}/${towerAmmoCapacity ?? 5}`, x, centerY);
        overlayContext.restore();
      },
    });
  },

  drawWorld: ({ tower, context, accent }) => {
    if (tower.attackRamp <= 0.01) return;
    const gap = 30 + tower.attackRamp * 18;
    const arm = 7;
    context.save();
    context.beginPath();
    context.moveTo(-gap - arm + tower.position.x, tower.position.y);
    context.lineTo(-gap + tower.position.x, tower.position.y);
    context.moveTo(gap + tower.position.x, tower.position.y);
    context.lineTo(gap + arm + tower.position.x, tower.position.y);
    context.moveTo(tower.position.x, tower.position.y - gap - arm);
    context.lineTo(tower.position.x, tower.position.y - gap);
    context.moveTo(tower.position.x, tower.position.y + gap);
    context.lineTo(tower.position.x, tower.position.y + gap + arm);
    context.strokeStyle = `${accent}aa`;
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  },

  presentEvent: (context) => {
    if (context.event.kind !== "attack" || !context.event.from || !(context.target ? context.enemyPosition(context.target) : context.position)) return false;
    const target = context.target ? context.enemyPosition(context.target) : context.position!;
    const aimAngle = Math.atan2(target.y - context.event.from.y, target.x - context.event.from.x);
    const range = Math.max(1, Math.min(2_000, context.event.value ?? Math.hypot(target.x - context.event.from.x, target.y - context.event.from.y)));
    const spreadStep = Math.max(0, Math.min(0.5, context.event.speed ?? 0.065));
    [-2, -1, 0, 1, 2].forEach((offset, pellet) => {
      const angle = aimAngle + offset * spreadStep;
      const end = { x: context.event.from!.x + Math.cos(angle) * range, y: context.event.from!.y + Math.sin(angle) * range };
      context.spawnBeam(context.event.from!, end, pellet === 2 ? "#eafffb" : context.color, 2, pellet * 0.018);
    });
    context.spawnMuzzleFlash(context.event.from, target, context.color, 26);
    context.playShoot(285, "shotgun");
    return true;
  },

  update: ({ tower, delta }) => {
    if (tower.idleTimer > 0.65) tower.attackRamp = Math.max(0, tower.attackRamp - delta * RECON_SPREAD_DECAY);
  },

  onUpgrade: ({ tower, stats }) => {
    tower.ammo = stats.ammo ?? -1;
  },

  beforeAttack: (context) => {
    if (context.ammoCapacity === undefined || context.reloadDuration === undefined) return false;
    if (context.tower.ammo > 0 && context.tower.ammo < context.ammoCapacity && context.tower.idleTimer >= 5) {
      context.reload("IDLE RELOAD", false, true);
      context.tower.idleTimer = 0;
    }
    if (context.tower.ammo <= 0) {
      if (context.tower.fireTimer > 0) return true;
      context.reload("RELOAD READY", false, false);
    }
    return false;
  },

  attack: (context, target) => {
    const aim = context.enemyPosition(target);
    const aimAngle = Math.atan2(aim.y - context.tower.position.y, aim.x - context.tower.position.x);
    const spreadStep = RECON_BASE_SPREAD + context.tower.attackRamp * RECON_SPREAD_PER_RAMP;
    pelletOffsets.forEach((offset) => {
      const angle = aimAngle + offset * spreadStep;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const hits = context.candidates
        .map((enemy) => {
          const position = context.enemyPosition(enemy);
          const relative = {
            x: position.x - context.tower.position.x,
            y: position.y - context.tower.position.y,
          };
          const forward = relative.x * direction.x + relative.y * direction.y;
          const sideways = Math.abs(relative.x * direction.y - relative.y * direction.x);
          const hitWidth = context.enemyRadius(enemy) + (context.tower.level >= 3 ? 8 : 5);
          return { enemy, forward, sideways, hitWidth };
        })
        .filter(({ forward, sideways, hitWidth }) => forward >= 0 && forward <= context.range && sideways <= hitWidth)
        .sort((a, b) => a.forward - b.forward)
        .slice(0, context.tower.level >= 3 ? 3 : 2);
      hits.forEach(({ enemy }) => context.damageEnemy(enemy, context.damage));
    });
    context.emitShotgunVisual(target, spreadStep, context.range);
    context.tower.idleTimer = 0;
    context.tower.attackRamp = Math.min(1, context.tower.attackRamp + 0.25);
    context.tower.shotCounter += 1;
    context.tower.ammo -= 1;
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    if (context.tower.ammo <= 0) {
      context.tower.ammo = 0;
      context.triggerReload();
    }
    context.playAttackSound();
  },

  counter: (context) => {
    context.victims.forEach((enemy) => {
      context.damageEnemy(enemy, context.damage * 5);
      context.emitShotgunCounterVisual(enemy);
    });
    context.resetMagazine();
    context.spawnText("BREACH LOAD x5");
  },
};
