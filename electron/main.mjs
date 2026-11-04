import { app, BrowserWindow, ipcMain, shell, utilityProcess } from "electron";
import electronSquirrelStartup from "electron-squirrel-startup";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configuredMultiplayerRelayUrl } from "./multiplayer-config.mjs";
import { RelayNetwork } from "./relay-network.mjs";
import { isGuestAction } from "./guest-identity.mjs";
import {
  compareVersions,
  createFullPackageManifest,
  getSquirrelUpdaterPath,
  isContinuousDeltaChain,
  launchSquirrelDetached,
  normalizeSquirrelReleaseLines,
  parseSquirrelCommandResult,
  parseSquirrelReleaseFile,
  runSquirrelCommand,
  withUpdateFeed,
} from "./squirrel-updater.mjs";
import { configuredUpdateValue, updateConfig } from "./update-config.mjs";
import {
  createSaveQueue,
  freshSave,
  getSavePaths,
  migrateLegacySave as migrateSave,
  readSave as loadSave,
  SAVE_SECTIONS as saveSections,
  writeSave as saveBundle,
} from "./save-manager.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, "..");
const towerConfigPath = path.join(projectDirectory, "src", "game", "config.ts");

const updateFeedTemplate = configuredUpdateValue(updateConfig.feedUrl, "MONOCHROMIUM_UPDATE_FEED_URL");
const latestReleaseUrl = configuredUpdateValue(updateConfig.latestReleaseUrl, "MONOCHROMIUM_LATEST_RELEASE_URL");
const updateState = {
  status: "disabled",
  currentVersion: app.getVersion(),
  targetVersion: null,
  progress: null,
  strategy: null,
  message: "Automatic updates are not configured.",
};
let mainWindow = null;
let hostServerProcess = null;
let hostServerStopping = false;
let multiplayerNetwork = null;
const hostCommandOwners = new Map();
let hostSimulationConfig = null;
let updaterReady = false;
let updateCheckPromise = null;
let updateDownloadPromise = null;
let updateApplyPromise = null;
let updatePlan = null;
let latestReleaseCache = null;
let latestReleaseEtag = null;
let latestReleaseLastModified = null;
let gpuBasicInfo = null;

const readGpuStatus = async () => {
  let featureStatus = {};
  try {
    featureStatus = app.getGPUFeatureStatus();
  } catch {
    // Chromium only exposes the complete status after GPU initialization.
  }
  if (!gpuBasicInfo) {
    try {
      gpuBasicInfo = await app.getGPUInfo("basic");
    } catch {
      // A completely disabled GPU may not have basic information available.
    }
  }
  const softwareRendering = Object.values(featureStatus).some((value) => /software/i.test(String(value)))
    || featureStatus.gpu_compositing === "disabled_off";
  return { softwareRendering, featureStatus, info: gpuBasicInfo };
};

app.on("gpu-info-update", () => {
  void readGpuStatus().then((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:gpu-status", status);
  });
});

const publishUpdateState = (nextState) => {
  Object.assign(updateState, nextState);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updater:state", { ...updateState });
};

const publishRendererMessage = (channel, message) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, { ...message, receivedAt: Date.now() });
};

const publishHostServerMessage = (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "state" && message.frame instanceof ArrayBuffer) {
    let sent = false;
    if (multiplayerNetwork?.connected) {
      sent = multiplayerNetwork.sendBinary(message.frame.slice(0));
    }
    publishRendererMessage("host-server:message", { ...message, sent });
    return;
  }
  if (message.type === "command-result") {
    const owner = hostCommandOwners.get(message.result?.commandId) ?? "host";
    hostCommandOwners.delete(message.result?.commandId);
    if (owner === "guest") {
      multiplayerNetwork?.sendControl({ type: "command-result", result: message.result });
      return;
    }
  }
  if (message.type === "diagnostics" || message.type === "ready") {
    const diagnostics = message.diagnostics;
    if (diagnostics && multiplayerNetwork?.connected) multiplayerNetwork.sendControl({ type: "server-diagnostics", diagnostics });
  }
  publishRendererMessage("host-server:message", message);
};

const publishMultiplayerNetworkMessage = (message) => publishRendererMessage("multiplayer-network:message", message);

const postHostServer = (message) => {
  if (!hostServerProcess) return false;
  try {
    hostServerProcess.postMessage(message);
    return true;
  } catch {
    return false;
  }
};

