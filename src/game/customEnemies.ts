import { ENEMY_DEFINITIONS } from "./config.ts";
import { DEFAULT_CUSTOM_ENEMY_APPEARANCE, sanitizeCustomEnemyAppearance } from "./customEnemyAppearance.ts";
import {
  NEUTRAL_SUMMON_MODIFIERS,
  cloneEnemyAbility,
  createEnemyActionId,
  createEnemyAbilityId,
  deterministicEnemyAbilityId,
  normalizeEnemyAbilities,
  sanitizeEnemyAbility,
  validateEnemyAbilities,
  type EnemyAbilityIssue,
} from "./enemyAbilities.ts";
import { DEFAULT_ENEMY_RESISTANCES, sanitizeResistances } from "./damageTypes.ts";
import { saveDiskSection } from "./persistence.ts";
import type { CustomEnemyAppearance } from "./customEnemyAppearance.ts";
import type { CustomEnemyKind, EnemyAbilityDefinition, EnemyAttackDefinition, EnemyAttackEffectDefinition, EnemyAttackVisualDefinition, EnemyDefinition, EnemyKind, EnemySummonModifiers } from "./types.ts";

const STORAGE_KEY = "monochromium.custom-enemies.v1";
const officialKinds = new Set<string>(Object.keys(ENEMY_DEFINITIONS));

export type CustomEnemyBehaviorAction =
  | { type: "stop"; delay: number; duration: number }
  | { type: "invulnerable"; delay: number; duration: number }
  | { type: "regenerate"; delay: number; amount: number; duration: number }
  | { type: "stomp"; delay: number; radius: number; damage: number; stunDuration: number }
  | { type: "stat-change"; delay: number; duration: number; speedMultiplier: number; damageMultiplier: number }
  | { type: "blink"; delay: number; distance: number };

export interface CustomEnemyBehaviorRule {
  id: string; name: string; minHp: number | null; maxHp: number | null; minAliveTime: number | null; maxAliveTime: number | null;
  cooldown: number; maxUses: number; actions: CustomEnemyBehaviorAction[];
}

export interface CustomEnemyDraftV4 {
  version: 4;
  id: CustomEnemyKind;
  name: string;
  color: string;
  opacity: number;
  appearance: CustomEnemyAppearance;
  sides: number;
  hp: number;
  shieldHp: number;
  speed: number;
  damage: number;
  attackInterval: number;
  telegraphDuration: number;
  coreDamage: number;
  radius: number;
  hidden: boolean;
  boss: boolean;
  defense: number;
  protection: number;
  armor: number;
  superarmor: number;
  resistances: Record<string, number>;
  abilities: EnemyAbilityDefinition[];
  updatedAt: number;
}

/** @deprecated Runtime-only bridge for the v3 editor while callers move to abilities. */
export interface LegacyCustomEnemyCompatibilityFields {
  timeLockEnabled: boolean; timeLockDistance: number; timeLockDuration: number;
  waveLockEnabled: boolean; waveLockDistance: number; waveLockWaves: number;
  summoningEnabled: boolean; summonInterval: number; summonCount: number; summonKinds: EnemyKind[];
  summonHitCashMultiplier: number; summonHpMultiplier: number; summonShieldMultiplier: number; summonSpeedMultiplier: number;
  summonDamageMultiplier: number; summonAttackIntervalMultiplier: number; summonCoreDamageMultiplier: number; summonDefenseBonus: number;
  summonProtectionBonus: number; summonArmorBonus: number; summonSuperarmorBonus: number;
  stunningEnabled: boolean; stunInterval: number; stunRadius: number; stunDuration: number;
  regenerationEnabled: boolean; regenerationRate: number;
  hasteEnabled: boolean; hasteInterval: number; hasteRadius: number; hasteDuration: number; hasteMultiplier: number;
  drainEnabled: boolean; drainInterval: number; drainRadius: number; drainDamage: number; drainHealing: number;
  phaseEnabled: boolean; phaseInterval: number; phaseDuration: number;
  blinkEnabled: boolean; blinkInterval: number; blinkDistance: number;
  behaviorRules: CustomEnemyBehaviorRule[]; attacks: EnemyAttackDefinition[];
}

