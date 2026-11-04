import { describe, expect, it } from "vitest";
import { getDesktopEnvironment, hasDiskSaveApi, loadDiskSave, replaceDiskSave, sanitizeSaveBundle, saveDiskSection } from "./persistence.ts";

describe("desktop persistence boundary", () => {
  it("fails closed outside the Electron bridge", async () => {
    expect(hasDiskSaveApi()).toBe(false);
    expect(await getDesktopEnvironment()).toBeNull();
    expect(await loadDiskSave()).toEqual({ available: false, exists: false, data: null });
    expect(await saveDiskSection("meta", {})).toBe(false);
    expect(await replaceDiskSave({ version: 1, meta: {}, customModes: [], customEnemies: [], customMaps: [], creatorFolders: {} })).toBe(false);
  });

  it("normalizes legacy and malformed import shapes before section sanitization", () => {
    expect(sanitizeSaveBundle({ meta: { coins: 5 }, customModes: [{ id: "custom:one" }] })).toEqual({
      version: 1,
      meta: { coins: 5 },
      customModes: [{ id: "custom:one" }],
      customEnemies: [],
      customMaps: [],
      creatorFolders: {},
    });
    expect(sanitizeSaveBundle({ meta: {}, customModes: "not-an-array" })).toBeNull();
    expect(sanitizeSaveBundle(null)).toBeNull();
  });
});
