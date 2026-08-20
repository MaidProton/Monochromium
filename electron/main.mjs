import { app, autoUpdater, BrowserWindow, ipcMain, shell, utilityProcess } from "electron";
import electronSquirrelStartup from "electron-squirrel-startup";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configuredUpdateValue, updateConfig } from "./update-config.mjs";
import { HostNetwork } from "./host-network.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, "..");
const towerConfigPath = path.join(projectDirectory, "src", "game", "config.ts");
const maximumSaveBytes = 16 * 1024 * 1024;
const saveSections = new Map([
  ["meta", "meta"],
  ["custom-modes", "customModes"],
  ["custom-enemies", "customEnemies"],
  ["custom-maps", "customMaps"],
  ["creator-folders", "creatorFolders"],
]);

const updateFeedTemplate = configuredUpdateValue(updateConfig.feedUrl, "MONOCHROMIUM_UPDATE_FEED_URL");
const updateState = {
  status: "disabled",
  currentVersion: app.getVersion(),
  message: "Automatic updates are not configured.",
};
let mainWindow = null;
let hostServerProcess = null;
let hostServerStopping = false;
let hostNetwork = null;
const hostCommandOwners = new Map();
let updaterReady = false;
let updateCheckPromise = null;
let updateDownloadPromise = null;

const publishUpdateState = (nextState) => {
  Object.assign(updateState, nextState);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updater:state", { ...updateState });
};

const publishRendererMessage = (channel, message) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, message);
};

const publishHostServerMessage = (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "state" && message.frame instanceof ArrayBuffer) {
    let sent = false;
    if (hostNetwork?.connected) {
      sent = hostNetwork.sendBinary(message.frame.slice(0));
      if (!sent) {
        try { hostServerProcess?.postMessage({ type: "keyframe-request" }); } catch { /* The server may be stopping. */ }
      }
    }
    publishRendererMessage("host-server:message", { ...message, sent });
    return;
  }
  if (message.type === "command-result") {
    const owner = hostCommandOwners.get(message.result?.commandId) ?? "host";
    hostCommandOwners.delete(message.result?.commandId);
    if (owner === "guest") {
      hostNetwork?.sendControl({ type: "command-result", result: message.result });
      return;
    }
  }
  if (message.type === "diagnostics" || message.type === "ready") {
    const diagnostics = message.diagnostics;
    if (diagnostics && hostNetwork?.connected) hostNetwork.sendControl({ type: "server-diagnostics", diagnostics });
  }
  publishRendererMessage("host-server:message", message);
};

const publishHostNetworkMessage = (message) => publishRendererMessage("host-network:message", message);

const postHostServer = (message) => {
  if (!hostServerProcess) return false;
  try {
    hostServerProcess.postMessage(message);
    return true;
  } catch {
    return false;
  }
};

const createHostNetwork = () => hostNetwork ??= new HostNetwork({
  onStatus: (message) => publishHostNetworkMessage(message),
  onControl: (message, peerId) => {
    if (message.type === "command") {
      const submitted = postHostServer({ type: "command", envelope: message.envelope });
      if (submitted) hostCommandOwners.set(message.envelope.commandId, "guest");
      else hostNetwork?.sendControl({
        type: "command-result",
        result: {
          commandId: message.envelope.commandId,
          accepted: false,
          serverTick: 0,
          rejectionCode: "not-running",
          message: "Authoritative server is not ready.",
        },
      });
      return;
    }
    if (message.type === "resync-request") {
      postHostServer({ type: "keyframe-request" });
      return;
    }
    if (message.type === "event-ack") {
      postHostServer({ type: "event-ack", eventId: message.eventId });
      return;
    }
    publishHostNetworkMessage({ type: "control", message, peerId });
  },
  onRealtime: (message, peerId) => publishHostNetworkMessage({ type: "realtime", message, peerId }),
  onPeerStatus: (connected) => postHostServer({ type: "peer-status", connected }),
});

const stopHostServer = (reason = "Host server stopped.") => {
  const server = hostServerProcess;
  if (!server) return;
  hostServerStopping = true;
  try { server.postMessage({ type: "stop", reason }); } catch { /* It may already have exited. */ }
  setTimeout(() => {
    if (hostServerProcess === server) server.kill();
  }, 1_000).unref();
};

