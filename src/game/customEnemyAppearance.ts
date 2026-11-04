import type { EnemyAppearanceMode } from "./types.ts";

export const CUSTOM_ENEMY_DRAWING_SIZE = 128;
export const CUSTOM_ENEMY_DRAWING_SIZES = [128, 256] as const;
export type CustomEnemyDrawingSize = (typeof CUSTOM_ENEMY_DRAWING_SIZES)[number];
export const CUSTOM_ENEMY_DRAWING_MAX_DATA_URL_LENGTH = 768_000;
export const CUSTOM_ENEMY_DRAWING_PREFIX = "data:image/png;base64,";

export interface CustomEnemyAppearance {
  readonly mode: EnemyAppearanceMode;
  readonly pngDataUrl: string | null;
}

export const DEFAULT_CUSTOM_ENEMY_APPEARANCE: CustomEnemyAppearance = {
  mode: "procedural",
  pngDataUrl: null,
};

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export const isValidCustomEnemyDrawing = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.startsWith(CUSTOM_ENEMY_DRAWING_PREFIX)) return false;
  if (value.length > CUSTOM_ENEMY_DRAWING_MAX_DATA_URL_LENGTH) return false;
  const encoded = value.slice(CUSTOM_ENEMY_DRAWING_PREFIX.length);
  if (encoded.length === 0 || !/^[a-z\d+/]+={0,2}$/i.test(encoded)) return false;
  try {
    const decoded = atob(encoded);
    return pngSignature.every((byte, index) => decoded.charCodeAt(index) === byte);
  } catch {
    return false;
  }
};

export const sanitizeCustomEnemyAppearance = (value: unknown): CustomEnemyAppearance => {
  if (!value || typeof value !== "object") return { ...DEFAULT_CUSTOM_ENEMY_APPEARANCE };
  const source = value as { mode?: unknown; pngDataUrl?: unknown };
  const pngDataUrl = isValidCustomEnemyDrawing(source.pngDataUrl) ? source.pngDataUrl : null;
  const mode: EnemyAppearanceMode = source.mode === "drawing" && pngDataUrl !== null ? "drawing" : "procedural";
  return { mode, pngDataUrl };
};

