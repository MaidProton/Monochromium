import type {
  EnemyAbilityActionDefinition,
  EnemyAbilityAttackDefinition,
  EnemyAbilityCondition,
  EnemyAbilityDefinition,
  EnemyAbilityDelivery,
  EnemyAbilityHpOperand,
  EnemyAbilityRuntimeState,
  EnemyAbilityTargetState,
  EnemyAbilityTrigger,
  EnemyAbilityVisualLayer,
  EnemyAttackDefinition,
  EnemyBehaviorActionDefinition,
  EnemyDefinition,
  EnemyKind,
  EnemySummonModifiers,
  Point,
  TargetingMode,
} from "./types.ts";

export type EnemyAbilityPreset = "ranged" | "cone" | "wave" | "last-stand" | "summoner" | "regeneration" | "haste" | "phase" | "blink" | "shockwave";

export interface EnemyAbilityIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly abilityId?: string;
  readonly message: string;
}

export interface EnemyAbilityEvaluationState {
  readonly hp: number;
  readonly maxHp: number;
  readonly age: number;
  readonly pathDistance: number;
  readonly blocked: boolean;
  readonly target?: { readonly hp: number; readonly maxHp: number; readonly stunned: boolean } | null;
  readonly cooldownRemaining?: number;
  readonly uses?: number;
  readonly maxUses?: number;
}

export const NEUTRAL_SUMMON_MODIFIERS: EnemySummonModifiers = {
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
};

const abilityIdPattern = /^[a-z0-9][a-z0-9:_-]{2,79}$/i;
const colorPattern = /^#[0-9a-f]{6}$/i;
const targetingModes = new Set<TargetingMode>(["first", "last", "strongest", "weakest", "closest"]);
const visualTypes = new Set<EnemyAbilityVisualLayer["type"]>(["projectile", "beam", "explosion", "lightning", "wave", "slash"]);
const targetStates = new Set<EnemyAbilityTargetState>(["blocked", "unblocked", "target-present", "target-missing", "target-stunned", "target-not-stunned", "target-damaged", "target-full-health"]);

const bounded = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) ? Math.min(maximum, Math.max(minimum, candidate)) : fallback;
};

const whole = (value: unknown, fallback: number, minimum: number, maximum: number): number => Math.round(bounded(value, fallback, minimum, maximum));

const label = (value: unknown, fallback: string, maximum = 40): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;

const hash = (seed: string): string => {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
};

export const deterministicEnemyAbilityId = (prefix: string, seed: string): string => `${prefix}-${hash(seed)}`.slice(0, 80);

