import { getEnemyDefinition, isKnownEnemyKind } from "./enemyRegistry.ts";
import { saveDiskSection } from "./persistence.ts";
import type { EnemyGroupWaveBlock, EnemyKind, ModeDefinition, ModeKind } from "./types.ts";

const STORAGE_KEY = "monochromium.custom-modes.v1";

export interface CustomEnemyGroupBlockDraft {
  command: "enemyGroup";
  enemy: EnemyKind;
  count: number;
  spawnDelay: number;
  nextBlockDelay: number;
}

export interface CustomWaveDraft {
  cashReward: number;
  blocks: CustomEnemyGroupBlockDraft[];
}

export interface CustomModeDraft {
  version: 1;
  id: `custom:${string}`;
  name: string;
  description: string;
  startingCash: number;
  coreIntegrity: number;
  waves: CustomWaveDraft[];
  updatedAt: number;
}

const numberInRange = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
};

const integerInRange = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
  Math.round(numberInRange(value, fallback, minimum, maximum));

const safeText = (value: unknown, fallback: string, maximumLength: number): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maximumLength);
  return trimmed || fallback;
};

const freshBlock = (): CustomEnemyGroupBlockDraft => ({
  command: "enemyGroup",
  enemy: "dummy",
  count: 5,
  spawnDelay: 1,
  nextBlockDelay: 5,
});

const createId = (): `custom:${string}` => {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom:${randomId}`;
};

export const createCustomMode = (): CustomModeDraft => ({
  version: 1,
  id: createId(),
  name: "Untitled Mode",
  description: "A custom finite defense timeline.",
  startingCash: 500,
  coreIntegrity: 12,
  waves: [{ cashReward: 50, blocks: [freshBlock()] }],
  updatedAt: Date.now(),
});

const sanitizeBlock = (value: unknown): CustomEnemyGroupBlockDraft => {
  const source = value && typeof value === "object" ? value as Partial<CustomEnemyGroupBlockDraft> : {};
  // Keep valid custom-enemy IDs even when the referenced enemy is not
  // installed yet. This lets imported modes remain locked instead of
  // silently changing their waves to Dummy.
  const rawEnemy = source.enemy as unknown;
  const enemy = (isKnownEnemyKind(rawEnemy) || (typeof rawEnemy === "string" && rawEnemy.startsWith("custom-enemy:")))
    ? rawEnemy as EnemyKind
    : "dummy";
  return {
    command: "enemyGroup",
    enemy,
    count: integerInRange(source.count, 1, 1, 10000),
    spawnDelay: numberInRange(source.spawnDelay, 1, 0.02, 3600),
    nextBlockDelay: numberInRange(source.nextBlockDelay, 1, 0, 3600),
  };
};

const sanitizeWave = (value: unknown): CustomWaveDraft => {
  const source = value && typeof value === "object" ? value as Partial<CustomWaveDraft> : {};
  const blocks = Array.isArray(source.blocks) ? source.blocks.map(sanitizeBlock) : [];
  return {
    cashReward: integerInRange(source.cashReward, 0, 0, 1_000_000_000),
    blocks: blocks.length > 0 ? blocks : [freshBlock()],
  };
};

const sanitizeMode = (value: unknown): CustomModeDraft | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<CustomModeDraft>;
  const id = typeof source.id === "string" && source.id.startsWith("custom:")
    ? source.id as `custom:${string}`
    : createId();
  const waves = Array.isArray(source.waves) ? source.waves.map(sanitizeWave) : [];
  return {
    version: 1,
    id,
    name: safeText(source.name, "Untitled Mode", 48),
    description: safeText(source.description, "A custom finite defense timeline.", 220),
    startingCash: integerInRange(source.startingCash, 500, 0, 1_000_000_000),
    coreIntegrity: integerInRange(source.coreIntegrity, 12, 1, 9999),
    waves: waves.length > 0 ? waves : [{ cashReward: 50, blocks: [freshBlock()] }],
    updatedAt: integerInRange(source.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  };
};

export const sanitizeCustomModes = (value: unknown): CustomModeDraft[] => {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeMode).filter((mode): mode is CustomModeDraft => mode !== null);
};

export const loadCustomModes = (): CustomModeDraft[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeCustomModes(parsed);
  } catch {
    return [];
  }
};

export const cacheCustomModesLocally = (modes: readonly CustomModeDraft[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // Creator state remains usable until this page is closed if storage is blocked.
  }
};

export const saveCustomModes = (modes: readonly CustomModeDraft[]): void => {
  cacheCustomModesLocally(modes);
  void saveDiskSection("custom-modes", modes);
};

export const cloneCustomMode = (mode: CustomModeDraft): CustomModeDraft => ({
  ...mode,
  waves: mode.waves.map((wave) => ({
    ...wave,
    blocks: wave.blocks.map((block) => ({ ...block })),
  })),
});

export const customModeToDefinition = (draft: CustomModeDraft): ModeDefinition => {
  const waves = draft.waves.map((wave) => {
    const blocks: EnemyGroupWaveBlock[] = wave.blocks.map((block) => ({ ...block }));
    const referenceHealth = blocks.reduce(
      (total, block) => {
        const enemy = getEnemyDefinition(block.enemy);
        return total + (enemy.hp + enemy.shieldHp) * block.count;
      },
      0,
    );
    return {
      blocks,
      cashReward: wave.cashReward,
      referenceHealth,
      waveTimeSeconds: null,
    };
  });
  return {
    kind: draft.id as ModeKind,
    name: draft.name,
    index: 0,
    isCustom: true,
    description: draft.description,
    startingCash: draft.startingCash,
    coreIntegrity: draft.coreIntegrity,
    reward: { coins: 0, tokens: 0 },
    waves,
  };
};

export const upsertCustomMode = (
  modes: readonly CustomModeDraft[],
  draft: CustomModeDraft,
): CustomModeDraft[] => {
  const sanitized = sanitizeMode({ ...draft, updatedAt: Date.now() });
  if (!sanitized) return [...modes];
  const next = modes.filter((mode) => mode.id !== sanitized.id);
  next.push(sanitized);
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  saveCustomModes(next);
  return next;
};

export const deleteCustomMode = (
  modes: readonly CustomModeDraft[],
  id: string,
): CustomModeDraft[] => {
  const next = modes.filter((mode) => mode.id !== id);
  saveCustomModes(next);
  return next;
};
