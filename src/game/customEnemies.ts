import { ENEMY_DEFINITIONS } from "./config.ts";
import { saveDiskSection } from "./persistence.ts";
import type { CustomEnemyKind, EnemyDefinition, EnemyKind } from "./types.ts";

const STORAGE_KEY = "monochromium.custom-enemies.v1";
const officialKinds = new Set(Object.keys(ENEMY_DEFINITIONS));

export interface CustomEnemyDraft {
  version: 1;
  id: CustomEnemyKind;
  name: string;
  color: string;
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
  summoningEnabled: boolean;
  summonInterval: number;
  summonCount: number;
  summonKinds: EnemyKind[];
  stunningEnabled: boolean;
  stunInterval: number;
  stunRadius: number;
  stunDuration: number;
  updatedAt: number;
}

const createId = (): CustomEnemyKind => {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-enemy:${value}`;
};

const rangedNumber = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const integer = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
  Math.round(rangedNumber(value, fallback, minimum, maximum));

const text = (value: unknown, fallback: string, maximum: number): string => {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maximum) || fallback;
};

const color = (value: unknown): string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#d46cff";

const enemyKind = (value: unknown): value is EnemyKind =>
  typeof value === "string" && (officialKinds.has(value) || value.startsWith("custom-enemy:"));

export const createCustomEnemy = (): CustomEnemyDraft => ({
  version: 1,
  id: createId(),
  name: "Custom Enemy",
  color: "#d46cff",
  sides: 5,
  hp: 100,
  shieldHp: 0,
  speed: 36,
  damage: 8,
  attackInterval: 1.8,
  telegraphDuration: 0.85,
  coreDamage: 2,
  radius: 18,
  hidden: false,
  boss: false,
  summoningEnabled: false,
  summonInterval: 8,
  summonCount: 2,
  summonKinds: ["dummy"],
  stunningEnabled: false,
  stunInterval: 8,
  stunRadius: 180,
  stunDuration: 2,
  updatedAt: Date.now(),
});

const sanitizeEnemy = (value: unknown): CustomEnemyDraft | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<CustomEnemyDraft>;
  const id = typeof source.id === "string" && source.id.startsWith("custom-enemy:")
    ? source.id as CustomEnemyKind
    : createId();
  const summonKinds = Array.isArray(source.summonKinds)
    ? source.summonKinds.filter((kind): kind is EnemyKind => enemyKind(kind) && kind !== id)
    : [];
  return {
    version: 1,
    id,
    name: text(source.name, "Custom Enemy", 40),
    color: color(source.color),
    sides: integer(source.sides, 5, 3, 12),
    hp: integer(source.hp, 100, 1, 10_000_000),
    shieldHp: integer(source.shieldHp, 0, 0, 10_000_000),
    speed: rangedNumber(source.speed, 36, 1, 500),
    damage: integer(source.damage, 8, 0, 1_000_000),
    attackInterval: rangedNumber(source.attackInterval, 1.8, 0.1, 120),
    telegraphDuration: rangedNumber(source.telegraphDuration, 0.85, 0.05, 30),
    coreDamage: integer(source.coreDamage, 2, 0, 9999),
    radius: rangedNumber(source.radius, 18, 6, 60),
    hidden: source.hidden === true,
    boss: source.boss === true,
    summoningEnabled: source.summoningEnabled === true,
    summonInterval: rangedNumber(source.summonInterval, 8, 0.2, 600),
    summonCount: integer(source.summonCount, 2, 1, 100),
    summonKinds: summonKinds.length > 0 ? [...new Set(summonKinds)] : ["dummy"],
    stunningEnabled: source.stunningEnabled === true,
    stunInterval: rangedNumber(source.stunInterval, 8, 0.2, 600),
    stunRadius: rangedNumber(source.stunRadius, 180, 20, 1000),
    stunDuration: rangedNumber(source.stunDuration, 2, 0.1, 60),
    updatedAt: integer(source.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  };
};

export const sanitizeCustomEnemies = (value: unknown): CustomEnemyDraft[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Map<CustomEnemyKind, CustomEnemyDraft>();
  value.forEach((candidate) => {
    const sanitized = sanitizeEnemy(candidate);
    if (sanitized) unique.set(sanitized.id, sanitized);
  });
  return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt);
};

export const loadCustomEnemies = (): CustomEnemyDraft[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeCustomEnemies(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
};

export const cacheCustomEnemiesLocally = (enemies: readonly CustomEnemyDraft[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enemies));
  } catch {
    // The in-memory editor remains usable if browser storage is unavailable.
  }
};

export const saveCustomEnemies = (enemies: readonly CustomEnemyDraft[]): void => {
  cacheCustomEnemiesLocally(enemies);
  void saveDiskSection("custom-enemies", enemies);
};

export const cloneCustomEnemy = (enemy: CustomEnemyDraft): CustomEnemyDraft => ({
  ...enemy,
  summonKinds: [...enemy.summonKinds],
});

export const upsertCustomEnemy = (
  enemies: readonly CustomEnemyDraft[],
  draft: CustomEnemyDraft,
): CustomEnemyDraft[] => {
  const sanitized = sanitizeEnemy({ ...draft, updatedAt: Date.now() });
  if (!sanitized) return [...enemies];
  const next = enemies.filter((enemy) => enemy.id !== sanitized.id);
  next.push(sanitized);
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  saveCustomEnemies(next);
  return next;
};

const shiftHex = (hex: string, amount: number): string => {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `#${channels.map((channel) => {
    const shifted = amount >= 0
      ? channel + (255 - channel) * amount
      : channel - channel * Math.abs(amount);
    return Math.round(shifted).toString(16).padStart(2, "0");
  }).join("")}`;
};

export const customEnemyToDefinition = (draft: CustomEnemyDraft): EnemyDefinition => ({
  kind: draft.id,
  name: draft.name,
  hp: draft.hp,
  shieldHp: draft.shieldHp,
  speed: draft.speed,
  damage: draft.damage,
  attackInterval: draft.attackInterval,
  telegraphDuration: Math.min(draft.telegraphDuration, draft.attackInterval),
  coreDamage: draft.coreDamage,
  radius: draft.radius,
  hidden: draft.hidden || undefined,
  boss: draft.boss || undefined,
  summon: draft.summoningEnabled
    ? { interval: draft.summonInterval, count: draft.summonCount, kinds: draft.summonKinds }
    : undefined,
  shockwave: draft.stunningEnabled
    ? { interval: draft.stunInterval, radius: draft.stunRadius, stunDuration: draft.stunDuration }
    : undefined,
  sprite: {
    shape: "polygon",
    sides: draft.sides,
    fill: draft.color,
    stroke: shiftHex(draft.color, -0.55),
    accent: shiftHex(draft.color, 0.48),
    glyph: draft.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "CE",
  },
});
