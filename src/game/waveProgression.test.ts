import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE } from "./config.ts";
import { buildWaveSpawnPlan, spawnDurationForWave } from "./waveProgression.ts";

describe("wave spawn planning", () => {
  it("expands authored groups into deterministic timed enemy entries", () => {
    const plan = buildWaveSpawnPlan(NORMAL_MODE, MAP_DEFINITIONS.sector07, 0, 1);
    const firstWave = NORMAL_MODE.waves[0]!;
    const expectedCount = firstWave.groups!.reduce((total, group) => total + group.count, 0);

    expect(plan.entries).toHaveLength(expectedCount);
    expect(plan.entries.every((entry) => entry.pathIndex === 0 && entry.hp > 0)).toBe(true);
    expect(plan.entries.map((entry) => entry.spawnAt)).toEqual(
      [...plan.entries].map((entry) => entry.spawnAt).sort((left, right) => left - right),
    );
    expect(plan.duration).toBe(Math.max(...plan.entries.map((entry) => entry.spawnAt)));
    expect(spawnDurationForWave(NORMAL_MODE, MAP_DEFINITIONS.sector07, 0, 1)).toBe(plan.duration);
  });

  it("duplicates each scheduled entry across multiply-routed paths", () => {
    const primary = MAP_DEFINITIONS.sector07.paths[0]!;
    const map = {
      ...MAP_DEFINITIONS.sector07,
      enemyRouting: "multiply" as const,
      paths: [primary, { ...primary, id: "sector07-secondary" }],
    };
    const singlePath = buildWaveSpawnPlan(NORMAL_MODE, MAP_DEFINITIONS.sector07, 0, 1);
    const multiplied = buildWaveSpawnPlan(NORMAL_MODE, map, 0, 2);

    expect(multiplied.entries).toHaveLength(singlePath.entries.length * 2);
    expect(new Set(multiplied.entries.map((entry) => entry.pathIndex))).toEqual(new Set([0, 1]));
    expect(multiplied.duration).toBe(singlePath.duration + 0.025);
  });

  it("spawns command blocks on their configured spawnPathIndex in split routing", () => {
    const primary = MAP_DEFINITIONS.sector07.paths[0]!;
    const map = {
      ...MAP_DEFINITIONS.sector07,
      enemyRouting: "split" as const,
      paths: [primary, { ...primary, id: "sector07-b" }, { ...primary, id: "sector07-c" }],
    };
    const mode = {
      ...NORMAL_MODE,
      waves: [
        {
          referenceHealth: 100,
          waveTimeSeconds: 30,
          blocks: [
            { command: "enemyGroup" as const, enemy: "rusher" as const, count: 3, spawnDelay: 0.5, nextBlockDelay: 2, spawnPathIndex: 1 },
          ],
        },
      ],
    };

    const plan = buildWaveSpawnPlan(mode, map, 0, 3);
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries.every((entry) => entry.pathIndex === 1)).toBe(true);
  });

  it("clamps spawnPathIndex to the highest available path when map has fewer paths", () => {
    const primary = MAP_DEFINITIONS.sector07.paths[0]!;
    const map = {
      ...MAP_DEFINITIONS.sector07,
      enemyRouting: "split" as const,
      paths: [primary, { ...primary, id: "sector07-secondary" }],
    };
    const mode = {
      ...NORMAL_MODE,
      waves: [
        {
          referenceHealth: 100,
          waveTimeSeconds: 30,
          blocks: [
            // Target path index 5, but map only has 2 paths (0 and 1)
            { command: "enemyGroup" as const, enemy: "bulwark" as const, count: 2, spawnDelay: 1, nextBlockDelay: 2, spawnPathIndex: 5 },
          ],
        },
      ],
    };

    const plan = buildWaveSpawnPlan(mode, map, 0, 2);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.every((entry) => entry.pathIndex === 1)).toBe(true);

    // If map only has 1 path, clamp to 0
    const singlePathPlan = buildWaveSpawnPlan(mode, MAP_DEFINITIONS.sector07, 0, 1);
    expect(singlePathPlan.entries.every((entry) => entry.pathIndex === 0)).toBe(true);
  });

  it("does not multiply enemies that have a custom spawnPathIndex on multiply maps", () => {
    const primary = MAP_DEFINITIONS.sector07.paths[0]!;
    const map = {
      ...MAP_DEFINITIONS.sector07,
      enemyRouting: "multiply" as const,
      paths: [primary, { ...primary, id: "sector07-b" }, { ...primary, id: "sector07-c" }],
    };
    const mode = {
      ...NORMAL_MODE,
      waves: [
        {
          referenceHealth: 100,
          waveTimeSeconds: 30,
          blocks: [
            // Normal block without custom path: should multiply across all 3 paths (2 * 3 = 6 spawns)
            { command: "enemyGroup" as const, enemy: "rusher" as const, count: 2, spawnDelay: 0.5, nextBlockDelay: 2 },
            // Custom path block: should NOT multiply, only spawn on path 2 (1 * 1 = 1 spawn)
            { command: "enemyGroup" as const, enemy: "overseer" as const, count: 1, spawnDelay: 1, nextBlockDelay: 1, spawnPathIndex: 2 },
          ],
        },
      ],
    };

    const plan = buildWaveSpawnPlan(mode, map, 0, 3);
    // 6 rusher spawns + 1 overseer spawn = 7 entries total
    expect(plan.entries).toHaveLength(7);
    const overseerEntries = plan.entries.filter((entry) => entry.kind === "overseer");
    expect(overseerEntries).toHaveLength(1);
    expect(overseerEntries[0]!.pathIndex).toBe(2);

    const rusherEntries = plan.entries.filter((entry) => entry.kind === "rusher");
    expect(rusherEntries).toHaveLength(6);
    expect(new Set(rusherEntries.map((e) => e.pathIndex))).toEqual(new Set([0, 1, 2]));
  });
});