const randomId = (prefix: string): string => {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${value}`.slice(0, 80);
};

export const createEnemyAbilityId = (): string => randomId("ability");
export const createEnemyActionId = (): string => randomId("action");
export const createEnemyVisualId = (): string => randomId("visual");

const interval = (every: number): EnemyAbilityTrigger => ({ type: "interval", every, initialDelay: every });
const pathMinimum = (minimum: number): EnemyAbilityCondition => ({ type: "path-distance", minimum, maximum: null });
const unblocked = (): EnemyAbilityCondition => ({ type: "target-state", state: "unblocked" });

const attackVisual = (type: EnemyAbilityVisualLayer["type"], color: string, overrides: Partial<EnemyAbilityVisualLayer> = {}): EnemyAbilityVisualLayer => ({
  id: createEnemyVisualId(),
  type,
  color,
  size: 1,
  width: 3,
  duration: 0.4,
  speed: 360,
  startOffset: 0,
  ...overrides,
});

const attackBlock = (delivery: EnemyAbilityDelivery, maxTargets: number, visual: EnemyAbilityVisualLayer): EnemyAbilityAttackDefinition => ({
  targeting: "first",
  range: delivery.type === "radial" ? delivery.radius : 220,
  maxTargets,
  delivery,
  telegraphDuration: 0.4,
  targetLock: "activation",
  impactTime: 0.4,
  visuals: [visual],
});

const abilityBase = (name: string, trigger: EnemyAbilityTrigger): EnemyAbilityDefinition => ({
  id: createEnemyAbilityId(),
  name,
  enabled: true,
  editorMode: "basic",
  priority: 0,
  cooldown: trigger.type === "interval" ? trigger.every : 0,
  maxUses: 0,
  exclusiveGroup: null,
  trigger,
  conditions: [],
  attack: null,
  actions: [],
});

export const createEnemyAbilityPreset = (preset: EnemyAbilityPreset): EnemyAbilityDefinition => {
  if (preset === "ranged") return {
    ...abilityBase("Ranged Attack", interval(8)),
    attack: attackBlock({ type: "targeted" }, 1, attackVisual("projectile", "#ff806f")),
    actions: [{ id: createEnemyActionId(), type: "damage", delay: 0, amount: 20 }],
  };
  if (preset === "cone") return {
    ...abilityBase("Cone Attack", interval(8)),
    attack: attackBlock({ type: "cone", depth: 180, angle: 60 }, 8, attackVisual("slash", "#ff9b88", { width: 5 })),
    actions: [{ id: createEnemyActionId(), type: "damage", delay: 0, amount: 20 }],
  };
  if (preset === "wave") return {
    ...abilityBase("Wave Attack", interval(8)),
    attack: attackBlock({ type: "wave", depth: 180, width: 60 }, 16, attackVisual("wave", "#ff806f", { width: 8 })),
    actions: [{ id: createEnemyActionId(), type: "damage", delay: 0, amount: 20 }],
  };
  if (preset === "last-stand") return {
    ...abilityBase("Last Stand", { type: "hp-threshold", direction: "below", threshold: { unit: "percent", value: 25 } }),
    maxUses: 1,
    actions: [{ id: createEnemyActionId(), type: "invulnerability", delay: 0, duration: 3 }],
  };
  if (preset === "summoner") return {
    ...abilityBase("Summoner", interval(8)),
    actions: [{ id: createEnemyActionId(), type: "summon", delay: 0, count: 2, kinds: ["dummy"], modifiers: { ...NEUTRAL_SUMMON_MODIFIERS } }],
  };
  if (preset === "regeneration") return {
    ...abilityBase("Regeneration", { type: "spawn" }),
    actions: [{ id: createEnemyActionId(), type: "regeneration", delay: 0, mode: "rate", amount: 5, duration: null }],
  };
  if (preset === "haste") return {
    ...abilityBase("Haste", interval(8)),
    actions: [{ id: createEnemyActionId(), type: "haste", delay: 0, radius: 180, duration: 3, multiplier: 1.5 }],
  };
  if (preset === "phase") return {
    ...abilityBase("Phase", interval(10)),
    conditions: [pathMinimum(40), unblocked()],
    actions: [{ id: createEnemyActionId(), type: "phase", delay: 0, duration: 2 }],
  };
  if (preset === "blink") return {
    ...abilityBase("Blink", interval(8)),
    conditions: [pathMinimum(40), unblocked()],
    actions: [{ id: createEnemyActionId(), type: "blink", delay: 0, distance: 120 }],
  };
  return {
    ...abilityBase("Shockwave", interval(8)),
    conditions: [pathMinimum(80)],
    attack: attackBlock({ type: "radial", radius: 180 }, 64, attackVisual("wave", "#ff806f", { width: 10 })),
    actions: [{ id: createEnemyActionId(), type: "stun", delay: 0, duration: 2 }],
  };
};

export const cloneEnemyAbility = (ability: EnemyAbilityDefinition, freshIds = false): EnemyAbilityDefinition => ({
  ...ability,
  id: freshIds ? createEnemyAbilityId() : ability.id,
  trigger: ability.trigger.type === "hp-threshold" ? { ...ability.trigger, threshold: { ...ability.trigger.threshold } } : { ...ability.trigger },
  conditions: ability.conditions.map((condition) => condition.type === "hp"
    ? { ...condition, minimum: condition.minimum ? { ...condition.minimum } : null, maximum: condition.maximum ? { ...condition.maximum } : null }
    : { ...condition }),
  attack: ability.attack ? {
    ...ability.attack,
    delivery: { ...ability.attack.delivery },
    visuals: ability.attack.visuals.map((visual) => ({ ...visual, id: freshIds ? createEnemyVisualId() : visual.id })),
  } : null,
  actions: ability.actions.map((action) => ({ ...action, id: freshIds ? createEnemyActionId() : action.id })),
});

const hpOperand = (value: unknown, fallback: EnemyAbilityHpOperand): EnemyAbilityHpOperand => {
  const source = value && typeof value === "object" ? value as Partial<EnemyAbilityHpOperand> : {};
  const unit = source.unit === "percent" ? "percent" : "absolute";
  return { unit, value: bounded(source.value, fallback.value, 0, unit === "percent" ? 100 : 10_000_000) };
};

const nullable = (value: unknown, maximum: number): number | null => value === null || value === undefined || value === "" ? null : bounded(value, 0, 0, maximum);

const sanitizeTrigger = (value: unknown): EnemyAbilityTrigger => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (source["type"] === "spawn" || source["type"] === "blocked" || source["type"] === "stunned" || source["type"] === "attack" || source["type"] === "death") return { type: source["type"] };
  if (source["type"] === "elapsed-time") return { type: "elapsed-time", at: bounded(source["at"], 1, 0, 86_400) };
  if (source["type"] === "hp-threshold") return { type: "hp-threshold", direction: source["direction"] === "above" ? "above" : "below", threshold: hpOperand(source["threshold"], { unit: "percent", value: 25 }) };
  return { type: "interval", every: bounded(source["every"], 8, 1 / 30, 600), initialDelay: bounded(source["initialDelay"], Number(source["every"]) || 8, 0, 600) };
};

const sanitizeCondition = (value: unknown): EnemyAbilityCondition | null => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (source["type"] === "hp") return { type: "hp", minimum: source["minimum"] === null ? null : hpOperand(source["minimum"], { unit: "absolute", value: 0 }), maximum: source["maximum"] === null ? null : hpOperand(source["maximum"], { unit: "absolute", value: 0 }) };
  if (source["type"] === "age") return { type: "age", minimum: nullable(source["minimum"], 86_400), maximum: nullable(source["maximum"], 86_400) };
  if (source["type"] === "path-distance") return { type: "path-distance", minimum: nullable(source["minimum"], 1_000_000), maximum: nullable(source["maximum"], 1_000_000) };
  if (source["type"] === "target-state" && typeof source["state"] === "string" && targetStates.has(source["state"] as EnemyAbilityTargetState)) return { type: "target-state", state: source["state"] as EnemyAbilityTargetState };
  if (source["type"] === "cooldown-ready" || source["type"] === "uses-remaining") return { type: source["type"] };
  return null;
};

const sanitizeVisual = (value: unknown, seed: string): EnemyAbilityVisualLayer | null => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof source["type"] !== "string" || !visualTypes.has(source["type"] as EnemyAbilityVisualLayer["type"])) return null;
  return {
    id: typeof source["id"] === "string" && abilityIdPattern.test(source["id"]) ? source["id"] : deterministicEnemyAbilityId("visual", seed),
    type: source["type"] as EnemyAbilityVisualLayer["type"],
    color: typeof source["color"] === "string" && colorPattern.test(source["color"]) ? source["color"].toLowerCase() : "#ff806f",
    size: bounded(source["size"], 1, 0.1, 10),
    width: bounded(source["width"], 3, 0.5, 100),
    duration: bounded(source["duration"], 0.4, 0.05, 10),
    speed: bounded(source["speed"], 360, 40, 2_000),
    startOffset: bounded(source["startOffset"], 0, 0, 600),
  };
};

const sanitizeDelivery = (value: unknown): EnemyAbilityDelivery => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (source["type"] === "cone") return { type: "cone", depth: bounded(source["depth"], 180, 4, 2_000), angle: bounded(source["angle"], 60, 5, 180) };
  if (source["type"] === "wave") return { type: "wave", depth: bounded(source["depth"], 180, 4, 2_000), width: bounded(source["width"], 60, 4, 1_000) };
  if (source["type"] === "radial") return { type: "radial", radius: bounded(source["radius"], 180, 4, 2_000) };
  return { type: "targeted" };
};

const sanitizeAttack = (value: unknown, seed: string): EnemyAbilityAttackDefinition | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const visuals = Array.isArray(source["visuals"])
    ? source["visuals"].slice(0, 16).flatMap((visual, index) => sanitizeVisual(visual, `${seed}:${index}`) ?? [])
    : [];
  const targeting = typeof source["targeting"] === "string" && targetingModes.has(source["targeting"] as TargetingMode) ? source["targeting"] as TargetingMode : "first";
  const delivery = sanitizeDelivery(source["delivery"]);
  return {
    targeting,
    range: bounded(source["range"], delivery.type === "radial" ? delivery.radius : 220, 4, 2_000),
    maxTargets: whole(source["maxTargets"], 1, 1, 64),
    delivery,
    telegraphDuration: bounded(source["telegraphDuration"], 0.4, 0, 30),
    targetLock: source["targetLock"] === "impact" ? "impact" : "activation",
    impactTime: bounded(source["impactTime"], 0.4, 0, 600),
    visuals,
  };
};

const sanitizeModifiers = (value: unknown): EnemySummonModifiers => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    hitCashMultiplier: bounded(source["hitCashMultiplier"], 0, 0, 10),
    hpMultiplier: bounded(source["hpMultiplier"], 1, 0, 10),
    shieldMultiplier: bounded(source["shieldMultiplier"], 1, 0, 10),
    speedMultiplier: bounded(source["speedMultiplier"], 1, 0, 10),
    damageMultiplier: bounded(source["damageMultiplier"], 1, 0, 10),
    attackIntervalMultiplier: bounded(source["attackIntervalMultiplier"], 1, 0.1, 10),
    coreDamageMultiplier: bounded(source["coreDamageMultiplier"], 1, 0, 10),
    defenseBonus: bounded(source["defenseBonus"], 0, -1_000_000, 1_000_000),
    protectionBonus: whole(source["protectionBonus"], 0, -999, 999),
    armorBonus: bounded(source["armorBonus"], 0, -1, 1),
    superarmorBonus: bounded(source["superarmorBonus"], 0, -1, 1),
  };
};

const sanitizeAction = (value: unknown, seed: string): EnemyAbilityActionDefinition | null => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = source["type"];
  const id = typeof source["id"] === "string" && abilityIdPattern.test(source["id"]) ? source["id"] : deterministicEnemyAbilityId("action", seed);
  const delay = bounded(source["delay"], 0, 0, 600);
  if (type === "damage") return { id, type, delay, amount: bounded(source["amount"], 20, 0, 1_000_000) };
  if (type === "stun") return { id, type, delay, duration: bounded(source["duration"], 2, 0, 60) };
  if (type === "summon") return { id, type, delay, count: whole(source["count"], 2, 1, 100), kinds: Array.isArray(source["kinds"]) ? source["kinds"].filter((kind): kind is EnemyKind => typeof kind === "string").slice(0, 64) : ["dummy"], modifiers: sanitizeModifiers(source["modifiers"]) };
  if (type === "regeneration") return { id, type, delay, mode: source["mode"] === "total" ? "total" : "rate", amount: bounded(source["amount"], 5, 0, 10_000_000), duration: source["duration"] === null ? null : bounded(source["duration"], 5, 0.1, 600) };
  if (type === "movement-lock") return { id, type, delay, duration: bounded(source["duration"], 5, 0, 600), waves: whole(source["waves"], 0, 0, 999) };
  if (type === "blink") return { id, type, delay, distance: bounded(source["distance"], 120, 5, 1_000) };
  if (type === "invulnerability") return { id, type, delay, duration: bounded(source["duration"], 3, 0.1, 600) };
  if (type === "stat-change") return { id, type, delay, duration: bounded(source["duration"], 5, 0.1, 600), speedMultiplier: bounded(source["speedMultiplier"], 1, 0, 10), damageMultiplier: bounded(source["damageMultiplier"], 1, 0, 10) };
  if (type === "haste") return { id, type, delay, radius: bounded(source["radius"], 180, 20, 1_000), duration: bounded(source["duration"], 3, 0.1, 60), multiplier: bounded(source["multiplier"], 1.5, 1, 5) };
  if (type === "drain") return { id, type, delay, damage: bounded(source["damage"], 10, 0, 1_000_000), healingPerTarget: bounded(source["healingPerTarget"], 20, 0, 1_000_000) };
  if (type === "phase") return { id, type, delay, duration: bounded(source["duration"], 2, 0.1, 60) };
  return null;
};

export const sanitizeEnemyAbility = (value: unknown, index = 0, issues: EnemyAbilityIssue[] = [], path = `abilities[${index}]`): EnemyAbilityDefinition | null => {
  if (!value || typeof value !== "object") {
    issues.push({ code: "ability-malformed", severity: "error", path, message: "Ability is not an object and was skipped." });
    return null;
  }
  const source = value as Record<string, unknown>;
  const id = typeof source["id"] === "string" && abilityIdPattern.test(source["id"]) ? source["id"] : deterministicEnemyAbilityId("ability", `${index}:${String(source["name"] ?? "ability")}`);
  const actions = Array.isArray(source["actions"])
    ? source["actions"].slice(0, 32).flatMap((action, actionIndex) => {
      const sanitized = sanitizeAction(action, `${id}:${actionIndex}`);
      if (sanitized) return [sanitized];
      issues.push({ code: "action-malformed", severity: "warning", path: `${path}.actions[${actionIndex}]`, abilityId: id, message: "Unknown action was skipped during import." });
      return [];
    })
    : [];
  if (actions.length === 0) {
    issues.push({ code: "ability-empty", severity: "error", path: `${path}.actions`, abilityId: id, message: "Ability has no usable actions and was skipped." });
    return null;
  }
  const conditions = Array.isArray(source["conditions"])
    ? source["conditions"].slice(0, 16).flatMap((condition, conditionIndex) => {
      const sanitized = sanitizeCondition(condition);
      if (sanitized) return [sanitized];
      issues.push({ code: "condition-malformed", severity: "warning", path: `${path}.conditions[${conditionIndex}]`, abilityId: id, message: "Unknown condition was skipped during import." });
      return [];
    })
    : [];
  return {
    id,
    name: label(source["name"], `Ability ${index + 1}`),
    enabled: source["enabled"] !== false,
    editorMode: source["editorMode"] === "advanced" ? "advanced" : "basic",
    priority: whole(source["priority"], 0, -999, 999),
    cooldown: bounded(source["cooldown"], 0, 0, 600),
    maxUses: whole(source["maxUses"], 0, 0, 999),
    exclusiveGroup: typeof source["exclusiveGroup"] === "string" && source["exclusiveGroup"].trim() ? source["exclusiveGroup"].trim().slice(0, 40) : null,
    trigger: sanitizeTrigger(source["trigger"]),
    conditions,
    attack: sanitizeAttack(source["attack"], id),
    actions,
  };
};

export const enemyAbilityHpValue = (operand: EnemyAbilityHpOperand, maxHp: number): number => operand.unit === "percent" ? maxHp * operand.value / 100 : operand.value;

export const isEnemyAbilityHpPastThreshold = (trigger: Extract<EnemyAbilityTrigger, { type: "hp-threshold" }>, hp: number, maxHp: number): boolean => {
  const threshold = enemyAbilityHpValue(trigger.threshold, maxHp);
  return trigger.direction === "below" ? hp <= threshold : hp >= threshold;
};

export const enemyAbilityConditionsMatch = (conditions: readonly EnemyAbilityCondition[], state: EnemyAbilityEvaluationState): boolean => conditions.every((condition) => {
  if (condition.type === "hp") {
    const minimum = condition.minimum ? enemyAbilityHpValue(condition.minimum, state.maxHp) : null;
    const maximum = condition.maximum ? enemyAbilityHpValue(condition.maximum, state.maxHp) : null;
    return (minimum === null || state.hp >= minimum) && (maximum === null || state.hp <= maximum);
  }
  if (condition.type === "age") return (condition.minimum === null || state.age >= condition.minimum) && (condition.maximum === null || state.age <= condition.maximum);
  if (condition.type === "path-distance") return (condition.minimum === null || state.pathDistance >= condition.minimum) && (condition.maximum === null || state.pathDistance <= condition.maximum);
  if (condition.type === "cooldown-ready") return (state.cooldownRemaining ?? 0) <= 0;
  if (condition.type === "uses-remaining") return (state.maxUses ?? 0) <= 0 || (state.uses ?? 0) < (state.maxUses ?? 0);
  if (condition.state === "blocked") return state.blocked;
  if (condition.state === "unblocked") return !state.blocked;
  if (condition.state === "target-present") return Boolean(state.target);
  if (condition.state === "target-missing") return !state.target;
  if (condition.state === "target-stunned") return Boolean(state.target?.stunned);
  if (condition.state === "target-not-stunned") return Boolean(state.target && !state.target.stunned);
  if (condition.state === "target-damaged") return Boolean(state.target && state.target.hp < state.target.maxHp);
  return Boolean(state.target && state.target.hp >= state.target.maxHp);
});

const conditionBoundsConflict = (condition: EnemyAbilityCondition, maxHp: number): boolean => {
  if (condition.type === "hp") return condition.minimum !== null && condition.maximum !== null && enemyAbilityHpValue(condition.minimum, maxHp) > enemyAbilityHpValue(condition.maximum, maxHp);
  if (condition.type === "age" || condition.type === "path-distance") return condition.minimum !== null && condition.maximum !== null && condition.minimum > condition.maximum;
  return false;
};

export const validateEnemyAbilities = (abilities: readonly EnemyAbilityDefinition[], options: { readonly maxHp: number; readonly knownEnemyKinds?: ReadonlySet<string>; readonly path?: string } ): EnemyAbilityIssue[] => {
  const issues: EnemyAbilityIssue[] = [];
  const ids = new Set<string>();
  const actionIds = new Set<string>();
  const visualIds = new Set<string>();
  const path = options.path ?? "abilities";
  const numericError = (value: unknown, issuePath: string, abilityId: string, code = "value-malformed"): boolean => {
    if (typeof value === "number" && Number.isFinite(value)) return false;
    issues.push({ code, severity: "error", path: issuePath, abilityId, message: "Value must be a finite number." }); return true;
  };
  if (abilities.length > 64) issues.push({ code: "ability-limit", severity: "error", path, message: "An enemy may contain at most 64 abilities." });
  abilities.forEach((ability, index) => {
    const abilityPath = `${path}[${index}]`;
    if (!abilityIdPattern.test(ability.id)) issues.push({ code: "ability-id-malformed", severity: "error", path: `${abilityPath}.id`, abilityId: ability.id, message: "Ability id is not a safe stable identifier." });
    if (ids.has(ability.id)) issues.push({ code: "ability-id-duplicate", severity: "error", path: `${abilityPath}.id`, abilityId: ability.id, message: `Ability id "${ability.id}" is duplicated.` });
    ids.add(ability.id);
    if (!ability.enabled) issues.push({ code: "ability-unused", severity: "warning", path: `${abilityPath}.enabled`, abilityId: ability.id, message: "Disabled ability will not run." });
    numericError(ability.priority, `${abilityPath}.priority`, ability.id); numericError(ability.cooldown, `${abilityPath}.cooldown`, ability.id); numericError(ability.maxUses, `${abilityPath}.maxUses`, ability.id);
    if (ability.cooldown < 0 || ability.maxUses < 0) issues.push({ code: "ability-value-unsafe", severity: "error", path: abilityPath, abilityId: ability.id, message: "Cooldown and maximum uses cannot be negative." });
    const firstActivation = ability.trigger.type === "interval" ? ability.trigger.initialDelay : ability.trigger.type === "elapsed-time" ? ability.trigger.at : 0;
    if (ability.cooldown > 120 || firstActivation > 120) issues.push({ code: "ability-excessive-cooldown", severity: "warning", path: abilityPath, abilityId: ability.id, message: "This ability may not activate during a typical enemy lifetime." });
    if (ability.conditions.length > 16) issues.push({ code: "condition-limit", severity: "error", path: `${abilityPath}.conditions`, abilityId: ability.id, message: "An ability may contain at most 16 conditions." });
    if (ability.actions.length > 32) issues.push({ code: "action-limit", severity: "error", path: `${abilityPath}.actions`, abilityId: ability.id, message: "An ability may contain at most 32 actions." });
    if (ability.trigger.type === "interval") { numericError(ability.trigger.every, `${abilityPath}.trigger.every`, ability.id, "trigger-timing-malformed"); numericError(ability.trigger.initialDelay, `${abilityPath}.trigger.initialDelay`, ability.id, "trigger-timing-malformed"); if (ability.trigger.every < 1 / 30 || ability.trigger.initialDelay < 0) issues.push({ code: "trigger-timing-unsafe", severity: "error", path: `${abilityPath}.trigger`, abilityId: ability.id, message: "Interval timing is outside fixed-tick safety bounds." }); }
    if (ability.trigger.type === "elapsed-time") numericError(ability.trigger.at, `${abilityPath}.trigger.at`, ability.id, "trigger-timing-malformed");
    if (ability.trigger.type === "hp-threshold") numericError(ability.trigger.threshold.value, `${abilityPath}.trigger.threshold.value`, ability.id, "threshold-malformed");
    if (ability.actions.length === 0) issues.push({ code: "ability-empty", severity: "error", path: `${abilityPath}.actions`, abilityId: ability.id, message: "Ability requires at least one action." });
    if (ability.attack) {
      numericError(ability.attack.range, `${abilityPath}.attack.range`, ability.id, "attack-geometry-malformed"); numericError(ability.attack.maxTargets, `${abilityPath}.attack.maxTargets`, ability.id, "attack-geometry-malformed"); numericError(ability.attack.telegraphDuration, `${abilityPath}.attack.telegraphDuration`, ability.id, "attack-timing-malformed"); numericError(ability.attack.impactTime, `${abilityPath}.attack.impactTime`, ability.id, "attack-timing-malformed");
      if (ability.attack.range <= 0 || ability.attack.maxTargets < 1 || ability.attack.maxTargets > 64 || ability.attack.telegraphDuration < 0 || ability.attack.impactTime < 0) issues.push({ code: "attack-geometry-unsafe", severity: "error", path: `${abilityPath}.attack`, abilityId: ability.id, message: "Attack timing or geometry is outside safe bounds." });
      if (ability.attack.visuals.length > 16) issues.push({ code: "visual-limit", severity: "error", path: `${abilityPath}.attack.visuals`, abilityId: ability.id, message: "An attack may contain at most 16 visual layers." });
      if (ability.attack.delivery.type === "cone") { numericError(ability.attack.delivery.depth, `${abilityPath}.attack.delivery.depth`, ability.id, "attack-geometry-malformed"); numericError(ability.attack.delivery.angle, `${abilityPath}.attack.delivery.angle`, ability.id, "attack-geometry-malformed"); }
      if (ability.attack.delivery.type === "wave") { numericError(ability.attack.delivery.depth, `${abilityPath}.attack.delivery.depth`, ability.id, "attack-geometry-malformed"); numericError(ability.attack.delivery.width, `${abilityPath}.attack.delivery.width`, ability.id, "attack-geometry-malformed"); }
      if (ability.attack.delivery.type === "radial") numericError(ability.attack.delivery.radius, `${abilityPath}.attack.delivery.radius`, ability.id, "attack-geometry-malformed");
      ability.attack.visuals.forEach((visual, visualIndex) => {
        if (visualIds.has(visual.id)) issues.push({ code: "visual-id-duplicate", severity: "error", path: `${abilityPath}.attack.visuals[${visualIndex}].id`, abilityId: ability.id, message: `Visual id "${visual.id}" is duplicated.` });
        visualIds.add(visual.id);
        [visual.size, visual.width, visual.duration, visual.speed, visual.startOffset].forEach((value, fieldIndex) => numericError(value, `${abilityPath}.attack.visuals[${visualIndex}].${["size", "width", "duration", "speed", "startOffset"][fieldIndex]}`, ability.id, "visual-value-malformed"));
        if (!colorPattern.test(visual.color) || visual.size <= 0 || visual.width <= 0 || visual.duration <= 0 || visual.speed <= 0 || visual.startOffset < 0) issues.push({ code: "visual-value-unsafe", severity: "error", path: `${abilityPath}.attack.visuals[${visualIndex}]`, abilityId: ability.id, message: "Visual layer contains an unsafe color, size, duration, speed, or offset." });
      });
    }
    if (ability.attack && ability.attack.impactTime < ability.attack.telegraphDuration) issues.push({ code: "attack-timing", severity: "error", path: `${abilityPath}.attack.impactTime`, abilityId: ability.id, message: "Impact time cannot precede the telegraph." });
    const targetActions = ability.actions.filter((action) => action.type === "damage" || action.type === "stun" || action.type === "drain");
    if (targetActions.length > 0 && !ability.attack) issues.push({ code: "attack-missing", severity: "error", path: `${abilityPath}.attack`, abilityId: ability.id, message: "Damage, stun, and drain actions require an attack block." });
    if (ability.attack && targetActions.every((action) => action.type === "damage" && action.amount <= 0 || action.type === "stun" && action.duration <= 0 || action.type === "drain" && action.damage <= 0 && action.healingPerTarget <= 0)) issues.push({ code: "attack-ineffective", severity: "warning", path: `${abilityPath}.actions`, abilityId: ability.id, message: "Attack has no effective damage, stun, or drain." });
    if (ability.attack && (ability.attack.delivery.type === "cone" || ability.attack.delivery.type === "wave") && ability.attack.delivery.depth > ability.attack.range) issues.push({ code: "attack-range-clipped", severity: "warning", path: `${abilityPath}.attack`, abilityId: ability.id, message: "Delivery depth extends beyond range and will be clipped." });
    const targetStatesInAbility = new Set(ability.conditions.flatMap((condition) => condition.type === "target-state" ? [condition.state] : []));
    const targetConflict = targetStatesInAbility.has("blocked") && targetStatesInAbility.has("unblocked") || targetStatesInAbility.has("target-present") && targetStatesInAbility.has("target-missing") || targetStatesInAbility.has("target-stunned") && targetStatesInAbility.has("target-not-stunned") || targetStatesInAbility.has("target-damaged") && targetStatesInAbility.has("target-full-health");
    if (targetConflict || ability.conditions.some((condition) => conditionBoundsConflict(condition, options.maxHp))) issues.push({ code: "condition-conflict", severity: "warning", path: `${abilityPath}.conditions`, abilityId: ability.id, message: "Condition bounds conflict, so this ability cannot activate." });
    if (ability.trigger.type === "hp-threshold" && ability.trigger.direction === "above" && enemyAbilityHpValue(ability.trigger.threshold, options.maxHp) > options.maxHp) issues.push({ code: "threshold-unreachable", severity: "warning", path: `${abilityPath}.trigger`, abilityId: ability.id, message: "HP threshold is above this enemy's maximum HP." });
    if (ability.trigger.type === "death" && ability.actions.every((action) => ["regeneration", "movement-lock", "blink", "invulnerability", "stat-change", "phase"].includes(action.type))) issues.push({ code: "death-action-ineffective", severity: "warning", path: `${abilityPath}.actions`, abilityId: ability.id, message: "Death ability contains only self-directed actions that cannot affect a removed enemy." });
    if (ability.exclusiveGroup && ability.actions.some((action) => action.type === "regeneration" && action.duration === null)) issues.push({ code: "exclusive-persistent", severity: "warning", path: `${abilityPath}.exclusiveGroup`, abilityId: ability.id, message: "Persistent regeneration holds its exclusive group until death." });
    ability.actions.forEach((action, actionIndex) => {
      if (actionIds.has(action.id)) issues.push({ code: "action-id-duplicate", severity: "error", path: `${abilityPath}.actions[${actionIndex}].id`, abilityId: ability.id, message: `Action id "${action.id}" is duplicated.` });
      actionIds.add(action.id);
      numericError(action.delay, `${abilityPath}.actions[${actionIndex}].delay`, ability.id, "action-value-malformed");
      if (action.delay < 0) issues.push({ code: "action-delay-unsafe", severity: "error", path: `${abilityPath}.actions[${actionIndex}].delay`, abilityId: ability.id, message: "Action delay cannot be negative." });
      Object.entries(action).forEach(([key, value]) => { if (key !== "delay" && typeof value === "number") numericError(value, `${abilityPath}.actions[${actionIndex}].${key}`, ability.id, "action-value-malformed"); });
      if (action.type === "summon") action.kinds.forEach((kind, kindIndex) => {
        if (options.knownEnemyKinds && !options.knownEnemyKinds.has(kind)) issues.push({ code: "summon-reference-missing", severity: "warning", path: `${abilityPath}.actions[${actionIndex}].kinds[${kindIndex}]`, abilityId: ability.id, message: `Summoned enemy "${kind}" is not currently available.` });
      });
    });
  });
  return issues;
};

const hpCondition = (minimum: number | null, maximum: number | null): EnemyAbilityCondition | null => minimum === null && maximum === null ? null : {
  type: "hp",
  minimum: minimum === null ? null : { unit: "absolute", value: minimum },
  maximum: maximum === null ? null : { unit: "absolute", value: maximum },
};
const ageCondition = (minimum: number | null, maximum: number | null): EnemyAbilityCondition | null => minimum === null && maximum === null ? null : { type: "age", minimum, maximum };

const legacyVisuals = (attack: EnemyAttackDefinition, seed: string): EnemyAbilityVisualLayer[] => attack.visuals.map((visual, index) => ({
  ...visual,
  id: deterministicEnemyAbilityId("visual", `${seed}:${index}`),
  startOffset: 0,
}));

const legacyAttackBlock = (attack: EnemyAttackDefinition): EnemyAbilityAttackDefinition => ({
  targeting: attack.targeting,
  range: attack.range,
  maxTargets: attack.maxTargets,
  delivery: attack.delivery === "forward"
    ? { type: "cone", depth: attack.depth, angle: attack.angle }
    : attack.delivery === "wave"
      ? { type: "wave", depth: attack.depth, width: attack.width }
      : { type: "targeted" },
  telegraphDuration: 0,
  targetLock: "activation",
  impactTime: 0,
  visuals: legacyVisuals(attack, attack.id),
});

const legacyRuleAction = (action: EnemyBehaviorActionDefinition, seed: string): EnemyAbilityActionDefinition[] => {
  const id = deterministicEnemyAbilityId("action", seed);
  if (action.type === "stop") return [{ id, type: "movement-lock", delay: action.delay, duration: action.duration, waves: 0 }];
  if (action.type === "invulnerable") return [{ id, type: "invulnerability", delay: action.delay, duration: action.duration }];
  if (action.type === "regenerate") return [{ id, type: "regeneration", delay: action.delay, mode: "total", amount: action.amount, duration: action.duration }];
  if (action.type === "stat-change") return [{ id, type: "stat-change", delay: action.delay, duration: action.duration, speedMultiplier: action.speedMultiplier, damageMultiplier: action.damageMultiplier }];
  if (action.type === "blink") return [{ id, type: "blink", delay: action.delay, distance: action.distance }];
  return [
    { id: `${id}-damage`.slice(0, 80), type: "damage", delay: action.delay, amount: action.damage },
    { id: `${id}-stun`.slice(0, 80), type: "stun", delay: action.delay, duration: action.stunDuration },
  ];
};

const legacyAbility = (kind: EnemyKind, suffix: string, name: string, trigger: EnemyAbilityTrigger, actions: readonly EnemyAbilityActionDefinition[], overrides: Partial<EnemyAbilityDefinition> = {}): EnemyAbilityDefinition => ({
  id: deterministicEnemyAbilityId("ability", `${kind}:${suffix}`),
  name,
  enabled: true,
  editorMode: "advanced",
  priority: 0,
  cooldown: trigger.type === "interval" ? trigger.every : 0,
  maxUses: 0,
  exclusiveGroup: null,
  trigger,
  conditions: [],
  attack: null,
  actions,
  ...overrides,
});

const compiledLegacyAbilities = new WeakMap<EnemyDefinition, readonly EnemyAbilityDefinition[]>();

/** Compiles official legacy fields and custom v4 definitions into one runtime representation. */
export const normalizeEnemyAbilities = (definition: EnemyDefinition): readonly EnemyAbilityDefinition[] => {
  if (definition.abilities) return definition.abilities;
  const cached = compiledLegacyAbilities.get(definition);
  if (cached) return cached;
  const result: EnemyAbilityDefinition[] = [];
  if (definition.summon) result.push(legacyAbility(definition.kind, "summon", "Summon", interval(definition.summon.interval), [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:summon`), type: "summon", delay: 0, count: definition.summon.count, kinds: definition.summon.kinds, modifiers: definition.summon.modifiers ?? NEUTRAL_SUMMON_MODIFIERS }]));
  if (definition.shockwave) result.push(legacyAbility(definition.kind, "shockwave", "Shockwave", interval(definition.shockwave.interval), [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:shockwave`), type: "stun", delay: 0, duration: definition.shockwave.stunDuration }], { conditions: [pathMinimum(80)], attack: { targeting: "closest", range: definition.shockwave.radius, maxTargets: 64, delivery: { type: "radial", radius: definition.shockwave.radius }, telegraphDuration: 0, targetLock: "impact", impactTime: 0, visuals: [] } }));
  if (definition.regeneration) result.push(legacyAbility(definition.kind, "regeneration", "Regeneration", { type: "spawn" }, [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:regeneration`), type: "regeneration", delay: 0, mode: "rate", amount: definition.regeneration.rate, duration: null }]));
  if (definition.hastePulse) result.push(legacyAbility(definition.kind, "haste", "Haste", interval(definition.hastePulse.interval), [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:haste`), type: "haste", delay: 0, radius: definition.hastePulse.radius, duration: definition.hastePulse.duration, multiplier: definition.hastePulse.multiplier }], { conditions: [pathMinimum(40)] }));
  if (definition.drain) result.push(legacyAbility(definition.kind, "drain", "Drain", interval(definition.drain.interval), [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:drain`), type: "drain", delay: 0, damage: definition.drain.damage, healingPerTarget: definition.drain.healingPerTower }], { conditions: [pathMinimum(40)], attack: { targeting: "closest", range: definition.drain.radius, maxTargets: 64, delivery: { type: "radial", radius: definition.drain.radius }, telegraphDuration: 0, targetLock: "impact", impactTime: 0, visuals: [] } }));
  if (definition.phase) result.push(legacyAbility(definition.kind, "phase", "Phase", interval(definition.phase.interval), [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:phase`), type: "phase", delay: 0, duration: definition.phase.duration }], { conditions: [pathMinimum(40), unblocked()] }));
  if (definition.blink) result.push(legacyAbility(definition.kind, "blink", "Blink", interval(definition.blink.interval), [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:blink`), type: "blink", delay: 0, distance: definition.blink.distance }], { conditions: [pathMinimum(40), unblocked()] }));
  if (definition.timeLock || definition.waveLock) {
    const distance = Math.max(definition.timeLock?.distance ?? 0, definition.waveLock?.distance ?? 0);
    result.push(legacyAbility(definition.kind, "movement-lock", "Movement Lock", { type: "interval", every: 1 / 30, initialDelay: 0 }, [{ id: deterministicEnemyAbilityId("action", `${definition.kind}:movement-lock`), type: "movement-lock", delay: 0, duration: definition.timeLock?.duration ?? 0, waves: definition.waveLock?.waves ?? 0 }], { maxUses: 1, cooldown: 0, conditions: [pathMinimum(distance)] }));
  }
  definition.attacks?.forEach((attack) => {
    const conditions = [hpCondition(attack.minHp, attack.maxHp), ageCondition(attack.minAliveTime, attack.maxAliveTime)].filter((condition): condition is EnemyAbilityCondition => condition !== null);
    result.push(legacyAbility(definition.kind, attack.id, attack.name, { type: "interval", every: attack.cooldown, initialDelay: attack.cooldown }, attack.effects.map((effect, index) => effect.type === "damage"
      ? { id: deterministicEnemyAbilityId("action", `${attack.id}:${index}`), type: "damage", delay: 0, amount: effect.amount }
      : { id: deterministicEnemyAbilityId("action", `${attack.id}:${index}`), type: "stun", delay: 0, duration: effect.duration }), { id: attack.id, cooldown: attack.cooldown, maxUses: attack.maxUses, conditions, attack: legacyAttackBlock(attack) }));
  });
  definition.behaviorRules?.forEach((rule) => {
    const conditions = [hpCondition(rule.minHp, rule.maxHp), ageCondition(rule.minAliveTime, rule.maxAliveTime)].filter((condition): condition is EnemyAbilityCondition => condition !== null);
    const stomps = rule.actions.map((action, index) => ({ action, index })).filter((item): item is { action: Extract<EnemyBehaviorActionDefinition, { type: "stomp" }>; index: number } => item.action.type === "stomp");
    const firstStomp = stomps[0];
    const primaryActions = rule.actions.flatMap((action, index) => action.type === "stomp" && firstStomp && index !== firstStomp.index ? [] : legacyRuleAction(action, `${rule.id}:${index}`));
    if (primaryActions.length > 0) result.push(legacyAbility(definition.kind, rule.id, rule.name, { type: "interval", every: Math.max(1 / 30, rule.cooldown), initialDelay: 0 }, primaryActions, {
      id: rule.id, cooldown: rule.cooldown, maxUses: rule.maxUses, conditions,
      attack: firstStomp ? { targeting: "closest", range: firstStomp.action.radius, maxTargets: 64, delivery: { type: "radial", radius: firstStomp.action.radius }, telegraphDuration: 0, targetLock: "impact", impactTime: 0, visuals: [] } : null,
    }));
    stomps.slice(1).forEach(({ action, index }, siblingIndex) => result.push(legacyAbility(definition.kind, `${rule.id}:stomp:${siblingIndex + 2}`, `${rule.name} // Stomp ${siblingIndex + 2}`, { type: "interval", every: Math.max(1 / 30, rule.cooldown), initialDelay: 0 }, legacyRuleAction(action, `${rule.id}:${index}`), {
      id: deterministicEnemyAbilityId("ability", `${rule.id}:stomp:${siblingIndex + 2}`), cooldown: rule.cooldown, maxUses: rule.maxUses, conditions,
      attack: { targeting: "closest", range: action.radius, maxTargets: 64, delivery: { type: "radial", radius: action.radius }, telegraphDuration: 0, targetLock: "impact", impactTime: 0, visuals: [] },
    })));
  });
  compiledLegacyAbilities.set(definition, result);
  return result;
};

