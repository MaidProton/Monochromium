interface MonochromiumDesktopEnvironment {
  readonly packaged: boolean;
  readonly version: string;
  readonly savePath: string;
}

type MonochromiumUpdateStatus = "disabled" | "idle" | "checking" | "downloading" | "downloaded" | "not-available" | "error";

interface MonochromiumUpdateState {
  readonly status: MonochromiumUpdateStatus;
  readonly currentVersion: string;
  readonly message: string;
}

interface MonochromiumDesktopBridge {
  loadSave(): Promise<{
    available: boolean;
    exists: boolean;
    data: import("./game/persistence.ts").SaveBundle | null;
  }>;
  replaceSave(bundle: import("./game/persistence.ts").SaveBundle): Promise<boolean>;
  saveSection(section: "meta" | "custom-modes" | "custom-enemies" | "custom-maps", value: unknown): Promise<boolean>;
  getEnvironment(): Promise<MonochromiumDesktopEnvironment>;
  getUpdateState(): Promise<MonochromiumUpdateState>;
  checkForUpdate(): Promise<MonochromiumUpdateState>;
  installUpdate(): Promise<boolean>;
  onUpdateState(listener: (state: MonochromiumUpdateState) => void): () => void;
}

interface Window {
  readonly monochromiumDesktop?: MonochromiumDesktopBridge;
}
