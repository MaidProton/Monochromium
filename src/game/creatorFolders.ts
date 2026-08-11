import { saveDiskSection } from "./persistence.ts";

export type CreatorFolderKind = "modes" | "enemies" | "maps";

export interface CreatorFolder {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreatorFolderState {
  readonly version: 1;
  readonly modes: readonly CreatorFolder[];
  readonly enemies: readonly CreatorFolder[];
  readonly maps: readonly CreatorFolder[];
  readonly assignments: {
    readonly modes: Readonly<Record<string, string>>;
    readonly enemies: Readonly<Record<string, string>>;
    readonly maps: Readonly<Record<string, string>>;
  };
}

const STORAGE_KEY = "monochromium:creator-folders:v1";
const MAX_FOLDER_NAME_LENGTH = 40;
const MAX_ID_LENGTH = 120;

export const emptyCreatorFolderState = (): CreatorFolderState => ({
  version: 1,
  modes: [],
  enemies: [],
  maps: [],
  assignments: { modes: {}, enemies: {}, maps: {} },
});

const cleanText = (value: unknown, fallback: string, maximum: number): string => {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().slice(0, maximum);
  return cleaned || fallback;
};

const cleanId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, MAX_ID_LENGTH);
  return cleaned || null;
};

const sanitizeFolders = (value: unknown): CreatorFolder[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    const id = cleanId(source["id"]);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const timestamp = typeof source["createdAt"] === "number" && Number.isFinite(source["createdAt"])
      ? source["createdAt"]
      : Date.now();
    const updatedAt = typeof source["updatedAt"] === "number" && Number.isFinite(source["updatedAt"])
      ? source["updatedAt"]
      : timestamp;
    return [{
      id,
      name: cleanText(source["name"], "UNTITLED FOLDER", MAX_FOLDER_NAME_LENGTH),
      createdAt: timestamp,
      updatedAt,
    }];
  });
};

const sanitizeAssignments = (value: unknown, folderIds: ReadonlySet<string>): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((assignments, [assetId, folderId]) => {
    const cleanAssetId = cleanId(assetId);
    const cleanFolderId = cleanId(folderId);
    if (cleanAssetId && cleanFolderId && folderIds.has(cleanFolderId)) assignments[cleanAssetId] = cleanFolderId;
    return assignments;
  }, {});
};

export const sanitizeCreatorFolders = (value: unknown): CreatorFolderState => {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const modes = sanitizeFolders(source["modes"]);
  const enemies = sanitizeFolders(source["enemies"]);
  const maps = sanitizeFolders(source["maps"]);
  const assignments = source["assignments"] && typeof source["assignments"] === "object" && !Array.isArray(source["assignments"])
    ? source["assignments"] as Record<string, unknown>
    : {};
  return {
    version: 1,
    modes,
    enemies,
    maps,
    assignments: {
      modes: sanitizeAssignments(assignments["modes"], new Set(modes.map((folder) => folder.id))),
      enemies: sanitizeAssignments(assignments["enemies"], new Set(enemies.map((folder) => folder.id))),
      maps: sanitizeAssignments(assignments["maps"], new Set(maps.map((folder) => folder.id))),
    },
  };
};

const cloneState = (state: CreatorFolderState): {
  modes: CreatorFolder[];
  enemies: CreatorFolder[];
  maps: CreatorFolder[];
  assignments: { modes: Record<string, string>; enemies: Record<string, string>; maps: Record<string, string> };
} => ({
  modes: [...state.modes],
  enemies: [...state.enemies],
  maps: [...state.maps],
  assignments: {
    modes: { ...state.assignments.modes },
    enemies: { ...state.assignments.enemies },
    maps: { ...state.assignments.maps },
  },
});

const makeFolderId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `folder-${crypto.randomUUID()}`;
  return `folder-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const foldersFor = (state: CreatorFolderState, kind: CreatorFolderKind): readonly CreatorFolder[] => state[kind];

export const assignmentFor = (state: CreatorFolderState, kind: CreatorFolderKind, assetId: string): string | null =>
  state.assignments[kind][assetId] ?? null;

export const createCreatorFolder = (state: CreatorFolderState, kind: CreatorFolderKind, name: string): CreatorFolderState => {
  const now = Date.now();
  const next = cloneState(state);
  next[kind].push({ id: makeFolderId(), name: cleanText(name, "UNTITLED FOLDER", MAX_FOLDER_NAME_LENGTH), createdAt: now, updatedAt: now });
  return { version: 1, ...next };
};

export const renameCreatorFolder = (state: CreatorFolderState, kind: CreatorFolderKind, folderId: string, name: string): CreatorFolderState => {
  const next = cloneState(state);
  next[kind] = next[kind].map((folder) => folder.id === folderId
    ? { ...folder, name: cleanText(name, folder.name, MAX_FOLDER_NAME_LENGTH), updatedAt: Date.now() }
    : folder);
  return { version: 1, ...next };
};

export const deleteCreatorFolder = (state: CreatorFolderState, kind: CreatorFolderKind, folderId: string): CreatorFolderState => {
  const next = cloneState(state);
  next[kind] = next[kind].filter((folder) => folder.id !== folderId);
  Object.entries(next.assignments[kind]).forEach(([assetId, assignedFolderId]) => {
    if (assignedFolderId === folderId) delete next.assignments[kind][assetId];
  });
  return { version: 1, ...next };
};

export const assignCreatorAssets = (
  state: CreatorFolderState,
  kind: CreatorFolderKind,
  assetIds: readonly string[],
  folderId: string | null,
): CreatorFolderState => {
  const next = cloneState(state);
  const validFolder = folderId !== null && next[kind].some((folder) => folder.id === folderId);
  assetIds.forEach((assetId) => {
    if (!assetId) return;
    if (validFolder) next.assignments[kind][assetId] = folderId!;
    else delete next.assignments[kind][assetId];
  });
  return { version: 1, ...next };
};

export const cacheCreatorFoldersLocally = (state: CreatorFolderState): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Disk persistence remains available in the desktop build.
  }
};

export const loadCreatorFolders = (): CreatorFolderState => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeCreatorFolders(JSON.parse(raw)) : emptyCreatorFolderState();
  } catch {
    return emptyCreatorFolderState();
  }
};

export const saveCreatorFolders = (state: CreatorFolderState): void => {
  const sanitized = sanitizeCreatorFolders(state);
  cacheCreatorFoldersLocally(sanitized);
  void saveDiskSection("creator-folders", sanitized);
};