const triggerSummary = (trigger: EnemyAbilityTrigger): string => {
  if (trigger.type === "spawn") return "When this enemy spawns";
  if (trigger.type === "elapsed-time") return `After ${trigger.at}s alive`;
  if (trigger.type === "interval") return `Every ${trigger.every}s`;
  if (trigger.type === "hp-threshold") return `When HP crosses ${trigger.direction} ${trigger.threshold.value}${trigger.threshold.unit === "percent" ? "%" : " HP"}`;
  if (trigger.type === "blocked") return "When blocked";
  if (trigger.type === "stunned") return "When stunned";
  if (trigger.type === "attack") return "After a base attack lands";
  return "On death";
};

const actionSummary = (action: EnemyAbilityActionDefinition): string => {
  if (action.type === "damage") return `deal ${action.amount} damage`;
  if (action.type === "stun") return `stun for ${action.duration}s`;
  if (action.type === "summon") return `summon ${action.count} ${action.kinds.join("/")}`;
  if (action.type === "regeneration") return action.mode === "rate" ? `regenerate ${action.amount} HP/s${action.duration === null ? "" : ` for ${action.duration}s`}` : `regenerate ${action.amount} HP over ${action.duration ?? 0}s`;
  if (action.type === "movement-lock") return `lock movement${action.duration > 0 ? ` for ${action.duration}s` : ""}${action.waves > 0 ? ` for ${action.waves} wave(s)` : ""}`;
  if (action.type === "blink") return `blink ${action.distance} path units`;
  if (action.type === "invulnerability") return `become invulnerable for ${action.duration}s`;
  if (action.type === "stat-change") return `change speed ×${action.speedMultiplier} and damage ×${action.damageMultiplier} for ${action.duration}s`;
  if (action.type === "haste") return `haste nearby enemies ×${action.multiplier} for ${action.duration}s`;
  if (action.type === "drain") return `drain ${action.damage} damage and heal ${action.healingPerTarget} per target`;
  return `phase for ${action.duration}s`;
};

