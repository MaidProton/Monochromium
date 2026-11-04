import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProgress, sanitizeProgress, togglePerkLoadout, toggleTowerLoadout, unlockPerk, unlockTower } from "./meta.ts";
import { installTestStorage, uninstallTestStorage } from "./testStorage.ts";

describe("profile persistence", () => {
  beforeEach(() => installTestStorage());
  afterEach(() => uninstallTestStorage());

  it("sanitizes invalid profile values and keeps the starter tower", () => {
    expect(sanitizeProgress({
      coins: -4.5,
      tokens: "bad",
      unlockedTowers: ["prism", "prism", "unknown"],
      loadout: ["prism", "unknown", "bandit"],
      clearedMaps: ["sector07", "missing", "custom-map:local"],
      runs: 2.9,
      victories: Number.NaN,
    })).toEqual({
      version: 1,
      coins: 0,
      tokens: 0,
      unlockedTowers: ["bandit", "prism"],
      loadout: ["prism", "bandit"],
      unlockedPerks: [],
      perkLoadout: [],
      clearedMaps: ["sector07", "custom-map:local"],
      runs: 2,
      victories: 0,
    });
  });

  it("unlocks towers, persists the profile, and enforces loadout capacity", () => {
    const progress = sanitizeProgress({ coins: 1_000, unlockedTowers: ["bandit"], loadout: ["bandit"] });
    expect(unlockTower(progress, "latch")).toBe(true);
    expect(progress.coins).toBe(650);
    expect(progress.loadout).toEqual(["bandit", "latch"]);
    expect(JSON.parse(localStorage.getItem("monochromium.meta.v1") ?? "null")).toMatchObject({ coins: 650, loadout: ["bandit", "latch"] });

    const full = sanitizeProgress({
      unlockedTowers: ["bandit", "samurai", "tempest", "cyborg", "mercenary", "infernus"],
      loadout: ["bandit", "samurai", "tempest", "cyborg", "mercenary"],
    });
    expect(toggleTowerLoadout(full, "infernus")).toBe("full");
    expect(toggleTowerLoadout(full, "mercenary")).toBe("unequipped");
    expect(toggleTowerLoadout(full, "infernus")).toBe("equipped");
  });

  it("permanently buys perks, auto-equips them, and enforces three slots without duplicates", () => {
    const progress = sanitizeProgress({ coins: 2_000, unlockedPerks: ["backdraft", "backdraft", "unknown"], perkLoadout: ["backdraft", "unknown"] });
    expect(progress.unlockedPerks).toEqual(["backdraft"]);
    expect(progress.perkLoadout).toEqual(["backdraft"]);
    expect(unlockPerk(progress, "high-noon")).toBe(true);
    expect(progress.coins).toBe(1_500);
    expect(progress.perkLoadout).toEqual(["backdraft", "high-noon"]);
    expect(unlockPerk(progress, "high-noon")).toBe(false);
    progress.unlockedPerks = ["backdraft", "high-noon", "glass-cannon"];
    progress.perkLoadout = ["backdraft", "high-noon", "glass-cannon"];
    expect(togglePerkLoadout(progress, "backdraft")).toBe("unequipped");
    expect(togglePerkLoadout(progress, "backdraft")).toBe("equipped");
    expect(togglePerkLoadout(progress, "glass-cannon")).toBe("unequipped");
    expect(togglePerkLoadout(progress, "glass-cannon")).toBe("equipped");
    expect(progress.perkLoadout).toEqual(["high-noon", "backdraft", "glass-cannon"]);
  });

  it("falls back safely when the stored profile is malformed", () => {
    localStorage.setItem("monochromium.meta.v1", "not-json");
    expect(loadProgress()).toEqual({
      version: 1,
      coins: 0,
      tokens: 0,
      unlockedTowers: ["bandit"],
      loadout: ["bandit"],
      unlockedPerks: [],
      perkLoadout: [],
      clearedMaps: [],
      runs: 0,
      victories: 0,
    });
  });
});
