import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAXIMUM_SAVE_BYTES = 16 * 1024 * 1024;

export const SAVE_SECTIONS = new Map([
  ["meta", "meta"],
  ["custom-modes", "customModes"],
  ["custom-enemies", "customEnemies"],
  ["custom-maps", "customMaps"],
  ["creator-folders", "creatorFolders"],
]);

export const freshSave = () => ({
  version: 1,
  meta: null,
  customModes: [],
  customEnemies: [],
  customMaps: [],
  creatorFolders: { version: 1, modes: [], enemies: [], maps: [], assignments: { modes: {}, enemies: {}, maps: {} } },
});

export const normalizeSave = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    meta: source.meta ?? null,
    customModes: Array.isArray(source.customModes) ? source.customModes : [],
    customEnemies: Array.isArray(source.customEnemies) ? source.customEnemies : [],
    customMaps: Array.isArray(source.customMaps) ? source.customMaps : [],
    creatorFolders: source.creatorFolders && typeof source.creatorFolders === "object" && !Array.isArray(source.creatorFolders)
      ? source.creatorFolders
      : { version: 1, modes: [], enemies: [], maps: [], assignments: { modes: {}, enemies: {}, maps: {} } },
  };
};

export const getSavePaths = (userDataDirectory) => ({
  directory: userDataDirectory,
  save: path.join(userDataDirectory, "monochromium_save.json"),
  backup: path.join(userDataDirectory, "monochromium_save.backup.json"),
  temporary: path.join(userDataDirectory, "monochromium_save.tmp.json"),
});

export const parseSaveFile = async (filePath, maximumBytes = MAXIMUM_SAVE_BYTES) => {
  const details = await stat(filePath);
  if (details.size > maximumBytes) throw new Error("Save file exceeds the 16 MB limit.");
  return normalizeSave(JSON.parse(await readFile(filePath, "utf8")));
};

export const writeSave = async (userDataDirectory, bundle) => {
  const paths = getSavePaths(userDataDirectory);
  const normalized = normalizeSave(bundle);
  const serialized = JSON.stringify(normalized, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_SAVE_BYTES) throw new Error("Save file exceeds the 16 MB limit.");
  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.temporary, serialized, "utf8");
  let primaryValid = false;
  try { await parseSaveFile(paths.save); primaryValid = true; } catch { /* Keep the last recoverable backup. */ }
  if (primaryValid) await copyFile(paths.save, paths.backup);
  await rename(paths.temporary, paths.save);
  return normalized;
};

export const migrateLegacySave = async (userDataDirectory, candidateDirectories = []) => {
  const paths = getSavePaths(userDataDirectory);
  try {
    await stat(paths.save);
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }

  const candidates = candidateDirectories.map((dir) =>
    path.extname(dir) === ".json" ? dir : path.join(dir, "save_data", "monochromium_save.json")
  );

  for (const candidate of [...new Set(candidates)]) {
    if (path.resolve(candidate) === path.resolve(paths.save)) continue;
    try {
      const parsed = await parseSaveFile(candidate);
      await writeSave(userDataDirectory, parsed);
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`Could not migrate save from ${candidate}:`, error);
    }
  }
  return false;
};

export const readSave = async (userDataDirectory, { logger = console } = {}) => {
  const paths = getSavePaths(userDataDirectory);
  try {
    return { exists: true, data: await parseSaveFile(paths.save) };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      logger.warn?.("Could not read desktop save:", error);
    }
    {
      try {
        const backupData = await parseSaveFile(paths.backup);
        logger.warn?.("Restored save data from backup file.");
        return { exists: true, data: backupData, restoredFromBackup: true };
      } catch {
        // Backup missing or unparseable
      }
    }
    return { exists: false, data: freshSave() };
  }
};

export const createSaveQueue = () => {
  let saveQueue = Promise.resolve();
  return (operation) => {
    const queued = saveQueue.then(operation, operation);
    saveQueue = queued.catch(() => undefined);
    return queued;
  };
};