export const summarizeEnemyAbility = (ability: EnemyAbilityDefinition): string => `${triggerSummary(ability.trigger)}, ${ability.actions.map(actionSummary).join(", then ")}.`;

export const enemyAbilityTimeline = (ability: EnemyAbilityDefinition): readonly { readonly at: number; readonly label: string }[] => [
  ...(ability.attack ? [{ at: 0, label: "Telegraph" }, { at: ability.attack.impactTime, label: "Impact" }] : []),
  ...ability.actions.map((action) => ({ at: (ability.attack && (action.type === "damage" || action.type === "stun" || action.type === "drain") ? ability.attack.impactTime : 0) + action.delay, label: actionSummary(action) })),
].sort((left, right) => left.at - right.at || left.label.localeCompare(right.label));

export const ENEMY_ABILITY_TICK_HZ = 30;

export type EnemyAbilitySignal = EnemyAbilityRuntimeState["signals"][number];

export interface EnemyAbilityEngineTarget {
  readonly id: number;
  readonly position: Point;
  readonly hp: number;
  readonly maxHp: number;
  readonly stunned: boolean;
  readonly pathDistance: number;
}

export interface EnemyAbilityEngineSource {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly hp: number;
  readonly maxHp: number;
  readonly age: number;
  readonly pathDistance: number;
  readonly blocked: boolean;
  readonly position: Point;
  readonly direction: Point;
  readonly selectedTarget: EnemyAbilityEngineTarget | null;
}

