import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE } from "./config.ts";
import { MULTIPLAYER_PROTOCOL_VERSION } from "./multiplayer.ts";
import { SimulationCore } from "./SimulationCore.ts";
import type { SimulationSessionConfig } from "./simulationProtocol.ts";

const config = (seed = 12345): SimulationSessionConfig => ({
  protocol: MULTIPLAYER_PROTOCOL_VERSION,
  sessionId: "TEST1234",
  seed,
  map: MAP_DEFINITIONS.sector07,
  mode: NORMAL_MODE,
  customEnemies: [],
  players: [
    { id: "test-host", username: "HOST", color: "#66d9ff", loadout: ["bandit"] },
    { id: "test-guest", username: "GUEST", color: "#ff806f", loadout: ["bandit"] },
  ],
});
const createCore = (seed = 12345): SimulationCore => new SimulationCore(config(seed), { onResult: () => undefined });

describe("authoritative SimulationCore", () => {
  it("advances identical seeded sessions deterministically at fixed ticks", () => {
    const left = createCore();
    const right = createCore();
    for (let index = 0; index < 180; index += 1) {
      left.advance();
      right.advance();
    }
    const leftSnapshot = left.createFrame()?.snapshot;
    const rightSnapshot = right.createFrame()?.snapshot;
    expect(left.tick).toBe(180);
    expect(right.tick).toBe(180);
    expect(leftSnapshot && {
      integrity: leftSnapshot.integrity,
      wave: leftSnapshot.wave,
      towers: leftSnapshot.towers,
      enemies: leftSnapshot.enemies,
      players: leftSnapshot.players,
    }).toEqual(rightSnapshot && {
      integrity: rightSnapshot.integrity,
      wave: rightSnapshot.wave,
      towers: rightSnapshot.towers,
      enemies: rightSnapshot.enemies,
      players: rightSnapshot.players,
    });
  });

  it("deduplicates command IDs and rejects unknown players", () => {
    const core = createCore();
    const envelope = {
      commandId: "test-host:1",
      playerId: "test-host",
      clientSequence: 1,
      command: { type: "pause" as const },
    };
    expect(core.submit(envelope).accepted).toBe(true);
    expect(core.submit(envelope).accepted).toBe(true);
    expect(core.createFrame()?.snapshot.paused).toBe(true);
    expect(core.submit({ ...envelope, commandId: "intruder:1", playerId: "intruder" }).accepted).toBe(false);
  });
});
