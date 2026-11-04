import { TOWER_DEFINITIONS } from "./config.ts";
import type { Tower } from "./types.ts";

export const tankCannonRecoil = (tower: Tower): number => tower.mechaFiring && !tower.mechaActiveAbility
  ? Math.max(0, Math.min(5, tower.fireTimer * 18)) : 0;

/** Draw in turret-local coordinates, independently of the damage tick clock. */
export function drawTankPlasmaBeam(context: CanvasRenderingContext2D, tower: Tower, range: number): void {
  if (!tower.mechaControlled || tower.mechaActiveAbility !== "g" || (tower.mechaAbilityTimer ?? 0) <= 0 || tower.stunTimer > 0 || (tower.mechaOverheatTimer ?? 0) > 0) return;
  const width = TOWER_DEFINITIONS.mecha.control!.beam.width[tower.level]!;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(32, 0);
  context.lineTo(range, 0);
  for (const [color, size, alpha] of [["#168bff", width * 2.4, 0.22], ["#32d4ff", width * 1.25, 0.7], ["#d8ffff", width * 0.34, 1]] as const) {
    context.strokeStyle = color;
    context.lineWidth = size;
    context.globalAlpha = alpha;
    context.stroke();
  }
  for (const x of [32, range]) {
    const glow = context.createRadialGradient(x, 0, 1, x, 0, width * 1.5);
    glow.addColorStop(0, "#e8ffffcc");
    glow.addColorStop(0.3, "#45dfff88");
    glow.addColorStop(1, "#168bff00");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, 0, width * 1.5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