const createMultiplayerNetwork = () => multiplayerNetwork ??= new RelayNetwork({
  onStatus: (message) => publishMultiplayerNetworkMessage(message),
  onControl: (message, peerId) => {
    if (multiplayerNetwork?.role === "host" && message.type === "command") {
      if (!isGuestAction(hostSimulationConfig, message.envelope)) return;
      const submitted = postHostServer({ type: "command", envelope: message.envelope });
      if (submitted) hostCommandOwners.set(message.envelope.commandId, "guest");
      else multiplayerNetwork?.sendControl({
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
    if (multiplayerNetwork?.role === "host" && message.type === "resync-request") {
      postHostServer({ type: "keyframe-request" });
      return;
    }
    publishMultiplayerNetworkMessage({ type: "control", message, peerId });
  },
  onRealtime: (message, peerId) => {
    if (multiplayerNetwork?.role === "host" && message?.type === "pulse") {
      postHostServer({ type: "guest-pulse", sequence: message.sequence, stateSequence: message.stateSequence, eventId: message.eventId });
    }
    if (multiplayerNetwork?.role === "host" && message?.type === "pilot-input") {
      if (!isGuestAction(hostSimulationConfig, message)) return;
      postHostServer({ type: "pilot-input", input: message });
      return;
    }
    publishMultiplayerNetworkMessage({ type: "realtime", message, peerId });
  },
  onBinary: (frame, peerId) => publishMultiplayerNetworkMessage({ type: "binary", frame, peerId }),
  onPeerStatus: (connected) => {
    if (multiplayerNetwork?.role === "host") postHostServer({ type: "peer-status", connected });
  },
  onStateBackpressure: (congested) => {
    publishMultiplayerNetworkMessage({ type: "state-pressure", busy: congested });
    if (multiplayerNetwork?.role === "host") postHostServer({ type: "replication-pressure", congested });
  },
  onStateSent: (bytes) => publishRendererMessage("host-server:message", { type: "network-bytes", bytes }),
  onStateReplaced: () => postHostServer({ type: "frame-replaced" }),
  onPassiveRtt: (rtt) => publishMultiplayerNetworkMessage({ type: "rtt", rtt }),
}, { relayUrl: configuredMultiplayerRelayUrl() });

const stopHostServer = (reason = "Host server stopped.") => {
  const server = hostServerProcess;
  if (!server) return;
  hostServerStopping = true;
  try { server.postMessage({ type: "stop", reason }); } catch { /* It may already have exited. */ }
  setTimeout(() => {
    if (hostServerProcess === server) server.kill();
  }, 1_000).unref();
};

const startMultiplayerNetwork = async (config) => {
  if (!config || (config.role !== "host" && config.role !== "guest")) throw new Error("Invalid multiplayer network configuration.");
  return await createMultiplayerNetwork().start(config);
};

const stopMultiplayerNetwork = async (reason = "Multiplayer networking stopped.") => {
  await multiplayerNetwork?.stop(reason);
  hostCommandOwners.clear();
};

const startHostServer = (config) => {
  if (!config || typeof config !== "object" || typeof config.sessionId !== "string" || !Array.isArray(config.players) || config.players.length !== 2) {
    throw new Error("Invalid host simulation configuration.");
  }
  hostSimulationConfig = config;
  if (hostServerProcess) {
    hostCommandOwners.clear();
    hostServerProcess.postMessage({ type: "restart", config });
    return true;
  }
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
      void stopMultiplayerNetwork("Authoritative simulation exited.");
      publishHostServerMessage({ type: "fatal", message: `Authoritative simulation exited unexpectedly (code ${code}).` });
    }
  });
  server.postMessage({ type: "start", config });
  if (multiplayerNetwork?.role === "host" && multiplayerNetwork.connected) server.postMessage({ type: "peer-status", connected: true });
  return true;
};

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
const updaterProcessIsActive = () => updateCheckPromise !== null || updateDownloadPromise !== null || updateApplyPromise !== null;

const squirrelUpdaterPath = () => getSquirrelUpdaterPath(process.execPath);

const updaterErrorMessage = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "unknown error";
};

const isLoopbackHost = (hostname) =>
  hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

const validateUpdateUrl = (value, label, allowLoopback = false) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  const isLoopback = isLoopbackHost(parsed.hostname);
  if (app.isPackaged && parsed.protocol !== "https:" && !(allowLoopback && isLoopback)) {
    throw new Error(`${label} must use HTTPS in packaged builds.`);
  }
  return parsed.toString();
};

