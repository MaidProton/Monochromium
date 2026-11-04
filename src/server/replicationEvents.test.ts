import { describe, expect, it } from "vitest";
import { coalesceEvents } from "./replicationEvents.ts";
import type { SimulationEvent } from "../game/simulationProtocol.ts";

const attack = (id: number, tick: number): SimulationEvent => ({
  id,
  tick,
  kind: "attack",
  entityId: 4,
  targetId: 9,
  label: "gunner",
  visual: "hitscan",
  cosmeticSeed: id,
});

describe("replication event coalescing", () => {
  it("preserves original burst cadence in compact cosmetic timing metadata", () => {
    const coalesced = coalesceEvents([attack(1, 30), attack(2, 33), attack(3, 36)]);

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]).toMatchObject({ count: 3, tick: 36, occurrenceTickOffsets: [-6, -3, 0] });
  });

  it("does not merge individually timed missile rack launches", () => {
    const missiles = [attack(1, 30), attack(2, 33)].map((event, index) => ({ ...event, label: "mecha-missile", count: index }));
    expect(coalesceEvents(missiles)).toHaveLength(2);
  });
});
