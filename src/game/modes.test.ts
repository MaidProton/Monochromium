import { describe, expect, it } from "vitest";
import { HARD_MODE, MODE_DEFINITIONS, NORMAL_MODE } from "./config.ts";
import { getEnemyDefinition } from "./enemyRegistry.ts";

describe("official mode progression", () => {
  it("ships Hard Mode as a distinct 30-wave official campaign", () => {
    expect(MODE_DEFINITIONS.map((mode) => mode.kind)).toEqual(["normal", "hard"]);
    expect(HARD_MODE).toMatchObject({
      kind: "hard",
      name: "Hard Mode",
      isCustom: false,
      startingCash: 900,
      coreIntegrity: 12,
      reward: { coins: 460, tokens: 0 },
    });
    expect(NORMAL_MODE.reward).toEqual({ coins: 250, tokens: 2 });
    expect(HARD_MODE.waves).toHaveLength(30);
    expect(HARD_MODE.waves.every((wave) => wave.groups && wave.groups.length > 0 && wave.referenceHealth > 0)).toBe(true);
    expect(Math.max(...HARD_MODE.waves.slice(0, 5).map((wave) => wave.referenceHealth))).toBeLessThanOrEqual(314);
    expect(HARD_MODE.waves[0]?.referenceHealth).toBeGreaterThan(NORMAL_MODE.waves[0]?.referenceHealth ?? 0);
    expect(HARD_MODE.waves.at(-1)?.referenceHealth).toBeGreaterThan(20_000);
  });

  it("introduces layered defenses and recurring boss checkpoints", () => {
    const newHardEnemies = [
      "platedDummy",
      "bulwark",
      "phaseRunner",
      "warDrummer",
      "siegeColossus",
      "hardenedDummy",
      "swiftRusher",
      "aegisRunner",
      "regenerator",
      "signalCaptain",
      "siphonWarden",
      "phaseBrute",
      "blinkStalker",
      "aegisBehemoth",
      "overseer",
    ] as const;
    expect(newHardEnemies.every((kind) => getEnemyDefinition(kind).kind === kind)).toBe(true);

    const bossWaves = HARD_MODE.waves.filter((wave) =>
      wave.groups?.some((group) => getEnemyDefinition(group.kind).boss === true),
    );
    expect(bossWaves.length).toBeGreaterThanOrEqual(7);
    expect(bossWaves.map((wave) => HARD_MODE.waves.indexOf(wave) + 1)).toEqual(expect.arrayContaining([6, 10, 14, 20, 25, 30]));

    const newEnemyKinds = new Set(
      HARD_MODE.waves.flatMap((wave) => wave.groups?.map((group) => group.kind) ?? []),
    );
    expect(newHardEnemies.every((kind) => newEnemyKinds.has(kind))).toBe(true);
  });

  it("stages hard-mode mechanics behind a funded opening", () => {
    const opening = HARD_MODE.waves.slice(0, 10);
    expect(opening.map((wave) => wave.referenceHealth)).toEqual([20, 40, 80, 192, 270, 194, 180, 277, 504, 566]);
    expect(opening.map((wave) => wave.cashReward)).toEqual([180, 195, 210, 225, 240, 260, 275, 290, 315, 340]);
    expect(HARD_MODE.waves.map((wave) => wave.cashReward)).toEqual([
      180, 195, 210, 225, 240, 260, 275, 290, 315, 340,
      360, 370, 380, 390, 400, 410, 420, 430, 440, 450,
      460, 470, 480, 490, 500, 510, 520, 530, 540, 550,
    ]);

    const earlyKinds = new Set(opening.slice(0, 6).flatMap((wave) => wave.groups!.map((group) => group.kind)));
    expect(earlyKinds).not.toContain("platedDummy");
    expect(earlyKinds).not.toContain("bulwark");
    expect(earlyKinds).not.toContain("aegisRunner");
    expect(HARD_MODE.waves[6]?.groups?.some((group) => group.kind === "tough")).toBe(true);
    expect(opening.slice(0, 9).flatMap((wave) => wave.groups!.map((group) => group.kind))).not.toContain("platedDummy");
    expect(HARD_MODE.waves[9]?.groups?.some((group) => group.kind === "platedDummy")).toBe(true);
    expect(HARD_MODE.waves[8]?.groups?.some((group) => group.kind === "bulwark")).toBe(true);
  });
});