const readLatestRelease = async () => {
  if (!latestReleaseUrl) {
    if (!updateFeedTemplate) throw new Error("No update endpoint is configured.");
    return {
      version: null,
      feedUrl: validateUpdateUrl(updateFeedTemplate.replaceAll("{version}", app.getVersion()), "Update feed"),
      manifestUrl: null,
      manifestText: null,
      normalizedManifest: null,
      entries: [],
      repoSlug: "MaidProton/Monochromium",
      fullPackageBytes: null,
      deltaPackageBytes: null,
      releaseName: "Latest Monochromium release",
    };
  }
  validateUpdateUrl(latestReleaseUrl, "Release endpoint");
  const headers = {
    Accept: "application/vnd.github+json",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Monochromium-Updater",
  };
  if (latestReleaseEtag) headers["If-None-Match"] = latestReleaseEtag;
  if (latestReleaseLastModified) headers["If-Modified-Since"] = latestReleaseLastModified;
  const response = await fetch(latestReleaseUrl, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 304 && latestReleaseCache) return latestReleaseCache;
  if (!response.ok) throw new Error(`Release service returned HTTP ${response.status}.`);
  const release = await response.json();
  if (!release || typeof release !== "object" || release.draft === true || release.prerelease === true || typeof release.tag_name !== "string") {
    throw new Error("The latest GitHub release is not available for updating.");
  }
  const versionMatch = /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name);
  if (!versionMatch?.[1]) throw new Error(`Latest release tag '${release.tag_name}' is not a supported version.`);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const manifest = assets.find((asset) => asset?.name === "RELEASES" && typeof asset.browser_download_url === "string");
  const fullPackage = assets.find((asset) => asset?.name === `monochromium-${versionMatch[1]}-full.nupkg` && typeof asset.browser_download_url === "string");
  const deltaPackage = assets.find((asset) => asset?.name === `monochromium-${versionMatch[1]}-delta.nupkg` && typeof asset.browser_download_url === "string");
  const installer = assets.find((asset) => asset?.name === "Monochromium-Setup.exe" && typeof asset.browser_download_url === "string");
  if (!manifest || !fullPackage || !installer) throw new Error(`Release ${versionMatch[1]} is missing one or more updater assets.`);
  const suffix = "/RELEASES";
  if (!manifest.browser_download_url.endsWith(suffix)) throw new Error("The latest release manifest URL is invalid.");

  const repoSlugMatch = /^https?:\/\/github\.com\/([^/]+\/[^/]+)/i.exec(manifest.browser_download_url);
  const repoSlug = repoSlugMatch ? repoSlugMatch[1] : "MaidProton/Monochromium";

  let manifestText = null;
  let normalizedManifest = null;
  let entries = [];
  try {
    const manifestResponse = await fetch(manifest.browser_download_url, {
      cache: "no-store",
      headers: { "User-Agent": "Monochromium-Updater" },
      signal: AbortSignal.timeout(10_000),
    });
    if (manifestResponse.ok) {
      manifestText = await manifestResponse.text();
      normalizedManifest = normalizeSquirrelReleaseLines(manifestText, repoSlug);
      entries = parseSquirrelReleaseFile(normalizedManifest);
    }
  } catch {
    // If fetching or normalizing the remote manifest fails, fallback to standard feed URL
  }

  const result = {
    version: versionMatch[1],
    feedUrl: manifest.browser_download_url.slice(0, -suffix.length),
    manifestUrl: manifest.browser_download_url,
    manifestText,
    normalizedManifest,
    entries,
    repoSlug,
    fullPackageBytes: Number.isSafeInteger(fullPackage.size) ? fullPackage.size : null,
    deltaPackageBytes: deltaPackage && Number.isSafeInteger(deltaPackage.size) ? deltaPackage.size : null,
    releaseName: typeof release.name === "string" ? release.name : `Monochromium ${versionMatch[1]}`,
  };
  validateUpdateUrl(result.feedUrl, "Update feed");
  latestReleaseCache = result;
  latestReleaseEtag = response.headers.get("etag");
  latestReleaseLastModified = response.headers.get("last-modified");
  return result;
};

const runSquirrel = (args, options = {}) => runSquirrelCommand(squirrelUpdaterPath(), args, options);

