import { describe, expect, it } from "vitest";
import { createCustomMap, MAP_PATH_SEGMENT_MIN, validateCustomMap } from "./customMaps.ts";

describe("custom map validation", () => {
  it("allows short grid-aligned bends while keeping segments non-zero", () => {
    const draft = createCustomMap();
    const route = draft.paths[0]!;
    route.path.splice(4, 0, { x: 780, y: 140 });

    expect(MAP_PATH_SEGMENT_MIN).toBe(20);
    expect(validateCustomMap(draft)).toMatchObject({ valid: true });
  });

  it("still rejects overlapping points that produce zero-length segments", () => {
    const draft = createCustomMap();
    const route = draft.paths[0]!;
    route.path[2] = { ...route.path[1]! };

    const validation = validateCustomMap(draft);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes("at least 20 units"))).toBe(true);
  });

  it("rejects paths with too few points or insufficient total length", () => {
    const draft = createCustomMap();
    draft.paths[0]!.path = [{ x: 100, y: 100 }];
    const tooFew = validateCustomMap(draft);
    expect(tooFew.valid).toBe(false);
    expect(tooFew.errors.some((err) => err.includes("requires 2 to 32 points"))).toBe(true);

    draft.paths[0]!.path = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
    const tooShort = validateCustomMap(draft);
    expect(tooShort.valid).toBe(false);
    expect(tooShort.errors.some((err) => err.includes("at least 1,500 units long"))).toBe(true);
  });

  it("rejects overlapping blocked zones and blocked zones outside bounds", () => {
    const draft = createCustomMap();
    draft.blockedZones = [
      { id: "zone-1", x: -50, y: 100, width: 100, height: 100 },
    ];
    const outOfBounds = validateCustomMap(draft);
    expect(outOfBounds.valid).toBe(false);
    expect(outOfBounds.errors.some((err) => err.includes("inside the battlefield"))).toBe(true);

    draft.blockedZones = [
      { id: "zone-1", x: 500, y: 200, width: 120, height: 120 },
      { id: "zone-2", x: 550, y: 220, width: 120, height: 120 },
    ];
    const overlapping = validateCustomMap(draft);
    expect(overlapping.valid).toBe(false);
    expect(overlapping.errors.some((err) => err.includes("overlap"))).toBe(true);
  });

  it("rejects path blockers with out-of-bounds start distance or length", () => {
    const draft = createCustomMap();
    draft.pathBlockers = [
      { id: "blocker-1", pathIndex: 0, startDistance: 99999, length: 100 },
    ];
    const invalidBlocker = validateCustomMap(draft);
    expect(invalidBlocker.valid).toBe(false);
    expect(invalidBlocker.errors.some((err) => err.includes("must fit on its path"))).toBe(true);
  });
});

