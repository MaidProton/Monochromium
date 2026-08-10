import { app, autoUpdater, BrowserWindow, ipcMain, shell } from "electron";
import electronSquirrelStartup from "electron-squirrel-startup";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configuredUpdateValue, updateConfig } from "./update-config.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, "..");
const maximumSaveBytes = 16 * 1024 * 1024;
const saveSections = new Map([
  ["meta", "meta"],
  ["custom-modes", "customModes"],
  ["custom-enemies", "customEnemies"],
]);

const updateFeedTemplate = configuredUpdateValue(updateConfig.feedUrl, "MONOCHROMIUM_UPDATE_FEED_URL");
const updateState = {
  status: "disabled",
  currentVersion: app.getVersion(),
  message: "Automatic updates are not configured.",
};
let mainWindow = null;
let updaterReady = false;

const publishUpdateState = (nextState) => {
  Object.assign(updateState, nextState);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updater:state", { ...updateState });
};

const updateFeedUrl = () => updateFeedTemplate.replaceAll("{version}", app.getVersion());

const setupUpdater = () => {
  if (!app.isPackaged || process.platform !== "win32" || !updateFeedTemplate) return;
  try {
    autoUpdater.setFeedURL({ url: updateFeedUrl() });
    updaterReady = true;
    publishUpdateState({ status: "idle", message: `Version ${app.getVersion()} // updater ready.` });
  } catch (error) {
    publishUpdateState({ status: "error", message: `Updater setup failed // ${error instanceof Error ? error.message : "unknown error"}` });
    return;
  }

  autoUpdater.on("checking-for-update", () => publishUpdateState({ status: "checking", message: "Checking for a newer release…" }));
  autoUpdater.on("update-available", () => publishUpdateState({ status: "downloading", message: "Update found // downloading in the background…" }));
  autoUpdater.on("update-not-available", () => publishUpdateState({ status: "not-available", message: `Version ${app.getVersion()} is current.` }));
  autoUpdater.on("update-downloaded", () => publishUpdateState({ status: "downloaded", message: "Update ready // restart to install it." }));
  autoUpdater.on("error", (error) => publishUpdateState({ status: "error", message: `Update check failed // ${error instanceof Error ? error.message : String(error)}` }));

  // Squirrel holds a lock during first-run setup. Delay the first check so a
  // newly installed copy does not report a misleading updater error.
  setTimeout(() => {
    if (updaterReady) void autoUpdater.checkForUpdates().catch((error) => {
      publishUpdateState({ status: "error", message: `Update check failed // ${error instanceof Error ? error.message : String(error)}` });
    });
  }, 10_000);
};

app.setName("Monochromium");
if (electronSquirrelStartup) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.squirrel.monochromium.Monochromium");

const freshSave = () => ({
  version: 1,
  meta: null,
  customModes: [],
  customEnemies: [],
});

const normalizeSave = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    meta: source.meta ?? null,
    customModes: Array.isArray(source.customModes) ? source.customModes : [],
    customEnemies: Array.isArray(source.customEnemies) ? source.customEnemies : [],
  };
};

const savePaths = () => {
  const directory = app.getPath("userData");
  return {
    directory,
    save: path.join(directory, "monochromium_save.json"),
    backup: path.join(directory, "monochromium_save.backup.json"),
    temporary: path.join(directory, "monochromium_save.tmp.json"),
  };
};

const parseSaveFile = async (file) => {
  const details = await stat(file);
  if (details.size > maximumSaveBytes) throw new Error("Save file exceeds the 16 MB limit.");
  return normalizeSave(JSON.parse(await readFile(file, "utf8")));
};

const writeSave = async (bundle) => {
  const paths = savePaths();
  const normalized = normalizeSave(bundle);
  await mkdir(paths.directory, { recursive: true });
  try {
    await copyFile(paths.save, paths.backup);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFile(paths.temporary, JSON.stringify(normalized, null, 2), "utf8");
  await rename(paths.temporary, paths.save);
  return normalized;
};

let migrationChecked = false;
const migrateLegacySave = async () => {
  if (migrationChecked) return;
  migrationChecked = true;
  const paths = savePaths();
  try {
    await stat(paths.save);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }

  const candidates = [
    path.join(projectDirectory, "save_data", "monochromium_save.json"),
    path.join(process.cwd(), "save_data", "monochromium_save.json"),
    path.join(path.dirname(process.execPath), "save_data", "monochromium_save.json"),
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (path.resolve(candidate) === path.resolve(paths.save)) continue;
    try {
      await writeSave(await parseSaveFile(candidate));
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`Could not migrate save from ${candidate}:`, error);
    }
  }
};

const readSave = async () => {
  await migrateLegacySave();
  const paths = savePaths();
  try {
    return { exists: true, data: await parseSaveFile(paths.save) };
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Could not read desktop save:", error);
    return { exists: false, data: freshSave() };
  }
};

let saveQueue = Promise.resolve();
const queueSaveOperation = (operation) => {
  const queued = saveQueue.then(operation, operation);
  saveQueue = queued.catch(() => undefined);
  return queued;
};

ipcMain.handle("save:load", async () => {
  await saveQueue;
  const result = await readSave();
  return { available: true, ...result };
});

ipcMain.handle("save:replace", (_event, bundle) => queueSaveOperation(async () => {
  await migrateLegacySave();
  await writeSave(bundle);
  return true;
}));

ipcMain.handle("save:section", (_event, section, value) => queueSaveOperation(async () => {
  const key = saveSections.get(section);
  if (!key) throw new Error("Unknown save section.");
  const current = (await readSave()).data;
  current[key] = value;
  await writeSave(current);
  return true;
}));

ipcMain.handle("desktop:environment", () => ({
  packaged: app.isPackaged,
  version: app.getVersion(),
  savePath: savePaths().save,
}));

ipcMain.handle("updater:state", () => ({ ...updateState }));

ipcMain.handle("updater:check", async () => {
  if (!updaterReady) return { ...updateState };
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdateState({ status: "error", message: `Update check failed // ${error instanceof Error ? error.message : String(error)}` });
  }
  return { ...updateState };
});

ipcMain.handle("updater:install", () => {
  if (!updaterReady || updateState.status !== "downloaded") return false;
  autoUpdater.quitAndInstall();
  return true;
});

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#080a0b",
    title: "MONOCHROMIUM // Pathbound Defense",
    webPreferences: {
      preload: path.join(moduleDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow = window;

  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "F11") return;
    event.preventDefault();
    window.setFullScreen(!window.isFullScreen());
  });
  window.once("ready-to-show", () => window.show());

  const developmentUrl = process.env.MONOCHROMIUM_DEV_URL;
  if (!app.isPackaged && developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(path.join(projectDirectory, "dist", "index.html"));
};

app.whenReady().then(async () => {
  await migrateLegacySave();
  setupUpdater();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
