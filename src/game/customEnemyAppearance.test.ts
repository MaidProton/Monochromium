import { describe, expect, it } from "vitest";
import {
  CUSTOM_ENEMY_DRAWING_MAX_DATA_URL_LENGTH,
  DEFAULT_CUSTOM_ENEMY_APPEARANCE,
  isValidCustomEnemyDrawing,
  sanitizeCustomEnemyAppearance,
} from "./customEnemyAppearance.ts";
import { createCustomEnemy, customEnemyToDefinition, sanitizeCustomEnemies } from "./customEnemies.ts";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("custom enemy appearance", () => {
  it("creates and migrates drafts with procedural version 4 defaults", () => {
    const created = createCustomEnemy();
    expect(created.version).toBe(4);
    expect(created.opacity).toBe(1);
    expect(created.appearance).toEqual(DEFAULT_CUSTOM_ENEMY_APPEARANCE);

    const legacy = { ...created } as Record<string, unknown>;
    delete legacy["opacity"];
    delete legacy["appearance"];
    const migrated = sanitizeCustomEnemies([legacy])[0]!;
    expect(migrated.version).toBe(4);
    expect(migrated.opacity).toBe(1);
    expect(migrated.appearance).toEqual(DEFAULT_CUSTOM_ENEMY_APPEARANCE);
  });

  it("accepts valid drawings, clamps opacity, and maps them to definitions", () => {
    expect(isValidCustomEnemyDrawing(VALID_PNG)).toBe(true);
    const draft = sanitizeCustomEnemies([{
      ...createCustomEnemy(),
      opacity: 2,
      appearance: { mode: "drawing", pngDataUrl: VALID_PNG },
    }])[0]!;
    expect(draft.opacity).toBe(1);
    expect(draft.appearance).toEqual({ mode: "drawing", pngDataUrl: VALID_PNG });
    expect(customEnemyToDefinition(draft).sprite).toEqual(expect.objectContaining({
      appearance: "drawing",
      drawing: VALID_PNG,
      opacity: 1,
    }));
  });

  it("falls back to procedural appearance for malformed or oversized drawings", () => {
    const oversized = `data:image/png;base64,${"A".repeat(CUSTOM_ENEMY_DRAWING_MAX_DATA_URL_LENGTH)}`;
    expect(isValidCustomEnemyDrawing("data:image/png;base64,not-a-png")).toBe(false);
    expect(isValidCustomEnemyDrawing(oversized)).toBe(false);
    expect(sanitizeCustomEnemyAppearance({ mode: "drawing", pngDataUrl: oversized })).toEqual(DEFAULT_CUSTOM_ENEMY_APPEARANCE);
    expect(sanitizeCustomEnemyAppearance({ mode: "drawing", pngDataUrl: "data:image/png;base64,not-a-png" })).toEqual(DEFAULT_CUSTOM_ENEMY_APPEARANCE);
  });
});
