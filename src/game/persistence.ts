export interface SaveBundle {
  readonly version: 1;
  readonly meta: unknown;
  readonly customModes: unknown;
  readonly customEnemies: unknown;
}

export interface DiskSaveResult {
  readonly available: boolean;
  readonly exists: boolean;
  readonly data: SaveBundle | null;
}

const apiPort = new URLSearchParams(window.location.search).get("saveApi");
const desktopApi = window.monochromiumDesktop;
const apiBase = apiPort && /^\d{1,5}$/.test(apiPort)
  ? `http://${window.location.hostname}:${apiPort}/api/save`
  : null;

const request = async (path = "", init?: RequestInit): Promise<Response | null> => {
  if (!apiBase) return null;
  try {
    return await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return null;
  }
};

export const hasDiskSaveApi = (): boolean => desktopApi !== undefined || apiBase !== null;

export const getDesktopEnvironment = async (): Promise<{
  packaged: boolean;
  version: string;
  savePath: string;
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
  const response = await request();
  if (!response?.ok) return { available: false, exists: false, data: null };
  try {
    const payload = await response.json() as { exists?: unknown; data?: unknown };
    const data = payload.data && typeof payload.data === "object" ? payload.data as SaveBundle : null;
    return { available: true, exists: payload.exists === true, data };
  } catch {
    return { available: false, exists: false, data: null };
  }
};

export const saveDiskSection = async (section: "meta" | "custom-modes" | "custom-enemies", value: unknown): Promise<boolean> => {
  if (desktopApi) {
    try {
      return await desktopApi.saveSection(section, value);
    } catch {
      return false;
    }
  }
  const response = await request(`/${section}`, { method: "PUT", body: JSON.stringify(value) });
  return Boolean(response?.ok);
};

export const replaceDiskSave = async (bundle: SaveBundle): Promise<boolean> => {
  if (desktopApi) {
    try {
      return await desktopApi.replaceSave(bundle);
    } catch {
      return false;
    }
  }
  const response = await request("", { method: "PUT", body: JSON.stringify(bundle) });
  return Boolean(response?.ok);
};