export type CustomEnemyDraft = CustomEnemyDraftV4 & LegacyCustomEnemyCompatibilityFields;
export type EnemyBehaviorActionType = CustomEnemyBehaviorAction["type"];
export type CustomEnemyValidationIssue = EnemyAbilityIssue;

export interface CustomEnemySanitizeResult {
  readonly enemies: CustomEnemyDraft[];
  readonly migrated: number;
  readonly issues: readonly CustomEnemyValidationIssue[];
}

interface LegacyCustomEnemySource extends Omit<Partial<CustomEnemyDraftV4>, "version"> {
  version?: number;
  timeLockEnabled?: boolean; timeLockDistance?: number; timeLockDuration?: number;
  waveLockEnabled?: boolean; waveLockDistance?: number; waveLockWaves?: number;
  summoningEnabled?: boolean; summonInterval?: number; summonCount?: number; summonKinds?: EnemyKind[];
  summonHitCashMultiplier?: number; summonHpMultiplier?: number; summonShieldMultiplier?: number; summonSpeedMultiplier?: number;
  summonDamageMultiplier?: number; summonAttackIntervalMultiplier?: number; summonCoreDamageMultiplier?: number; summonDefenseBonus?: number;
  summonProtectionBonus?: number; summonArmorBonus?: number; summonSuperarmorBonus?: number;
  stunningEnabled?: boolean; stunInterval?: number; stunRadius?: number; stunDuration?: number;
  regenerationEnabled?: boolean; regenerationRate?: number;
  hasteEnabled?: boolean; hasteInterval?: number; hasteRadius?: number; hasteDuration?: number; hasteMultiplier?: number;
  drainEnabled?: boolean; drainInterval?: number; drainRadius?: number; drainDamage?: number; drainHealing?: number;
  phaseEnabled?: boolean; phaseInterval?: number; phaseDuration?: number;
  blinkEnabled?: boolean; blinkInterval?: number; blinkDistance?: number;
  behaviorRules?: CustomEnemyBehaviorRule[]; attacks?: EnemyAttackDefinition[];
}

const rangedNumber = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
const integer = (value: unknown, fallback: number, minimum: number, maximum: number): number => Math.round(rangedNumber(value, fallback, minimum, maximum));
const text = (value: unknown, fallback: string, maximum: number): string => typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
const color = (value: unknown): string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#d46cff";
const nullableNumber = (value: unknown, minimum: number, maximum: number): number | null => value === null || value === undefined || value === "" ? null : rangedNumber(value, minimum, minimum, maximum);
const isSafeCustomEnemyKind = (value: unknown): value is CustomEnemyKind => typeof value === "string" && /^custom-enemy:[a-z0-9-]{8,80}$/i.test(value);
const isEnemyKindReference = (value: unknown): value is EnemyKind => typeof value === "string" && (officialKinds.has(value) || isSafeCustomEnemyKind(value));

