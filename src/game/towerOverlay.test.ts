import { describe, expect, it } from "vitest";
import { layoutTowerOverlays } from "./towerOverlay.ts";

const item = (key: string, priority: number, side: "above" | "below" = "below", height = 10) => ({
  key,
  priority,
  side,
  height,
  render: () => undefined,
});

describe("tower overlay layout", () => {
  it("sorts each side by priority and reorders when an item appears", () => {
    const withoutHighPriority = layoutTowerOverlays([
      item("low", 10),
      item("medium", 20),
    ], 100);
    expect(withoutHighPriority.filter(({ item: overlay }) => overlay.side === "below").map(({ item: overlay }) => overlay.key))
      .toEqual(["medium", "low"]);

    const withHighPriority = layoutTowerOverlays([
      item("low", 10),
      item("medium", 20),
      item("high", 30),
    ], 100);
    expect(withHighPriority.filter(({ item: overlay }) => overlay.side === "below").map(({ item: overlay }) => overlay.key))
      .toEqual(["high", "medium", "low"]);
  });

  it("keeps every item separated from the tower and its neighbors", () => {
    const placements = layoutTowerOverlays([
      item("above-a", 20, "above", 12),
      item("above-b", 10, "above", 18),
      item("below-a", 30, "below", 7),
      item("below-b", 10, "below", 20),
    ], 100);
    const above = placements.filter(({ item: overlay }) => overlay.side === "above");
    const below = placements.filter(({ item: overlay }) => overlay.side === "below");

    expect(above[0]!.bottom).toBeLessThan(100);
    expect(above[0]!.top - above[1]!.bottom).toBeGreaterThanOrEqual(4);
    expect(below[0]!.top).toBeGreaterThan(100);
    expect(below[1]!.top - below[0]!.bottom).toBeGreaterThanOrEqual(4);
  });
});