const startHostNetwork = async (config) => {
  if (!config || typeof config.roomCode !== "string" || config.roomCode.length < 6 || config.roomCode.length > 8) {
    throw new Error("Invalid host room configuration.");
  }
  await createHostNetwork().start(config.roomCode, config.iceServers);
  return true;
};

const stopHostNetwork = (reason = "Host networking stopped.") => {
  hostNetwork?.stop(reason);
  hostCommandOwners.clear();
};

const startHostServer = (config) => {
  if (!config || typeof config !== "object" || typeof config.sessionId !== "string" || !Array.isArray(config.players) || config.players.length !== 2) {
    throw new Error("Invalid host simulation configuration.");
  }
  if (hostServerProcess) throw new Error("An authoritative simulation is already running.");
  const serverPath = path.join(projectDirectory, "dist-server", "simulation-server.mjs");
  hostServerStopping = false;
  const server = utilityProcess.fork(serverPath, [], {
    serviceName: "Monochromium Authoritative Simulation",
    stdio: app.isPackaged ? "ignore" : "inherit",
  });
  hostServerProcess = server;
  server.on("message", (message) => publishHostServerMessage(message));
  server.once("exit", (code) => {
    const expected = hostServerStopping;
    if (hostServerProcess === server) hostServerProcess = null;
    hostServerStopping = false;
    if (!expected) {
      stopHostNetwork("Authoritative simulation exited.");
      publishHostServerMessage({ type: "fatal", message: `Authoritative simulation exited unexpectedly (code ${code}).` });
    }
  });
  server.postMessage({ type: "start", config });
  if (hostNetwork?.connected) server.postMessage({ type: "peer-status", connected: true });
  return true;
};

const updateFeedUrl = () => updateFeedTemplate.replaceAll("{version}", app.getVersion());

const findTowerDefinitionBlock = (source, kind) => {
  const marker = `  ${kind}: {`;
  const start = source.indexOf(marker, source.indexOf("export const TOWER_DEFINITIONS"));
  if (start < 0) throw new Error(`Could not find tower definition: ${kind}`);
  const openingBrace = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return { start, end: index };
  }
  throw new Error(`Could not parse tower definition: ${kind}`);
};
const updateReleaseFileUrl = () => `${updateFeedUrl()}/RELEASES?id=monochromium&localVersion=${encodeURIComponent(app.getVersion())}&arch=${process.arch === "x64" ? "amd64" : process.arch}`;
const versionParts = (value) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
};

const updaterProcessIsActive = () => updateCheckPromise !== null || updateDownloadPromise !== null;

const inspectForUpdates = async () => {
  if (!updaterReady || updaterProcessIsActive()) return;
  publishUpdateState({ status: "checking", message: "Checking for a newer release…" });
  updateCheckPromise = fetch(updateReleaseFileUrl())
    .then(async (response) => {
      if (!response.ok) throw new Error(`Update service returned HTTP ${response.status}.`);
      const releases = await response.text();
      const versions = [...releases.matchAll(/monochromium-(\d+\.\d+\.\d+)-(?:full|delta)\.nupkg/gi)]
        .map((match) => match[1])
        .filter((version) => version !== undefined);
      const latestVersion = versions.reduce((latest, version) => {
        if (!latest || compareVersions(version, latest) > 0) return version;
        return latest;
      }, null);
      if (!latestVersion || compareVersions(latestVersion, app.getVersion()) <= 0) {
        publishUpdateState({ status: "not-available", message: `Version ${app.getVersion()} is current.` });
        return;
      }
      publishUpdateState({
        status: "available",
        message: `Version ${latestVersion} available // download requires approval.`,
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      publishUpdateState({ status: "error", message: `Update check failed // ${message}` });
    })
    .finally(() => {
      updateCheckPromise = null;
    });
  await updateCheckPromise;
};

const downloadUpdate = async () => {
  if (!updaterReady || updateState.status !== "available" || updaterProcessIsActive()) return;
  publishUpdateState({ status: "downloading", message: "Downloading update // please keep the game open…" });
  updateDownloadPromise = autoUpdater.checkForUpdates()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      publishUpdateState({ status: "error", message: `Update download failed // ${message}` });
    })
    .finally(() => {
      updateDownloadPromise = null;
    });
  await updateDownloadPromise;
};

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

  autoUpdater.on("checking-for-update", () => publishUpdateState({ status: "downloading", message: "Starting approved update download…" }));
  autoUpdater.on("update-available", () => publishUpdateState({ status: "downloading", message: "Update approved // downloading…" }));
  autoUpdater.on("update-not-available", () => publishUpdateState({ status: "error", message: "The approved update was not available." }));
  autoUpdater.on("update-downloaded", () => publishUpdateState({ status: "downloaded", message: "Update ready // restart to install it." }));
  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    publishUpdateState({ status: "error", message: `Update download failed // ${message}` });
  });

  // Squirrel holds a lock during first-run setup. Delay the first check so a
  // newly installed copy does not report a misleading updater error.
  setTimeout(() => void inspectForUpdates(), 10_000);
};

