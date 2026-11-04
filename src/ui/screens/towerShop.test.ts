import { describe, expect, it, vi } from "vitest";
import {
  handleShopAction,
  renderLoadoutSlotsHtml,
  renderPerkLoadoutSlotsHtml,
  renderTowerShopHtml,
  updateShopAndLoadoutUi,
} from "./towerShop.ts";
import type { MetaProgress } from "../../game/meta.ts";

describe("towerShop", () => {
  it("renders tower shop HTML containing loadout panels and cards", () => {
    const html = renderTowerShopHtml();
    expect(html).toContain('id="tower-shop"');
    expect(html).toContain('data-action="buy-tower"');
    expect(html).toContain('data-action="buy-perk"');
    expect(html).toContain("ARMORY");
  });

  it("renders correct slot counts for loadout and perks", () => {
    const loadoutHtml = renderLoadoutSlotsHtml(["bandit", "gunner"]);
    expect(loadoutHtml.match(/loadout-slot filled/g)).toHaveLength(2);
    expect(loadoutHtml.match(/loadout-slot empty/g)).toHaveLength(3);

    const perkHtml = renderPerkLoadoutSlotsHtml(["backdraft"]);
    expect(perkHtml.match(/loadout-slot filled/g)).toHaveLength(1);
    expect(perkHtml.match(/loadout-slot empty/g)).toHaveLength(2);
  });

  it("updates DOM elements using updateShopAndLoadoutUi", () => {
    const loadoutCountEl = { textContent: "" };
    const perkCountEl = { textContent: "" };
    const elements: Record<string, unknown> = {
      "#loadout-count": loadoutCountEl,
      "#perk-loadout-count": perkCountEl,
    };
    const mockRoot = {
      querySelector: (selector: string) => (elements[selector] ?? null) as Element | null,
    } as unknown as ParentNode;

    const progress: MetaProgress = {
      version: 1,
      coins: 1000,
      tokens: 5,
      runs: 1,
      victories: 0,
      clearedMaps: [],
      unlockedTowers: ["bandit", "gunner"],
      loadout: ["bandit", "gunner"],
      unlockedPerks: ["backdraft"],
      perkLoadout: ["backdraft"],
    };
    updateShopAndLoadoutUi(mockRoot, progress);
    expect(loadoutCountEl.textContent).toBe("2 / 5");
    expect(perkCountEl.textContent).toBe("1 / 3");
  });

  it("delegates shop actions correctly", () => {
    const progress: MetaProgress = {
      version: 1,
      coins: 50000,
      tokens: 10,
      runs: 0,
      victories: 0,
      clearedMaps: [],
      unlockedTowers: ["bandit"],
      loadout: ["bandit"],
      unlockedPerks: [],
      perkLoadout: [],
    };
    const ctx = {
      progress,
      onLoadoutChange: vi.fn(),
      onLog: vi.fn(),
      onAudioConfirm: vi.fn(),
      onAudioError: vi.fn(),
      renderMeta: vi.fn(),
    };

    expect(handleShopAction("buy-tower", "gunner", ctx)).toBe(true);
    expect(ctx.onLoadoutChange).toHaveBeenCalled();
    expect(ctx.onAudioConfirm).toHaveBeenCalled();
    expect(progress.unlockedTowers).toContain("gunner");

    expect(handleShopAction("unknown-action", undefined, ctx)).toBe(false);
  });
});