const randomCustomEnemyId = (): CustomEnemyKind => {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-enemy:${value}`;
};

export const createCustomEnemyBehaviorAction = (type: EnemyBehaviorActionType = "stop"): CustomEnemyBehaviorAction => {
  if (type === "invulnerable") return { type, delay: 0, duration: 5 };
  if (type === "regenerate") return { type, delay: 0, amount: 1000, duration: 5 };
  if (type === "stomp") return { type, delay: 0, radius: 180, damage: 20, stunDuration: 2 };
  if (type === "stat-change") return { type, delay: 0, duration: 5, speedMultiplier: 2, damageMultiplier: 1 };
  if (type === "blink") return { type, delay: 0, distance: 120 };
  return { type: "stop", delay: 0, duration: 5 };
};

export const createCustomEnemyBehaviorRule = (): CustomEnemyBehaviorRule => ({
  id: deterministicEnemyAbilityId("rule", `${Date.now()}:${Math.random()}`), name: "HP Phase", minHp: null, maxHp: 2000,
  minAliveTime: null, maxAliveTime: null, cooldown: 1, maxUses: 1, actions: [createCustomEnemyBehaviorAction("stop")],
});

export const createCustomEnemyAttack = (): EnemyAttackDefinition => ({
  id: deterministicEnemyAbilityId("attack", `${Date.now()}:${Math.random()}`), name: "Ranged Attack", cooldown: 8, maxUses: 0,
  minHp: null, maxHp: null, minAliveTime: 0, maxAliveTime: null, targeting: "first", range: 220, maxTargets: 1,
  delivery: "ranged", width: 60, depth: 180, angle: 60, projectileSpeed: 360, effects: [{ type: "damage", amount: 20 }],
  visuals: [{ type: "projectile", color: "#ff806f", size: 1, width: 3, duration: 0.3, speed: 360 }],
});

const legacyDefaults: Record<string, unknown> = {
  timeLockEnabled: false, timeLockDistance: 140, timeLockDuration: 5, waveLockEnabled: false, waveLockDistance: 140, waveLockWaves: 1,
  summoningEnabled: false, summonInterval: 8, summonCount: 2, summonKinds: ["dummy"], summonHitCashMultiplier: 0,
  summonHpMultiplier: 1, summonShieldMultiplier: 1, summonSpeedMultiplier: 1, summonDamageMultiplier: 1, summonAttackIntervalMultiplier: 1,
  summonCoreDamageMultiplier: 1, summonDefenseBonus: 0, summonProtectionBonus: 0, summonArmorBonus: 0, summonSuperarmorBonus: 0,
  stunningEnabled: false, stunInterval: 8, stunRadius: 180, stunDuration: 2, regenerationEnabled: false, regenerationRate: 5,
  hasteEnabled: false, hasteInterval: 8, hasteRadius: 180, hasteDuration: 3, hasteMultiplier: 1.5,
  drainEnabled: false, drainInterval: 8, drainRadius: 160, drainDamage: 10, drainHealing: 20,
  phaseEnabled: false, phaseInterval: 10, phaseDuration: 2, blinkEnabled: false, blinkInterval: 8, blinkDistance: 120,
  behaviorRules: [], attacks: [],
};

/** Non-enumerable compatibility fields keep older callers usable without persisting v3 data. */
const attachLegacyCompatibility = <T extends CustomEnemyDraftV4>(draft: T, source: LegacyCustomEnemySource = {}): T & LegacyCustomEnemyCompatibilityFields => {
  const record = source as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(legacyDefaults)) {
    const value = record[key] ?? (Array.isArray(fallback) ? [...fallback] : fallback);
    Object.defineProperty(draft, key, { value, writable: true, configurable: true, enumerable: false });
  }
  return draft as T & LegacyCustomEnemyCompatibilityFields;
};

export const createCustomEnemy = (): CustomEnemyDraft => attachLegacyCompatibility({
  version: 4, id: randomCustomEnemyId(), name: "Custom Enemy", color: "#d46cff", opacity: 1,
  appearance: { ...DEFAULT_CUSTOM_ENEMY_APPEARANCE }, sides: 5, hp: 100, shieldHp: 0, speed: 36, damage: 8,
  attackInterval: 1.8, telegraphDuration: 0.85, coreDamage: 2, radius: 18, hidden: false, boss: false,
  defense: 0, protection: 0, armor: 0, superarmor: 0, resistances: { ...DEFAULT_ENEMY_RESISTANCES }, abilities: [], updatedAt: Date.now(),
});

const sanitizeLegacyAction = (value: unknown): CustomEnemyBehaviorAction | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>; const delay = rangedNumber(source["delay"], 0, 0, 600);
  if (source["type"] === "stop" || source["type"] === "invulnerable") return { type: source["type"], delay, duration: rangedNumber(source["duration"], 5, 0.1, 600) };
  if (source["type"] === "regenerate") return { type: "regenerate", delay, amount: rangedNumber(source["amount"], 1000, 0, 10_000_000), duration: rangedNumber(source["duration"], 5, 0.1, 600) };
  if (source["type"] === "stomp") return { type: "stomp", delay, radius: rangedNumber(source["radius"], 180, 20, 1000), damage: rangedNumber(source["damage"], 20, 0, 1_000_000), stunDuration: rangedNumber(source["stunDuration"], 2, 0, 60) };
  if (source["type"] === "stat-change") return { type: "stat-change", delay, duration: rangedNumber(source["duration"], 5, 0.1, 600), speedMultiplier: rangedNumber(source["speedMultiplier"], 2, 0, 10), damageMultiplier: rangedNumber(source["damageMultiplier"], 1, 0, 10) };
  if (source["type"] === "blink") return { type: "blink", delay, distance: rangedNumber(source["distance"], 120, 5, 1000) };
  return null;
};

const sanitizeLegacyRules = (value: unknown): CustomEnemyBehaviorRule[] => !Array.isArray(value) ? [] : value.slice(0, 32).flatMap((candidate, index) => {
  if (!candidate || typeof candidate !== "object") return [];
  const source = candidate as Partial<CustomEnemyBehaviorRule>;
  const actions = Array.isArray(source.actions) ? source.actions.slice(0, 32).flatMap((action) => sanitizeLegacyAction(action) ?? []) : [];
  if (actions.length === 0) return [];
  return [{ id: typeof source.id === "string" && source.id.trim() ? source.id.slice(0, 80) : deterministicEnemyAbilityId("rule", `${index}:${source.name ?? "rule"}`),
    name: text(source.name, `Rule ${index + 1}`, 40), minHp: nullableNumber(source.minHp, 0, 10_000_000), maxHp: nullableNumber(source.maxHp, 0, 10_000_000),
    minAliveTime: nullableNumber(source.minAliveTime, 0, 86_400), maxAliveTime: nullableNumber(source.maxAliveTime, 0, 86_400),
    cooldown: rangedNumber(source.cooldown, 1, 1 / 30, 600), maxUses: integer(source.maxUses, 1, 0, 999), actions }];
});

const sanitizeLegacyAttacks = (value: unknown): EnemyAttackDefinition[] => !Array.isArray(value) ? [] : value.slice(0, 24).flatMap((candidate, index) => {
  if (!candidate || typeof candidate !== "object") return [];
  const source = candidate as Partial<EnemyAttackDefinition>;
  const effects: EnemyAttackEffectDefinition[] = [];
  if (Array.isArray(source.effects)) source.effects.slice(0, 16).forEach((effect) => {
    if (effect?.type === "damage") effects.push({ type: "damage", amount: rangedNumber(effect.amount, 20, 0, 1_000_000) });
    else if (effect?.type === "stun") effects.push({ type: "stun", duration: rangedNumber(effect.duration, 1, 0, 60) });
  });
  const visuals: EnemyAttackVisualDefinition[] = Array.isArray(source.visuals) ? source.visuals.slice(0, 16).flatMap((visual) => visual && typeof visual === "object" && ["projectile", "beam", "explosion", "lightning", "wave", "slash"].includes(visual.type)
    ? [{ type: visual.type, color: color(visual.color), size: rangedNumber(visual.size, 1, 0.1, 10), width: rangedNumber(visual.width, 3, 0.5, 100), duration: rangedNumber(visual.duration, 0.3, 0.05, 10), speed: rangedNumber(visual.speed, 360, 40, 2_000) } as EnemyAttackVisualDefinition] : []) : [];
  if (effects.length === 0) return [];
  return [{ ...createCustomEnemyAttack(), id: typeof source.id === "string" && source.id.trim() ? source.id.slice(0, 80) : deterministicEnemyAbilityId("attack", `${index}:${source.name ?? "attack"}`),
    name: text(source.name, `Attack ${index + 1}`, 40), cooldown: rangedNumber(source.cooldown, 8, 1 / 30, 600), maxUses: integer(source.maxUses, 0, 0, 999),
    minHp: nullableNumber(source.minHp, 0, 10_000_000), maxHp: nullableNumber(source.maxHp, 0, 10_000_000), minAliveTime: nullableNumber(source.minAliveTime, 0, 86_400), maxAliveTime: nullableNumber(source.maxAliveTime, 0, 86_400),
    targeting: ["first", "last", "strongest", "weakest", "closest"].includes(source.targeting ?? "") ? source.targeting! : "first",
    range: rangedNumber(source.range, 220, 4, 2_000), maxTargets: integer(source.maxTargets, 1, 1, 64), delivery: ["ranged", "wave", "forward"].includes(source.delivery ?? "") ? source.delivery! : "ranged",
    width: rangedNumber(source.width, 60, 4, 1_000), depth: rangedNumber(source.depth, 180, 4, 2_000), angle: rangedNumber(source.angle, 60, 5, 180), projectileSpeed: rangedNumber(source.projectileSpeed, 360, 40, 2_000),
    effects, visuals: visuals.length > 0 ? visuals : createCustomEnemyAttack().visuals }];
});

const summonModifiersFromLegacy = (source: LegacyCustomEnemySource): EnemySummonModifiers => ({
  hitCashMultiplier: rangedNumber(source.summonHitCashMultiplier, 0, 0, 10), hpMultiplier: rangedNumber(source.summonHpMultiplier, 1, 0, 10), shieldMultiplier: rangedNumber(source.summonShieldMultiplier, 1, 0, 10),
  speedMultiplier: rangedNumber(source.summonSpeedMultiplier, 1, 0, 10), damageMultiplier: rangedNumber(source.summonDamageMultiplier, 1, 0, 10), attackIntervalMultiplier: rangedNumber(source.summonAttackIntervalMultiplier, 1, 0.1, 10),
  coreDamageMultiplier: rangedNumber(source.summonCoreDamageMultiplier, 1, 0, 10), defenseBonus: rangedNumber(source.summonDefenseBonus, 0, -1_000_000, 1_000_000), protectionBonus: integer(source.summonProtectionBonus, 0, -999, 999),
  armorBonus: rangedNumber(source.summonArmorBonus, 0, -1, 1), superarmorBonus: rangedNumber(source.summonSuperarmorBonus, 0, -1, 1),
});

const hasLegacyBehavior = (source: LegacyCustomEnemySource): boolean => Boolean(source.timeLockEnabled || source.waveLockEnabled || source.summoningEnabled || source.stunningEnabled || source.regenerationEnabled || source.hasteEnabled || source.drainEnabled || source.phaseEnabled || source.blinkEnabled || source.behaviorRules?.length || source.attacks?.length);

const legacyDefinition = (source: LegacyCustomEnemySource, base: CustomEnemyDraftV4): EnemyDefinition => ({
  kind: base.id, name: base.name, hp: base.hp, shieldHp: base.shieldHp, speed: base.speed, damage: base.damage, attackInterval: base.attackInterval,
  telegraphDuration: Math.min(base.telegraphDuration, base.attackInterval), coreDamage: base.coreDamage, radius: base.radius, hidden: base.hidden || undefined, boss: base.boss || undefined,
  defense: base.defense || undefined, protection: base.protection || undefined, armor: base.armor || undefined, superarmor: base.superarmor || undefined,
  timeLock: source.timeLockEnabled ? { distance: rangedNumber(source.timeLockDistance, 140, 0, 2_000), duration: rangedNumber(source.timeLockDuration, 5, 0.1, 600) } : undefined,
  waveLock: source.waveLockEnabled ? { distance: rangedNumber(source.waveLockDistance, 140, 0, 2_000), waves: integer(source.waveLockWaves, 1, 1, 999) } : undefined,
  summon: source.summoningEnabled ? { interval: rangedNumber(source.summonInterval, 8, 0.2, 600), count: integer(source.summonCount, 2, 1, 100), kinds: Array.isArray(source.summonKinds) ? source.summonKinds.filter(isEnemyKindReference) : ["dummy"], modifiers: summonModifiersFromLegacy(source) } : undefined,
  shockwave: source.stunningEnabled ? { interval: rangedNumber(source.stunInterval, 8, 0.2, 600), radius: rangedNumber(source.stunRadius, 180, 20, 1_000), stunDuration: rangedNumber(source.stunDuration, 2, 0, 60) } : undefined,
  regeneration: source.regenerationEnabled ? { rate: rangedNumber(source.regenerationRate, 5, 0.1, 1_000_000) } : undefined,
  hastePulse: source.hasteEnabled ? { interval: rangedNumber(source.hasteInterval, 8, 0.2, 600), radius: rangedNumber(source.hasteRadius, 180, 20, 1_000), duration: rangedNumber(source.hasteDuration, 3, 0.1, 60), multiplier: rangedNumber(source.hasteMultiplier, 1.5, 1, 5) } : undefined,
  drain: source.drainEnabled ? { interval: rangedNumber(source.drainInterval, 8, 0.2, 600), radius: rangedNumber(source.drainRadius, 160, 20, 1_000), damage: rangedNumber(source.drainDamage, 10, 0, 1_000_000), healingPerTower: rangedNumber(source.drainHealing, 20, 0, 1_000_000) } : undefined,
  phase: source.phaseEnabled ? { interval: rangedNumber(source.phaseInterval, 10, 0.2, 600), duration: rangedNumber(source.phaseDuration, 2, 0.1, 60) } : undefined,
  blink: source.blinkEnabled ? { interval: rangedNumber(source.blinkInterval, 8, 0.2, 600), distance: rangedNumber(source.blinkDistance, 120, 5, 1_000) } : undefined,
  behaviorRules: sanitizeLegacyRules(source.behaviorRules), attacks: sanitizeLegacyAttacks(source.attacks),
  sprite: { shape: "polygon", sides: base.sides, fill: base.color, stroke: base.color, accent: base.color, glyph: "CE" },
});

const sanitizeBase = (source: LegacyCustomEnemySource): CustomEnemyDraftV4 => ({
  version: 4, id: isSafeCustomEnemyKind(source.id) ? source.id : randomCustomEnemyId(), name: text(source.name, "Custom Enemy", 40), color: color(source.color), opacity: rangedNumber(source.opacity, 1, 0, 1),
  appearance: sanitizeCustomEnemyAppearance(source.appearance), sides: integer(source.sides, 5, 3, 12), hp: integer(source.hp, 100, 1, 10_000_000), shieldHp: integer(source.shieldHp, 0, 0, 10_000_000),
  speed: rangedNumber(source.speed, 36, 0, 500), damage: integer(source.damage, 8, 0, 1_000_000), attackInterval: rangedNumber(source.attackInterval, 1.8, 0.1, 120), telegraphDuration: rangedNumber(source.telegraphDuration, 0.85, 0.05, 30),
  coreDamage: integer(source.coreDamage, 2, 0, 9999), radius: rangedNumber(source.radius, 18, 6, 60), hidden: source.hidden === true, boss: source.boss === true,
  defense: rangedNumber(source.defense, 0, 0, 1_000_000), protection: integer(source.protection, 0, 0, 999), armor: rangedNumber(source.armor, 0, 0, 1), superarmor: rangedNumber(source.superarmor, 0, 0, 1),
  resistances: sanitizeResistances(source.resistances),
  abilities: [], updatedAt: integer(source.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
});

const sanitizeEnemy = (value: unknown, index: number, issues: EnemyAbilityIssue[]): { enemy: CustomEnemyDraft; migrated: boolean } | null => {
  if (!value || typeof value !== "object") { issues.push({ code: "enemy-malformed", severity: "error", path: `enemies[${index}]`, message: "Enemy is not an object and was skipped." }); return null; }
  const source = value as LegacyCustomEnemySource; const base = sanitizeBase(source); const migrated = source.version !== 4;
  (source.version === 4 ? [] : sanitizeLegacyRules(source.behaviorRules)).forEach((rule, ruleIndex) => {
    const stompGeometries = new Set(rule.actions.filter((action) => action.type === "stomp").map((action) => action.type === "stomp" ? action.radius : 0));
    if (stompGeometries.size > 1) issues.push({ code: "legacy-stomp-split", severity: "warning", path: `enemies[${index}].behaviorRules[${ruleIndex}]`, abilityId: rule.id, message: "Incompatible legacy stomp geometries were split into deterministic sibling abilities." });
  });
  const rawAbilities = source.version === 4 && Array.isArray(source.abilities) ? source.abilities : normalizeEnemyAbilities(legacyDefinition(source, base));
  const abilityIssues: EnemyAbilityIssue[] = [];
  const abilities = rawAbilities.slice(0, 64).flatMap((ability, abilityIndex) => sanitizeEnemyAbility(ability, abilityIndex, abilityIssues, `enemies[${index}].abilities[${abilityIndex}]`) ?? []);
  issues.push(...abilityIssues);
  const enemy = attachLegacyCompatibility({ ...base, abilities }, source);
  if (migrated) issues.push({ code: "enemy-migrated-v4", severity: "warning", path: `enemies[${index}]`, message: `"${enemy.name}" was migrated to the v4 ability schema.` });
  return { enemy, migrated };
};

const removeDuplicateAbilityIds = (enemy: CustomEnemyDraft, issues: EnemyAbilityIssue[]): void => {
  const ids = new Set<string>();
  enemy.abilities = enemy.abilities.filter((ability, index) => {
    if (!ids.has(ability.id)) { ids.add(ability.id); return true; }
    issues.push({ code: "ability-id-duplicate", severity: "warning", path: `${enemy.id}.abilities[${index}]`, abilityId: ability.id, message: `Later duplicate ability "${ability.id}" was skipped.` }); return false;
  });
};

const removeSummonCycles = (enemies: CustomEnemyDraft[], issues: EnemyAbilityIssue[]): void => {
  const byId = new Map(enemies.map((enemy) => [enemy.id, enemy]));
  const edges = (enemy: CustomEnemyDraft): string[] => enemy.abilities.flatMap((ability) => ability.actions.flatMap((action) => action.type === "summon" ? action.kinds.filter((kind) => byId.has(kind as CustomEnemyKind)) : []));
  const reaches = (start: string, current: string, seen: Set<string>): boolean => {
    if (seen.has(current)) return false; seen.add(current); const enemy = byId.get(current as CustomEnemyKind);
    return Boolean(enemy && edges(enemy).some((next) => next === start || reaches(start, next, seen)));
  };
  enemies.forEach((enemy) => { enemy.abilities = enemy.abilities.filter((ability, index) => {
    const cyclic = ability.actions.some((action) => action.type === "summon" && action.kinds.some((kind) => kind === enemy.id || byId.has(kind as CustomEnemyKind) && reaches(enemy.id, kind, new Set())));
    if (!cyclic) return true;
    issues.push({ code: "summon-cycle", severity: "error", path: `${enemy.id}.abilities[${index}]`, abilityId: ability.id, message: `Summon-cycle ability "${ability.name}" was skipped.` }); return false;
  }); });
};

export const validateCustomEnemyDraft = (enemy: CustomEnemyDraft, available: readonly CustomEnemyDraft[] = []): CustomEnemyValidationIssue[] => {
  const known = new Set<string>([...officialKinds, ...available.map((candidate) => candidate.id), enemy.id]);
  const issues = validateEnemyAbilities(enemy.abilities, { maxHp: enemy.hp, knownEnemyKinds: known, path: "abilities" });
  const candidates = new Map<CustomEnemyKind, CustomEnemyDraft>(available.map((candidate) => [candidate.id, candidate])); candidates.set(enemy.id, enemy);
  const edges = (candidate: CustomEnemyDraft): Array<{ kind: CustomEnemyKind; abilityId: string; index: number }> => candidate.abilities.flatMap((ability, index) => ability.actions.flatMap((action) => action.type === "summon" ? action.kinds.filter((kind): kind is CustomEnemyKind => kind.startsWith("custom-enemy:") && candidates.has(kind as CustomEnemyKind)).map((kind) => ({ kind, abilityId: ability.id, index })) : []));
  const reaches = (target: CustomEnemyKind, current: CustomEnemyKind, visiting: Set<CustomEnemyKind>): boolean => {
    if (current === target && visiting.size > 0) return true; if (visiting.has(current)) return false; visiting.add(current);
    return edges(candidates.get(current)!).some((edge) => reaches(target, edge.kind, new Set(visiting)));
  };
  edges(enemy).forEach((edge) => { if (edge.kind === enemy.id || reaches(enemy.id, edge.kind, new Set())) issues.push({ code: "summon-cycle", severity: "error", path: `abilities[${edge.index}]`, abilityId: edge.abilityId, message: "Ability creates a direct or transitive summon cycle." }); });
  return issues;
};

export const sanitizeCustomEnemiesDetailed = (value: unknown): CustomEnemySanitizeResult => {
  if (!Array.isArray(value)) return { enemies: [], migrated: 0, issues: [{ code: "enemy-list-malformed", severity: "error", path: "enemies", message: "Enemy collection is not an array." }] };
  const issues: EnemyAbilityIssue[] = []; const unique = new Map<CustomEnemyKind, CustomEnemyDraft>(); let migrated = 0;
  value.slice(0, 256).forEach((candidate, index) => { const result = sanitizeEnemy(candidate, index, issues); if (!result) return;
    if (unique.has(result.enemy.id)) issues.push({ code: "enemy-id-duplicate", severity: "warning", path: `enemies[${index}].id`, message: `Later duplicate enemy "${result.enemy.id}" replaced the earlier entry.` });
    unique.set(result.enemy.id, result.enemy); if (result.migrated) migrated += 1; });
  const enemies = [...unique.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  enemies.forEach((enemy) => removeDuplicateAbilityIds(enemy, issues)); removeSummonCycles(enemies, issues);
  enemies.forEach((enemy) => issues.push(...validateCustomEnemyDraft(enemy, enemies)));
  return { enemies, migrated, issues };
};

export const sanitizeCustomEnemies = (value: unknown): CustomEnemyDraft[] => sanitizeCustomEnemiesDetailed(value).enemies;
export const loadCustomEnemies = (): CustomEnemyDraft[] => { try {
  const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return [];
  const result = sanitizeCustomEnemiesDetailed(JSON.parse(raw));
  if (result.migrated > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(result.enemies));
  return result.enemies;
} catch { return []; } };
export const cacheCustomEnemiesLocally = (enemies: readonly CustomEnemyDraft[]): void => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(enemies)); } catch { /* in-memory editor remains usable */ } };
export const saveCustomEnemies = (enemies: readonly CustomEnemyDraft[]): void => { cacheCustomEnemiesLocally(enemies); void saveDiskSection("custom-enemies", enemies); };
export const cloneCustomEnemy = (enemy: CustomEnemyDraft): CustomEnemyDraft => attachLegacyCompatibility({ ...enemy, appearance: { ...enemy.appearance }, resistances: { ...(enemy.resistances ?? DEFAULT_ENEMY_RESISTANCES) }, abilities: enemy.abilities.map((ability) => cloneEnemyAbility(ability)) }, enemy as unknown as LegacyCustomEnemySource);

export const upsertCustomEnemy = (enemies: readonly CustomEnemyDraft[], draft: CustomEnemyDraft): CustomEnemyDraft[] => {
  const sanitized = sanitizeEnemy({ ...draft, updatedAt: Date.now() }, 0, [])?.enemy; if (!sanitized) return [...enemies];
  const next = enemies.filter((enemy) => enemy.id !== sanitized.id); next.push(sanitized); next.sort((left, right) => right.updatedAt - left.updatedAt); saveCustomEnemies(next); return next;
};

const shiftHex = (hex: string, amount: number): string => { const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)); return `#${channels.map((channel) => Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel - channel * Math.abs(amount)).toString(16).padStart(2, "0")).join("")}`; };

export const customEnemyToDefinition = (draft: CustomEnemyDraft): EnemyDefinition => {
  const legacy = draft as unknown as LegacyCustomEnemySource;
  const abilities = hasLegacyBehavior(legacy) ? [...draft.abilities.map((ability) => cloneEnemyAbility(ability)), ...normalizeEnemyAbilities(legacyDefinition(legacy, draft)).map((ability) => cloneEnemyAbility(ability))] : draft.abilities.map((ability) => cloneEnemyAbility(ability));
  return { kind: draft.id, name: draft.name, hp: draft.hp, shieldHp: draft.shieldHp, speed: draft.speed, damage: draft.damage,
    attackInterval: draft.attackInterval, telegraphDuration: Math.min(draft.telegraphDuration, draft.attackInterval), coreDamage: draft.coreDamage, radius: draft.radius,
    hidden: draft.hidden || undefined, boss: draft.boss || undefined, defense: draft.defense || undefined, protection: draft.protection || undefined,
    armor: draft.armor || undefined, superarmor: draft.superarmor || undefined,
    resistances: draft.resistances ? { ...draft.resistances } : undefined, abilities,
    sprite: { shape: "polygon", sides: draft.sides, fill: draft.color, stroke: shiftHex(draft.color, -0.55), accent: shiftHex(draft.color, 0.48),
      glyph: draft.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "CE", appearance: draft.appearance.mode,
      drawing: draft.appearance.mode === "drawing" ? draft.appearance.pngDataUrl ?? undefined : undefined, opacity: rangedNumber(draft.opacity, 1, 0, 1) } };
};

export const createEmptyEnemyAbility = (): EnemyAbilityDefinition => ({ id: createEnemyAbilityId(), name: "New Ability", enabled: true, editorMode: "basic", priority: 0,
  cooldown: 0, maxUses: 1, exclusiveGroup: null, trigger: { type: "spawn" }, conditions: [], attack: null,
  actions: [{ id: createEnemyActionId(), type: "invulnerability", delay: 0, duration: 3 }] });
export const defaultSummonModifiers = (): EnemySummonModifiers => ({ ...NEUTRAL_SUMMON_MODIFIERS });
