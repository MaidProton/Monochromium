export interface SaveBundle {
  readonly version: 1;
  readonly meta: unknown;
  readonly customModes: unknown;
  readonly customEnemies: unknown;
  readonly customMaps: unknown;
  readonly creatorFolders: unknown;
}

export interface DiskSaveResult {
  readonly available: boolean;
  readonly exists: boolean;
  readonly data: SaveBundle | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Normalizes imported save-shaped data before each section is sanitized. */
export const sanitizeSaveBundle = (value: unknown): SaveBundle | null => {
  const source = record(value);
  if (!source || !Object.hasOwn(source, "meta") || !Array.isArray(source["customModes"])) return null;
  return {
    version: 1,
    meta: source["meta"],
    customModes: source["customModes"],
    customEnemies: Array.isArray(source["customEnemies"]) ? source["customEnemies"] : [],
    customMaps: Array.isArray(source["customMaps"]) ? source["customMaps"] : [],
    creatorFolders: source["creatorFolders"] ?? {},
  };
};

const desktopApi = typeof window === "undefined" ? undefined : window.monochromiumDesktop;

export const hasDiskSaveApi = (): boolean => desktopApi !== undefined;

export const getDesktopEnvironment = async (): Promise<{
  packaged: boolean;
  version: string;
  savePath: string;
  gpu: MonochromiumGpuStatus;
} | null> => {
  if (!desktopApi) return null;
  try {
    return await desktopApi.getEnvironment();
  } catch {
    return null;
  }
};

export const loadDiskSave = async (): Promise<DiskSaveResult> => {
  if (desktopApi) {
    try {
      return await desktopApi.loadSave();
    } catch {
      return { available: false, exists: false, data: null };
    }
  }
  return { available: false, exists: false, data: null };
};

export const saveDiskSection = async (section: "meta" | "custom-modes" | "custom-enemies" | "custom-maps" | "creator-folders", value: unknown): Promise<boolean> => {
  if (desktopApi) {
    try {
      return await desktopApi.saveSection(section, value);
    } catch {
      return false;
    }
  }
  return false;
};

export const replaceDiskSave = async (bundle: SaveBundle): Promise<boolean> => {
  if (desktopApi) {
    try {
      return await desktopApi.replaceSave(bundle);
    } catch {
      return false;
    }
  }
  return false;
};
