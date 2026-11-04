import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCustomMode, customModeToDefinition, deleteCustomMode, sanitizeCustomModes, upsertCustomMode } from "./customModes.ts";
import { installTestStorage, uninstallTestStorage } from "./testStorage.ts";

describe("custom mode persistence and conversion", () => {
  beforeEach(() => installTestStorage());
  afterEach(() => uninstallTestStorage());

  it("migrates malformed blocks while preserving unavailable custom-enemy references", () => {
    const modes = sanitizeCustomModes([{
      id: "custom:legacy",
      name: "  Legacy  ",
      description: "x".repeat(300),
      startingCash: -5,
      coreIntegrity: 0,
      multiplayerHitCashMultiplier: 4,
      waves: [{
        cashReward: -10,
        blocks: [{ enemy: "custom-enemy:not-installed", count: 0, spawnDelay: -1, nextBlockDelay: 99999 }],
      }],
    }]);
    expect(modes[0]).toMatchObject({
      id: "custom:legacy",
      name: "Legacy",
      startingCash: 0,
      coreIntegrity: 1,
      multiplayerHitCashMultiplier: 1,
      waves: [{ cashReward: 0, blocks: [{ enemy: "custom-enemy:not-installed", count: 1, spawnDelay: 0.02, nextBlockDelay: 3600 }] }],
    });
  });

  it("converts waves to authoritative definitions and persists upserts/deletes", () => {
    const draft = createCustomMode();
    draft.id = "custom:fixture";
    draft.waves[0]!.blocks[0]!.enemy = "dummy";
    draft.waves[0]!.blocks[0]!.count = 3;
    const definition = customModeToDefinition(draft);
    expect(definition.isCustom).toBe(true);
    expect(definition.waves[0]).toMatchObject({ cashReward: 50, referenceHealth: 12 });

    const saved = upsertCustomMode([], draft);
    expect(saved).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("monochromium.custom-modes.v1") ?? "null")).toHaveLength(1);
    expect(deleteCustomMode(saved, draft.id)).toEqual([]);
    expect(JSON.parse(localStorage.getItem("monochromium.custom-modes.v1") ?? "null")).toEqual([]);
  });

  it("sanitizes, clones, and converts spawnPathIndex on enemy group blocks", () => {
    const modes = sanitizeCustomModes([{
      id: "custom:path-test",
      name: "Path Test",
      description: "Testing spawnPathIndex",
      startingCash: 500,
      coreIntegrity: 12,
      multiplayerHitCashMultiplier: 0.75,
      waves: [{
        cashReward: 50,
        blocks: [
          { enemy: "rusher", count: 3, spawnDelay: 1, nextBlockDelay: 5, spawnPathIndex: 2 },
          { enemy: "tank", count: 1, spawnDelay: 1, nextBlockDelay: 5, spawnPathIndex: -5 },
          { enemy: "swiftRusher", count: 2, spawnDelay: 0.5, nextBlockDelay: 3 },
        ],
      }],
    }]);

    expect(modes[0]!.waves[0]!.blocks[0]!.spawnPathIndex).toBe(2);
    // Invalid negative spawnPathIndex should be sanitized away (undefined)
    expect(modes[0]!.waves[0]!.blocks[1]!.spawnPathIndex).toBeUndefined();
    // Omitted spawnPathIndex remains undefined
    expect(modes[0]!.waves[0]!.blocks[2]!.spawnPathIndex).toBeUndefined();

    const definition = customModeToDefinition(modes[0]!);
    expect(definition.waves[0]!.blocks![0]!.spawnPathIndex).toBe(2);
    expect(definition.waves[0]!.blocks![1]!.spawnPathIndex).toBeUndefined();
  });
});