export interface EnemyAbilityPresentationState {
  readonly movementLocked: boolean;
  readonly movementLockWaves: number;
  readonly invulnerable: boolean;
  readonly phased: boolean;
  readonly speedMultiplier: number;
  readonly damageMultiplier: number;
}

export type EnemyAbilityTraceCode =
  | "triggered"
  | "suppressed"
  | "telegraph"
  | "target-locked"
  | "impact"
  | "action"
  | "action-ineffective"
  | "complete";

export interface EnemyAbilityTraceEvent {
  readonly tick: number;
  readonly code: EnemyAbilityTraceCode;
  readonly phase: "trigger" | "telegraph" | "target-lock" | "impact" | "action" | "complete";
  readonly sourceId: number;
  readonly abilityId: string;
  readonly actionId?: string;
  readonly targetIds: readonly number[];
  readonly position: Point;
  readonly message: string;
}

/** The ability engine knows rules and geometry; adapters own game entities and side effects. */
export interface EnemyAbilityWorldAdapter {
  readonly readSource: () => EnemyAbilityEngineSource | null;
  readonly enumerateTargets: () => readonly EnemyAbilityEngineTarget[];
  readonly isKnownEnemyKind: (kind: EnemyKind) => boolean;
  readonly damageTarget: (targetId: number, amount: number) => boolean;
  readonly stunTarget: (targetId: number, duration: number) => boolean;
  readonly summon: (kind: EnemyKind, modifiers: EnemySummonModifiers, offset: number) => void;
  readonly healSource: (amount: number) => number;
  readonly blinkSource: (distance: number) => void;
  readonly hasteNearby: (radius: number, duration: number, multiplier: number) => number;
  readonly projectSourceState: (state: EnemyAbilityPresentationState) => void;
  readonly onLifecycle?: (event: EnemyAbilityTraceEvent, ability: EnemyAbilityDefinition, action?: EnemyAbilityActionDefinition) => void;
}

