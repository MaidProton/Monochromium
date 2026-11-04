import {
  createEnemyActionId,
  createEnemyVisualId,
  validateEnemyAbilities,
  type EnemyAbilityPreset,
} from "../../game/enemyAbilities.ts";
import { sanitizeCustomEnemies } from "../../game/customEnemies.ts";
import type { CustomEnemyDraftV4 } from "../../game/customEnemies.ts";
import type {
  EnemyAbilityActionDefinition,
  EnemyAbilityAttackDefinition,
  EnemyAbilityCondition,
  EnemyAbilityDefinition,
  EnemyAbilityTrigger,
  EnemyAbilityVisualLayer,
  EnemyDefinition,
} from "../../game/types.ts";
import { EnemyAbilityLab, explainEnemyAbilityTrace } from "./lab.ts";
import {
  ENEMY_ABILITY_PRESETS,
  abilityEligibleForPreview,
  addEnemyAbilityPreset,
  duplicateEnemyAbility,
  enemyAbilityCardView,
  removeEnemyAbility,
  reorderEnemyAbility,
  titleEnemyAbilityPreset,
} from "./model.ts";

export interface EnemyCreatorV4Options {
  readonly getDraft: () => CustomEnemyDraftV4 | null;
  readonly getEnemyDefinitions: () => readonly EnemyDefinition[];
  readonly isDirty: () => boolean;
  readonly onChange: () => void;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]!,
  );

const selected = (left: unknown, right: unknown): string => (left === right ? "selected" : "");
const checked = (value: boolean): string => (value ? "checked" : "");

const numberInput = (
  label: string,
  field: string,
  value: number,
  min: number,
  max: number,
  step = 0.1,
  tooltip = "",
): string => `
  <label class="v4-field-label" ${tooltip ? `title="${escapeHtml(tooltip)}"` : ""}>
    <span>${label}</span>
    <input type="number" data-v4-field="${field}" value="${value}" min="${min}" max="${max}" step="${step}">
  </label>
`;

/* --------------------------------------------------------------------------
   NATURAL-LANGUAGE EXPLANATION GENERATOR
   -------------------------------------------------------------------------- */

const explainTrigger = (trigger: EnemyAbilityTrigger): string => {
  if (trigger.type === "interval") {
    const delay = trigger.initialDelay && trigger.initialDelay !== trigger.every ? ` (first at ${trigger.initialDelay}s)` : "";
    return `Every ${trigger.every}s${delay}`;
  }
  if (trigger.type === "hp-threshold") {
    const symbol = trigger.direction === "below" ? "≤" : "≥";
    const unit = trigger.threshold.unit === "percent" ? "%" : " HP";
    return `When Health ${symbol} ${trigger.threshold.value}${unit}`;
  }
  if (trigger.type === "elapsed-time") return `After surviving for ${trigger.at}s`;
  if (trigger.type === "spawn") return "Immediately upon spawning";
  if (trigger.type === "death") return "Upon death (Death Rattle)";
  if (trigger.type === "blocked") return "When blocked by a tower";
  if (trigger.type === "stunned") return "When stunned / disabled";
  if (trigger.type === "attack") return "On every contact strike";
  return "Custom trigger";
};

const explainCondition = (condition: EnemyAbilityCondition): string => {
  if (condition.type === "hp") {
    const min = condition.minimum;
    const max = condition.maximum;
    if (min !== null && max !== null) {
      return `Health between ${min.value}${min.unit === "percent" ? "%" : ""} and ${max.value}${max.unit === "percent" ? "%" : ""}`;
    }
    if (max !== null) return `Health ≤ ${max.value}${max.unit === "percent" ? "%" : " HP"}`;
    if (min !== null) return `Health ≥ ${min.value}${min.unit === "percent" ? "%" : " HP"}`;
    return "Any Health";
  }
  if (condition.type === "age") {
    if (condition.minimum !== null && condition.maximum !== null) return `Alive between ${condition.minimum}s–${condition.maximum}s`;
    if (condition.minimum !== null) return `Alive ≥ ${condition.minimum}s`;
    if (condition.maximum !== null) return `Alive ≤ ${condition.maximum}s`;
    return "Any Age";
  }
  if (condition.type === "path-distance") {
    if (condition.minimum !== null && condition.maximum !== null) return `Distance ${condition.minimum}–${condition.maximum}px`;
    if (condition.minimum !== null) return `Traveled ≥ ${condition.minimum}px`;
    if (condition.maximum !== null) return `Traveled ≤ ${condition.maximum}px`;
    return "Any Distance";
  }
  if (condition.type === "target-state") {
    switch (condition.state) {
      case "blocked": return "Blocked by construct";
      case "unblocked": return "Moving freely";
      case "target-present": return "Target in range";
      case "target-missing": return "No targets in range";
      case "target-stunned": return "Target is stunned";
      case "target-not-stunned": return "Target is active";
      case "target-damaged": return "Target is damaged";
      case "target-full-health": return "Target at full HP";
      default: return String(condition.state);
    }
  }
  if (condition.type === "cooldown-ready") return "Cooldown ready";
  if (condition.type === "uses-remaining") return "Uses remaining";
  return "Active";
};

const explainAction = (action: EnemyAbilityActionDefinition): string => {
  if (action.type === "damage") return `Deal ${action.amount} damage`;
  if (action.type === "stun") return `Stun for ${action.duration}s`;
  if (action.type === "drain") return `Siphon ${action.damage} damage (heal ${action.healingPerTarget} HP)`;
  if (action.type === "summon") return `Summon ${action.count} minion(s)`;
  if (action.type === "regeneration") return `Heal ${action.amount} HP${action.mode === "rate" ? "/s" : ""}`;
  if (action.type === "haste") return `Speed +${Math.round((action.multiplier - 1) * 100)}% (${action.duration}s)`;
  if (action.type === "invulnerability") return `Invulnerable (${action.duration}s)`;
  if (action.type === "phase") return `Phase shift (${action.duration}s)`;
  if (action.type === "blink") return `Blink forward ${action.distance}px`;
  if (action.type === "movement-lock") return `Hold position (${action.duration}s)`;
  if (action.type === "stat-change") return `Speed ×${action.speedMultiplier}, Dmg ×${action.damageMultiplier}`;
  return (action as { type: string }).type;
};

const explainDelivery = (attack: EnemyAbilityAttackDefinition | null): string => {
  if (!attack) return "Self / Area Aura";
  if (attack.delivery.type === "cone") return `${attack.delivery.angle}° forward cone (${attack.delivery.depth}px reach)`;
  if (attack.delivery.type === "wave") return `Path shockwave (${attack.delivery.depth}px reach, ${attack.delivery.width}px wide)`;
  if (attack.delivery.type === "radial") return `360° radial pulse (${attack.delivery.radius}px radius)`;
  return `Targeted construct projectile (${attack.range}px range)`;
};

export const generateHumanReadableSummary = (ability: EnemyAbilityDefinition): string => {
  const triggerText = explainTrigger(ability.trigger);
  const conditionsText = ability.conditions.length > 0
    ? ability.conditions.map(explainCondition).join(" AND ")
    : "No restrictions";
  const actionsText = ability.actions.length > 0
    ? ability.actions.map(explainAction).join(", then ")
    : "No actions";
  const deliveryText = explainDelivery(ability.attack);

  return `TRIGGER: ${triggerText} • ONLY IF: ${conditionsText} • TARGETING: ${deliveryText} • ACTIONS: ${actionsText}`;
};

/* --------------------------------------------------------------------------
   01 // TRIGGER EDITOR
   -------------------------------------------------------------------------- */

const triggerEditor = (ability: EnemyAbilityDefinition, advanced: boolean): string => {
  const trigger = ability.trigger;
  let specificFields = "";

  if (trigger.type === "interval") {
    specificFields = `
      ${numberInput("REPEAT EVERY (SECONDS)", "trigger.every", trigger.every, 1 / 30, 600, 0.5, "Interval between casts")}
      ${advanced ? numberInput("FIRST CAST DELAY (S)", "trigger.initialDelay", trigger.initialDelay, 0, 600, 0.5, "Seconds before first activation") : ""}
    `;
  } else if (trigger.type === "elapsed-time") {
    specificFields = numberInput("SURVIVAL TIME (SECONDS)", "trigger.at", trigger.at, 0, 86_400, 1, "Seconds alive on map before casting");
  } else if (trigger.type === "hp-threshold") {
    specificFields = `
      <label class="v4-field-label">
        <span>ACTIVATES WHEN</span>
        <select data-v4-field="trigger.direction">
          <option value="below" ${selected(trigger.direction, "below")}>HEALTH DROPS TO OR BELOW (Enrage / Last Stand)</option>
          <option value="above" ${selected(trigger.direction, "above")}>HEALTH RISES TO OR ABOVE (Healed / Overcharge)</option>
        </select>
      </label>
      <label class="v4-field-label">
        <span>UNIT TYPE</span>
        <select data-v4-field="trigger.threshold.unit">
          <option value="percent" ${selected(trigger.threshold.unit, "percent")}>PERCENTAGE (%)</option>
          <option value="absolute" ${selected(trigger.threshold.unit, "absolute")}>RAW HIT POINTS (HP)</option>
        </select>
      </label>
      ${numberInput(
        trigger.threshold.unit === "percent" ? "HEALTH THRESHOLD (%)" : "HEALTH THRESHOLD (HP)",
        "trigger.threshold.value",
        trigger.threshold.value,
        0,
        trigger.threshold.unit === "percent" ? 100 : 10_000_000,
        1,
        "HP level that triggers this ability",
      )}
    `;
  }

  return `
    <div class="v4-trigger-flow">
      <div class="v4-trigger-grid">
        <label class="v4-field-label v4-primary-trigger-select">
          <span>TRIGGER EVENT TYPE</span>
          <select data-v4-field="trigger.type">
            <option value="interval" ${selected(trigger.type, "interval")}>⏱️ PERIODIC INTERVAL (Repeats automatically)</option>
            <option value="hp-threshold" ${selected(trigger.type, "hp-threshold")}>🩸 HEALTH THRESHOLD (Last Stand / Enrage)</option>
            <option value="elapsed-time" ${selected(trigger.type, "elapsed-time")}>⏳ SURVIVAL TIMER (One-time countdown)</option>
            <option value="spawn" ${selected(trigger.type, "spawn")}>🌟 ON SPAWN (Immediate entrance cast)</option>
            <option value="death" ${selected(trigger.type, "death")}>💀 ON DEATH (Death Rattle upon defeat)</option>
            <option value="blocked" ${selected(trigger.type, "blocked")}>🛡️ WHEN BLOCKED (Colliding with a construct)</option>
            <option value="stunned" ${selected(trigger.type, "stunned")}>⚡ WHEN STUNNED (Disabled by towers)</option>
            <option value="attack" ${selected(trigger.type, "attack")}>⚔️ ON MELEE STRIKE (Standard contact attack)</option>
          </select>
        </label>
        ${specificFields}
      </div>
      <div class="v4-trigger-summary-banner">
        <b>CURRENT TRIGGER:</b> ${escapeHtml(explainTrigger(trigger))}
      </div>
    </div>
  `;
};

