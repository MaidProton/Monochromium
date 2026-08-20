import { Game } from "./Game.ts";
import { sanitizeCustomEnemies } from "./customEnemies.ts";
import { setCustomEnemyRegistry } from "./enemyRegistry.ts";
import { MULTIPLAYER_PROTOCOL_VERSION } from "./multiplayer.ts";
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

/** DOM-free authoritative facade used by the Electron utility process. */
export class SimulationCore {
  private readonly game: Game;
  private readonly handledCommands = new Map<string, boolean>();
  private readonly events: SimulationEvent[] = [];
  private eventSequence = 0;
  private snapshotSequence = 0;
  private _tick = 0;

  constructor(config: SimulationSessionConfig, callbacks: SimulationCoreCallbacks) {
    if (config.protocol !== MULTIPLAYER_PROTOCOL_VERSION || config.players.length !== 2) throw new Error("Invalid or incompatible simulation session.");
    const host = config.players[0];
    if (!host) throw new Error("The simulation session does not contain a host.");
    setCustomEnemyRegistry(sanitizeCustomEnemies(config.customEnemies));
    this.game = new Game(null as unknown as HTMLCanvasElement, {
      onUi: () => undefined,
      onLog: (label, tone = "neutral") => this.emitLog(label, tone),
      onGameOver: (wave) => callbacks.onResult(false, wave),
      onVictory: (mode) => callbacks.onResult(true, mode.waves.length),
      onSimulationEvent: (event) => this.emitEvent(event),
    }, null, { headless: true });
    this.game.setSimulationSeed(config.seed);
    this.game.configureMultiplayer("host", host, config.players);
    this.game.startRun(config.map, host.loadout, config.mode);
  }

  get tick(): number { return this._tick; }

  advance(): void {
    this.game.advanceFixedStep(1 / SIMULATION_TICK_HZ);
    this._tick += 1;
  }

  submit(envelope: SimulationCommandEnvelope): CommandResult {
    const prior = this.handledCommands.get(envelope.commandId);
    if (prior !== undefined) {
      return {
        commandId: envelope.commandId,
        accepted: prior,
        serverTick: this._tick,
        ...(!prior ? { rejectionCode: "duplicate" as const, message: "Duplicate rejected command." } : {}),
      };
    }
    const accepted = this.game.applyMultiplayerCommand(envelope.playerId, envelope.command);
    this.handledCommands.set(envelope.commandId, accepted);
    if (this.handledCommands.size > 2_048) this.handledCommands.delete(this.handledCommands.keys().next().value as string);
    return {
      commandId: envelope.commandId,
      accepted,
      serverTick: this._tick,
      ...(!accepted ? { rejectionCode: "rejected" as const, message: "The authoritative server rejected that action." } : {}),
    };
  }

  createFrame(): AuthoritativeStateFrame | null {
    const snapshot = this.game.createMultiplayerSnapshot(++this.snapshotSequence);
    if (!snapshot) return null;
    return {
      tick: this._tick,
      generatedAt: performance.now(),
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