interface ScheduledEnemyAbilityAction {
  readonly sourceId: number;
  readonly abilityId: string;
  readonly ability: EnemyAbilityDefinition;
  readonly action: EnemyAbilityActionDefinition;
  readonly dueTick: number;
  readonly targetIds: readonly number[];
  readonly capturedSource: EnemyAbilityEngineSource;
  readonly adapter: EnemyAbilityWorldAdapter;
  readonly deathActivation: boolean;
}

export interface EnemyAbilityScheduleSnapshot {
  readonly sourceId: number;
  readonly abilityId: string;
  readonly actionId: string;
  readonly dueTick: number;
  readonly targetIds: readonly number[];
  readonly capturedSource: EnemyAbilityEngineSource;
}

export const createEnemyAbilityRuntime = (
  abilities: readonly EnemyAbilityDefinition[],
  source: Pick<EnemyAbilityEngineSource, "hp" | "maxHp">,
): EnemyAbilityRuntimeState => ({
  entries: Object.fromEntries(abilities.map((ability) => [ability.id, {
    uses: 0,
    cooldownRemaining: 0,
    intervalRemaining: ability.trigger.type === "interval" ? ability.trigger.initialDelay : 0,
    intervalArmed: ability.trigger.type === "interval" && ability.trigger.initialDelay <= 0,
    elapsedTriggered: false,
    hpWasPastThreshold: ability.trigger.type === "hp-threshold"
      ? isEnemyAbilityHpPastThreshold(ability.trigger, source.hp, source.maxHp)
      : false,
  }])),
  groupLocks: {},
  signals: ["spawn"],
  previousHp: source.hp,
  activeEffects: [],
  pendingActions: [],
});

export const signalEnemyAbility = (runtime: EnemyAbilityRuntimeState | undefined, signal: EnemyAbilitySignal): void => {
  if (runtime && !runtime.signals.includes(signal)) runtime.signals.push(signal);
};

export const advanceEnemyAbilityWaveLocks = (runtime: EnemyAbilityRuntimeState | undefined): void => {
  runtime?.activeEffects.forEach((effect) => {
    if (effect.type === "movement-lock" && effect.waves > 0) effect.waves -= 1;
  });
};

const targetDistance = (left: Point, right: Point): number => Math.hypot(left.x - right.x, left.y - right.y);

/** Deterministic attack geometry used by the game, preview, and lab. */
export const selectEnemyAbilityTargets = (
  source: EnemyAbilityEngineSource,
  attack: EnemyAbilityAttackDefinition,
  targets: readonly EnemyAbilityEngineTarget[],
): EnemyAbilityEngineTarget[] => {
  const candidates = targets.filter((target) => {
    if (target.hp <= 0) return false;
    const relative = { x: target.position.x - source.position.x, y: target.position.y - source.position.y };
    const forward = relative.x * source.direction.x + relative.y * source.direction.y;
    const lateral = Math.abs(relative.x * -source.direction.y + relative.y * source.direction.x);
    const range = Math.hypot(relative.x, relative.y);
    if (range > attack.range) return false;
    if (attack.delivery.type === "targeted") return true;
    if (attack.delivery.type === "radial") return range <= attack.delivery.radius;
    if (attack.delivery.type === "wave") return forward >= 0 && forward <= attack.delivery.depth && lateral <= attack.delivery.width / 2;
    if (forward <= 0 || forward > attack.delivery.depth) return false;
    return Math.abs(Math.atan2(lateral, Math.max(0.001, forward))) <= (attack.delivery.angle * Math.PI / 180) / 2;
  });
  candidates.sort((left, right) => {
    if (attack.targeting === "last") return left.pathDistance - right.pathDistance || left.id - right.id;
    if (attack.targeting === "strongest") return right.maxHp - left.maxHp || right.hp - left.hp || left.id - right.id;
    if (attack.targeting === "weakest") return left.hp - right.hp || left.maxHp - right.maxHp || left.id - right.id;
    if (attack.targeting === "closest") return targetDistance(left.position, source.position) - targetDistance(right.position, source.position) || left.id - right.id;
    return right.pathDistance - left.pathDistance || left.id - right.id;
  });
  return candidates.slice(0, attack.maxTargets);
};

const phaseForTrace = (code: EnemyAbilityTraceCode): EnemyAbilityTraceEvent["phase"] => {
  if (code === "triggered" || code === "suppressed") return "trigger";
  if (code === "telegraph") return "telegraph";
  if (code === "target-locked") return "target-lock";
  if (code === "impact") return "impact";
  if (code === "complete") return "complete";
  return "action";
};

const traceMessage = (code: EnemyAbilityTraceCode, ability: EnemyAbilityDefinition, action?: EnemyAbilityActionDefinition): string => {
  if (code === "triggered") return `${ability.name} triggered.`;
  if (code === "suppressed") return `${ability.name} was suppressed.`;
  if (code === "telegraph") return `${ability.name} began telegraphing.`;
  if (code === "target-locked") return `${ability.name} locked targets.`;
  if (code === "impact") return `${ability.name} impacted.`;
  if (code === "action-ineffective") return `${ability.name}'s ${action?.type ?? "action"} had no valid source or target.`;
  if (code === "complete") return `${ability.name} completed.`;
  return `${ability.name} applied ${action?.type ?? "an action"}.`;
};

const actionDuration = (action: EnemyAbilityActionDefinition): number => {
  if (action.type === "regeneration") return action.duration ?? Number.POSITIVE_INFINITY;
  if (action.type === "movement-lock") return action.waves > 0 && action.duration <= 0 ? Number.POSITIVE_INFINITY : action.duration;
  if (action.type === "invulnerability" || action.type === "stat-change" || action.type === "haste" || action.type === "phase" || action.type === "stun") return action.duration;
  return 0;
};

const targetBound = (action: EnemyAbilityActionDefinition): boolean => action.type === "damage" || action.type === "stun" || action.type === "drain";

export class EnemyAbilityEngine {
  private readonly pending: ScheduledEnemyAbilityAction[] = [];

