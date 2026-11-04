import { describe, expect, it } from "vitest";
import {
  balanceFieldLabel,
  balanceFieldStep,
  balanceValueAtPath,
  cloneTowerDefinition,
  formatDebugDuration,
  renderBalanceFieldsHtml,
  setBalanceValueAtPath,
} from "./debugPanel.ts";
import { TOWER_DEFINITIONS } from "../../game/config.ts";

describe("debugPanel", () => {
  it("formats debug duration nicely", () => {
    expect(formatDebugDuration(-1)).toBe("—");
    expect(formatDebugDuration(NaN)).toBe("—");
    expect(formatDebugDuration(0)).toBe("00:00");
    expect(formatDebugDuration(65)).toBe("01:05");
    expect(formatDebugDuration(3600)).toBe("60:00");
  });

  it("clones tower definitions cleanly", () => {
    const banditClone = cloneTowerDefinition("bandit");
    expect(banditClone.name).toBe("Bandit");
    expect(banditClone).not.toBe(TOWER_DEFINITIONS.bandit);
  });

  it("reads and writes balance value at path", () => {
    const bandit = cloneTowerDefinition("bandit");
    expect(balanceValueAtPath(bandit, "cost")).toBe(bandit.cost);
    expect(balanceValueAtPath(bandit, "onPath.hp")).toBe(bandit.onPath.hp);
    expect(balanceValueAtPath(bandit, "levels.0.damage")).toBe(bandit.levels[0]!.damage);

    setBalanceValueAtPath(bandit, "cost", 999);
    expect(bandit.cost).toBe(999);
    setBalanceValueAtPath(bandit, "levels.0.damage", 50);
    expect(bandit.levels[0]!.damage).toBe(50);
  });

  it("formats balance field labels and steps", () => {
    expect(balanceFieldLabel("cost")).toBe("COST");
    expect(balanceFieldLabel("onPath.hp")).toBe("PATH // HP");
    expect(balanceFieldLabel("levels.0.fireRate")).toBe("LEVEL 1 // FIRE RATE");

    expect(balanceFieldStep("levels.0.fireRate")).toBe("0.01");
    expect(balanceFieldStep("cost")).toBe("1");
  });

  it("renders balance fields HTML for a tower", () => {
    const bandit = cloneTowerDefinition("bandit");
    const html = renderBalanceFieldsHtml(bandit);
    expect(html).toContain('data-balance-path="cost"');
    expect(html).toContain('data-balance-path="onPath.hp"');
  });
});
