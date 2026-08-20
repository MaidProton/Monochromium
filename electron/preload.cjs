const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("monochromiumDesktop", Object.freeze({
  loadSave: () => ipcRenderer.invoke("save:load"),
  replaceSave: (bundle) => ipcRenderer.invoke("save:replace", bundle),
  saveSection: (section, value) => ipcRenderer.invoke("save:section", section, value),
  getEnvironment: () => ipcRenderer.invoke("desktop:environment"),
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
  startHostNetwork: (config) => ipcRenderer.invoke("host-network:start", config),
  sendHostNetworkControl: (message) => ipcRenderer.invoke("host-network:control", message),
  sendHostNetworkRealtime: (message) => ipcRenderer.invoke("host-network:realtime", message),
  measureHostNetworkRtt: () => ipcRenderer.invoke("host-network:rtt"),
  stopHostNetwork: (reason) => ipcRenderer.invoke("host-network:stop", reason),
  submitHostCommand: (envelope) => ipcRenderer.invoke("host-server:command", envelope),
  requestHostKeyframe: () => ipcRenderer.invoke("host-server:keyframe"),
  stopHostServer: (reason) => ipcRenderer.invoke("host-server:stop", reason),
  onHostServerMessage: (listener) => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on("host-server:message", handler);
    return () => ipcRenderer.removeListener("host-server:message", handler);
  },
  onHostNetworkMessage: (listener) => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on("host-network:message", handler);
    return () => ipcRenderer.removeListener("host-network:message", handler);
  },
}));
