import { describe, expect, it } from "vitest";
import { SimulationCore } from "./SimulationCore.ts";
import { advanceTicks, createHeadlessGame, makeTestEnemy, makeTestPlayer, makeTestSimulationConfig, makeTestTower, snapshotDigest } from "./testSupport.ts";

describe("simulation test support", () => {
  it("creates valid overridable tower and enemy fixtures", () => {
    expect(makeTestTower("prism", 2)).toMatchObject({ kind: "prism", level: 2, hp: expect.any(Number) });
    expect(makeTestEnemy({ id: 8, hp: 42 })).toMatchObject({ id: 8, hp: 42, maxHp: 1_000 });
  });

  it("advances cores and produces a stable digest without transport metadata", () => {
    const left = new SimulationCore(makeTestSimulationConfig(), { onResult: () => undefined });
    const right = new SimulationCore(makeTestSimulationConfig(), { onResult: () => undefined });
    advanceTicks(left, 90);
    advanceTicks(right, 90);
    const leftFrame = left.createFrame();
    const rightFrame = right.createFrame();
    expect(leftFrame && rightFrame).toBeTruthy();
    expect(snapshotDigest(leftFrame!.snapshot)).toBe(snapshotDigest(rightFrame!.snapshot));
    left.destroy();
    right.destroy();
  });

  it("uses an injected clock for multiplayer snapshots", () => {
    const host = makeTestPlayer("test-host");
    const guest = makeTestPlayer("test-guest");
    const game = createHeadlessGame({
      role: "host",
      localPlayer: host,
      players: [host, guest],
      now: () => 12_345,
    });
    expect(game.createMultiplayerSnapshot(1)?.sentAt).toBe(12_345);
    game.destroy();
  });
});
