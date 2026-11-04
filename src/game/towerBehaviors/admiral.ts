import { RANGE_SCALE } from "../config.ts";
import type { TowerBehavior } from "./types.ts";

export const ADMIRAL_BEHAVIOR: TowerBehavior = {
  counterName: "FIRE SUPPORT",

  drawSupplemental: ({ tower, accent, showSupplementalStats, towerFireRate, addOverlay, drawOverlayBar }) => {
    if (!showSupplementalStats && !tower.aiming) return;
    const reloadDuration = towerFireRate / (1 + tower.fireRateBuff);
    const reloadProgress = reloadDuration > 0 ? 1 - tower.fireTimer / reloadDuration : 1;
    addOverlay({
      key: "admiral-reload",
      side: "below",
      priority: 780,
      height: 20,
      render: ({ context: overlayContext, x, centerY }) => {
        overlayContext.save();
        overlayContext.font = "700 9px ui-monospace, monospace";
        overlayContext.textAlign = "center";
        overlayContext.textBaseline = "middle";
        overlayContext.fillStyle = accent;
        overlayContext.fillText(reloadProgress >= 1 ? "FIRE READY" : `RELOAD ${Math.max(0, tower.fireTimer).toFixed(1)}s`, x, centerY - 6);
        overlayContext.restore();
        drawOverlayBar(x - 26, centerY + 4, 52, 4, reloadProgress, accent);
      },
    });
  },

  drawAim: ({ tower, context, accent, pointer, clampAimPoint, towerSplash }) => {
    const rawPoint = tower.aiming && pointer ? pointer : tower.aimPoint;
    const point = rawPoint ? clampAimPoint(rawPoint) : null;
    if (!point) return;
    context.save();
    context.globalAlpha = tower.aiming ? 0.95 : 0.65;
    context.setLineDash([5, 6]);
    context.strokeStyle = accent;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(tower.position.x, tower.position.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(point.x, point.y, towerSplash, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(point.x - 17, point.y);
    context.lineTo(point.x + 17, point.y);
    context.moveTo(point.x, point.y - 17);
    context.lineTo(point.x, point.y + 17);
    context.stroke();
    context.restore();
  },
  presentEvent: (context) => {
    if (context.event.kind === "attack" && context.event.visual === "projectile" && context.event.from && context.position) {
      const speed = Math.max(40, Math.min(2_000, context.event.speed ?? 620 / 1.5));
      context.enqueueVisualProjectile({
        start: context.event.from,
        endpoint: context.position,
        targetId: null,
        speed,
        color: context.color,
        splash: true,
        style: "admiral",
        flightDuration: Math.hypot(context.position.x - context.event.from.x, context.position.y - context.event.from.y) / speed,
        scale: 0.7,
      });
      context.spawnMuzzleFlash(context.event.from, context.position, context.color, 22);
      context.playShoot(0);
      return true;
    }
    if (context.event.kind === "explosion" && context.position) {
      context.spawnExplosion(context.position, context.color, context.event.value ?? 70, 1.5);
      context.playBreach("admiral");
      return true;
    }
    return false;
  },

  onCreate: ({ tower, placement, stats }) => {
    tower.aimPoint = placement
      ? { x: placement.position.x + stats.range * RANGE_SCALE, y: placement.position.y }
      : null;
  },

  ability: (context) => {
    if (context.slot !== "f") return;
    context.startAimMode();
  },

  aim: (context) => {
    if (!context.point) return false;
    const aimed = context.clampPoint(context.point);
    context.tower.aimPoint = aimed;
    context.tower.aiming = false;
    context.spawnText(aimed, "AIM SET");
    context.log(`Admiral aim locked // ${Math.round(Math.hypot(aimed.x - context.tower.position.x, aimed.y - context.tower.position.y))}m impact range.`);
    context.playAbilitySound();
    context.emitUi();
    return true;
  },

  cancelAim: (context) => {
    context.tower.aiming = false;
    context.spawnText(context.tower.position, "AIM CANCELLED", context.dimAccent);
    context.log("Admiral aim mode cancelled.");
    context.playFailSound();
    context.emitUi();
    return true;
  },

  beforeAttack: (context) => {
    if (context.tower.fireTimer > 0) return false;
    context.fireAdmiralShot(context.damage);
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate);
    context.tower.idleTimer = 0;
    return true;
  },

  counter: (context) => {
    context.fireAdmiralSupport(context.damage * 2);
  },
};