const inspectForUpdates = async () => {
  if (!updaterReady || updaterProcessIsActive() || updateState.status === "downloaded" || updateState.status === "installing") return;
  publishUpdateState({ status: "checking", message: "Checking for a newer releaseÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" });
  updateCheckPromise = readLatestRelease()
    .then(async (release) => {
      if (release.version && compareVersions(release.version, app.getVersion()) <= 0) {
        updatePlan = null;
        publishUpdateState({ status: "not-available", targetVersion: null, progress: null, strategy: null, message: `Version ${app.getVersion()} is current.` });
        return;
      }

      let chosenStrategy = "smart";
      let chosenManifest = release.normalizedManifest;
      const targetVersionCandidate = release.version;

      if (release.entries.length > 0 && targetVersionCandidate) {
        const canUseDeltas = isContinuousDeltaChain(app.getVersion(), targetVersionCandidate, release.entries);
        if (!canUseDeltas) {
          const fullManifest = createFullPackageManifest(targetVersionCandidate, release.entries, release.repoSlug);
          if (fullManifest) {
            chosenStrategy = "full";
            chosenManifest = fullManifest;
          }
        }
      }

      let checkResult;
      try {
        checkResult = await withUpdateFeed(chosenManifest || release.feedUrl, (feed) =>
          runSquirrel(["--checkForUpdate", feed])
        );
      } catch (checkError) {
        if (chosenStrategy === "smart" && release.entries.length > 0 && targetVersionCandidate) {
          const fullManifest = createFullPackageManifest(targetVersionCandidate, release.entries, release.repoSlug);
          if (fullManifest) {
            chosenStrategy = "full";
            chosenManifest = fullManifest;
            checkResult = await withUpdateFeed(chosenManifest, (feed) =>
              runSquirrel(["--checkForUpdate", feed])
            );
          } else {
            throw checkError;
          }
        } else {
          throw checkError;
        }
      }

      const details = parseSquirrelCommandResult(checkResult.stdout);
      const targetVersion = details.futureVersion ?? release.version;
      if (!targetVersion) throw new Error("The update feed did not identify a target version.");
      if (!details.releasesToApply.length || compareVersions(targetVersion, app.getVersion()) <= 0) {
        updatePlan = null;
        publishUpdateState({ status: "not-available", targetVersion: null, progress: null, strategy: null, message: `Version ${app.getVersion()} is current.` });
        return;
      }

      updatePlan = {
        feedUrl: release.feedUrl,
        manifestContent: chosenManifest,
        targetVersion,
        strategy: chosenStrategy,
        entries: release.entries,
        repoSlug: release.repoSlug,
        fullPackageBytes: release.fullPackageBytes,
        deltaPackageBytes: release.deltaPackageBytes,
        releaseName: release.releaseName,
      };
      publishUpdateState({
        status: "available",
        targetVersion,
        progress: null,
        strategy: chosenStrategy,
        message: chosenStrategy === "smart"
          ? `Version ${targetVersion} available // smart delta download is ready.`
          : `Version ${targetVersion} available // full package download is ready.`,
      });
    })
    .catch((error) => {
      updatePlan = null;
      publishUpdateState({ status: "error", targetVersion: null, progress: null, strategy: null, message: `Update check failed // ${updaterErrorMessage(error)}` });
    })
    .finally(() => {
      updateCheckPromise = null;
    });
  await updateCheckPromise;
};

