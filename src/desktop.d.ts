interface MonochromiumGpuStatus {
  readonly softwareRendering: boolean;
  readonly featureStatus: Readonly<Record<string, string>>;
  readonly info: unknown;
}

interface MonochromiumDesktopEnvironment {
  readonly packaged: boolean;
  readonly version: string;
  readonly savePath: string;
  readonly gpu: MonochromiumGpuStatus;
}

type MonochromiumUpdateStatus = "disabled" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "not-available" | "error";
type MonochromiumUpdateStrategy = "smart" | "delta" | "full" | null;

interface MonochromiumUpdateState {
  readonly status: MonochromiumUpdateStatus;
  readonly currentVersion: string;
  readonly targetVersion: string | null;
  readonly progress: number | null;
  readonly strategy: MonochromiumUpdateStrategy;
  readonly message: string;
}

type MonochromiumMultiplayerNetworkMessage =
  | {
      readonly type: "status";
      readonly status: import("./game/multiplayer.ts").MultiplayerConnectionStatus;
      readonly detail?: string;
      readonly peerId?: string;
      readonly receivedAt?: number;
    }
  | {
      readonly type: "control";
      readonly message: import("./game/multiplayer.ts").MultiplayerControlMessage;
      readonly peerId: string;
      readonly receivedAt?: number;
    }
  | {
      readonly type: "realtime";
      readonly message: import("./game/multiplayer.ts").MultiplayerRealtimeMessage;
      readonly peerId: string;
      readonly receivedAt?: number;
    }
  | {
      readonly type: "binary";
      readonly frame: ArrayBuffer;
      readonly peerId: string;
      readonly receivedAt?: number;
    }
  | {
      readonly type: "state-pressure";
      readonly busy: boolean;
      readonly receivedAt?: number;
    }
  | {
      readonly type: "rtt";
      readonly rtt: number;
      readonly receivedAt?: number;
    };

interface MonochromiumDesktopBridge {
  loadSave(): Promise<{
    available: boolean;
    exists: boolean;
    data: import("./game/persistence.ts").SaveBundle | null;
  }>;
  replaceSave(bundle: import("./game/persistence.ts").SaveBundle): Promise<boolean>;
  saveSection(section: "meta" | "custom-modes" | "custom-enemies" | "custom-maps" | "creator-folders", value: unknown): Promise<boolean>;
  saveTowerBalance(kind: import("./game/types.ts").TowerKind, definition: unknown): Promise<{ ok: boolean; path: string }>;
  getEnvironment(): Promise<MonochromiumDesktopEnvironment>;
  getFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<boolean>;
  onFullscreenChanged(listener: (fullscreen: boolean) => void): () => void;
  onGpuStatus(listener: (status: MonochromiumGpuStatus) => void): () => void;
  getUpdateState(): Promise<MonochromiumUpdateState>;
  checkForUpdate(): Promise<MonochromiumUpdateState>;
  downloadUpdate(): Promise<MonochromiumUpdateState>;
  installUpdate(): Promise<boolean>;
  onUpdateState(listener: (state: MonochromiumUpdateState) => void): () => void;
  startMultiplayerNetwork(config: { readonly role: import("./game/multiplayer.ts").MultiplayerRole; readonly roomCode?: string }): Promise<{ readonly roomCode: string }>;
  sendMultiplayerControl(message: import("./game/multiplayer.ts").MultiplayerControlMessage): Promise<boolean>;
  sendMultiplayerRealtime(message: import("./game/multiplayer.ts").MultiplayerRealtimeMessage): Promise<boolean>;
  measureMultiplayerRtt(): Promise<number | null>;
  retryMultiplayerNetwork(): Promise<{ readonly roomCode: string } | undefined>;
  stopMultiplayerNetwork(reason: string): Promise<boolean>;
  onMultiplayerNetworkMessage(listener: (message: MonochromiumMultiplayerNetworkMessage) => void): () => void;
  startHostServer(config: import("./game/simulationProtocol.ts").SimulationSessionConfig): Promise<boolean>;
  submitHostCommand(envelope: import("./game/simulationProtocol.ts").SimulationCommandEnvelope): Promise<boolean>;
  submitHostPilotInput(input: import("./game/multiplayer.ts").MultiplayerPilotInput): Promise<boolean>;
  requestHostKeyframe(): Promise<boolean>;
  stopHostServer(reason: string): Promise<boolean>;
  onHostServerMessage(listener: (message: import("./game/simulationProtocol.ts").HostServerOutboundMessage) => void): () => void;
}

interface Window {
  readonly monochromiumDesktop?: MonochromiumDesktopBridge;
}