/* --------------------------------------------------------------------------
   02 // CONDITION EDITOR
   -------------------------------------------------------------------------- */

const conditionEditor = (condition: EnemyAbilityCondition, index: number): string => {
  if (condition.type === "hp") {
    const hpCond = condition;
    const isBelow = hpCond.maximum !== null && hpCond.minimum === null;
    const isAbove = hpCond.minimum !== null && hpCond.maximum === null;
    const mode = isBelow ? "below" : isAbove ? "above" : "range";
    const unit = hpCond.maximum?.unit ?? hpCond.minimum?.unit ?? "percent";
    const val = (isBelow ? hpCond.maximum?.value : hpCond.minimum?.value) ?? 50;

    return `
      <div class="v4-condition-card" data-condition-index="${index}">
        <div class="v4-cond-header">
          <span class="v4-cond-badge">🩸 HEALTH RESTRICTION</span>
          <span class="v4-cond-summary">${escapeHtml(explainCondition(condition))}</span>
          <button type="button" class="v4-cond-del-btn" data-v4-action="condition-delete" data-condition-index="${index}" title="Remove Condition">×</button>
        </div>
        <div class="v4-cond-body">
          <label class="v4-field-label">
            <span>RULE MODE</span>
            <select data-v4-field="condition.${index}.hp-mode">
              <option value="below" ${selected(mode, "below")}>ONLY WHEN DAMAGED (HP ≤ Threshold)</option>
              <option value="above" ${selected(mode, "above")}>ONLY WHEN HEALTHY (HP ≥ Threshold)</option>
              <option value="range" ${selected(mode, "range")}>ONLY IN HP RANGE (Min to Max)</option>
            </select>
          </label>
          <label class="v4-field-label">
            <span>UNIT</span>
            <select data-v4-field="condition.${index}.hp-unit">
              <option value="percent" ${selected(unit, "percent")}>PERCENT (%)</option>
              <option value="absolute" ${selected(unit, "absolute")}>HP (ABSOLUTE)</option>
            </select>
          </label>
          ${mode === "range"
            ? `
              ${numberInput("MIN HP", `condition.${index}.minimum.value`, hpCond.minimum?.value ?? 25, 0, unit === "percent" ? 100 : 10_000_000, 1)}
              ${numberInput("MAX HP", `condition.${index}.maximum.value`, hpCond.maximum?.value ?? 75, 0, unit === "percent" ? 100 : 10_000_000, 1)}
            `
            : `
              ${numberInput(mode === "below" ? "MAX THRESHOLD" : "MIN THRESHOLD", `condition.${index}.hp-threshold`, val, 0, unit === "percent" ? 100 : 10_000_000, 1)}
            `}
        </div>
      </div>
    `;
  }

  if (condition.type === "age") {
    const isAfter = condition.minimum !== null && condition.maximum === null;
    const isBefore = condition.maximum !== null && condition.minimum === null;
    const mode = isAfter ? "after" : isBefore ? "before" : "range";
    const val = (isAfter ? condition.minimum : condition.maximum) ?? 5;

    return `
      <div class="v4-condition-card" data-condition-index="${index}">
        <div class="v4-cond-header">
          <span class="v4-cond-badge">⏳ LIFESPAN / TIME ALIVE</span>
          <span class="v4-cond-summary">${escapeHtml(explainCondition(condition))}</span>
          <button type="button" class="v4-cond-del-btn" data-v4-action="condition-delete" data-condition-index="${index}" title="Remove Condition">×</button>
        </div>
        <div class="v4-cond-body">
          <label class="v4-field-label">
            <span>TIMING RULE</span>
            <select data-v4-field="condition.${index}.age-mode">
              <option value="after" ${selected(mode, "after")}>AFTER SURVIVING AT LEAST (s)</option>
              <option value="before" ${selected(mode, "before")}>ONLY DURING FIRST (s) OF LIFE</option>
              <option value="range" ${selected(mode, "range")}>BETWEEN (s) AND (s)</option>
            </select>
          </label>
          ${mode === "range"
            ? `
              ${numberInput("FROM (S)", `condition.${index}.minimum`, condition.minimum ?? 0, 0, 86_400, 0.5)}
              ${numberInput("UNTIL (S)", `condition.${index}.maximum`, condition.maximum ?? 10, 0, 86_400, 0.5)}
            `
            : `
              ${numberInput("SECONDS", `condition.${index}.age-threshold`, val, 0, 86_400, 0.5)}
            `}
        </div>
      </div>
    `;
  }

  if (condition.type === "path-distance") {
    const isAfter = condition.minimum !== null && condition.maximum === null;
    const isBefore = condition.maximum !== null && condition.minimum === null;
    const mode = isAfter ? "after" : isBefore ? "before" : "range";
    const val = (isAfter ? condition.minimum : condition.maximum) ?? 100;

    return `
      <div class="v4-condition-card" data-condition-index="${index}">
        <div class="v4-cond-header">
          <span class="v4-cond-badge">🛣️ PATH PROGRESS</span>
          <span class="v4-cond-summary">${escapeHtml(explainCondition(condition))}</span>
          <button type="button" class="v4-cond-del-btn" data-v4-action="condition-delete" data-condition-index="${index}" title="Remove Condition">×</button>
        </div>
        <div class="v4-cond-body">
          <label class="v4-field-label">
            <span>PROGRESSION RULE</span>
            <select data-v4-field="condition.${index}.path-mode">
              <option value="after" ${selected(mode, "after")}>AFTER TRAVELING AT LEAST (px)</option>
              <option value="before" ${selected(mode, "before")}>BEFORE REACHING DISTANCE (px)</option>
              <option value="range" ${selected(mode, "range")}>BETWEEN PATH DISTANCES (px)</option>
            </select>
          </label>
          ${mode === "range"
            ? `
              ${numberInput("MIN DISTANCE (PX)", `condition.${index}.minimum`, condition.minimum ?? 0, 0, 1_000_000, 10)}
              ${numberInput("MAX DISTANCE (PX)", `condition.${index}.maximum`, condition.maximum ?? 500, 0, 1_000_000, 10)}
            `
            : `
              ${numberInput("DISTANCE (PX)", `condition.${index}.path-threshold`, val, 0, 1_000_000, 10)}
            `}
        </div>
      </div>
    `;
  }

  if (condition.type === "target-state") {
    return `
      <div class="v4-condition-card" data-condition-index="${index}">
        <div class="v4-cond-header">
          <span class="v4-cond-badge">🎯 TARGET / CONSTRUCT STATE</span>
          <span class="v4-cond-summary">${escapeHtml(explainCondition(condition))}</span>
          <button type="button" class="v4-cond-del-btn" data-v4-action="condition-delete" data-condition-index="${index}" title="Remove Condition">×</button>
        </div>
        <div class="v4-cond-body">
          <label class="v4-field-label v4-wide-field">
            <span>REQUIRED BATTLEFIELD STATE</span>
            <select data-v4-field="condition.${index}.state">
              <option ${selected(condition.state, "blocked")} value="blocked">🛡️ Hostile is currently blocked by a construct</option>
              <option ${selected(condition.state, "unblocked")} value="unblocked">🏃 Hostile is moving freely (not blocked)</option>
              <option ${selected(condition.state, "target-present")} value="target-present">🎯 Target construct is within attack range</option>
              <option ${selected(condition.state, "target-missing")} value="target-missing">❌ No constructs in attack range</option>
              <option ${selected(condition.state, "target-stunned")} value="target-stunned">⚡ Target construct is disabled / stunned</option>
              <option ${selected(condition.state, "target-not-stunned")} value="target-not-stunned">⚔️ Target construct is active (not stunned)</option>
              <option ${selected(condition.state, "target-damaged")} value="target-damaged">❤️ Target construct is damaged (&lt; 100% HP)</option>
              <option ${selected(condition.state, "target-full-health")} value="target-full-health">💎 Target construct is at full HP</option>
            </select>
          </label>
        </div>
      </div>
    `;
  }

  return `
    <div class="v4-condition-card" data-condition-index="${index}">
      <div class="v4-cond-header">
        <span class="v4-cond-badge">⚡ ${escapeHtml(condition.type.replace("-", " ").toUpperCase())}</span>
        <span class="v4-cond-summary">${escapeHtml(explainCondition(condition))}</span>
        <button type="button" class="v4-cond-del-btn" data-v4-action="condition-delete" data-condition-index="${index}" title="Remove Condition">×</button>
      </div>
    </div>
  `;
};

/* --------------------------------------------------------------------------
   03 // ATTACK & TARGETING EDITOR
   -------------------------------------------------------------------------- */