const downloadUpdate = async () => {
  if (!updaterReady || updateState.status !== "available" || !updatePlan) return;
  if (updateDownloadPromise) {
    await updateDownloadPromise;
    return;
  }
  const plan = updatePlan;
  let lastProgress = -1;
  const reportProgress = (progress, currentStrategy = plan.strategy) => {
    if (progress < lastProgress) return;
    lastProgress = progress;
    const strategyLabel = currentStrategy === "smart" ? "verified smart delta path" : "full package";
    publishUpdateState({
      status: "downloading",
      targetVersion: plan.targetVersion,
      progress,
      strategy: currentStrategy,
      message: `Downloading ${plan.targetVersion} // ${strategyLabel} ${progress}%ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦`,
    });
  };
  reportProgress(0, plan.strategy);

  updateDownloadPromise = (async () => {
    let activeStrategy = plan.strategy;
    let activeManifest = plan.manifestContent;
    let downloadResult;

    try {
      downloadResult = await withUpdateFeed(activeManifest || plan.feedUrl, (feed) =>
        runSquirrel(["--download", feed], { onProgress: (p) => reportProgress(p, activeStrategy) })
      );
    } catch (smartError) {
      if (activeStrategy === "smart" && plan.entries?.length) {
        const fullManifest = createFullPackageManifest(plan.targetVersion, plan.entries, plan.repoSlug);
        if (fullManifest) {
          activeStrategy = "full";
          activeManifest = fullManifest;
          lastProgress = -1;
          reportProgress(0, "full");
          downloadResult = await withUpdateFeed(activeManifest, (feed) =>
            runSquirrel(["--download", feed], { onProgress: (p) => reportProgress(p, "full") })
          );
        } else {
          throw smartError;
        }
      } else {
        throw smartError;
      }
    }

    let details = null;
    try {
      details = parseSquirrelCommandResult(downloadResult?.stdout);
    } catch {
      // A successful Squirrel download is still staged even if an older
      // helper omitted its final JSON summary.
    }
    if (details && details.releasesToApply.length === 0) {
      throw new Error("The update is no longer available.");
    }
    updatePlan = {
      ...plan,
      strategy: activeStrategy,
      manifestContent: activeManifest,
      downloadDetails: details,
    };
    publishUpdateState({
      status: "downloaded",
      targetVersion: plan.targetVersion,
      progress: 100,
      strategy: activeStrategy,
      message: `Update ${plan.targetVersion} staged // package verified; restart to install.`,
    });
  })()
    .catch((error) => {
      publishUpdateState({
        status: "error",
        targetVersion: plan.targetVersion,
        progress: null,
        strategy: plan.strategy,
        message: `Update download failed // ${updaterErrorMessage(error)}`,
      });
    })
    .finally(() => {
      updateDownloadPromise = null;
    });
  await updateDownloadPromise;
};

const setupUpdater = () => {
  if (!app.isPackaged || process.platform !== "win32" || (!latestReleaseUrl && !updateFeedTemplate)) return;
  if (!existsSync(squirrelUpdaterPath())) {
    publishUpdateState({ status: "error", message: "Updater setup failed // Squirrel Update.exe was not found." });
    return;
  }

  updaterReady = true;
  publishUpdateState({ status: "idle", targetVersion: null, progress: null, strategy: null, message: `Version ${app.getVersion()} // smart updater ready.` });

  // Squirrel holds a lock during first-run setup. Delay the first check so a
  // newly installed copy does not report a misleading updater error.
  setTimeout(() => void inspectForUpdates(), 10_000);
  const periodicCheck = setInterval(() => void inspectForUpdates(), 10 * 60 * 1_000);
  periodicCheck.unref?.();
};

const applyDownloadedUpdate = async () => {
  if (!updaterReady || updateState.status !== "downloaded" || !updatePlan) return false;
  if (updateApplyPromise) return await updateApplyPromise;

  const plan = updatePlan;
  publishUpdateState({
    status: "installing",
    targetVersion: plan.targetVersion,
    progress: 0,
    strategy: plan.strategy,
    message: `Applying ${plan.targetVersion} // preparing a safe restartÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦`,
  });
  updateApplyPromise = withUpdateFeed(plan.manifestContent || plan.feedUrl, (feed) =>
    runSquirrel(["--update", feed], {
      onProgress: (progress) =>
        publishUpdateState({
          status: "installing",
          targetVersion: plan.targetVersion,
          progress,
          strategy: plan.strategy,
          message: `Applying ${plan.targetVersion} // installing ${progress}%ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦`,
        }),
    })
  )
    .then(() => {
      // Squirrel has now materialized the new version directory. Its
      // processStartAndWait helper waits for this process to exit, then
      // resolves the shortcut to the newest installed version.
      launchSquirrelDetached(squirrelUpdaterPath(), ["--processStartAndWait", path.basename(process.execPath)]);
      publishUpdateState({
        status: "installing",
        targetVersion: plan.targetVersion,
        progress: 100,
        strategy: plan.strategy,
        message: `Update ${plan.targetVersion} applied // restartingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦`,
      });
      app.quit();
      return true;
    })
    .catch((error) => {
      publishUpdateState({
        status: "error",
        targetVersion: plan.targetVersion,
        progress: null,
        strategy: plan.strategy,
        message: `Update install failed // ${updaterErrorMessage(error)}`,
      });
      return false;
    })
    .finally(() => {
      updateApplyPromise = null;
    });
  return await updateApplyPromise;
};

app.setName("Monochromium");
if (electronSquirrelStartup) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.squirrel.monochromium.Monochromium");

