export type CropShape = "circle" | "square" | "polygon";

export const MIN_POLYGON_SIDES = 3;
export const MAX_POLYGON_SIDES = 12;
export const DEFAULT_TARGET_SPRITE_SIZE = 128;
export const DEFAULT_TARGET_SPRITE_RADIUS = 60;

export const clampSides = (sides: number): number =>
  Math.max(MIN_POLYGON_SIDES, Math.min(MAX_POLYGON_SIDES, Math.round(sides || 5)));

export const createCropPath = (
  context: CanvasPath,
  shape: CropShape,
  sides: number,
  centerX: number,
  centerY: number,
  radius: number,
): void => {
  if (shape === "circle") {
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    return;
  }

  if (shape === "square") {
    context.rect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    return;
  }

  const effectiveSides = clampSides(sides);
  for (let i = 0; i < effectiveSides; i += 1) {
    const angle = -Math.PI / 2 + (i / effectiveSides) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();
};

export const calculateFitZoom = (
  imageWidth: number,
  imageHeight: number,
  cropRadius: number,
  mode: "cover" | "contain" = "cover",
): number => {
  if (imageWidth <= 0 || imageHeight <= 0 || cropRadius <= 0) return 1;
  const targetDiameter = cropRadius * 2;
  const scaleX = targetDiameter / imageWidth;
  const scaleY = targetDiameter / imageHeight;
  return mode === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
};

export interface OutputTransformParams {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly cropRadius: number;
  readonly targetSize?: number;
  readonly targetRadius?: number;
}

export interface OutputRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const calculateOutputTransform = (params: OutputTransformParams): OutputRect => {
  const targetSize = params.targetSize ?? DEFAULT_TARGET_SPRITE_SIZE;
  const targetRadius = params.targetRadius ?? DEFAULT_TARGET_SPRITE_RADIUS;
  const targetCenter = targetSize / 2;
  const ratio = params.cropRadius > 0 ? targetRadius / params.cropRadius : 1;

  const width = params.imageWidth * params.zoom * ratio;
  const height = params.imageHeight * params.zoom * ratio;
  const x = targetCenter + params.panX * ratio - width / 2;
  const y = targetCenter + params.panY * ratio - height / 2;

  return { x, y, width, height };
};
