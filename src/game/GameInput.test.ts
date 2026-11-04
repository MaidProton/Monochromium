import { describe, expect, it } from "vitest";
import {
  CAMERA_DRAG_THRESHOLD,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  calculateCameraZoom,
  calculateZoomPanOffset,
  clampCameraPan,
} from "./GameInput.ts";

describe("GameInput", () => {
  describe("calculateCameraZoom", () => {
    it("zooms in with negative deltaY and clamps at max", () => {
      const zoomed = calculateCameraZoom(1.0, -500);
      expect(zoomed).toBeGreaterThan(1.0);

      const maxClamped = calculateCameraZoom(2.4, -5000);
      expect(maxClamped).toBe(CAMERA_ZOOM_MAX);
    });

    it("zooms out with positive deltaY and clamps at min", () => {
      const zoomed = calculateCameraZoom(1.0, 500);
      expect(zoomed).toBeLessThan(1.0);

      const minClamped = calculateCameraZoom(0.8, 5000);
      expect(minClamped).toBe(CAMERA_ZOOM_MIN);
    });
  });

  describe("calculateZoomPanOffset", () => {
    it("calculates correct pan coordinates centered on cursor", () => {
      const offset = calculateZoomPanOffset(
        { x: 500, y: 300 }, // canvasPoint
        { x: 500, y: 300 }, // worldPoint
        1000,
        600,
        1000,
        600,
        1.0,
      );
      // When scale is 1, world is 1000x600, canvas is 1000x600:
      // (1000 - 1000*1)/2 = 0.
      // offset.x = 500 - 0 - 500 = 0.
      expect(offset.x).toBe(0);
      expect(offset.y).toBe(0);
    });
  });

  describe("clampCameraPan", () => {
    it("clamps pan to horizontal and vertical limits", () => {
      const mapBounds = { width: 960, height: 600 };
      const clamped = clampCameraPan(
        { x: 9999, y: -9999 },
        960,
        600,
        mapBounds,
        1.5,
      );
      expect(clamped.x).toBeLessThan(9999);
      expect(clamped.y).toBeGreaterThan(-9999);
    });

    it("keeps pan at 0 when canvas is larger than expanded world", () => {
      const mapBounds = { width: 400, height: 300 };
      const clamped = clampCameraPan(
        { x: 50, y: -50 },
        1200,
        900,
        mapBounds,
        1.0,
      );
      expect(clamped.x).toBe(0);
      expect(clamped.y).toBe(0);
    });
  });

  describe("constants", () => {
    it("exports standard camera thresholds", () => {
      expect(CAMERA_DRAG_THRESHOLD).toBe(6);
      expect(CAMERA_ZOOM_MIN).toBe(0.65);
      expect(CAMERA_ZOOM_MAX).toBe(2.5);
    });
  });
});
