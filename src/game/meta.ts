import { MAP_DEFINITIONS, TOWER_DEFINITIONS, TOWER_ORDER } from "./config.ts";
import { saveDiskSection } from "./persistence.ts";
import type { OfficialMapKind, TowerKind } from "./types.ts";

const STORAGE_KEY = "monochromium.meta.v1";

export interface MetaProgress {
  readonly version: 1;
  coins: number;
  tokens: number;
  unlockedTowers: TowerKind[];
  loadout: TowerKind[];
  clearedMaps: OfficialMapKind[];
  runs: number;
  victories: number;
}

const freshProgress = (): MetaProgress => ({
  version: 1,
  coins: 0,
  tokens: 0,
  unlockedTowers: ["bandit"],
  loadout: ["bandit"],
  clearedMaps: [],
  runs: 0,
  victories: 0,
});

const uniqueKnownTowers = (value: unknown): TowerKind[] => {
  const requested = Array.isArray(value) ? value : [];
  const known = new Set<TowerKind>(["bandit"]);
  requested.forEach((kind) => {
    if (typeof kind === "string" && TOWER_ORDER.includes(kind as TowerKind)) known.add(kind as TowerKind);
  });
  return TOWER_ORDER.filter((kind) => known.has(kind));
};

const sanitizeLoadout = (value: unknown, unlockedTowers: readonly TowerKind[]): TowerKind[] => {
  const unlocked = new Set(unlockedTowers);
  if (Array.isArray(value)) {
    return [...new Set(value.filter((kind): kind is TowerKind => typeof kind === "string" && unlocked.has(kind as TowerKind)))].slice(0, 5);
  }
  const fallback = unlockedTowers.slice(0, 5);
  return fallback;
};

const uniqueKnownMaps = (value: unknown): OfficialMapKind[] => {
  if (!Array.isArray(value)) return [];
  const known = new Set(Object.keys(MAP_DEFINITIONS) as OfficialMapKind[]);
  return [...new Set(value.filter((kind): kind is OfficialMapKind => typeof kind === "string" && known.has(kind as OfficialMapKind)))];
};

const safeNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export const sanitizeProgress = (value: unknown): MetaProgress => {
  const stored = value && typeof value === "object" ? value as Partial<MetaProgress> : {};
  const unlockedTowers = uniqueKnownTowers(stored.unlockedTowers);
  return {
    version: 1,
    coins: safeNumber(stored.coins),
    tokens: safeNumber(stored.tokens),
    unlockedTowers,
    loadout: sanitizeLoadout(stored.loadout, unlockedTowers),
    clearedMaps: uniqueKnownMaps(stored.clearedMaps),
    runs: safeNumber(stored.runs),
    victories: safeNumber(stored.victories),
  };
};

export const loadProgress = (): MetaProgress => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshProgress();
    return sanitizeProgress(JSON.parse(raw));
  } catch {
    return freshProgress();
  }
};

export const cacheProgressLocally = (progress: MetaProgress): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // The current run remains playable if a browser blocks persistent storage.
  }
};

export const saveProgress = (progress: MetaProgress): void => {
  cacheProgressLocally(progress);
  void saveDiskSection("meta", progress);
};

export const unlockTower = (progress: MetaProgress, kind: TowerKind): boolean => {
  if (progress.unlockedTowers.includes(kind)) return false;
  const cost = TOWER_DEFINITIONS[kind].unlockCost;
  if (progress.coins < cost) return false;
  progress.coins -= cost;
  progress.unlockedTowers = uniqueKnownTowers([...progress.unlockedTowers, kind]);
  if (progress.loadout.length < 5) progress.loadout = [...progress.loadout, kind];
  saveProgress(progress);
  return true;
};

export type TowerLoadoutResult = "equipped" | "unequipped" | "full" | "locked";

export const toggleTowerLoadout = (progress: MetaProgress, kind: TowerKind): TowerLoadoutResult => {
  if (!progress.unlockedTowers.includes(kind)) return "locked";
  if (progress.loadout.includes(kind)) {
    progress.loadout = progress.loadout.filter((candidate) => candidate !== kind);
    saveProgress(progress);
    return "unequipped";
  }
  if (progress.loadout.length >= 5) return "full";
  progress.loadout = [...progress.loadout, kind];
  saveProgress(progress);
  return "equipped";
};

export const unlockEveryTower = (progress: MetaProgress): void => {
  progress.unlockedTowers = [...TOWER_ORDER];
  saveProgress(progress);
};