  private projectSchedules(runtime: EnemyAbilityRuntimeState, sourceId: number): void {
    runtime.pendingActions = this.pending.filter((item) => item.sourceId === sourceId).map((item) => ({
      abilityId: item.abilityId,
      actionId: item.action.id,
      dueTick: item.dueTick,
      lockedTargetIds: [...item.targetIds],
      sourceId: item.sourceId,
      sourceKind: item.capturedSource.kind,
      sourcePosition: { ...item.capturedSource.position },
      sourceDirection: { ...item.capturedSource.direction },
      sourcePathDistance: item.capturedSource.pathDistance,
    }));
  }

  private emit(
    tick: number,
    code: EnemyAbilityTraceCode,
    adapter: EnemyAbilityWorldAdapter,
    source: EnemyAbilityEngineSource,
    ability: EnemyAbilityDefinition,
    targetIds: readonly number[] = [],
    action?: EnemyAbilityActionDefinition,
  ): void {
    adapter.onLifecycle?.({
      tick,
      code,
      phase: phaseForTrace(code),
      sourceId: source.id,
      abilityId: ability.id,
      ...(action ? { actionId: action.id } : {}),
      targetIds,
      position: { ...source.position },
      message: traceMessage(code, ability, action),
    }, ability, action);
  }

  private sourceState(source: EnemyAbilityEngineSource, entry: EnemyAbilityRuntimeState["entries"][string], ability: EnemyAbilityDefinition, target: EnemyAbilityEngineTarget | null): EnemyAbilityEvaluationState {
    return {
      hp: source.hp,
      maxHp: source.maxHp,
      age: source.age,
      pathDistance: source.pathDistance,
      blocked: source.blocked,
      target,
      cooldownRemaining: entry.cooldownRemaining,
      uses: entry.uses,
      maxUses: ability.maxUses,
    };
  }

  private triggerReady(ability: EnemyAbilityDefinition, entry: EnemyAbilityRuntimeState["entries"][string], runtime: EnemyAbilityRuntimeState, source: EnemyAbilityEngineSource): boolean {
    const trigger = ability.trigger;
    if (trigger.type === "spawn") return runtime.signals.includes("spawn");
    if (trigger.type === "interval") return entry.intervalArmed;
    if (trigger.type === "elapsed-time") return !entry.elapsedTriggered && source.age >= trigger.at;
    if (trigger.type === "hp-threshold") {
      const past = isEnemyAbilityHpPastThreshold(trigger, source.hp, source.maxHp);
      return !entry.hpWasPastThreshold && past;
    }
    if (trigger.type === "blocked") return runtime.signals.includes("blocked");
    if (trigger.type === "stunned") return runtime.signals.includes("stunned");
    if (trigger.type === "attack") return runtime.signals.includes("attack");
    return false;
  }

  private consumeEdges(abilities: readonly EnemyAbilityDefinition[], runtime: EnemyAbilityRuntimeState, source: EnemyAbilityEngineSource): void {
    abilities.forEach((ability) => {
      const entry = runtime.entries[ability.id];
      if (!entry) return;
      if (ability.trigger.type === "elapsed-time" && source.age >= ability.trigger.at) entry.elapsedTriggered = true;
      if (ability.trigger.type === "hp-threshold") entry.hpWasPastThreshold = isEnemyAbilityHpPastThreshold(ability.trigger, source.hp, source.maxHp);
    });
    runtime.previousHp = source.hp;
    runtime.signals.length = 0;
  }

  private updateTimers(abilities: readonly EnemyAbilityDefinition[], runtime: EnemyAbilityRuntimeState, delta: number): void {
    abilities.forEach((ability) => {
      const entry = runtime.entries[ability.id];
      if (!entry) return;
      entry.cooldownRemaining = Math.max(0, entry.cooldownRemaining - delta);
      if (ability.trigger.type === "interval" && !entry.intervalArmed) {
        entry.intervalRemaining = Math.max(0, entry.intervalRemaining - delta);
        if (entry.intervalRemaining <= 0) entry.intervalArmed = true;
      }
    });
    Object.keys(runtime.groupLocks).forEach((group) => {
      const remaining = runtime.groupLocks[group] ?? 0;
      if (Number.isFinite(remaining)) runtime.groupLocks[group] = Math.max(0, remaining - delta);
    });
  }

  private updateEffects(runtime: EnemyAbilityRuntimeState, adapter: EnemyAbilityWorldAdapter, delta: number): void {
    runtime.activeEffects.forEach((effect) => {
      if (effect.type === "regeneration") {
        const healing = effect.remainingAmount > 0
          ? Math.min(effect.remainingAmount, effect.rate * delta)
          : effect.rate * delta;
        if (healing > 0) {
          adapter.healSource(healing);
          if (effect.remainingAmount > 0) effect.remainingAmount = Math.max(0, effect.remainingAmount - healing);
        }
      }
      if (Number.isFinite(effect.remaining)) effect.remaining = Math.max(0, effect.remaining - delta);
    });
    runtime.activeEffects = runtime.activeEffects.filter((effect) => {
      if (effect.type === "movement-lock") return effect.remaining > 0 || effect.waves > 0;
      if (effect.type === "regeneration" && effect.remainingAmount > 0) return effect.remaining > 0;
      return effect.remaining > 0;
    });
    const state: EnemyAbilityPresentationState = {
      movementLocked: runtime.activeEffects.some((effect) => effect.type === "movement-lock" && (effect.remaining > 0 || effect.waves > 0)),
      movementLockWaves: Math.max(0, ...runtime.activeEffects.filter((effect) => effect.type === "movement-lock").map((effect) => effect.waves)),
      invulnerable: runtime.activeEffects.some((effect) => effect.type === "invulnerability" && effect.remaining > 0),
      phased: runtime.activeEffects.some((effect) => effect.type === "phase" && effect.remaining > 0),
      speedMultiplier: runtime.activeEffects.filter((effect) => effect.type === "stat-change").reduce((value, effect) => value * effect.speedMultiplier, 1),
      damageMultiplier: runtime.activeEffects.filter((effect) => effect.type === "stat-change").reduce((value, effect) => value * effect.damageMultiplier, 1),
    };
    adapter.projectSourceState(state);
  }

  private reserveGroup(ability: EnemyAbilityDefinition, runtime: EnemyAbilityRuntimeState): void {
    if (!ability.exclusiveGroup) return;
    let final = 0;
    ability.actions.forEach((action) => {
      const impact = ability.attack && targetBound(action) ? ability.attack.impactTime : 0;
      final = Math.max(final, impact + action.delay + actionDuration(action));
    });
    runtime.groupLocks[ability.exclusiveGroup] = Math.max(runtime.groupLocks[ability.exclusiveGroup] ?? 0, final || 1 / ENEMY_ABILITY_TICK_HZ);
  }

  private schedule(tick: number, ability: EnemyAbilityDefinition, source: EnemyAbilityEngineSource, targetIds: readonly number[], adapter: EnemyAbilityWorldAdapter, deathActivation = false): void {
    ability.actions.forEach((action) => {
      const impact = ability.attack && targetBound(action) ? ability.attack.impactTime : 0;
      this.pending.push({
        sourceId: source.id,
        abilityId: ability.id,
        ability,
        action,
        dueTick: tick + Math.max(0, Math.round((impact + action.delay) * ENEMY_ABILITY_TICK_HZ)),
        targetIds,
        capturedSource: { ...source, position: { ...source.position }, direction: { ...source.direction } },
        adapter,
        deathActivation,
      });
    });
  }

  private addEffect(runtime: EnemyAbilityRuntimeState, ability: EnemyAbilityDefinition, action: EnemyAbilityActionDefinition): boolean {
    if (action.type === "regeneration") {
      const duration = action.duration ?? Number.POSITIVE_INFINITY;
      runtime.activeEffects.push({ abilityId: ability.id, actionId: action.id, type: "regeneration", remaining: duration, waves: 0, remainingAmount: action.mode === "total" ? action.amount : 0, rate: action.mode === "total" ? action.amount / Math.max(1 / ENEMY_ABILITY_TICK_HZ, duration) : action.amount, speedMultiplier: 1, damageMultiplier: 1 });
      return true;
    }
    if (action.type === "movement-lock") {
      runtime.activeEffects.push({ abilityId: ability.id, actionId: action.id, type: "movement-lock", remaining: action.duration, waves: action.waves, remainingAmount: 0, rate: 0, speedMultiplier: 1, damageMultiplier: 1 });
      return true;
    }
    if (action.type === "invulnerability" || action.type === "phase") {
      runtime.activeEffects.push({ abilityId: ability.id, actionId: action.id, type: action.type, remaining: action.duration, waves: 0, remainingAmount: 0, rate: 0, speedMultiplier: 1, damageMultiplier: 1 });
      return true;
    }
    if (action.type === "stat-change") {
      runtime.activeEffects.push({ abilityId: ability.id, actionId: action.id, type: "stat-change", remaining: action.duration, waves: 0, remainingAmount: 0, rate: 0, speedMultiplier: action.speedMultiplier, damageMultiplier: action.damageMultiplier });
      return true;
    }
    return false;
  }

