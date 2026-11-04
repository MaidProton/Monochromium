import { describe, expect, it } from "vitest";
import { dismissBossHudEntry, visibleBossHudEntries } from "./bossHud.ts";

describe("boss HUD visibility", () => {
  const bosses = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

  it("keeps the visible list capped while skipping dismissed bosses", () => {
    expect(visibleBossHudEntries(bosses, new Set([2]))).toEqual([{ id: 1 }, { id: 3 }, { id: 4 }]);
    expect(visibleBossHudEntries(bosses, new Set(), 2)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("adds only the selected boss to the dismissed set", () => {
    const dismissed = dismissBossHudEntry(new Set([7]), 2);
    expect([...dismissed]).toEqual([7, 2]);
    expect(dismissBossHudEntry(dismissed, 2)).toEqual(dismissed);
  });

  it("dismisses one instance without hiding identical boss classes", () => {
    const identicalBosses = [
      { id: 11, kind: "slowBoss" },
      { id: 12, kind: "slowBoss" },
      { id: 13, kind: "slowBoss" },
    ];
    const dismissed = dismissBossHudEntry(new Set(), identicalBosses[1]!.id);

    expect(visibleBossHudEntries(identicalBosses, dismissed)).toEqual([
      identicalBosses[0],
      identicalBosses[2],
    ]);
  });
});