app.setName("Monochromium");
if (electronSquirrelStartup) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.squirrel.monochromium.Monochromium");

const freshSave = () => ({
  version: 1,
  meta: null,
  customModes: [],
  customEnemies: [],
  customMaps: [],
  creatorFolders: { version: 1, modes: [], enemies: [], maps: [], assignments: { modes: {}, enemies: {}, maps: {} } },
});

const normalizeSave = (value) => {
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

ipcMain.handle("host-server:start", (event, config) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("Untrusted host-server request.");
  return startHostServer(config);
});

ipcMain.handle("host-network:start", async (event, config) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("Untrusted host-network request.");
  return startHostNetwork(config);
});

ipcMain.handle("host-network:control", (event, message) => {
  if (event.sender !== mainWindow?.webContents) return false;
  return Boolean(hostNetwork?.sendControl(message));
});

ipcMain.handle("host-network:realtime", (event, message) => {
  if (event.sender !== mainWindow?.webContents) return false;
  return Boolean(hostNetwork?.sendRealtime(message));
});

ipcMain.handle("host-network:rtt", async (event) => {
  if (event.sender !== mainWindow?.webContents) return null;
  return await (hostNetwork?.measureRtt() ?? null);
});

ipcMain.handle("host-network:stop", (event, reason) => {
  if (event.sender !== mainWindow?.webContents) return false;
  stopHostNetwork(typeof reason === "string" ? reason.slice(0, 500) : "Host networking stopped.");
  return true;
});

ipcMain.handle("host-server:command", (event, envelope) => {
  if (event.sender !== mainWindow?.webContents || !hostServerProcess) return false;
  if (envelope && typeof envelope.commandId === "string") hostCommandOwners.set(envelope.commandId, "host");
  hostServerProcess.postMessage({ type: "command", envelope });
  return true;
});

ipcMain.handle("host-server:keyframe", (event) => {
  if (event.sender !== mainWindow?.webContents || !hostServerProcess) return false;
  hostServerProcess.postMessage({ type: "keyframe-request" });
  return true;
});

ipcMain.handle("host-server:stop", (event, reason) => {
  if (event.sender !== mainWindow?.webContents) return false;
  stopHostServer(typeof reason === "string" ? reason.slice(0, 500) : "Host ended the session.");
  return true;
});

ipcMain.handle("balance:save-tower", async (_event, kind, definition) => {
  if (app.isPackaged) throw new Error("The Tower Balance Lab is available only in development builds.");
  if (typeof kind !== "string" || !/^[a-z]+$/.test(kind)) throw new Error("Invalid tower kind.");
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("Invalid tower definition.");
  const source = await readFile(towerConfigPath, "utf8");
  const block = findTowerDefinitionBlock(source, kind);
  const formatted = `  ${kind}: ${JSON.stringify(definition, null, 2).replaceAll("\n", "\n  ")}`;
  await writeFile(towerConfigPath, `${source.slice(0, block.start)}${formatted}${source.slice(block.end + 1)}`, "utf8");
  return { ok: true, path: towerConfigPath };
});

ipcMain.handle("updater:state", () => ({ ...updateState }));

ipcMain.handle("updater:check", async () => {
  if (!updaterReady) return { ...updateState };
  await inspectForUpdates();
  return { ...updateState };
});

ipcMain.handle("updater:download", async () => {
  if (!updaterReady) return { ...updateState };
  await downloadUpdate();
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
  stopHostNetwork("Application closed.");
  stopHostServer("Application closed.");
  if (process.platform !== "darwin") app.quit();
});