  private execute(schedule: ScheduledEnemyAbilityAction, tick: number, runtime?: EnemyAbilityRuntimeState): void {
    const { action, ability, adapter, capturedSource } = schedule;
    const liveSource = adapter.readSource();
    let targetIds = schedule.targetIds;
    if (ability.attack && ability.attack.targetLock === "impact" && targetBound(action)) {
      targetIds = selectEnemyAbilityTargets(liveSource ?? capturedSource, ability.attack, adapter.enumerateTargets()).map((target) => target.id);
      this.emit(tick, "target-locked", adapter, liveSource ?? capturedSource, ability, targetIds, action);
    }
    if (targetBound(action)) this.emit(tick, "impact", adapter, liveSource ?? capturedSource, ability, targetIds, action);
    let effective = false;
    if (action.type === "damage") targetIds.forEach((targetId) => { effective = adapter.damageTarget(targetId, action.amount) || effective; });
    else if (action.type === "stun") targetIds.forEach((targetId) => { effective = adapter.stunTarget(targetId, action.duration) || effective; });
    else if (action.type === "drain") {
      let victims = 0;
      targetIds.forEach((targetId) => { if (adapter.damageTarget(targetId, action.damage)) victims += 1; });
      effective = victims > 0;
      if (liveSource && victims > 0) adapter.healSource(action.healingPerTarget * victims);
    } else if (action.type === "summon") {
      let spawned = 0;
      for (let index = 0; index < action.count; index += 1) {
        const kind = action.kinds[index % Math.max(1, action.kinds.length)];
        if (!kind || !adapter.isKnownEnemyKind(kind)) continue;
        adapter.summon(kind, action.modifiers, index);
        spawned += 1;
      }
      effective = spawned > 0;
    } else if (action.type === "blink") {
      if (liveSource && !schedule.deathActivation) { adapter.blinkSource(action.distance); effective = true; }
    } else if (action.type === "haste") {
      if (liveSource && !schedule.deathActivation) effective = adapter.hasteNearby(action.radius, action.duration, action.multiplier) > 0;
    } else if (runtime && liveSource && !schedule.deathActivation) effective = this.addEffect(runtime, ability, action);
    this.emit(tick, effective ? "action" : "action-ineffective", adapter, liveSource ?? capturedSource, ability, targetIds, action);
  }

  private flushDue(tick: number, sourceId?: number, runtime?: EnemyAbilityRuntimeState): void {
    const due = this.pending.filter((item) => item.dueTick <= tick && (sourceId === undefined ? item.adapter.readSource() === null : item.sourceId === sourceId));
    if (due.length === 0) return;
    due.sort((left, right) => left.dueTick - right.dueTick || left.abilityId.localeCompare(right.abilityId) || left.action.id.localeCompare(right.action.id));
    const dueSet = new Set(due);
    for (let index = this.pending.length - 1; index >= 0; index -= 1) if (dueSet.has(this.pending[index]!)) this.pending.splice(index, 1);
    due.forEach((item) => this.execute(item, tick, runtime));
  }

  step(tick: number, delta: number, abilities: readonly EnemyAbilityDefinition[], runtime: EnemyAbilityRuntimeState, adapter: EnemyAbilityWorldAdapter): void {
    const source = adapter.readSource();
    if (!source) return;
    this.updateTimers(abilities, runtime, delta);
    this.updateEffects(runtime, adapter, delta);
    this.flushDue(tick, source.id, runtime);
    const sorted = abilities.map((ability, order) => ({ ability, order })).sort((left, right) => right.ability.priority - left.ability.priority || left.order - right.order || left.ability.id.localeCompare(right.ability.id));
    sorted.forEach(({ ability }) => {
      const entry = runtime.entries[ability.id];
      if (!entry || !ability.enabled || ability.trigger.type === "death" || !this.triggerReady(ability, entry, runtime, source)) return;
      const attackTargets = ability.attack ? selectEnemyAbilityTargets(source, ability.attack, adapter.enumerateTargets()) : [];
      const target = source.selectedTarget ?? attackTargets[0] ?? null;
      const allowed = entry.cooldownRemaining <= 0 && (ability.maxUses <= 0 || entry.uses < ability.maxUses) &&
        (!ability.exclusiveGroup || (runtime.groupLocks[ability.exclusiveGroup] ?? 0) <= 0) &&
        enemyAbilityConditionsMatch(ability.conditions, this.sourceState(source, entry, ability, target));
      const needsTargets = Boolean(ability.attack && ability.actions.some(targetBound));
      if (!allowed || needsTargets && attackTargets.length === 0) {
        this.emit(tick, "suppressed", adapter, source, ability, attackTargets.map((candidate) => candidate.id));
        return;
      }
      const targetIds = ability.attack?.targetLock === "activation" ? attackTargets.map((candidate) => candidate.id) : [];
      entry.uses += 1;
      entry.cooldownRemaining = ability.cooldown;
      if (ability.trigger.type === "interval") {
        entry.intervalArmed = false;
        entry.intervalRemaining = ability.trigger.every;
      }
      this.reserveGroup(ability, runtime);
      this.emit(tick, "triggered", adapter, source, ability, targetIds);
      if (ability.attack) {
        this.emit(tick, "telegraph", adapter, source, ability, targetIds);
        if (ability.attack.targetLock === "activation") this.emit(tick, "target-locked", adapter, source, ability, targetIds);
      }
      this.schedule(tick, ability, source, targetIds, adapter);
      this.flushDue(tick, source.id, runtime);
    });
    this.consumeEdges(abilities, runtime, source);
    this.updateEffects(runtime, adapter, 0);
    this.projectSchedules(runtime, source.id);
    Object.keys(runtime.groupLocks).forEach((group) => {
      if (!Number.isFinite(runtime.groupLocks[group]) && !abilities.some((ability) => ability.exclusiveGroup === group && (runtime.activeEffects.some((effect) => effect.abilityId === ability.id) || this.pending.some((item) => item.sourceId === source.id && item.abilityId === ability.id)))) delete runtime.groupLocks[group];
      if ((runtime.groupLocks[group] ?? 0) > 0) return;
      delete runtime.groupLocks[group];
    });
  }

  notifyDeath(tick: number, abilities: readonly EnemyAbilityDefinition[], runtime: EnemyAbilityRuntimeState, adapter: EnemyAbilityWorldAdapter): void {
    const source = adapter.readSource();
    if (!source) return;
    abilities.map((ability, order) => ({ ability, order })).filter(({ ability }) => ability.enabled && ability.trigger.type === "death")
      .sort((left, right) => right.ability.priority - left.ability.priority || left.order - right.order || left.ability.id.localeCompare(right.ability.id))
      .forEach(({ ability }) => {
        const entry = runtime.entries[ability.id];
        if (!entry || entry.cooldownRemaining > 0 || ability.maxUses > 0 && entry.uses >= ability.maxUses) return;
        const targets = ability.attack ? selectEnemyAbilityTargets(source, ability.attack, adapter.enumerateTargets()) : [];
        if (!enemyAbilityConditionsMatch(ability.conditions, this.sourceState(source, entry, ability, targets[0] ?? source.selectedTarget))) return;
        entry.uses += 1;
        entry.cooldownRemaining = ability.cooldown;
        const targetIds = ability.attack?.targetLock === "activation" ? targets.map((target) => target.id) : [];
        this.emit(tick, "triggered", adapter, source, ability, targetIds);
        this.schedule(tick, ability, source, targetIds, adapter, true);
        this.flushDue(tick, source.id, runtime);
      });
    this.projectSchedules(runtime, source.id);
  }

  /** Resolves captured-context actions whose source has already been removed. */
  advanceDetached(tick: number): void {
    this.flushDue(tick);
  }

  snapshotSchedules(sourceId: number): readonly EnemyAbilityScheduleSnapshot[] {
    return this.pending.filter((item) => item.sourceId === sourceId).map((item) => ({
      sourceId: item.sourceId,
      abilityId: item.abilityId,
      actionId: item.action.id,
      dueTick: item.dueTick,
      targetIds: [...item.targetIds],
      capturedSource: { ...item.capturedSource, position: { ...item.capturedSource.position }, direction: { ...item.capturedSource.direction }, selectedTarget: item.capturedSource.selectedTarget ? { ...item.capturedSource.selectedTarget, position: { ...item.capturedSource.selectedTarget.position } } : null },
    }));
  }

  restoreSchedules(sourceId: number, snapshots: readonly EnemyAbilityScheduleSnapshot[], abilities: readonly EnemyAbilityDefinition[], adapter: EnemyAbilityWorldAdapter): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) if (this.pending[index]?.sourceId === sourceId) this.pending.splice(index, 1);
    const byAbility = new Map(abilities.map((ability) => [ability.id, ability]));
    snapshots.forEach((snapshot) => {
      const ability = byAbility.get(snapshot.abilityId); const action = ability?.actions.find((candidate) => candidate.id === snapshot.actionId);
      if (!ability || !action) return;
      this.pending.push({ sourceId, abilityId: ability.id, ability, action, dueTick: snapshot.dueTick, targetIds: [...snapshot.targetIds], capturedSource: snapshot.capturedSource, adapter, deathActivation: ability.trigger.type === "death" });
    });
  }

  reset(): void {
    this.pending.length = 0;
  }
}