const savePaths = () => getSavePaths(app.getPath("userData"));

let migrationChecked = false;
const migrateLegacySave = async () => {
  if (migrationChecked) return;
  migrationChecked = true;
  const candidates = [
    path.join(projectDirectory, "save_data", "monochromium_save.json"),
    path.join(process.cwd(), "save_data", "monochromium_save.json"),
    path.join(path.dirname(process.execPath), "save_data", "monochromium_save.json"),
  ];
  await migrateSave(app.getPath("userData"), candidates);
};

const readSave = async () => {
  await migrateLegacySave();
  return await loadSave(app.getPath("userData"));
};

const writeSave = async (bundle) => saveBundle(app.getPath("userData"), bundle);

const queueSaveOperation = createSaveQueue();

ipcMain.handle("save:load", async () => {
  const result = await queueSaveOperation(async () => readSave());
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

ipcMain.handle("desktop:environment", async () => ({
  packaged: app.isPackaged,
  version: app.getVersion(),
  savePath: savePaths().save,
  gpu: await readGpuStatus(),
}));

ipcMain.handle("desktop:fullscreen:get", (event) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("Untrusted fullscreen request.");
  return Boolean(mainWindow?.isFullScreen());
});

ipcMain.handle("desktop:fullscreen:set", (event, fullscreen) => {
  if (event.sender !== mainWindow?.webContents || typeof fullscreen !== "boolean") throw new Error("Untrusted fullscreen request.");
  mainWindow.setFullScreen(fullscreen);
  return mainWindow.isFullScreen();
});

ipcMain.handle("host-server:start", (event, config) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("Untrusted host-server request.");
  return startHostServer(config);
});

ipcMain.handle("multiplayer-network:start", async (event, config) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("Untrusted multiplayer-network request.");
  return startMultiplayerNetwork(config);
});

ipcMain.handle("multiplayer-network:control", (event, message) => {
  if (event.sender !== mainWindow?.webContents) return false;
  return Boolean(multiplayerNetwork?.sendControl(message));
});

ipcMain.handle("multiplayer-network:realtime", (event, message) => {
  if (event.sender !== mainWindow?.webContents) return false;
  if (multiplayerNetwork?.role === "host" && message?.type === "cursor") {
    return postHostServer({ type: "host-cursor", point: message.point ?? null });
  }
  if (multiplayerNetwork?.role === "host" && message?.type === "pilot-input") {
    return postHostServer({ type: "pilot-input", input: message });
  }
  return Boolean(multiplayerNetwork?.sendRealtime(message));
});

ipcMain.handle("multiplayer-network:rtt", async (event) => {
  if (event.sender !== mainWindow?.webContents) return null;
  return await (multiplayerNetwork?.measureRtt() ?? null);
});

ipcMain.handle("multiplayer-network:retry", async (event) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("Untrusted multiplayer-network request.");
  return await multiplayerNetwork?.retryNow();
});

ipcMain.handle("multiplayer-network:stop", (event, reason) => {
  if (event.sender !== mainWindow?.webContents) return false;
  void stopMultiplayerNetwork(typeof reason === "string" ? reason.slice(0, 500) : "Multiplayer networking stopped.");
  return true;
});

ipcMain.handle("host-server:command", (event, envelope) => {
  if (event.sender !== mainWindow?.webContents || !hostServerProcess) return false;
  if (envelope && typeof envelope.commandId === "string") hostCommandOwners.set(envelope.commandId, "host");
  hostServerProcess.postMessage({ type: "command", envelope });
  return true;
});

ipcMain.handle("host-server:pilot-input", (event, input) => {
  if (event.sender !== mainWindow?.webContents || !hostServerProcess) return false;
  hostServerProcess.postMessage({ type: "pilot-input", input });
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

ipcMain.handle("updater:install", () => applyDownloadedUpdate());

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
      // Keep production renderers sandboxed. The UI smoke runner opts out only
      // on managed Windows hosts where Chromium's OS sandbox cannot start.
      sandbox: process.env.MONOCHROMIUM_UI_SMOKE !== "1",
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
  const publishFullscreenState = () => window.webContents.send("desktop:fullscreen:changed", window.isFullScreen());
  window.on("enter-full-screen", publishFullscreenState);
  window.on("leave-full-screen", publishFullscreenState);
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
  void stopMultiplayerNetwork("Application closed.");
  stopHostServer("Application closed.");
  if (process.platform !== "darwin") app.quit();
});