const attackEditor = (ability: EnemyAbilityDefinition, advanced: boolean): string => {
  const attack = ability.attack;
  if (!attack) {
    return `
      <div class="v4-no-attack-card">
        <div class="v4-no-attack-info">
          <strong>DIRECT / SELF AURA ABILITY</strong>
          <p>This ability runs as a personal buff, passive power, minion summon, or instant self-cast without targeting construct towers directly.</p>
        </div>
        <button type="button" class="v4-primary-btn" data-v4-action="attack-add">
          + ENABLE OFFENSIVE TOWER TARGETING
        </button>
      </div>
    `;
  }

  const delivery = attack.delivery;
  let geometryFields = "";
  if (delivery.type === "cone") {
    geometryFields = `
      ${numberInput("CONE REACH / DEPTH (PX)", "attack.delivery.depth", delivery.depth, 4, 2_000, 10, "Distance forward the cone reaches")}
      ${numberInput("CONE ANGLE (DEGREES °)", "attack.delivery.angle", delivery.angle, 5, 180, 5, "Spread angle in front of hostile")}
    `;
  } else if (delivery.type === "wave") {
    geometryFields = `
      ${numberInput("WAVE REACH (PX)", "attack.delivery.depth", delivery.depth, 4, 2_000, 10, "Distance shockwave travels along path")}
      ${numberInput("CORRIDOR WIDTH (PX)", "attack.delivery.width", delivery.width, 4, 1_000, 5, "Lateral width of the shockwave corridor")}
    `;
  } else if (delivery.type === "radial") {
    geometryFields = numberInput("AOE RADIUS (PX)", "attack.delivery.radius", delivery.radius, 4, 2_000, 10, "360° radius around this hostile");
  }

  return `
    <div class="v4-attack-card">
      <header class="v4-attack-header">
        <div>
          <span class="v4-attack-tag">OFFENSIVE TARGETING</span>
          <strong>${escapeHtml(explainDelivery(attack))}</strong>
        </div>
        <button type="button" class="v4-secondary-btn v4-danger-text" data-v4-action="attack-delete">
          REMOVE TARGETING BLOCK
        </button>
      </header>

      <div class="v4-delivery-selector">
        <span class="v4-sub-label">DELIVERY PATTERN:</span>
        <div class="v4-delivery-buttons">
          <button type="button" class="v4-delivery-btn ${delivery.type === "targeted" ? "active" : ""}" data-v4-action="set-delivery" data-delivery="targeted">
            <b>🎯 DIRECT PROJECTILE</b>
            <small>Fires targeted shot at single construct</small>
          </button>
          <button type="button" class="v4-delivery-btn ${delivery.type === "cone" ? "active" : ""}" data-v4-action="set-delivery" data-delivery="cone">
            <b>📐 FORWARD CONE</b>
            <small>Cleaves arc in front of hostile</small>
          </button>
          <button type="button" class="v4-delivery-btn ${delivery.type === "wave" ? "active" : ""}" data-v4-action="set-delivery" data-delivery="wave">
            <b>🌊 PATH SHOCKWAVE</b>
            <small>Rolls forward down the lane</small>
          </button>
          <button type="button" class="v4-delivery-btn ${delivery.type === "radial" ? "active" : ""}" data-v4-action="set-delivery" data-delivery="radial">
            <b>💥 RADIAL AOE</b>
            <small>360° pulse hitting all nearby towers</small>
          </button>
        </div>
      </div>

      <div class="v4-attack-grid">
        <label class="v4-field-label">
          <span>TARGET PRIORITY</span>
          <select data-v4-field="attack.targeting">
            <option ${selected(attack.targeting, "first")} value="first">FIRST (Nearest to start)</option>
            <option ${selected(attack.targeting, "closest")} value="closest">CLOSEST (Nearest to hostile)</option>
            <option ${selected(attack.targeting, "strongest")} value="strongest">STRONGEST (Highest HP construct)</option>
            <option ${selected(attack.targeting, "weakest")} value="weakest">WEAKEST (Lowest HP construct)</option>
            <option ${selected(attack.targeting, "last")} value="last">LAST (Furthest construct)</option>
          </select>
        </label>
        ${numberInput("ENGAGE RANGE (PX)", "attack.range", attack.range, 4, 2_000, 10, "Maximum distance to start casting")}
        ${numberInput("MAX TOWERS HIT", "attack.maxTargets", attack.maxTargets, 1, 64, 1, "Simultaneous construct targets")}
        ${geometryFields}
        ${advanced ? `
          ${numberInput("TELEGRAPH WARNING (S)", "attack.telegraphDuration", attack.telegraphDuration, 0, 30, 0.1, "Red warning zone duration before strike")}
          ${numberInput("IMPACT DELAY (S)", "attack.impactTime", attack.impactTime, 0, 600, 0.1, "Moment damage and effects take place")}
          <label class="v4-field-label">
            <span>TARGET LOCKING</span>
            <select data-v4-field="attack.targetLock">
              <option value="activation" ${selected(attack.targetLock, "activation")}>AT ACTIVATION (Locks when cast starts)</option>
              <option value="impact" ${selected(attack.targetLock, "impact")}>AT IMPACT (Recalculates on hit)</option>
            </select>
          </label>
        ` : ""}
      </div>

      ${advanced ? `
        <div class="v4-visuals-section">
          <div class="v4-visuals-head">
            <span>VISUAL FX LAYERS (${attack.visuals.length}/16)</span>
            <button type="button" class="v4-secondary-btn" data-v4-action="visual-add">+ ADD FX LAYER</button>
          </div>
          <div class="v4-visuals-list">
            ${attack.visuals.map((visual, index) => `
              <div class="v4-visual-card" data-visual-index="${index}">
                <select data-v4-field="visual.type">
                  <option ${selected(visual.type, "projectile")} value="projectile">PROJECTILE</option>
                  <option ${selected(visual.type, "beam")} value="beam">BEAM / LASER</option>
                  <option ${selected(visual.type, "explosion")} value="explosion">EXPLOSION</option>
                  <option ${selected(visual.type, "lightning")} value="lightning">LIGHTNING</option>
                  <option ${selected(visual.type, "wave")} value="wave">ENERGY WAVE</option>
                  <option ${selected(visual.type, "slash")} value="slash">SLASH / CLEAVE</option>
                </select>
                <input type="color" data-v4-field="visual.color" value="${visual.color}" title="FX Tint">
                ${numberInput("START DELAY (S)", "visual.startOffset", visual.startOffset, 0, 600, 0.1)}
                <button type="button" class="v4-cond-del-btn" data-v4-action="visual-delete" title="Delete visual">×</button>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
};

/* --------------------------------------------------------------------------
   04 // ACTION SEQUENCE EDITOR
   -------------------------------------------------------------------------- */

export const actionFields = (
  action: EnemyAbilityActionDefinition,
  enemyDefinitions: readonly EnemyDefinition[] = [],
  searchQuery = "",
  draftId?: string,
): string => {
  if (action.type === "damage") return numberInput("DAMAGE AMOUNT", "action.amount", action.amount, 0, 1_000_000, 5, "Direct HP damage dealt to targets");
  if (action.type === "stun") return numberInput("STUN DURATION (SECONDS)", "action.duration", action.duration, 0, 60, 0.5, "Duration construct is disabled");
  if (action.type === "summon") {
    const q = searchQuery.trim().toLowerCase();
    const availableEnemies = enemyDefinitions.filter((enemy) => !draftId || enemy.kind !== draftId);
    const selectedKinds = action.kinds;
    const enemyMap = new Map<string, EnemyDefinition>();
    for (const def of enemyDefinitions) {
      enemyMap.set(def.kind, def);
    }

    const chipsMarkup = selectedKinds.length > 0
      ? selectedKinds
          .map((kind) => {
            const def = enemyMap.get(kind);
            const name = def?.name ?? kind;
            return `
              <span class="v4-summon-chip" data-kind="${escapeHtml(kind)}">
                <span class="v4-summon-chip-label">${escapeHtml(name)}</span>
                <button
                  type="button"
                  class="v4-summon-chip-remove"
                  data-v4-action="summon-remove-kind"
                  data-action-id="${escapeHtml(action.id)}"
                  data-kind="${escapeHtml(kind)}"
                  title="Remove ${escapeHtml(name)}"
                  aria-label="Remove ${escapeHtml(name)}"
                >×</button>
              </span>
            `;
          })
          .join("")
      : `<span class="v4-summon-empty">No hostiles selected. Click hostiles below to add them to the summon pool.</span>`;

    const optionsMarkup = availableEnemies.length > 0
      ? availableEnemies
          .map((enemy) => {
            const isSelected = selectedKinds.includes(enemy.kind);
            const isCustom = enemy.kind.startsWith("custom-enemy:");
            const matches = !q || enemy.name.toLowerCase().includes(q) || enemy.kind.toLowerCase().includes(q);
            const stats = `${enemy.hp.toLocaleString()} HP · ${enemy.speed} SPD · ${enemy.damage} DMG${enemy.shieldHp > 0 ? ` · ${enemy.shieldHp} SHIELD` : ""}`;
            return `
              <div
                class="v4-summon-option ${isSelected ? "selected" : ""}"
                data-v4-action="summon-toggle-kind"
                data-action-id="${escapeHtml(action.id)}"
                data-kind="${escapeHtml(enemy.kind)}"
                role="checkbox"
                aria-checked="${isSelected}"
                tabindex="0"
                ${matches ? "" : 'style="display:none"'}
              >
                <input
                  type="checkbox"
                  class="v4-summon-checkbox"
                  ${checked(isSelected)}
                  tabindex="-1"
                  aria-hidden="true"
                >
                <div class="v4-summon-option-text">
                  <div class="v4-summon-option-name-row">
                    <span class="v4-summon-name">${escapeHtml(enemy.name)}</span>
                    <span class="v4-summon-badge ${isCustom ? "custom" : "official"}">${isCustom ? "CREATED" : "OFFICIAL"}</span>
                  </div>
                  <span class="v4-summon-stats">${escapeHtml(stats)}</span>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="v4-summon-no-results">No hostiles available in pool.</div>`;

    const anyMatches = availableEnemies.some(
      (enemy) => !q || enemy.name.toLowerCase().includes(q) || enemy.kind.toLowerCase().includes(q),
    );

    return `
      ${numberInput("SPAWN COUNT", "action.count", action.count, 1, 100, 1, "Number of hostiles to spawn")}
      <div class="v4-summon-picker v4-wide-field" data-action-id="${escapeHtml(action.id)}">
        <div class="v4-summon-header">
          <span>SUMMON POOL (${selectedKinds.length} SELECTED)</span>
        </div>
        <div class="v4-summon-chips">
          ${chipsMarkup}
        </div>
        <div class="v4-summon-search-wrap">
          <input
            type="text"
            class="v4-summon-search"
            data-v4-action="summon-search"
            data-action-id="${escapeHtml(action.id)}"
            placeholder="Search hostiles by name or kind..."
            value="${escapeHtml(searchQuery)}"
            autocomplete="off"
            spellcheck="false"
          >
          <button
            type="button"
            class="v4-summon-clear-btn"
            data-v4-action="summon-search-clear"
            data-action-id="${escapeHtml(action.id)}"
            title="Clear search"
            ${searchQuery ? "" : "hidden"}
          >×</button>
        </div>
        <div class="v4-summon-list" data-action-id="${escapeHtml(action.id)}">
          ${optionsMarkup}
          <div class="v4-summon-no-results" ${anyMatches ? 'style="display:none"' : ""}>
            No hostiles match search filter.
          </div>
        </div>
        <details class="v4-summon-manual-details">
          <summary>MANUAL HOSTILE IDENTIFIERS</summary>
          <label class="v4-field-label v4-wide-field">
            <span>COMMA-SEPARATED IDENTIFIERS</span>
            <input data-v4-field="action.kinds" value="${escapeHtml(action.kinds.join(", "))}" placeholder="e.g. runner, tank, swarmer">
          </label>
        </details>
      </div>
    `;
  }
  if (action.type === "regeneration") {
    return `
      <label class="v4-field-label">
        <span>HEALING MODE</span>
        <select data-v4-field="action.mode">
          <option value="rate" ${selected(action.mode, "rate")}>CONTINUOUS (HP per second)</option>
          <option value="total" ${selected(action.mode, "total")}>INSTANT BURST (Fixed HP)</option>
        </select>
      </label>
      ${numberInput(action.mode === "rate" ? "HEAL RATE (HP/S)" : "HEAL AMOUNT (HP)", "action.amount", action.amount, 0, 10_000_000, 5)}
      ${numberInput("DURATION (0 = PERMANENT)", "action.duration", action.duration ?? 0, 0, 600, 1)}
    `;
  }
  if (action.type === "movement-lock") {
    return `
      ${numberInput("LOCK DURATION (SECONDS)", "action.duration", action.duration, 0, 600, 0.5, "Time hostile holds position")}
      ${numberInput("WAVE DELAY (0 = NONE)", "action.waves", action.waves, 0, 999, 1)}
    `;
  }
  if (action.type === "blink") return numberInput("TELEPORT DISTANCE (PIXELS)", "action.distance", action.distance, 5, 1_000, 10, "Distance forward along path");
  if (action.type === "invulnerability" || action.type === "phase") return numberInput("IMMUNITY DURATION (SECONDS)", "action.duration", action.duration, 0.1, 600, 0.5, "Duration immune to all damage");
  if (action.type === "stat-change") {
    return `
      ${numberInput("BUFF DURATION (S)", "action.duration", action.duration, 0.1, 600, 0.5)}
      ${numberInput("SPEED MULTIPLIER", "action.speedMultiplier", action.speedMultiplier, 0, 10, 0.1, "1.0 = normal, 1.5 = +50% speed")}
      ${numberInput("DAMAGE MULTIPLIER", "action.damageMultiplier", action.damageMultiplier, 0, 10, 0.1, "1.0 = normal, 2.0 = double damage")}
    `;
  }
  if (action.type === "haste") {
    return `
      ${numberInput("AURA RADIUS (PX)", "action.radius", action.radius, 20, 1_000, 10, "Radius to buff nearby allies")}
      ${numberInput("DURATION (SECONDS)", "action.duration", action.duration, 0.1, 60, 0.5)}
      ${numberInput("SPEED MULTIPLIER", "action.multiplier", action.multiplier, 1, 5, 0.1, "1.5 = +50% movement speed")}
    `;
  }
  return `
    ${numberInput("DRAIN DAMAGE", "action.damage", action.damage, 0, 1_000_000, 5)}
    ${numberInput("HEAL PER TARGET", "action.healingPerTarget", action.healingPerTarget, 0, 1_000_000, 5)}
  `;
};

const actionBadgeClass = (type: string): string => {
  if (type === "damage" || type === "drain") return "danger";
  if (type === "stun" || type === "movement-lock") return "warning";
  if (type === "regeneration" || type === "invulnerability" || type === "phase") return "success";
  if (type === "haste" || type === "blink" || type === "stat-change") return "info";
  return "neutral";
};

export const actionEditor = (
  action: EnemyAbilityActionDefinition,
  index: number,
  advanced: boolean,
  enemyDefinitions: readonly EnemyDefinition[] = [],
  searchQuery = "",
  draftId?: string,
): string => `
  <div class="v4-action-card" data-action-id="${escapeHtml(action.id)}">
    <div class="v4-action-header">
      <div class="v4-action-title">
        <span class="v4-action-order">#${index + 1}</span>
        <span class="v4-action-badge ${actionBadgeClass(action.type)}">${action.type.replace("-", " ").toUpperCase()}</span>
        <span class="v4-action-desc">${escapeHtml(explainAction(action))}</span>
      </div>
      <button type="button" class="v4-cond-del-btn" data-v4-action="action-delete" aria-label="Delete action" title="Remove action">×</button>
    </div>
    <div class="v4-action-body">
      <div class="v4-action-type-select">
        <label class="v4-field-label">
          <span>CHANGE ACTION TYPE</span>
          <select data-v4-field="action.type">
            <option value="damage" ${selected(action.type, "damage")}>💥 TOWER DAMAGE (Direct strike)</option>
            <option value="stun" ${selected(action.type, "stun")}>⚡ TOWER STUN (Disable constructs)</option>
            <option value="drain" ${selected(action.type, "drain")}>🧪 SIPHON DRAIN (Damage & heal self)</option>
            <option value="summon" ${selected(action.type, "summon")}>👥 SUMMON MINIONS (Spawn reinforcements)</option>
            <option value="regeneration" ${selected(action.type, "regeneration")}>💖 REGENERATION (Self healing)</option>
            <option value="haste" ${selected(action.type, "haste")}>🏃 SPEED AURA (Haste nearby allies)</option>
            <option value="invulnerability" ${selected(action.type, "invulnerability")}>🛡️ INVULNERABILITY SHIELD (Immunity)</option>
            <option value="phase" ${selected(action.type, "phase")}>👻 PHASE SHIFT (Pass through constructs)</option>
            <option value="blink" ${selected(action.type, "blink")}>⚡ TACTICAL BLINK (Forward teleport)</option>
            <option value="movement-lock" ${selected(action.type, "movement-lock")}>🔒 MOVEMENT LOCK (Hold position)</option>
            <option value="stat-change" ${selected(action.type, "stat-change")}>📈 STAT SURGE (Speed / Damage buff)</option>
          </select>
        </label>
      </div>
      <div class="v4-action-fields-grid">
        ${actionFields(action, enemyDefinitions, searchQuery, draftId)}
        ${advanced ? numberInput("DELAY AFTER CAST (S)", "action.delay", action.delay, 0, 600, 0.1, "Seconds to wait before this specific effect occurs") : ""}
      </div>
    </div>
  </div>
`;

/* --------------------------------------------------------------------------
   PREVIEW OVERLAY (SVG CANVAS)
   -------------------------------------------------------------------------- */

const renderPreviewOverlay = (draft: CustomEnemyDraftV4, ability: EnemyAbilityDefinition | null): string => {
  const color = draft.color || "#ff806f";
  if (!ability) {
    return `
      <svg viewBox="0 0 400 200" class="v4-svg-preview" aria-label="No ability selected">
        <circle cx="80" cy="100" r="16" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
        <text x="220" y="105" fill="#78848a" font-size="12" font-family="monospace" text-anchor="middle">NO ABILITY SELECTED</text>
      </svg>
    `;
  }

  const attack = ability.attack;
  if (!attack) {
    return `
      <svg viewBox="0 0 400 200" class="v4-svg-preview" aria-label="Self-targeted or passive ability">
        <circle cx="80" cy="100" r="42" fill="rgba(241,208,122,0.12)"/>
        <circle cx="80" cy="100" r="26" fill="none" stroke="#f1d07a" stroke-width="2" stroke-dasharray="4 3"/>
        <circle cx="80" cy="100" r="16" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
        <text x="220" y="96" fill="#f1d07a" font-size="11" font-weight="bold" font-family="monospace" text-anchor="middle">SELF / ALLIED AURA</text>
        <text x="220" y="116" fill="#8ca0a8" font-size="10" font-family="monospace" text-anchor="middle">${escapeHtml(ability.trigger.type.toUpperCase())} TRIGGER</text>
      </svg>
    `;
  }

  const ox = 70;
  const oy = 100;
  const delivery = attack.delivery;
  let zoneMarkup = "";

  if (delivery.type === "radial") {
    const rawR = delivery.radius || 180;
    const r = Math.min(85, Math.max(25, rawR * 0.4));
    zoneMarkup = `
      <circle cx="${ox}" cy="${oy}" r="${r}" fill="rgba(255,110,90,.16)" stroke="#ff806f" stroke-width="2" stroke-dasharray="4 3"/>
      <text x="${ox}" y="${oy - r - 6}" fill="#ff806f" font-size="9" font-family="monospace" text-anchor="middle">RADIUS: ${rawR}px</text>
    `;
  } else if (delivery.type === "cone") {
    const rawDepth = delivery.depth || 180;
    const rawAngle = delivery.angle || 60;
    const depth = Math.min(260, Math.max(60, rawDepth * 0.75));
    const halfAngleRad = (rawAngle * Math.PI) / 360;
    const x1 = ox + depth * Math.cos(-halfAngleRad);
    const y1 = oy + depth * Math.sin(-halfAngleRad);
    const x2 = ox + depth * Math.cos(halfAngleRad);
    const y2 = oy + depth * Math.sin(halfAngleRad);
    const largeArc = rawAngle > 180 ? 1 : 0;
    const pathD = `M ${ox} ${oy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${depth.toFixed(1)} ${depth.toFixed(1)} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
    zoneMarkup = `
      <path d="${pathD}" fill="rgba(255,110,90,.16)" stroke="#ff806f" stroke-width="2"/>
      <line x1="${ox}" y1="${oy}" x2="${(ox + depth).toFixed(1)}" y2="${oy}" stroke="#ff806f" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>
      <text x="${(ox + depth + 6).toFixed(1)}" y="${oy + 3}" fill="#ff806f" font-size="9" font-family="monospace">${rawDepth}px (${rawAngle}°)</text>
    `;
  } else if (delivery.type === "wave") {
    const rawDepth = delivery.depth || 180;
    const rawWidth = delivery.width || 60;
    const depth = Math.min(260, Math.max(60, rawDepth * 0.75));
    const width = Math.min(140, Math.max(20, rawWidth * 0.75));
    const top = oy - width / 2;
    zoneMarkup = `
      <rect x="${ox}" y="${top.toFixed(1)}" width="${depth.toFixed(1)}" height="${width.toFixed(1)}" fill="rgba(255,110,90,.16)" stroke="#ff806f" stroke-width="2" rx="4"/>
      <line x1="${ox}" y1="${oy}" x2="${(ox + depth).toFixed(1)}" y2="${oy}" stroke="#ff806f" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>
      <text x="${(ox + depth / 2).toFixed(1)}" y="${(top - 5).toFixed(1)}" fill="#ff806f" font-size="9" font-family="monospace" text-anchor="middle">${rawDepth}px × ${rawWidth}px</text>
    `;
  } else {
    // Targeted projectile
    const rawRange = attack.range || 220;
    const range = Math.min(260, Math.max(60, rawRange * 0.75));
    const tx = ox + range;
    zoneMarkup = `
      <line x1="${ox}" y1="${oy}" x2="${tx.toFixed(1)}" y2="${oy}" stroke="#ff806f" stroke-width="2.5" stroke-dasharray="6 4"/>
      <circle cx="${tx.toFixed(1)}" cy="${oy}" r="12" fill="rgba(255,110,90,.25)" stroke="#ff806f" stroke-width="2"/>
      <circle cx="${tx.toFixed(1)}" cy="${oy}" r="4" fill="#ff806f"/>
      <text x="${tx.toFixed(1)}" y="${oy + 24}" fill="#ff806f" font-size="9" font-family="monospace" text-anchor="middle">RANGE: ${rawRange}px</text>
    `;
  }

  return `
    <svg viewBox="0 0 400 200" class="v4-svg-preview" aria-label="Selected ability geometry">
      <defs>
        <pattern id="v4-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="400" height="200" fill="url(#v4-grid)"/>
      ${zoneMarkup}
      <circle cx="${ox}" cy="${oy}" r="16" fill="${color}" stroke="#ffffff" stroke-width="2"/>
    </svg>
  `;
};

/* --------------------------------------------------------------------------
   SELECTED ABILITY DETAIL INSPECTOR
   -------------------------------------------------------------------------- */

const selectedAbilityInspector = (
  ability: EnemyAbilityDefinition,
  index: number,
  draft: CustomEnemyDraftV4,
  enemyDefinitions: readonly EnemyDefinition[] = [],
  summonSearchQueries: Map<string, string> = new Map(),
): string => {
  const view = enemyAbilityCardView(ability);
  const advanced = view.advanced;
  const humanSummary = generateHumanReadableSummary(ability);

  return `
    <article
      class="v4-ability-card selected ${ability.enabled ? "" : "disabled"}"
      data-ability-index="${index}"
      data-ability-id="${escapeHtml(ability.id)}"
      tabindex="0"
    >
      <header class="v4-card-head">
        <div class="v4-head-title-wrap">
          <input
            type="checkbox"
            data-v4-field="enabled"
            ${checked(ability.enabled)}
            aria-label="Enable ability"
            title="Enable / Disable ability"
          >
          <input
            class="v4-ability-name"
            data-v4-field="name"
            maxlength="40"
            value="${escapeHtml(ability.name)}"
            placeholder="Ability Name"
          >
        </div>
        <div class="v4-head-actions">
          <div class="v4-view-toggle">
            <button type="button" data-v4-action="view-basic" class="${advanced ? "" : "active"}">GUIDED</button>
            <button type="button" data-v4-action="view-advanced" data-testid="enemy-ability-advanced" class="${advanced ? "active" : ""}">ADVANCED</button>
          </div>
          <button type="button" class="v4-secondary-btn" data-v4-action="duplicate" title="Duplicate ability">DUPLICATE</button>
          <button type="button" class="v4-secondary-btn v4-danger-text" data-v4-action="delete" title="Delete ability">DELETE</button>
        </div>
      </header>

      <div class="v4-natural-summary-card">
        <span class="v4-summary-badge">⚡ COMBAT BEHAVIOR OVERVIEW</span>
        <p>${escapeHtml(humanSummary)}</p>
      </div>

      <!-- STEP 1: TRIGGER -->
      <section class="v4-step-card">
        <h4><span>01 // WHEN</span> Primary Activation Trigger</h4>
        ${triggerEditor(ability, advanced)}
        ${advanced ? `
          <div class="v4-advanced-grid">
            ${numberInput("PRIORITY", "priority", ability.priority, -999, 999, 1, "Higher priority abilities evaluate first")}
            ${numberInput("INTERNAL COOLDOWN (S)", "cooldown", ability.cooldown, 0, 600, 0.5, "Minimum time between triggers")}
            ${numberInput("MAX TOTAL USES (0 = ∞)", "maxUses", ability.maxUses, 0, 999, 1, "Limit how many times this runs")}
            <label class="v4-field-label">
              <span>EXCLUSIVE MUTEX GROUP</span>
              <input data-v4-field="exclusiveGroup" value="${escapeHtml(ability.exclusiveGroup ?? "")}" placeholder="None">
            </label>
          </div>
        ` : ""}
      </section>

      <!-- STEP 2: CONDITIONS -->
      <section class="v4-step-card">
        <h4><span>02 // ONLY IF</span> Prerequisites & Battle Conditions</h4>
        <div class="v4-condition-list">
          ${ability.conditions.length
            ? ability.conditions.map(conditionEditor).join("")
            : `<div class="v4-no-conds-msg">✨ NO RESTRICTIONS — Ability executes whenever the trigger fires.</div>`}
        </div>
        <div class="v4-add-bar">
          <span class="v4-add-label">+ ADD CONDITION RULE:</span>
          <div class="v4-add-buttons-row">
            <button type="button" class="v4-add-chip" data-v4-action="condition-add" data-condition-type="hp">🩸 Health Rule</button>
            <button type="button" class="v4-add-chip" data-v4-action="condition-add" data-condition-type="age">⏳ Lifespan Rule</button>
            <button type="button" class="v4-add-chip" data-v4-action="condition-add" data-condition-type="path-distance">🛣️ Path Progress</button>
            <button type="button" class="v4-add-chip" data-v4-action="condition-add" data-condition-type="target-state">🎯 Target / Blocker State</button>
            ${advanced ? `
              <button type="button" class="v4-add-chip" data-v4-action="condition-add" data-condition-type="cooldown-ready">⏱️ Cooldown Ready</button>
              <button type="button" class="v4-add-chip" data-v4-action="condition-add" data-condition-type="uses-remaining">🔢 Uses Remaining</button>
            ` : ""}
          </div>
        </div>
      </section>

      <!-- STEP 3: HOW (TARGETING & DELIVERY) -->
      <section class="v4-step-card">
        <h4><span>03 // HOW</span> Targeting Range & Delivery Geometry</h4>
        ${attackEditor(ability, advanced)}
      </section>

      <!-- STEP 4: THEN (ACTIONS) -->
      <section class="v4-step-card">
        <h4><span>04 // THEN</span> Action & Effect Sequence</h4>
        <div class="v4-actions">
          ${ability.actions.map((action, actionIndex) => actionEditor(action, actionIndex, advanced, enemyDefinitions, summonSearchQueries.get(action.id) ?? "", draft.id)).join("")}
        </div>
        <div class="v4-add-bar">
          <span class="v4-add-label">+ ADD ACTION EFFECT:</span>
          <div class="v4-add-buttons-row">
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="damage">💥 Tower Damage</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="stun">⚡ Tower Stun</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="drain">🧪 Siphon Drain</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="summon">👥 Summon Minions</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="regeneration">💖 Regeneration</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="haste">🏃 Speed Aura</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="invulnerability">🛡️ Shield</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="blink">⚡ Blink</button>
            <button type="button" class="v4-add-chip" data-v4-action="action-add" data-action-type="phase">👻 Phase Shift</button>
          </div>
        </div>

        <div class="v4-timeline-wrap">
          <span class="v4-timeline-label">EXECUTION SEQUENCE TIMELINE</span>
          <div class="v4-timeline">
            ${view.timeline
              .map((item) => `<span style="--at:${Math.min(100, item.at * 12)}%"><b>${item.at.toFixed(2)}s</b>${escapeHtml(item.label)}</span>`)
              .join("")}
          </div>
        </div>
      </section>
    </article>
  `;
};

const emptyAbilityInspector = (): string => `
  <div class="v4-empty-inspector">
    <div class="v4-empty-inner">
      <strong>NO ABILITY SELECTED</strong>
      <p>Select an equipped ability on the left rail or click a preset above to equip powers, attacks, spells, or passive auras.</p>
    </div>
  </div>
`;

const newAction = (type: string): EnemyAbilityActionDefinition => {
  const id = createEnemyActionId();
  if (type === "stun") return { id, type, delay: 0, duration: 2 };
  if (type === "summon") {
    return {
      id,
      type,
      delay: 0,
      count: 2,
      kinds: ["dummy"],
      modifiers: {
        hitCashMultiplier: 0,
        hpMultiplier: 1,
        shieldMultiplier: 1,
        speedMultiplier: 1,
        damageMultiplier: 1,
        attackIntervalMultiplier: 1,
        coreDamageMultiplier: 1,
        defenseBonus: 0,
        protectionBonus: 0,
        armorBonus: 0,
        superarmorBonus: 0,
      },
    };
  }
  if (type === "regeneration") return { id, type, delay: 0, mode: "rate", amount: 5, duration: null };
  if (type === "movement-lock") return { id, type, delay: 0, duration: 5, waves: 0 };
  if (type === "blink") return { id, type, delay: 0, distance: 120 };
  if (type === "invulnerability") return { id, type, delay: 0, duration: 3 };
  if (type === "stat-change") return { id, type, delay: 0, duration: 5, speedMultiplier: 1.5, damageMultiplier: 1 };
  if (type === "haste") return { id, type, delay: 0, radius: 180, duration: 3, multiplier: 1.5 };
  if (type === "drain") return { id, type, delay: 0, damage: 10, healingPerTarget: 20 };
  if (type === "phase") return { id, type, delay: 0, duration: 2 };
  return { id, type: "damage", delay: 0, amount: 20 };
};

export class EnemyCreatorV4Editor {
  private selectedIndex = 0;
  private previewHp = 100;
  private previewAge = 0;
  private lab: EnemyAbilityLab | null = null;
  private labTimer: number | null = null;
  private labSpeed = 1;
  private dragTowerId: number | null = null;
  private summonSearchQueries = new Map<string, string>();

  constructor(private readonly root: HTMLElement, private readonly options: EnemyCreatorV4Options) {
    root.addEventListener("click", (event) => this.click(event));
    root.addEventListener("change", (event) => this.change(event));
    root.addEventListener("input", (event) => {
      const summonSearch = (event.target as Element).closest<HTMLInputElement>("[data-v4-action='summon-search']");
      if (summonSearch) {
        this.handleSummonSearchInput(summonSearch);
        return;
      }
      this.change(event);
    });
    root.addEventListener("pointerdown", (event) => this.pointerDown(event));
    root.addEventListener("pointermove", (event) => this.pointerMove(event));
    root.addEventListener("pointerup", () => {
      this.dragTowerId = null;
    });
    root.addEventListener("dblclick", (event) => {
      const tower = (event.target as Element).closest<HTMLElement>("[data-lab-tower-id]");
      if (tower && this.lab) {
        this.lab.command({ type: "tower-remove", id: Number(tower.dataset["labTowerId"]) });
        this.renderLab(true);
      }
    });
    root.addEventListener("keydown", (event) => this.keydown(event));
  }

  private draft(): CustomEnemyDraftV4 | null {
    return this.options.getDraft();
  }

  private card(element: Element | null): { ability: EnemyAbilityDefinition; index: number } | null {
    const card = element?.closest<HTMLElement>("[data-ability-index]");
    const draft = this.draft();
    const index = Number(card?.dataset["abilityIndex"]);
    return draft && Number.isInteger(index) && draft.abilities[index]
      ? { ability: draft.abilities[index]!, index }
      : null;
  }

  render(): void {
    const draft = this.draft();
    if (!draft) {
      this.root.innerHTML = "";
      return;
    }

    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, draft.abilities.length - 1)));
    const issues = validateEnemyAbilities(draft.abilities, {
      maxHp: draft.hp,
      knownEnemyKinds: new Set(this.options.getEnemyDefinitions().map((enemy) => enemy.kind)),
    });
    const errors = issues.filter((issue) => issue.severity === "error");
    const warnings = issues.filter((issue) => issue.severity === "warning");
    this.previewHp = Math.min(draft.hp, this.previewHp || draft.hp);

    const selectedAbility = draft.abilities[this.selectedIndex] ?? null;
    const previewState = {
      hp: this.previewHp,
      maxHp: draft.hp,
      age: this.previewAge,
      pathDistance: 100,
      blocked: false,
      target: { hp: 75, maxHp: 100, stunned: false },
    };

    const overlay = renderPreviewOverlay(draft, selectedAbility);

    this.root.innerHTML = `
      <div class="v4-workshop-layout">
        <aside class="v4-workshop-sidebar">
          <div class="v4-preview-card">
            <header class="v4-preview-card-head">
              <div>
                <span>LIVE ATTACK PREVIEW</span>
                <strong>${selectedAbility ? escapeHtml(selectedAbility.name) : "IDLE SILHOUETTE"}</strong>
              </div>
              <span class="v4-eligibility-badge ${selectedAbility && abilityEligibleForPreview(selectedAbility, previewState) ? "eligible" : ""}">
                ${selectedAbility ? (abilityEligibleForPreview(selectedAbility, previewState) ? "ELIGIBLE" : "LOCKED") : "NO ABILITY"}
              </span>
            </header>
            <div class="v4-preview-canvas-wrap">
              ${overlay}
            </div>
            <div class="v4-preview-sim-box">
              <div class="v4-preview-hp-bar">
                <i style="--fill:${Math.max(0, (this.previewHp / draft.hp) * 100)}%"></i>
                <b>${Math.round(this.previewHp)} / ${draft.hp} HP</b>
              </div>
              <div class="v4-preview-controls">
                ${numberInput("SIM HP", "preview.hp", this.previewHp, 0, draft.hp, 1)}
                ${numberInput("AGE (S)", "preview.age", this.previewAge, 0, 86_400, 1)}
              </div>
            </div>
          </div>

          <div class="v4-presets-card">
            <header class="v4-presets-head">
              <span>+ ADD PRESET ABILITY</span>
            </header>
            <div class="v4-presets-grid">
              ${ENEMY_ABILITY_PRESETS.map(
                (preset) => `
                  <button type="button" class="v4-preset-btn" data-v4-action="preset" data-preset="${preset}" title="Add ${titleEnemyAbilityPreset(preset)}">
                    <b>${titleEnemyAbilityPreset(preset)}</b>
                    <small>+ ADD</small>
                  </button>
                `,
              ).join("")}
            </div>
          </div>

          <div class="v4-stack-card" data-testid="enemy-ability-stack">
            <header class="v4-stack-head">
              <span>EQUIPPED ABILITIES (${draft.abilities.length}/64)</span>
            </header>
            <div class="v4-stack-list">
              ${draft.abilities.length === 0
                ? `<div class="v4-empty-stack-msg">No abilities yet. Pick a preset above.</div>`
                : draft.abilities
                    .map(
                      (ability, index) => `
                        <div
                          class="v4-stack-item ${index === this.selectedIndex ? "selected" : ""} ${ability.enabled ? "" : "disabled"}"
                          data-ability-index="${index}"
                          data-ability-id="${escapeHtml(ability.id)}"
                        >
                          <input
                            type="checkbox"
                            data-v4-field="enabled"
                            ${checked(ability.enabled)}
                            title="Toggle ability enabled"
                          >
                          <button
                            type="button"
                            class="v4-stack-select-btn"
                            data-v4-action="select-ability"
                            data-ability-id="${escapeHtml(ability.id)}"
                            data-ability-index="${index}"
                          >
                            <strong>${escapeHtml(ability.name || "Untitled")}</strong>
                            <small>${escapeHtml(ability.attack ? ability.attack.delivery.type.toUpperCase() : "PASSIVE/BUFF")} // ${escapeHtml(ability.trigger.type.replaceAll("-", " ").toUpperCase())}</small>
                          </button>
                          <div class="v4-stack-order-btns">
                            <button type="button" data-v4-action="move-up" title="Move Up" ${index === 0 ? "disabled" : ""}>↑</button>
                            <button type="button" data-v4-action="move-down" title="Move Down" ${index === draft.abilities.length - 1 ? "disabled" : ""}>↓</button>
                          </div>
                        </div>
                      `,
                    )
                    .join("")}
            </div>
          </div>
        </aside>

        <main class="v4-workshop-inspector">
          ${selectedAbility
            ? selectedAbilityInspector(
                selectedAbility,
                this.selectedIndex,
                draft,
                this.options.getEnemyDefinitions(),
                this.summonSearchQueries,
              )
            : emptyAbilityInspector()}
        </main>
      </div>

      <nav class="v4-status" aria-label="Enemy creator status">
        <span class="${this.options.isDirty() ? "dirty" : "saved"}">
          ${this.options.isDirty() ? "UNSAVED CHANGES" : "SAVED"}
        </span>
        <button type="button" class="v4-issues-trigger ${errors.length ? "error" : warnings.length ? "warning" : ""}" data-v4-action="issues">
          ${errors.length} ERRORS // ${warnings.length} WARNINGS
        </button>
        <button type="button" data-v4-action="test" data-testid="enemy-test" ${errors.length ? "disabled" : ""}>
          TEST IN LAB
        </button>
        <button type="button" data-action="enemy-save" ${errors.length ? "disabled" : ""}>
          SAVE ENEMY
        </button>
      </nav>

      ${issues.length ? `
        <div class="v4-issue-drawer" hidden>
          ${issues
            .map(
              (issue) => `
                <button
                  type="button"
                  data-v4-action="issue-jump"
                  data-ability-id="${escapeHtml(issue.abilityId ?? "")}"
                  class="${issue.severity}"
                >
                  <b>${escapeHtml(issue.code)}</b>${escapeHtml(issue.message)}
                </button>
              `,
            )
            .join("")}
        </div>
      ` : ""}

      <dialog class="v4-lab-dialog" data-testid="enemy-lab"></dialog>
    `;

    if (typeof document !== "undefined") {
      document.querySelectorAll<HTMLButtonElement>("[data-action='enemy-save']").forEach((button) => {
        button.disabled = errors.length > 0;
      });
    }

    if (this.lab) this.renderLab(true);
  }

  private changed(): void {
    this.options.onChange();
    this.render();
  }

  private click(event: Event): void {
    const source = (event.target as Element).closest<HTMLElement>("[data-v4-action]");
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const action = source.dataset["v4Action"]!;
    const draft = this.draft();

    if (action === "preset" && draft) {
      const created = addEnemyAbilityPreset(draft, source.dataset["preset"] as EnemyAbilityPreset);
      if (created) this.selectedIndex = draft.abilities.indexOf(created);
      this.changed();
      return;
    }
    if (action === "select-ability" && draft) {
      const index = source.dataset["abilityIndex"] !== undefined
        ? Number(source.dataset["abilityIndex"])
        : draft.abilities.findIndex((ability) => ability.id === source.dataset["abilityId"]);
      if (index >= 0 && index < draft.abilities.length) {
        this.selectedIndex = index;
        this.render();
      }
      return;
    }
    if (action === "issues") {
      const drawer = this.root.querySelector<HTMLElement>(".v4-issue-drawer");
      if (drawer) drawer.hidden = !drawer.hidden;
      return;
    }
    if (action === "issue-jump") {
      const targetId = source.dataset["abilityId"] ?? "";
      if (draft && targetId) {
        const found = draft.abilities.findIndex((a) => a.id === targetId);
        if (found >= 0) {
          this.selectedIndex = found;
          this.render();
        }
      }
      return;
    }
    if (action === "test") {
      this.openLab();
      return;
    }
    if (action.startsWith("lab-")) {
      this.labAction(action, source);
      return;
    }

    const card = this.card(source);
    if (!draft || !card) return;
    this.selectedIndex = card.index;

    if (action === "view-basic" || action === "view-advanced") {
      (card.ability as { editorMode: string }).editorMode = action === "view-advanced" ? "advanced" : "basic";
    } else if (action === "move-up" || action === "move-down") {
      if (reorderEnemyAbility(draft, card.index, action === "move-up" ? -1 : 1)) {
        this.selectedIndex += action === "move-up" ? -1 : 1;
      }
    } else if (action === "duplicate") {
      if (duplicateEnemyAbility(draft, card.index)) {
        this.selectedIndex = card.index + 1;
      }
    } else if (action === "delete") {
      removeEnemyAbility(draft, card.index);
      this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, draft.abilities.length - 1));
    } else if (action === "condition-add") {
      const type = source.dataset["conditionType"];
      const list = card.ability.conditions as EnemyAbilityCondition[];
      if (type === "hp") list.push({ type, minimum: null, maximum: { unit: "percent", value: 50 } });
      else if (type === "age" || type === "path-distance") list.push({ type, minimum: 0, maximum: null });
      else if (type === "target-state") list.push({ type, state: "target-present" });
      else if (type === "cooldown-ready" || type === "uses-remaining") list.push({ type });
    } else if (action === "condition-delete") {
      (card.ability.conditions as EnemyAbilityCondition[]).splice(Number(source.dataset["conditionIndex"]), 1);
    } else if (action === "action-add") {
      const actType = source.dataset["actionType"] || "damage";
      (card.ability.actions as EnemyAbilityActionDefinition[]).push(newAction(actType));
    } else if (action === "action-delete") {
      const actionCardEl = source.closest<HTMLElement>(".v4-action-card, .v4-action-row");
      const actionId = actionCardEl?.dataset["actionId"];
      const actionIdx = actionId
        ? (card.ability.actions as EnemyAbilityActionDefinition[]).findIndex((a) => a.id === actionId)
        : Number(actionCardEl?.querySelector(".v4-action-order")?.textContent?.replace("#", "")) - 1;
      if (actionIdx >= 0) {
        (card.ability.actions as EnemyAbilityActionDefinition[]).splice(actionIdx, 1);
      }
    } else if (action === "summon-toggle-kind") {
      const actionCardEl = source.closest<HTMLElement>(".v4-action-card, .v4-action-row");
      const actionId = source.dataset["actionId"] || actionCardEl?.dataset["actionId"];
      const kind = source.dataset["kind"];
      if (actionId && kind) {
        const act = (card.ability.actions as any[]).find((a) => a.id === actionId);
        if (act && act.type === "summon") {
          const currentKinds = (act.kinds ?? []) as string[];
          if (currentKinds.includes(kind)) {
            act.kinds = currentKinds.filter((k: string) => k !== kind);
          } else if (currentKinds.length < 64) {
            act.kinds = [...currentKinds, kind];
          }
        }
      }
    } else if (action === "summon-remove-kind") {
      const actionCardEl = source.closest<HTMLElement>(".v4-action-card, .v4-action-row");
      const actionId = source.dataset["actionId"] || actionCardEl?.dataset["actionId"];
      const kind = source.dataset["kind"];
      if (actionId && kind) {
        const act = (card.ability.actions as any[]).find((a) => a.id === actionId);
        if (act && act.type === "summon") {
          const currentKinds = (act.kinds ?? []) as string[];
          act.kinds = currentKinds.filter((k: string) => k !== kind);
        }
      }
    } else if (action === "summon-search-clear") {
      const actionId = source.dataset["actionId"];
      if (actionId) this.summonSearchQueries.delete(actionId);
      const picker = source.closest<HTMLElement>(".v4-summon-picker");
      const searchInput = picker?.querySelector<HTMLInputElement>("[data-v4-action='summon-search']");
      if (searchInput) {
        searchInput.value = "";
        this.handleSummonSearchInput(searchInput);
        searchInput.focus();
      }
      return;
    } else if (action === "set-delivery" && card.ability.attack) {
      const deliveryType = source.dataset["delivery"] || "targeted";
      (card.ability.attack as any).delivery =
        deliveryType === "cone"
          ? { type: "cone", depth: 180, angle: 60 }
          : deliveryType === "wave"
          ? { type: "wave", depth: 180, width: 60 }
          : deliveryType === "radial"
          ? { type: "radial", radius: 180 }
          : { type: "targeted" };
    } else if (action === "attack-add") {
      (card.ability as { attack: unknown }).attack = {
        targeting: "first",
        range: 220,
        maxTargets: 1,
        delivery: { type: "targeted" },
        telegraphDuration: 0.4,
        targetLock: "activation",
        impactTime: 0.4,
        visuals: [
          {
            id: createEnemyVisualId(),
            type: "projectile",
            color: "#ff806f",
            size: 1,
            width: 3,
            duration: 0.4,
            speed: 360,
            startOffset: 0,
          },
        ],
      };
    } else if (action === "attack-delete") {
      (card.ability as { attack: unknown }).attack = null;
    } else if (action === "visual-add" && card.ability.attack && card.ability.attack.visuals.length < 16) {
      (card.ability.attack.visuals as EnemyAbilityVisualLayer[]).push({
        id: createEnemyVisualId(),
        type: "beam",
        color: "#ffffff",
        size: 1,
        width: 3,
        duration: 0.4,
        speed: 360,
        startOffset: 0,
      });
    } else if (action === "visual-delete" && card.ability.attack) {
      (card.ability.attack.visuals as EnemyAbilityVisualLayer[]).splice(
        Number(source.closest<HTMLElement>("[data-visual-index]")?.dataset["visualIndex"]),
        1,
      );
    }
    this.changed();
  }

  private change(event: Event): void {
    const field = (event.target as Element).closest<HTMLInputElement | HTMLSelectElement>("[data-v4-field]");
    if (!field) return;
    event.stopPropagation();
    if (this.handleLabField(field)) return;
    const path = field.dataset["v4Field"]!;
    const draft = this.draft();

    if (path === "preview.hp") {
      this.previewHp = Number(field.value);
      this.render();
      return;
    }
    if (path === "preview.age") {
      this.previewAge = Number(field.value);
      this.render();
      return;
    }

    const card = this.card(field);
    if (!draft || !card) return;
    const ability = card.ability as any;
    const value = field instanceof HTMLInputElement && field.type === "checkbox" ? field.checked : field.value;
    const numeric = field.type === "number" ? Number(field.value) : value;

    const actionCardEl = field.closest<HTMLElement>(".v4-action-card, .v4-action-row");
    const actionId = actionCardEl?.dataset["actionId"];
    const actionIndex = actionId
      ? ability.actions.findIndex((a: any) => a.id === actionId)
      : -1;
    const action = actionIndex >= 0 ? ability.actions[actionIndex] : undefined;

    const visualIndex = Number(field.closest<HTMLElement>("[data-visual-index]")?.dataset["visualIndex"]);
    const visual = ability.attack?.visuals[visualIndex] as any;

    if (path === "enabled" || path === "name" || path === "priority" || path === "cooldown" || path === "maxUses") {
      ability[path] = numeric;
    } else if (path === "exclusiveGroup") {
      ability.exclusiveGroup = value || null;
    } else if (path === "trigger.type") {
      ability.trigger =
        value === "interval"
          ? { type: value, every: 8, initialDelay: 8 }
          : value === "elapsed-time"
          ? { type: value, at: 5 }
          : value === "hp-threshold"
          ? { type: value, direction: "below", threshold: { unit: "percent", value: 25 } }
          : { type: value };
    } else if (path.startsWith("trigger.")) {
      const keys = path.split(".").slice(1);
      let target = ability.trigger;
      while (keys.length > 1) target = target[keys.shift()!];
      target[keys[0]!] = numeric;
    } else if (path.startsWith("condition.")) {
      const parts = path.split(".");
      const condIdx = Number(parts[1]);
      const subProp = parts[2];
      const cond = ability.conditions[condIdx];

      if (cond && subProp === "hp-mode") {
        const curUnit = cond.maximum?.unit ?? cond.minimum?.unit ?? "percent";
        const curVal = cond.maximum?.value ?? cond.minimum?.value ?? 50;
        if (value === "below") {
          cond.minimum = null;
          cond.maximum = { unit: curUnit, value: curVal };
        } else if (value === "above") {
          cond.minimum = { unit: curUnit, value: curVal };
          cond.maximum = null;
        } else {
          cond.minimum = { unit: curUnit, value: Math.min(curVal, 25) };
          cond.maximum = { unit: curUnit, value: Math.max(curVal, 75) };
        }
      } else if (cond && subProp === "hp-unit") {
        if (cond.minimum) cond.minimum.unit = value;
        if (cond.maximum) cond.maximum.unit = value;
      } else if (cond && subProp === "hp-threshold") {
        const curUnit = cond.maximum?.unit ?? cond.minimum?.unit ?? "percent";
        if (cond.maximum !== null && cond.minimum === null) {
          cond.maximum = { unit: curUnit, value: Number(numeric) };
        } else if (cond.minimum !== null && cond.maximum === null) {
          cond.minimum = { unit: curUnit, value: Number(numeric) };
        }
      } else if (cond && subProp === "age-mode") {
        const curVal = cond.minimum ?? cond.maximum ?? 5;
        if (value === "after") {
          cond.minimum = curVal;
          cond.maximum = null;
        } else if (value === "before") {
          cond.minimum = null;
          cond.maximum = curVal;
        } else {
          cond.minimum = 0;
          cond.maximum = 10;
        }
      } else if (cond && subProp === "age-threshold") {
        if (cond.minimum !== null && cond.maximum === null) {
          cond.minimum = Number(numeric);
        } else if (cond.maximum !== null && cond.minimum === null) {
          cond.maximum = Number(numeric);
        }
      } else if (cond && subProp === "path-mode") {
        const curVal = cond.minimum ?? cond.maximum ?? 100;
        if (value === "after") {
          cond.minimum = curVal;
          cond.maximum = null;
        } else if (value === "before") {
          cond.minimum = null;
          cond.maximum = curVal;
        } else {
          cond.minimum = 0;
          cond.maximum = 500;
        }
      } else if (cond && subProp === "path-threshold") {
        if (cond.minimum !== null && cond.maximum === null) {
          cond.minimum = Number(numeric);
        } else if (cond.maximum !== null && cond.minimum === null) {
          cond.maximum = Number(numeric);
        }
      } else {
        const keys = parts.slice(2);
        let target = cond;
        while (keys.length > 1) {
          const key = keys.shift()!;
          target[key] ??= { unit: "absolute", value: 0 };
          target = target[key];
        }
        if (target && keys.length === 1) {
          target[keys[0]!] = numeric;
        }
      }
    } else if (path === "action.type" && actionIndex >= 0) {
      ability.actions[actionIndex] = newAction(String(value));
    } else if (path.startsWith("action.") && action) {
      const key = path.slice(7);
      if (key === "kinds") {
        action.kinds = String(value)
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 64);
      } else if (key === "duration" && action.type === "regeneration" && Number(numeric) === 0) {
        action.duration = null;
      } else {
        action[key] = numeric;
      }
    } else if (path === "attack.delivery.type") {
      ability.attack.delivery =
        value === "cone"
          ? { type: value, depth: 180, angle: 60 }
          : value === "wave"
          ? { type: value, depth: 180, width: 60 }
          : value === "radial"
          ? { type: value, radius: 180 }
          : { type: value };
    } else if (path.startsWith("attack.delivery.")) {
      ability.attack.delivery[path.slice(16)] = numeric;
    } else if (path.startsWith("attack.")) {
      ability.attack[path.slice(7)] = numeric;
    } else if (path.startsWith("visual.") && visual) {
      visual[path.slice(7)] = numeric;
    }

    this.selectedIndex = card.index;
    this.changed();
  }

  private openLab(): void {
    const draft = this.draft();
    if (!draft) return;
    const copy = sanitizeCustomEnemies([JSON.parse(JSON.stringify(draft))])[0];
    if (!copy) return;
    this.lab = new EnemyAbilityLab(copy);
    this.labSpeed = 1;
    this.render();
    const dialog = this.root.querySelector<HTMLDialogElement>(".v4-lab-dialog");
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("button")?.focus();
  }

  private renderLab(keepOpen = false): void {
    const lab = this.lab;
    const dialog = this.root.querySelector<HTMLDialogElement>(".v4-lab-dialog");
    if (!lab || !dialog) return;
    const state = lab.state;
    const recent = lab.traces.slice(-16).reverse();
    dialog.innerHTML = `
      <div class="v4-lab">
        <header>
          <div>
            <span>DETERMINISTIC SCENARIO LAB // 30 HZ</span>
            <strong>${escapeHtml(lab.draft.name)}</strong>
          </div>
          <button type="button" data-v4-action="lab-close">CLOSE</button>
        </header>
        <div class="v4-lab-controls">
          <button type="button" data-v4-action="lab-play">PLAY</button>
          <button type="button" data-v4-action="lab-pause">PAUSE</button>
          <button type="button" data-v4-action="lab-step" data-testid="enemy-lab-step">STEP</button>
          <button type="button" data-v4-action="lab-reset">RESET</button>
          <select data-v4-field="lab.speed">
            <option value="0.5" ${selected(this.labSpeed, 0.5)}>0.5×</option>
            <option value="1" ${selected(this.labSpeed, 1)}>1×</option>
            <option value="2" ${selected(this.labSpeed, 2)}>2×</option>
            <option value="4" ${selected(this.labSpeed, 4)}>4×</option>
          </select>
          <label class="v4-field-label">HP <input type="number" data-v4-field="lab.hp" value="${state.hp}" min="0" max="${state.maxHp}"></label>
          <label class="v4-field-label">AGE <input type="number" data-v4-field="lab.age" value="${state.age.toFixed(2)}" min="0"></label>
          <label class="v4-field-label"><input type="checkbox" data-v4-field="lab.blocked" ${checked(state.blocked)}> BLOCKED</label>
          <label class="v4-field-label"><input type="checkbox" data-v4-field="lab.stunned" ${checked(state.stunned)}> STUNNED</label>
          <button type="button" data-v4-action="lab-base-attack">BASE IMPACT</button>
        </div>
        <input class="v4-scrub" data-v4-field="lab.scrub" type="range" min="0" max="${Math.max(1, lab.maxTick)}" value="${state.tick}">
        <div class="v4-lab-readout">
          TICK ${state.tick} // ${state.age.toFixed(2)}S // HP ${state.hp.toFixed(1)} // PATH ${state.pathDistance.toFixed(1)} // ${state.movementLocked ? "LOCKED" : "MOVING"} // ${state.invulnerable ? "INVULNERABLE" : "VULNERABLE"}
        </div>
        <div class="v4-lab-body">
          <div>
            <div class="v4-lab-arena" data-testid="enemy-lab-arena">
              <i class="enemy" style="left:${Math.min(94, state.pathDistance / 6)}%;top:50%;--enemy:${lab.draft.color}"></i>
              ${state.towers
                .map(
                  (tower) => `
                    <button
                      type="button"
                      class="tower ${tower.blocking ? "blocking" : ""}"
                      data-lab-tower-id="${tower.id}"
                      style="left:${tower.x / 6}%;top:${tower.y / 2.4}%"
                    >
                      <b>#${tower.id}</b>
                      <small>${Math.round(tower.hp)} HP${tower.stunTimer > 0 ? " // STUN" : ""}</small>
                    </button>
                  `,
                )
                .join("")}
              <small>CLICK TO ADD // DRAG TO MOVE // DOUBLE-CLICK TO REMOVE</small>
            </div>
            <div class="v4-lab-tower-controls">
              ${state.towers
                .map(
                  (tower) => `
                    <label class="v4-field-label">#${tower.id} HP <input type="number" min="0" max="${tower.maxHp}" value="${tower.hp}" data-v4-field="lab.tower-hp:${tower.id}"></label>
                    <label class="v4-field-label"><input type="checkbox" data-v4-field="lab.tower-blocking:${tower.id}" ${checked(tower.blocking)}> BLOCKING</label>
                    <button type="button" data-v4-action="lab-tower-remove" data-lab-tower-id="${tower.id}">REMOVE</button>
                  `,
                )
                .join("")}
            </div>
          </div>
          <aside>
            <strong>ENGINE TRACE</strong>
            ${recent.map((trace) => `<p><b>${trace.tick} // ${escapeHtml(trace.phase.toUpperCase())}</b>${escapeHtml(explainEnemyAbilityTrace(trace))}</p>`).join("") || "<small>STEP THE LAB TO BEGIN.</small>"}
          </aside>
        </div>
      </div>
    `;
    if (!keepOpen && !dialog.open) dialog.showModal();
  }

  private labAction(action: string, source: HTMLElement): void {
    if (!this.lab) return;
    if (action === "lab-close") {
      this.stopLab();
      this.root.querySelector<HTMLDialogElement>(".v4-lab-dialog")?.close();
      this.lab = null;
      return;
    }
    if (action === "lab-step") this.lab.step();
    else if (action === "lab-reset") {
      this.stopLab();
      this.lab.reset();
    } else if (action === "lab-pause") this.stopLab();
    else if (action === "lab-play") {
      this.stopLab();
      this.labTimer = window.setInterval(
        () => {
          for (let index = 0; index < this.labSpeed; index += 1) this.lab?.step();
          this.renderLab(true);
        },
        this.labSpeed === 0.5 ? 66 : 33,
      );
    } else if (action === "lab-base-attack") this.lab.command({ type: "base-attack" });
    else if (action === "lab-tower-remove") this.lab.command({ type: "tower-remove", id: Number(source.dataset["labTowerId"]) });
    this.renderLab(true);
    source.blur();
  }

  private stopLab(): void {
    if (this.labTimer !== null) window.clearInterval(this.labTimer);
    this.labTimer = null;
  }

  private pointerDown(event: PointerEvent): void {
    const tower = (event.target as Element).closest<HTMLElement>("[data-lab-tower-id]");
    if (tower) {
      this.dragTowerId = Number(tower.dataset["labTowerId"]);
      event.preventDefault();
      return;
    }
    const arena = (event.target as Element).closest<HTMLElement>(".v4-lab-arena");
    if (!arena || !this.lab) return;
    const rect = arena.getBoundingClientRect();
    this.lab.addTower(((event.clientX - rect.left) / rect.width) * 600, ((event.clientY - rect.top) / rect.height) * 240);
    this.renderLab(true);
  }

  private pointerMove(event: PointerEvent): void {
    const arena = (event.target as Element).closest<HTMLElement>(".v4-lab-arena");
    if (!arena || !this.lab || this.dragTowerId === null) return;
    const rect = arena.getBoundingClientRect();
    this.lab.command({
      type: "tower-move",
      id: this.dragTowerId,
      x: Math.max(0, Math.min(600, ((event.clientX - rect.left) / rect.width) * 600)),
      y: Math.max(0, Math.min(240, ((event.clientY - rect.top) / rect.height) * 240)),
    });
    this.renderLab(true);
  }

  private keydown(event: KeyboardEvent): void {
    const summonOpt = (event.target as Element).closest<HTMLElement>("[data-v4-action='summon-toggle-kind']");
    if (summonOpt && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      summonOpt.click();
      return;
    }
    const dialog = this.root.querySelector<HTMLDialogElement>(".v4-lab-dialog");
    if (!dialog?.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.stopLab();
      dialog.close();
      this.lab = null;
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
    if (!controls.length) return;
    event.preventDefault();
    const index = controls.indexOf(document.activeElement as HTMLElement);
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length]?.focus();
  }

  handleLabField(field: HTMLInputElement | HTMLSelectElement): boolean {
    if (!this.lab || !field.dataset["v4Field"]?.startsWith("lab.")) return false;
    const key = field.dataset["v4Field"]!.slice(4);
    if (key === "speed") this.labSpeed = Number(field.value);
    else if (key === "scrub") this.lab.scrub(Number(field.value));
    else if (key === "hp") this.lab.command({ type: "hp", value: Number(field.value) });
    else if (key === "age") this.lab.command({ type: "age", value: Number(field.value) });
    else if (key === "blocked") this.lab.command({ type: "blocked", value: (field as HTMLInputElement).checked });
    else if (key === "stunned") this.lab.command({ type: "stunned", value: (field as HTMLInputElement).checked });
    else if (key.startsWith("tower-hp:")) this.lab.command({ type: "tower-hp", id: Number(key.split(":")[1]), value: Number(field.value) });
    else if (key.startsWith("tower-blocking:")) this.lab.command({ type: "tower-blocking", id: Number(key.split(":")[1]), value: (field as HTMLInputElement).checked });
    return true;
  }

  private handleSummonSearchInput(input: HTMLInputElement): void {
    const actionId = input.dataset["actionId"] ?? "";
    const query = input.value;
    if (actionId) {
      if (query) {
        this.summonSearchQueries.set(actionId, query);
      } else {
        this.summonSearchQueries.delete(actionId);
      }
    }
    const picker = input.closest<HTMLElement>(".v4-summon-picker");
    if (!picker) return;
    const clearBtn = picker.querySelector<HTMLElement>("[data-v4-action='summon-search-clear']");
    if (clearBtn) clearBtn.hidden = !query;
    const q = query.trim().toLowerCase();
    const options = picker.querySelectorAll<HTMLElement>(".v4-summon-option");
    let matchCount = 0;
    options.forEach((opt) => {
      const name = opt.querySelector(".v4-summon-name")?.textContent?.toLowerCase() ?? "";
      const kind = opt.dataset["kind"]?.toLowerCase() ?? "";
      const matches = !q || name.includes(q) || kind.includes(q);
      opt.style.display = matches ? "" : "none";
      if (matches) matchCount++;
    });
    const noResultsEl = picker.querySelector<HTMLElement>(".v4-summon-no-results");
    if (noResultsEl) {
      noResultsEl.style.display = matchCount > 0 ? "none" : "";
    }
  }
}

