import { getTankHeatCap, TOWER_DEFINITIONS } from "../game/config.ts";
import type { Tower, TowerAbilitySlot } from "../game/types.ts";

export function mechaWeaponStatus(tower: Tower): string {
  if (!tower.mechaControlled) return "DORMANT";
  if (tower.stunTimer > 0) return `STUNNED ${tower.stunTimer.toFixed(1)}s`;
  if ((tower.mechaOverheatTimer ?? 0) > 0) return `COOLING ${tower.mechaOverheatTimer!.toFixed(1)}s`;
  if (tower.mechaActiveAbility) return `${tower.mechaActiveAbility === "g" ? "PLASMA BEAM" : "FLAMETHROWER"} ${Math.max(0, tower.mechaAbilityTimer ?? 0).toFixed(1)}s`;
  return tower.mechaFiring ? "CANNON FIRING" : "CANNON READY";
}

export function mechaAbilityState(tower: Tower, slot: TowerAbilitySlot, owned: boolean, paused: boolean) {
  const definition = TOWER_DEFINITIONS.mecha;
  const ability = definition.abilities![slot]!;
  const cooldown = tower.abilityCooldowns?.[slot] ?? (slot === "f" ? tower.abilityCooldown : 0);
  const active = tower.mechaActiveAbility === slot;
  const duration = slot === "g" ? definition.control!.beam.duration[tower.level]! : slot === "h" ? definition.control!.flame.duration[tower.level]! : 0;
  let status = "READY";
  let hint = `Press ${slot.toUpperCase()} to activate`;
  let blocked = true;
  if (!owned) { status = "OWNER ONLY"; hint = "Teammate controls this chassis"; }
  else if (tower.level < ability.unlockLevel) { status = `LEVEL ${ability.unlockLevel}`; hint = "Upgrade to unlock this weapon"; }
  else if (paused) { status = "PAUSED"; hint = "Resume to use weapons"; }
  else if (!tower.mechaControlled) { status = "PILOT REQUIRED"; hint = "Enter Pilot Mode above"; }
  else if (tower.stunTimer > 0) { status = "STUNNED"; hint = "Weapons disabled while stunned"; }
  else if ((tower.mechaOverheatTimer ?? 0) > 0) { status = "OVERHEATED"; hint = "Wait for the core to cool"; }
  else if (active) { status = `ACTIVE ${Math.max(0, tower.mechaAbilityTimer ?? 0).toFixed(1)}s`; hint = "Cannon disabled during channel"; }
  else if (tower.mechaActiveAbility) { status = "CHANNEL BUSY"; hint = "Wait for the active weapon to finish"; }
  else if (cooldown > 0) { status = `${cooldown.toFixed(1)}s`; hint = "Weapon recharging"; }
  else blocked = false;
  return { status, hint, blocked, progress: active ? Math.max(0, (tower.mechaAbilityTimer ?? 0) / duration) : Math.max(0, 1 - cooldown / ability.cooldown) };
}

export function renderMechaControls(tower: Tower, owned: boolean): string {
  const heatCap = getTankHeatCap(tower.level);
  const heat = Math.round(tower.mechaHeat ?? 0);
  return `<section class="mecha-control-panel" data-testid="mecha-control-panel">
    <div class="mecha-control-copy"><span>PILOT LINK // ${owned ? "YOUR CHASSIS" : "REMOTE OWNER"}</span><strong data-mecha-weapon>${mechaWeaponStatus(tower)}</strong><small>${owned ? "WASD MOVE · MOUSE AIM · HOLD LMB FIRE · ESC EXIT" : "REMOTE OWNER CONTROL // READ ONLY"}</small></div>
    <div class="mecha-control-status"><span data-testid="mecha-heat">HEAT ${heat} / ${heatCap}</span><b>RELEASE FIRE TO VENT</b></div>
    <div class="mecha-heat-track" role="meter" aria-label="Tank heat" aria-valuemin="0" aria-valuemax="${heatCap}" aria-valuenow="${heat}"><i></i></div>
    <button type="button" class="mecha-control-toggle" data-action="toggle-mecha-control" data-testid="mecha-control-toggle" aria-pressed="${tower.mechaControlled === true}" ${owned ? "" : "disabled"}>${tower.mechaControlled ? "LEAVE PILOT MODE" : "ENTER PILOT MODE"}</button>
  </section>`;
}

export function tankCooldownState(tower: Tower, slot: TowerAbilitySlot) {
  const ability = TOWER_DEFINITIONS.mecha.abilities![slot]!;
  const remaining = Math.max(0, tower.abilityCooldowns?.[slot] ?? (slot === "f" ? tower.abilityCooldown : 0));
  const locked = tower.level < ability.unlockLevel;
  const active = tower.mechaActiveAbility === slot;
  return {
    name: ability.name,
    locked,
    active,
    progress: locked ? 0 : Math.max(0, Math.min(1, 1 - remaining / Math.max(0.001, ability.cooldown))),
    label: locked ? `LV ${ability.unlockLevel}` : remaining > 0 ? `${remaining.toFixed(1)}s` : "READY",
  };
}

export function renderTankCooldowns(): string {
  return (["f", "g", "h"] as const).map((slot) => `<div class="tank-cooldown" data-tank-cooldown="${slot}" data-testid="tank-cooldown-${slot}">
    <div class="tank-cooldown-label"><kbd>${slot.toUpperCase()}</kbd><span>${TOWER_DEFINITIONS.mecha.abilities![slot]!.name}</span><strong></strong></div>
    <div class="tank-cooldown-track" role="progressbar" aria-label="${TOWER_DEFINITIONS.mecha.abilities![slot]!.name} cooldown" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
  </div>`).join("");
}
