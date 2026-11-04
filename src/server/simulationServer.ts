import { SimulationCore } from "../game/SimulationCore.ts";
import { coalesceEvents } from "./replicationEvents.ts";
import { ReplicationEncoder, replicationEventBytes } from "../game/replication.ts";
import {
  CONGESTED_REPLICATION_HZ,
  IDLE_REPLICATION_HZ,
  REPLICATION_HZ,
  PILOT_REPLICATION_HZ,
  SIMULATION_TICK_HZ,
  type HostServerInboundMessage,
  type HostServerOutboundMessage,
  type SimulationServerDiagnostics,
} from "../game/simulationProtocol.ts";

interface UtilityParentPort {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
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
let hostCursor: import("../game/types.ts").Point | null = null;
let latestGuestPulseSequence = 0;
let lastReplicationAt = 0;
let lastCommandFlushTick = -1;
let commandFlushPending = false;
let idleReplication = true;
let pilotReplication = false;
let replicationCongested = false;
let packetsInWindow = 0;
let stateBytes = 0;
let eventBytes = 0;
let keyframes = 0;
let replacedFrames = 0;
let backpressureStartedAt = 0;
let backpressureMs = 0;
const replicationEncoder = new ReplicationEncoder();
const pendingRemoteEvents = new Map<number, import("../game/simulationProtocol.ts").SimulationEvent>();
const send = (message: HostServerOutboundMessage, transfer?: ArrayBuffer[]): void => parentPort.postMessage(message, transfer);

const diagnostics = (status: SimulationServerDiagnostics["status"], message?: string): SimulationServerDiagnostics => ({
  status,
  tick,
  tickRate: measuredTickRate,
  frameSequence: snapshotSequence,
  startedAt,
  packetRate: packetsInWindow,
  stateBytes,
  eventBytes,
  keyframes,
  replacedFrames,
  backpressureMs: backpressureMs + (backpressureStartedAt > 0 ? performance.now() - backpressureStartedAt : 0),
  ...(message ? { message } : {}),
});

const publishState = (): void => {
  const frame = core?.createFrame();
  if (!frame) return;
  const currentEvents = coalesceEvents(frame.events);
  if (guestConnected) {
    currentEvents.forEach((event) => pendingRemoteEvents.set(event.id, event));
    while (pendingRemoteEvents.size > 512) pendingRemoteEvents.delete(pendingRemoteEvents.keys().next().value as number);
  }
  const retainedEvents = guestConnected ? [...pendingRemoteEvents.values()] : currentEvents;
  const wasKeyframe = forceReplicationKeyframe;
  const encoded = replicationEncoder.encode(activeSessionId, frame.tick, frame.snapshot, forceReplicationKeyframe, {
    events: retainedEvents,
    hostCursor,
    guestPulseSequence: latestGuestPulseSequence,
    pilotInputAcks: core?.getPilotInputAcks() ?? [],
  });
  forceReplicationKeyframe = false;
  snapshotSequence += 1;
  packetsInWindow += 1;
  stateBytes += encoded.byteLength;
  eventBytes += replicationEventBytes(retainedEvents);
  if (wasKeyframe) keyframes += 1;
  idleReplication = frame.snapshot.paused || !frame.snapshot.waveActive;
  pilotReplication = !frame.snapshot.paused && frame.snapshot.towers.some((tower) => tower.kind === "mecha" && tower.mechaControlled);
  lastReplicationAt = performance.now();
  send({
    type: "state",
    frame: encoded,
  }, [encoded]);
};

const start = (message: Extract<HostServerInboundMessage, { type: "start" | "restart" }>): void => {
  core?.destroy();
  core = null;
  const { config } = message;
  activeSessionId = config.sessionId;
  guestConnected = false;
  forceReplicationKeyframe = true;
  replicationEncoder.reset();
  tick = 0;
  snapshotSequence = 0;
  accumulatorMs = 0;
  ticksInWindow = 0;
  measuredTickRate = 0;
  pendingRemoteEvents.clear();
  hostCursor = null;
  latestGuestPulseSequence = 0;
  lastReplicationAt = 0;
  lastCommandFlushTick = -1;
  commandFlushPending = false;
  idleReplication = true;
  pilotReplication = false;
  replicationCongested = false;
  packetsInWindow = 0;
  stateBytes = 0;
  eventBytes = 0;
  keyframes = 0;
  replacedFrames = 0;
  backpressureStartedAt = 0;
  backpressureMs = 0;
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
  // Held-input heartbeats are acknowledged, but use the pilot state cadence.
  // Two pilots must not force two full-world snapshots per input heartbeat.
  if (envelope.command.type === "mecha-input") return;
  if (result.accepted) {
    if (lastCommandFlushTick !== tick) {
      lastCommandFlushTick = tick;
      publishState();
    } else commandFlushPending = true;
  }
};

parentPort.on("message", (event) => {
  try {
    const message = event.data as HostServerInboundMessage;
    if (!message || typeof message !== "object") return;
    if (message.type === "start" || message.type === "restart") start(message);
    else if (message.type === "command") handleCommand(message);
    else if (message.type === "pilot-input") {
      core?.submitPilotInput(message.input);
    }
    else if (message.type === "keyframe-request") {
      forceReplicationKeyframe = true;
      publishState();
    }
    else if (message.type === "guest-pulse") {
      latestGuestPulseSequence = Math.max(latestGuestPulseSequence, message.sequence);
      [...pendingRemoteEvents.keys()].forEach((id) => { if (id <= message.eventId) pendingRemoteEvents.delete(id); });
    }
    else if (message.type === "host-cursor") {
      hostCursor = message.point ? { ...message.point } : null;
      if (performance.now() - lastReplicationAt >= 1_000 / REPLICATION_HZ) publishState();
    }
    else if (message.type === "frame-replaced") {
      replacedFrames += 1;
      forceReplicationKeyframe = true;
      publishState();
    }
    else if (message.type === "replication-pressure") {
      if (message.congested !== replicationCongested) {
        replicationCongested = message.congested;
        if (message.congested) backpressureStartedAt = performance.now();
        else if (backpressureStartedAt > 0) { backpressureMs += performance.now() - backpressureStartedAt; backpressureStartedAt = 0; }
      }
    }
    else if (message.type === "peer-status") {
      guestConnected = message.connected;
      if (guestConnected) {
        forceReplicationKeyframe = true;
        publishState();
      } else pendingRemoteEvents.clear();
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
  }
  const replicationHz = replicationCongested ? CONGESTED_REPLICATION_HZ : pilotReplication ? PILOT_REPLICATION_HZ : idleReplication ? IDLE_REPLICATION_HZ : REPLICATION_HZ;
  if (commandFlushPending && lastCommandFlushTick !== tick) {
    commandFlushPending = false;
    lastCommandFlushTick = tick;
    publishState();
  } else if (now - lastReplicationAt >= 1_000 / replicationHz) publishState();
  if (now - tickWindowStartedAt >= 1_000) {
    measuredTickRate = ticksInWindow * 1_000 / (now - tickWindowStartedAt);
    tickWindowStartedAt = now;
    ticksInWindow = 0;
    send({ type: "diagnostics", diagnostics: diagnostics("running") });
    packetsInWindow = 0;
    stateBytes = 0;
    eventBytes = 0;
  }
}, 5).unref();
