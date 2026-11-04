const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("monochromiumDesktop", Object.freeze({
  loadSave: () => ipcRenderer.invoke("save:load"),
  replaceSave: (bundle) => ipcRenderer.invoke("save:replace", bundle),
  saveSection: (section, value) => ipcRenderer.invoke("save:section", section, value),
  getEnvironment: () => ipcRenderer.invoke("desktop:environment"),
  getFullscreen: () => ipcRenderer.invoke("desktop:fullscreen:get"),
  setFullscreen: (fullscreen) => ipcRenderer.invoke("desktop:fullscreen:set", fullscreen),
  onFullscreenChanged: (listener) => {
    const handler = (_event, fullscreen) => listener(fullscreen);
    ipcRenderer.on("desktop:fullscreen:changed", handler);
    return () => ipcRenderer.removeListener("desktop:fullscreen:changed", handler);
  },
  onGpuStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("desktop:gpu-status", handler);
    return () => ipcRenderer.removeListener("desktop:gpu-status", handler);
  },
  saveTowerBalance: (kind, definition) => ipcRenderer.invoke("balance:save-tower", kind, definition),
  getUpdateState: () => ipcRenderer.invoke("updater:state"),
  checkForUpdate: () => ipcRenderer.invoke("updater:check"),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onUpdateState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("updater:state", handler);
    return () => ipcRenderer.removeListener("updater:state", handler);
  },
  startHostServer: (config) => ipcRenderer.invoke("host-server:start", config),
  startMultiplayerNetwork: (config) => ipcRenderer.invoke("multiplayer-network:start", config),
  sendMultiplayerControl: (message) => ipcRenderer.invoke("multiplayer-network:control", message),
  sendMultiplayerRealtime: (message) => ipcRenderer.invoke("multiplayer-network:realtime", message),
  measureMultiplayerRtt: () => ipcRenderer.invoke("multiplayer-network:rtt"),
  retryMultiplayerNetwork: () => ipcRenderer.invoke("multiplayer-network:retry"),
  stopMultiplayerNetwork: (reason) => ipcRenderer.invoke("multiplayer-network:stop", reason),
  submitHostCommand: (envelope) => ipcRenderer.invoke("host-server:command", envelope),
  submitHostPilotInput: (input) => ipcRenderer.invoke("host-server:pilot-input", input),
  requestHostKeyframe: () => ipcRenderer.invoke("host-server:keyframe"),
  stopHostServer: (reason) => ipcRenderer.invoke("host-server:stop", reason),
  onHostServerMessage: (listener) => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on("host-server:message", handler);
    return () => ipcRenderer.removeListener("host-server:message", handler);
  },
  onMultiplayerNetworkMessage: (listener) => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on("multiplayer-network:message", handler);
    return () => ipcRenderer.removeListener("multiplayer-network:message", handler);
  },
}));
