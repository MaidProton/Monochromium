import { Game } from "./Game.ts";
import { TOWER_ORDER } from "./config.ts";
import { sanitizeCustomEnemies } from "./customEnemies.ts";
import { setCustomEnemyRegistry } from "./enemyRegistry.ts";
import { MULTIPLAYER_PROTOCOL_VERSION, type MultiplayerPilotInput, type MultiplayerPilotInputAck } from "./multiplayer.ts";
import {
  SIMULATION_TICK_HZ,
  type AuthoritativeStateFrame,
  type CommandResult,
  type SimulationCommandEnvelope,
  type SimulationEvent,
  type SimulationSessionConfig,
} from "./simulationProtocol.ts";

export interface SimulationCoreCallbacks {
  readonly onResult: (victory: boolean, wave: number) => void;
}

export interface SimulationCoreOptions {
  /** Defaults to the fixed simulation clock so replays do not depend on wall time. */
  readonly now?: () => number;
}

/** DOM-free authoritative facade used by the Electron utility process. */
export class SimulationCore {
  private readonly game: Game;
  private readonly handledCommands = new Map<string, boolean>();
  private readonly events: SimulationEvent[] = [];
  private readonly now: () => number;
  private eventSequence = 0;
  private snapshotSequence = 0;
  private _tick = 0;
  private readonly pilotInputAcks = new Map<string, MultiplayerPilotInputAck>();

  constructor(config: SimulationSessionConfig, callbacks: SimulationCoreCallbacks, options: SimulationCoreOptions = {}) {
    if (config.protocol !== MULTIPLAYER_PROTOCOL_VERSION || config.players.length !== 2 || !Array.isArray(config.allowedTowers) || config.allowedTowers.length === 0) throw new Error("Invalid or incompatible simulation session.");
    const allowedTowers = new Set(config.allowedTowers.filter((kind) => TOWER_ORDER.includes(kind)));
    if (allowedTowers.size === 0) throw new Error("The simulation session has no authorized tower types.");
    const players = config.players.map((player) => ({ ...player, loadout: player.loadout.filter((kind) => allowedTowers.has(kind)) }));
    const host = players[0];
    if (!host) throw new Error("The simulation session does not contain a host.");
    this.now = options.now ?? (() => this._tick * 1_000 / SIMULATION_TICK_HZ);
    setCustomEnemyRegistry(sanitizeCustomEnemies(config.customEnemies));
    this.game = new Game(null as unknown as HTMLCanvasElement, {
      onUi: () => undefined,
      onLog: (label, tone = "neutral") => this.emitLog(label, tone),
      onGameOver: (wave) => callbacks.onResult(false, wave),
      onVictory: (mode) => callbacks.onResult(true, mode.waves.length),
      onSimulationEvent: (event) => this.emitEvent(event),
    }, null, { headless: true, now: this.now });
    this.game.setSimulationSeed(config.seed);
    this.game.configureMultiplayer("host", host, players);
    this.game.startRun(config.map, host.loadout, config.mode);
  }

  get tick(): number { return this._tick; }

  advance(): void {
    this.game.advanceFixedStep(1 / SIMULATION_TICK_HZ);
    this._tick += 1;
  }

  submit(envelope: SimulationCommandEnvelope): CommandResult {
    const commandKey = `${envelope.playerId}:${envelope.commandId}`;
    const prior = this.handledCommands.get(commandKey);
    if (prior !== undefined) {
      return {
        commandId: envelope.commandId,
        accepted: prior,
        serverTick: this._tick,
        ...(!prior ? { rejectionCode: "duplicate" as const, message: "Duplicate rejected command." } : {}),
      };
    }
    const accepted = this.game.applyMultiplayerCommand(envelope.playerId, envelope.command);
    this.handledCommands.set(commandKey, accepted);
    if (this.handledCommands.size > 2_048) this.handledCommands.delete(this.handledCommands.keys().next().value as string);
    return {
      commandId: envelope.commandId,
      accepted,
      serverTick: this._tick,
      ...(!accepted ? { rejectionCode: "rejected" as const, message: "The authoritative server rejected that action." } : {}),
    };
  }

  /** Applies only the latest continuous pilot state; it is not a reliable gameplay command. */
  submitPilotInput(input: MultiplayerPilotInput): boolean {
    const key = `${input.playerId}:${input.towerId}`;
    const prior = this.pilotInputAcks.get(key);
    if (prior && input.sequence <= prior.sequence) return false;
    const accepted = this.game.applyMultiplayerCommand(input.playerId, {
      type: "mecha-input",
      towerId: input.towerId,
      moveX: input.moveX,
      moveY: input.moveY,
      aim: input.aim,
      firing: input.firing,
      ...(input.brake === undefined ? {} : { brake: input.brake }),
    });
    if (accepted) {
      this.pilotInputAcks.set(key, { playerId: input.playerId, towerId: input.towerId, sequence: input.sequence });
      if (this.pilotInputAcks.size > 100) this.pilotInputAcks.delete(this.pilotInputAcks.keys().next().value as string);
    }
    return accepted;
  }

  getPilotInputAcks(): readonly MultiplayerPilotInputAck[] {
    return [...this.pilotInputAcks.values()];
  }

  createFrame(): AuthoritativeStateFrame | null {
    const snapshot = this.game.createMultiplayerSnapshot(++this.snapshotSequence);
    if (!snapshot) return null;
    return {
      tick: this._tick,
      generatedAt: this.now(),
      snapshot: { ...snapshot, projectiles: [], particles: [], spawnQueue: [] },
      events: this.events.splice(0),
    };
  }

  destroy(): void {
    this.game.destroy();
  }

  private emitLog(label: string, tone: "neutral" | "good" | "danger"): void {
    const id = ++this.eventSequence;
    this.events.push({
      id,
      tick: this._tick,
      kind: "log",
      label,
      tone,
      cosmeticSeed: (Math.imul(id, 2654435761) ^ this._tick) >>> 0,
    });
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }

  private emitEvent(event: Omit<SimulationEvent, "id" | "tick" | "cosmeticSeed" | "tone">): void {
    const id = ++this.eventSequence;
    this.events.push({
      ...event,
      id,
      tick: this._tick,
      cosmeticSeed: (Math.imul(id, 2654435761) ^ this._tick) >>> 0,
    });
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }
}
