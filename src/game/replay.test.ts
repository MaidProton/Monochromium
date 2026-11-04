import { describe, expect, it } from "vitest";
import { makeTestSimulationConfig } from "./testSupport.ts";
import { createSimulationReplay, parseSimulationReplay, runSimulationReplay, serializeSimulationReplay } from "./replay.ts";

describe("deterministic simulation replays", () => {
  it("round-trips a command bundle and reproduces the same checkpoints", () => {
    const bundle = createSimulationReplay(makeTestSimulationConfig({
      mode: { ...makeTestSimulationConfig().mode, startingCash: 2_000 },
    }), [{
      tick: 0,
      envelope: {
        commandId: "test-host:deploy",
        playerId: "test-host",
        clientSequence: 1,
        command: { type: "deploy", kind: "bandit", position: { x: 400, y: 300 } },
      },
    }]);
    const parsed = parseSimulationReplay(serializeSimulationReplay(bundle));
    const left = runSimulationReplay(parsed, { ticks: 90, checkpointInterval: 15 });
    const right = runSimulationReplay(parsed, { ticks: 90, checkpointInterval: 15 });
    expect(left.commandResults).toEqual(right.commandResults);
    expect(left.finalDigest).toBe(right.finalDigest);
    expect(left.checkpoints).toEqual(right.checkpoints);
    expect(left.events.map((event) => event.kind)).toEqual(right.events.map((event) => event.kind));
    expect(left.commandResults[0]?.accepted).toBe(true);
  });

  it("rejects malformed bundles and commands", () => {
    expect(() => parseSimulationReplay({ version: 99, config: {}, commands: [] })).toThrow("Invalid or incompatible");
    expect(() => parseSimulationReplay({ version: 1, config: {}, commands: [{ tick: -1 }] })).toThrow("Invalid simulation replay command");
  });
});
