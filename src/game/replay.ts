import { SimulationCore } from "./SimulationCore.ts";
import type { MultiplayerGameSnapshot } from "./multiplayer.ts";
import type { CommandResult, SimulationCommandEnvelope, SimulationEvent, SimulationSessionConfig } from "./simulationProtocol.ts";

export const SIMULATION_REPLAY_VERSION = 1 as const;

export interface SimulationReplayCommand {
  readonly tick: number;
  readonly envelope: SimulationCommandEnvelope;
}

export interface SimulationReplayBundle {
  readonly version: typeof SIMULATION_REPLAY_VERSION;
  readonly config: SimulationSessionConfig;
  readonly commands: readonly SimulationReplayCommand[];
  /** Recent authoritative events are diagnostic context; replay execution ignores them. */
  readonly recentEvents?: readonly SimulationEvent[];
}

export interface SimulationReplayCheckpoint {
  readonly tick: number;
  readonly digest: string;
}

export interface SimulationReplayResult {
  readonly finalSnapshot: MultiplayerGameSnapshot;
  readonly finalDigest: string;
  readonly commandResults: readonly CommandResult[];
  readonly events: readonly SimulationEvent[];
  readonly checkpoints: readonly SimulationReplayCheckpoint[];
  readonly result: { readonly victory: boolean; readonly wave: number } | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const finiteInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

const cloneForDigest = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Stable state representation that deliberately excludes transport timestamps and sequence numbers. */
export const simulationSnapshotDigest = (snapshot: MultiplayerGameSnapshot): string => JSON.stringify({
  integrity: snapshot.integrity,
  maxIntegrity: snapshot.maxIntegrity,
  wave: snapshot.wave,
  waveActive: snapshot.waveActive,
  intermissionRemaining: snapshot.intermissionRemaining,
  nextWaveIndex: snapshot.nextWaveIndex,
  paused: snapshot.paused,
  speed: snapshot.speed,
  started: snapshot.started,
  gameOver: snapshot.gameOver,
  modeComplete: snapshot.modeComplete,
  players: [...snapshot.players].sort((left, right) => left.id.localeCompare(right.id)),
  towers: [...snapshot.towers]
    .map((tower) => ({ ...tower, engaged: [...tower.engaged].sort((left, right) => left - right) }))
    .sort((left, right) => left.id - right.id),
  enemies: [...snapshot.enemies].sort((left, right) => left.id - right.id),
  timedBombs: [...snapshot.timedBombs],
});

export const createSimulationReplay = (
  config: SimulationSessionConfig,
  commands: readonly SimulationReplayCommand[] = [],
  recentEvents: readonly SimulationEvent[] = [],
): SimulationReplayBundle => ({
  version: SIMULATION_REPLAY_VERSION,
  config: cloneForDigest(config),
  commands: [...commands]
    .map((entry) => ({ tick: entry.tick, envelope: cloneForDigest(entry.envelope) }))
    .sort((left, right) => left.tick - right.tick),
  ...(recentEvents.length > 0 ? { recentEvents: cloneForDigest(recentEvents.slice(-128)) } : {}),
});

export const serializeSimulationReplay = (bundle: SimulationReplayBundle): string => JSON.stringify(bundle, null, 2);

export const parseSimulationReplay = (input: unknown): SimulationReplayBundle => {
  const source = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const object = record(source);
  if (!object || object["version"] !== SIMULATION_REPLAY_VERSION || !record(object["config"]) || !Array.isArray(object["commands"])) {
    throw new Error("Invalid or incompatible simulation replay bundle.");
  }
  const commands = (object["commands"] as unknown[]).map((value, index) => {
    const entry = record(value);
    const envelope = entry ? record(entry["envelope"]) : null;
    if (!entry || !finiteInteger(entry["tick"]) || !envelope || typeof envelope["commandId"] !== "string" || typeof envelope["playerId"] !== "string" || !finiteInteger(envelope["clientSequence"], 1) || !record(envelope["command"])) {
      throw new Error(`Invalid simulation replay command at index ${index}.`);
    }
    return { tick: entry["tick"] as number, envelope: valueOfReplayEnvelope(envelope) };
  });
  const recentEvents = Array.isArray(object["recentEvents"])
    ? object["recentEvents"].slice(-128) as SimulationEvent[]
    : [];
  return createSimulationReplay(object["config"] as unknown as SimulationSessionConfig, commands, recentEvents);
};

const valueOfReplayEnvelope = (value: Record<string, unknown>): SimulationCommandEnvelope => ({
  commandId: value["commandId"] as string,
  playerId: value["playerId"] as string,
  clientSequence: value["clientSequence"] as number,
  command: value["command"] as SimulationCommandEnvelope["command"],
});

export const runSimulationReplay = (
  bundle: SimulationReplayBundle,
  options: { readonly ticks?: number; readonly checkpointInterval?: number } = {},
): SimulationReplayResult => {
  const latestCommandTick = bundle.commands.reduce((latest, command) => Math.max(latest, command.tick), 0);
  const ticks = options.ticks ?? latestCommandTick + 1;
  if (!finiteInteger(ticks)) throw new Error("Replay tick count must be a non-negative safe integer.");
  const checkpointInterval = options.checkpointInterval ?? 30;
  if (!finiteInteger(checkpointInterval, 1)) throw new Error("Replay checkpoint interval must be a positive safe integer.");
  const commandsByTick = new Map<number, SimulationReplayCommand[]>();
  bundle.commands.forEach((command) => {
    if (command.tick > ticks) return;
    const scheduled = commandsByTick.get(command.tick) ?? [];
    scheduled.push(command);
    commandsByTick.set(command.tick, scheduled);
  });
  const commandResults: CommandResult[] = [];
  const events: SimulationEvent[] = [];
  const checkpoints: SimulationReplayCheckpoint[] = [];
  let result: { victory: boolean; wave: number } | null = null;
  const core = new SimulationCore(bundle.config, {
    onResult: (victory, wave) => { result = { victory, wave }; },
  });
  let finalSnapshot: MultiplayerGameSnapshot | null = null;
  try {
    for (let tick = 0; tick < ticks; tick += 1) {
      commandsByTick.get(tick)?.forEach(({ envelope }) => commandResults.push(core.submit(envelope)));
      core.advance();
      const frame = core.createFrame();
      if (!frame) continue;
      finalSnapshot = frame.snapshot;
      events.push(...frame.events);
      if (core.tick % checkpointInterval === 0 || core.tick === ticks) {
        checkpoints.push({ tick: core.tick, digest: simulationSnapshotDigest(frame.snapshot) });
      }
    }
    if (!finalSnapshot) {
      const frame = core.createFrame();
      if (!frame) throw new Error("Replay did not produce a state snapshot.");
      finalSnapshot = frame.snapshot;
      events.push(...frame.events);
    }
  } finally {
    core.destroy();
  }
  return {
    finalSnapshot,
    finalDigest: simulationSnapshotDigest(finalSnapshot),
    commandResults,
    events,
    checkpoints,
    result,
  };
};
