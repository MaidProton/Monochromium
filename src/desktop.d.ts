interface MonochromiumDesktopEnvironment {
  readonly packaged: boolean;
  readonly version: string;
  readonly savePath: string;
}

type MonochromiumUpdateStatus = "disabled" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";

interface MonochromiumUpdateState {
  readonly status: MonochromiumUpdateStatus;
  readonly currentVersion: string;
  readonly message: string;
}

type MonochromiumHostNetworkMessage =
  | {
      readonly type: "status";
      readonly status: import("./game/multiplayer.ts").MultiplayerConnectionStatus;
      readonly detail?: string;
      readonly peerId?: string;
    }
  | {
      readonly type: "control";
      readonly message: import("./game/multiplayer.ts").MultiplayerControlMessage;
      readonly peerId: string;
    }
  | {
      readonly type: "realtime";
      readonly message: import("./game/multiplayer.ts").MultiplayerRealtimeMessage;
      readonly peerId: string;
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
  getUpdateState(): Promise<MonochromiumUpdateState>;
  checkForUpdate(): Promise<MonochromiumUpdateState>;
  downloadUpdate(): Promise<MonochromiumUpdateState>;
  installUpdate(): Promise<boolean>;
  onUpdateState(listener: (state: MonochromiumUpdateState) => void): () => void;
  startHostNetwork(config: { readonly roomCode: string; readonly iceServers: readonly RTCIceServer[] }): Promise<boolean>;
  sendHostNetworkControl(message: import("./game/multiplayer.ts").MultiplayerControlMessage): Promise<boolean>;
  sendHostNetworkRealtime(message: import("./game/multiplayer.ts").MultiplayerRealtimeMessage): Promise<boolean>;
  measureHostNetworkRtt(): Promise<number | null>;
  stopHostNetwork(reason: string): Promise<boolean>;
  onHostNetworkMessage(listener: (message: MonochromiumHostNetworkMessage) => void): () => void;
  startHostServer(config: import("./game/simulationProtocol.ts").SimulationSessionConfig): Promise<boolean>;
  submitHostCommand(envelope: import("./game/simulationProtocol.ts").SimulationCommandEnvelope): Promise<boolean>;
  requestHostKeyframe(): Promise<boolean>;
  stopHostServer(reason: string): Promise<boolean>;
  onHostServerMessage(listener: (message: import("./game/simulationProtocol.ts").HostServerOutboundMessage) => void): () => void;
}

interface Window {
  readonly monochromiumDesktop?: MonochromiumDesktopBridge;
}
