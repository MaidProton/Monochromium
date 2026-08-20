import { SimulationCore } from "../game/SimulationCore.ts";
import { ReplicationEncoder } from "../game/replication.ts";
import {
  REPLICATION_HZ,
  SIMULATION_TICK_HZ,
  type HostServerInboundMessage,
  type HostServerOutboundMessage,
  type SimulationServerDiagnostics,
} from "../game/simulationProtocol.ts";

interface UtilityParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { readonly data: unknown }) => void): void;
}

const parentPort = (process as typeof process & { readonly parentPort?: UtilityParentPort }).parentPort;
if (!parentPort) throw new Error("The simulation server must run as an Electron utility process.");

let core: SimulationCore | null = null;
let tick = 0;
let snapshotSequence = 0;
let startedAt = 0;
let lastPumpAt = performance.now();
let accumulatorMs = 0;
let tickWindowStartedAt = performance.now();
let ticksInWindow = 0;
let measuredTickRate = 0;
let stopped = false;
let guestConnected = false;
let forceReplicationKeyframe = true;
let activeSessionId = "";
const replicationEncoder = new ReplicationEncoder();
const pendingRemoteEvents = new Map<number, import("../game/simulationProtocol.ts").SimulationEvent>();

const send = (message: HostServerOutboundMessage): void => parentPort.postMessage(message);

const diagnostics = (status: SimulationServerDiagnostics["status"], message?: string): SimulationServerDiagnostics => ({
  status,
  tick,
  tickRate: measuredTickRate,
  frameSequence: snapshotSequence,
  startedAt,
  ...(message ? { message } : {}),
});

const publishState = (): void => {
  const frame = core?.createFrame();
  if (!frame) return;
  frame.events.forEach((event) => pendingRemoteEvents.set(event.id, event));
  while (pendingRemoteEvents.size > 512) pendingRemoteEvents.delete(pendingRemoteEvents.keys().next().value as number);
  const events = guestConnected ? [...pendingRemoteEvents.values()] : frame.events;
  const encoded = replicationEncoder.encode(activeSessionId, frame.tick, frame.snapshot, events, forceReplicationKeyframe);
  forceReplicationKeyframe = false;
  snapshotSequence += 1;
  send({
    type: "state",
    frame: encoded,
  });
};

const start = (message: Extract<HostServerInboundMessage, { type: "start" }>): void => {
  if (core) throw new Error("An authoritative session is already running.");
  const { config } = message;
  activeSessionId = config.sessionId;
  guestConnected = false;
  forceReplicationKeyframe = true;
  replicationEncoder.reset();
  pendingRemoteEvents.clear();
  core = new SimulationCore(config, {
    onResult: (victory, wave) => send({ type: "result", victory, wave }),
  });
  startedAt = Date.now();
  lastPumpAt = performance.now();
  tickWindowStartedAt = lastPumpAt;
  send({ type: "ready", diagnostics: diagnostics("running") });
  publishState();
};

const handleCommand = (message: Extract<HostServerInboundMessage, { type: "command" }>): void => {
  const { envelope } = message;
  if (!core) {
    send({ type: "command-result", result: { commandId: envelope.commandId, accepted: false, serverTick: tick, rejectionCode: "not-running", message: "Authoritative simulation is not running." } });
    return;
  }
  const result = core.submit(envelope);
  send({ type: "command-result", result });
  if (result.accepted) publishState();
};

parentPort.on("message", (event) => {
  try {
    const message = event.data as HostServerInboundMessage;
    if (!message || typeof message !== "object") return;
    if (message.type === "start") start(message);
    else if (message.type === "command") handleCommand(message);
    else if (message.type === "keyframe-request") {
      forceReplicationKeyframe = true;
      publishState();
    }
    else if (message.type === "event-ack") {
      [...pendingRemoteEvents.keys()].forEach((id) => { if (id <= message.eventId) pendingRemoteEvents.delete(id); });
    }
    else if (message.type === "peer-status") {
      guestConnected = message.connected;
      if (guestConnected) {
        forceReplicationKeyframe = true;
        publishState();
      }
    }
    else if (message.type === "stop") {
      stopped = true;
      core?.destroy();
      core = null;
      activeSessionId = "";
      pendingRemoteEvents.clear();
      send({ type: "diagnostics", diagnostics: diagnostics("stopped", message.reason) });
      process.exit(0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: "fatal", message });
  }
});

const stepMs = 1_000 / SIMULATION_TICK_HZ;
const replicationInterval = Math.max(1, Math.round(SIMULATION_TICK_HZ / REPLICATION_HZ));
setInterval(() => {
  if (stopped || !core) return;
  const now = performance.now();
  accumulatorMs = Math.min(accumulatorMs + (now - lastPumpAt), stepMs * 5);
  lastPumpAt = now;
  while (accumulatorMs >= stepMs) {
    core.advance();
    accumulatorMs -= stepMs;
    tick = core.tick;
    ticksInWindow += 1;
    if (tick % replicationInterval === 0) publishState();
  }
  if (now - tickWindowStartedAt >= 1_000) {
    measuredTickRate = ticksInWindow * 1_000 / (now - tickWindowStartedAt);
    tickWindowStartedAt = now;
    ticksInWindow = 0;
    send({ type: "diagnostics", diagnostics: diagnostics("running") });
  }
}, 5).unref();
