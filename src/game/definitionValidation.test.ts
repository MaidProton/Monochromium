import { describe, expect, it } from "vitest";
import { ENEMY_DEFINITIONS, TOWER_DEFINITIONS } from "./config.ts";
import { validateGameDefinitions } from "./definitionValidation.ts";
import type { EnemyKind } from "./types.ts";

describe("game definition validation", () => {
  it("accepts the shipped roster and content", () => {
    expect(validateGameDefinitions()).toEqual({ valid: true, errors: [] });
  });

  it("reports incomplete tower upgrade curves", () => {
    const invalidBandit = { ...TOWER_DEFINITIONS.bandit, upgrades: [] };
    const result = validateGameDefinitions({
      towers: { ...TOWER_DEFINITIONS, bandit: invalidBandit },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("towers.bandit.upgrades must contain one entry per level after level 0.");
  });

  it("reports modes that reference unknown enemies", () => {
    const result = validateGameDefinitions({
      enemies: { ...ENEMY_DEFINITIONS },
      modes: [{
        kind: "custom:invalid",
        name: "Invalid",
        index: 1,
        isCustom: true,
        description: "Invalid fixture",
        startingCash: 1,
        coreIntegrity: 1,
        multiplayerHitCashMultiplier: 1,
        reward: { coins: 0, tokens: 0 },
        waves: [{
          groups: [{ kind: "missing-enemy" as EnemyKind, count: 1, gap: 0 }],
          referenceHealth: 1,
          waveTimeSeconds: 1,
        }],
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("groups[0] is invalid"))).toBe(true);
  });
});
