const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("monochromiumDesktop", Object.freeze({
  loadSave: () => ipcRenderer.invoke("save:load"),
  replaceSave: (bundle) => ipcRenderer.invoke("save:replace", bundle),
  saveSection: (section, value) => ipcRenderer.invoke("save:section", section, value),
  getEnvironment: () => ipcRenderer.invoke("desktop:environment"),
  getUpdateState: () => ipcRenderer.invoke("updater:state"),
  checkForUpdate: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onUpdateState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("updater:state", handler);
    return () => ipcRenderer.removeListener("updater:state", handler);
  },
}));
