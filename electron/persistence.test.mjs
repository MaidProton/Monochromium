import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSaveQueue,
  freshSave,
  getSavePaths,
  MAXIMUM_SAVE_BYTES,
  migrateLegacySave,
  normalizeSave,
  parseSaveFile,
  readSave,
  SAVE_SECTIONS,
  writeSave,
} from "./save-manager.mjs";

describe("desktop save persistence", () => {
  let testDir;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "monochromium-save-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("freshSave and normalizeSave", () => {
    it("provides a valid default schema with expected sections", () => {
      const fresh = freshSave();
      expect(fresh.version).toBe(1);
      expect(fresh.meta).toBeNull();
      expect(fresh.customModes).toEqual([]);
      expect(fresh.customEnemies).toEqual([]);
      expect(fresh.customMaps).toEqual([]);
      expect(fresh.creatorFolders).toMatchObject({
        version: 1,
        modes: [],
        enemies: [],
        maps: [],
      });
    });

    it("normalizes malformed and partial inputs", () => {
      expect(normalizeSave(null)).toEqual(freshSave());
      expect(normalizeSave("invalid")).toEqual(freshSave());
      expect(normalizeSave([])).toEqual(freshSave());

      const partial = {
        meta: { coins: 100 },
        customModes: "not-an-array",
      };
      const normalized = normalizeSave(partial);
      expect(normalized.meta).toEqual({ coins: 100 });
      expect(normalized.customModes).toEqual([]);
      expect(normalized.customEnemies).toEqual([]);
    });

    it("contains expected save section mappings", () => {
      expect(SAVE_SECTIONS.get("meta")).toBe("meta");
      expect(SAVE_SECTIONS.get("custom-modes")).toBe("customModes");
      expect(SAVE_SECTIONS.get("custom-enemies")).toBe("customEnemies");
      expect(SAVE_SECTIONS.get("custom-maps")).toBe("customMaps");
      expect(SAVE_SECTIONS.get("creator-folders")).toBe("creatorFolders");
    });
  });

  describe("writeSave and atomic backup", () => {
    it("writes a normalized save file atomically to disk", async () => {
      const bundle = {
        meta: { coins: 250, tokens: 3 },
        customModes: [{ id: "custom:1", name: "Challenge" }],
      };
      const written = await writeSave(testDir, bundle);
      expect(written.meta).toEqual({ coins: 250, tokens: 3 });

      const paths = getSavePaths(testDir);
      const onDisk = JSON.parse(await readFile(paths.save, "utf8"));
      expect(onDisk.meta).toEqual({ coins: 250, tokens: 3 });
      expect(onDisk.customModes).toHaveLength(1);

      // Temporary file must not linger
      await expect(stat(paths.temporary)).rejects.toThrow();
    });

    it("creates a backup file before overwriting an existing save", async () => {
      const paths = getSavePaths(testDir);
      await writeSave(testDir, { meta: { coins: 100 } });
      await expect(stat(paths.backup)).rejects.toThrow(); // No backup on first write

      // Overwrite with next version
      await writeSave(testDir, { meta: { coins: 200 } });
      const current = JSON.parse(await readFile(paths.save, "utf8"));
      const backup = JSON.parse(await readFile(paths.backup, "utf8"));

      expect(current.meta.coins).toBe(200);
      expect(backup.meta.coins).toBe(100);
    });
  });

  it("rejects oversized or unserializable writes without damaging recovery files", async () => {
    await writeSave(testDir, { meta: { coins: 123 } });
    await writeSave(testDir, { meta: { coins: 456 } });
    const paths = getSavePaths(testDir);
    const before = await Promise.all([readFile(paths.save, "utf8"), readFile(paths.backup, "utf8")]);
    await expect(writeSave(testDir, { meta: { label: "x".repeat(MAXIMUM_SAVE_BYTES) } })).rejects.toThrow("16 MB");
    await expect(writeSave(testDir, { meta: { coins: 1n } })).rejects.toThrow();
    expect(await Promise.all([readFile(paths.save, "utf8"), readFile(paths.backup, "utf8")])).toEqual(before);
  });

  it("keeps the valid backup when replacing a corrupt primary and recovers a missing primary", async () => {
    const paths = getSavePaths(testDir);
    await writeFile(paths.backup, JSON.stringify({ meta: { coins: 123 } }));
    expect((await readSave(testDir, { logger: {} })).data.meta.coins).toBe(123);
    await writeFile(paths.save, "corrupt");
    await writeSave(testDir, { meta: { coins: 456 } });
    expect((await parseSaveFile(paths.backup)).meta.coins).toBe(123);
    expect((await readSave(testDir)).data.meta.coins).toBe(456);
  });

  describe("parseSaveFile and size limits", () => {
    it("parses valid JSON saves", async () => {
      const saveFile = path.join(testDir, "test_save.json");
      await writeFile(saveFile, JSON.stringify({ meta: { coins: 42 } }), "utf8");

      const result = await parseSaveFile(saveFile);
      expect(result.meta).toEqual({ coins: 42 });
    });

    it("rejects files exceeding maximum allowed bytes", async () => {
      const saveFile = path.join(testDir, "oversized.json");
      await writeFile(saveFile, "{}", "utf8");

      await expect(parseSaveFile(saveFile, 1)).rejects.toThrow("Save file exceeds the 16 MB limit.");
    });
  });

  describe("readSave and corrupt recovery", () => {
    it("returns fresh save when save file does not exist", async () => {
      const result = await readSave(testDir);
      expect(result.exists).toBe(false);
      expect(result.data).toEqual(freshSave());
    });

    it("returns existing save when present", async () => {
      await writeSave(testDir, { meta: { coins: 500 } });
      const result = await readSave(testDir);
      expect(result.exists).toBe(true);
      expect(result.data.meta.coins).toBe(500);
    });

    it("recovers from backup file when primary save is corrupted JSON", async () => {
      const paths = getSavePaths(testDir);
      // Write initial valid save (will become backup)
      await writeSave(testDir, { meta: { coins: 300 } });
      // Overwrite to create backup
      await writeSave(testDir, { meta: { coins: 400 } });

      // Corrupt the primary save file with broken JSON
      await writeFile(paths.save, "{ corrupted json: missing quotes", "utf8");

      const logger = { warn: vi.fn() };
      const result = await readSave(testDir, { logger });
      expect(result.exists).toBe(true);
      expect(result.restoredFromBackup).toBe(true);
      expect(result.data.meta.coins).toBe(300); // restored from backup
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Restored save data from backup file."));
    });
  });

  describe("migrateLegacySave", () => {
    it("does not migrate if save file already exists in userData", async () => {
      await writeSave(testDir, { meta: { coins: 999 } });

      const legacyDir = path.join(testDir, "legacy");
      await mkdir(path.join(legacyDir, "save_data"), { recursive: true });
      await writeFile(path.join(legacyDir, "save_data", "monochromium_save.json"), JSON.stringify({ meta: { coins: 1 } }), "utf8");

      const migrated = await migrateLegacySave(testDir, [legacyDir]);
      expect(migrated).toBe(false);

      const current = await readSave(testDir);
      expect(current.data.meta.coins).toBe(999);
    });

    it("migrates legacy save from candidate locations when userData save is absent", async () => {
      const legacyDir = path.join(testDir, "legacy_project");
      await mkdir(path.join(legacyDir, "save_data"), { recursive: true });
      await writeFile(
        path.join(legacyDir, "save_data", "monochromium_save.json"),
        JSON.stringify({ meta: { coins: 777, runs: 12 } }),
        "utf8",
      );

      const migrated = await migrateLegacySave(testDir, [
        path.join(testDir, "nonexistent"),
        legacyDir,
      ]);
      expect(migrated).toBe(true);

      const current = await readSave(testDir);
      expect(current.exists).toBe(true);
      expect(current.data.meta.coins).toBe(777);
      expect(current.data.meta.runs).toBe(12);
    });
  });

  describe("createSaveQueue", () => {
    it("executes operations sequentially", async () => {
      const queue = createSaveQueue();
      const order = [];

      const op1 = queue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push(1);
        return "first";
      });

      const op2 = queue(async () => {
        order.push(2);
        return "second";
      });

      const results = await Promise.all([op1, op2]);
      expect(results).toEqual(["first", "second"]);
      expect(order).toEqual([1, 2]);
    });

    it("continues queue execution even after an operation throws", async () => {
      const queue = createSaveQueue();

      await expect(queue(async () => {
        throw new Error("Disk full");
      })).rejects.toThrow("Disk full");

      const next = await queue(async () => "recovered");
      expect(next).toBe("recovered");
    });
  });
});
