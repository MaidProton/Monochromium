import { describe, expect, it } from "vitest";
import {
  calculateFitZoom,
  calculateOutputTransform,
  clampSides,
  createCropPath,
  DEFAULT_TARGET_SPRITE_RADIUS,
  DEFAULT_TARGET_SPRITE_SIZE,
} from "./cropMath.ts";

describe("cropMath utility", () => {
  it("clamps polygon sides within the 3..12 range", () => {
    expect(clampSides(2)).toBe(3);
    expect(clampSides(3)).toBe(3);
    expect(clampSides(5)).toBe(5);
    expect(clampSides(12)).toBe(12);
    expect(clampSides(20)).toBe(12);
    expect(clampSides(Number.NaN)).toBe(5);
  });

  it("calculates cover and contain fit zoom factors", () => {
    // 200x100 image inside 100 radius (200 diameter) crop shape
    // scaleX = 200 / 200 = 1.0; scaleY = 200 / 100 = 2.0
    const coverZoom = calculateFitZoom(200, 100, 100, "cover");
    expect(coverZoom).toBe(2.0);

    const containZoom = calculateFitZoom(200, 100, 100, "contain");
    expect(containZoom).toBe(1.0);
  });

  it("calculates centered output transform without pan", () => {
    // 400x400 image, 0 pan, zoom 1.0, cropRadius 120, targetRadius 60 (ratio 0.5)
    // Target center is 64, 64. Output size is 200x200, so top-left is at 64 - 100 = -36
    const transform = calculateOutputTransform({
      imageWidth: 400,
      imageHeight: 400,
      panX: 0,
      panY: 0,
      zoom: 1.0,
      cropRadius: 120,
      targetSize: DEFAULT_TARGET_SPRITE_SIZE,
      targetRadius: DEFAULT_TARGET_SPRITE_RADIUS,
    });

    expect(transform.width).toBe(200);
    expect(transform.height).toBe(200);
    expect(transform.x).toBe(64 - 100);
    expect(transform.y).toBe(64 - 100);
  });

  it("applies pan offsets scaled by the target ratio", () => {
    const transform = calculateOutputTransform({
      imageWidth: 400,
      imageHeight: 400,
      panX: 20,
      panY: -10,
      zoom: 1.0,
      cropRadius: 120,
      targetSize: 128,
      targetRadius: 60, // ratio 0.5
    });

    expect(transform.x).toBe(64 + 10 - 100);
    expect(transform.y).toBe(64 - 5 - 100);
  });

  it("creates circle, square, and polygon paths on a canvas mock context", () => {
    const operations: string[] = [];
    const mockContext = {
      arc: (x: number, y: number, r: number) => operations.push(`arc(${x},${y},${r})`),
      rect: (x: number, y: number, w: number, h: number) => operations.push(`rect(${x},${y},${w},${h})`),
      moveTo: (x: number, y: number) => operations.push(`moveTo(${Math.round(x)},${Math.round(y)})`),
      lineTo: (x: number, y: number) => operations.push(`lineTo(${Math.round(x)},${Math.round(y)})`),
      closePath: () => operations.push("closePath()"),
    } as unknown as CanvasPath;

    createCropPath(mockContext, "circle", 5, 64, 64, 60);
    expect(operations).toContain("arc(64,64,60)");

    operations.length = 0;
    createCropPath(mockContext, "square", 5, 64, 64, 60);
    expect(operations).toContain("rect(4,4,120,120)");

    operations.length = 0;
    createCropPath(mockContext, "polygon", 3, 64, 64, 60);
    expect(operations[0]).toBe("moveTo(64,4)"); // top vertex: -PI/2
    expect(operations.filter((op) => op.startsWith("lineTo")).length).toBe(2);
    expect(operations).toContain("closePath()");
  });
});
