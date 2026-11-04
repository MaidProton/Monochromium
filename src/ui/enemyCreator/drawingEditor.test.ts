import { describe, expect, it } from "vitest";
import {
  colorRgba,
  DrawingHistoryStack,
  drawingCursorSvg,
  findClosestDrawingZoom,
  floodFillImageData,
} from "./drawingEditor.ts";

describe("drawingEditor", () => {
  describe("colorRgba", () => {
    it("converts hex color and alpha to rgba string", () => {
      expect(colorRgba("#ff0000", 1)).toBe("rgba(255,0,0,1)");
      expect(colorRgba("#00ff00", 0.5)).toBe("rgba(0,255,0,0.5)");
      expect(colorRgba("invalid", 1)).toBe("rgba(212,108,255,1)"); // fallback #d46cff
    });

    it("clamps alpha between 0 and 1", () => {
      expect(colorRgba("#ffffff", 1.5)).toBe("rgba(255,255,255,1)");
      expect(colorRgba("#ffffff", -0.5)).toBe("rgba(255,255,255,0)");
    });
  });

  describe("drawingCursorSvg", () => {
    it("generates a data URI SVG with appropriate cursor hotspot", () => {
      const cursor = drawingCursorSvg(16, "#ff0000", false, false);
      expect(cursor).toContain("data:image/svg+xml");
      expect(cursor).toContain("circle");
      expect(cursor).toContain("crosshair");

      const pixelCursor = drawingCursorSvg(16, "#ff0000", false, true);
      expect(pixelCursor).toContain("rect");

      const eraserCursor = drawingCursorSvg(16, "#ff0000", true, false);
      expect(eraserCursor).toContain("%23ff8c86");
    });
  });

  describe("findClosestDrawingZoom", () => {
    it("finds the nearest zoom factor from allowed levels", () => {
      expect(findClosestDrawingZoom(0.8)).toBe(1);
      expect(findClosestDrawingZoom(1.4)).toBe(1);
      expect(findClosestDrawingZoom(1.8)).toBe(2);
      expect(findClosestDrawingZoom(3.2)).toBe(3);
      expect(findClosestDrawingZoom(5.0)).toBe(4);
    });
  });

  describe("floodFillImageData", () => {
    it("fills connected matching pixels with replacement color", () => {
      const width = 4;
      const height = 4;
      const data = new Uint8ClampedArray(width * height * 4); // all zeros initially (0,0,0,0)

      const changed = floodFillImageData(data, width, height, { x: 0, y: 0 }, [255, 0, 0, 255]);
      expect(changed).toBe(true);

      // Check pixel (0,0)
      expect(data[0]).toBe(255);
      expect(data[1]).toBe(0);
      expect(data[2]).toBe(0);
      expect(data[3]).toBe(255);

      // Check pixel (3,3)
      const lastIndex = (3 * width + 3) * 4;
      expect(data[lastIndex]).toBe(255);
      expect(data[lastIndex + 1]).toBe(0);
      expect(data[lastIndex + 2]).toBe(0);
      expect(data[lastIndex + 3]).toBe(255);
    });

    it("respects color boundaries", () => {
      const width = 4;
      const height = 4;
      const data = new Uint8ClampedArray(width * height * 4);

      // Put a barrier at x = 2
      for (let y = 0; y < height; y += 1) {
        const idx = (y * width + 2) * 4;
        data[idx] = 100;
        data[idx + 1] = 100;
        data[idx + 2] = 100;
        data[idx + 3] = 255;
      }

      const changed = floodFillImageData(data, width, height, { x: 0, y: 0 }, [255, 0, 0, 255]);
      expect(changed).toBe(true);

      // x=0, y=0 was filled
      expect(data[0]).toBe(255);
      // barrier was not overwritten
      const barrierIdx = (0 * width + 2) * 4;
      expect(data[barrierIdx]).toBe(100);
      // x=3, y=0 on other side of barrier was not reached
      const otherSideIdx = (0 * width + 3) * 4;
      expect(data[otherSideIdx]).toBe(0);
    });

    it("returns false if fill color is identical to target", () => {
      const width = 2;
      const height = 2;
      const data = new Uint8ClampedArray(width * height * 4);
      const changed = floodFillImageData(data, width, height, { x: 0, y: 0 }, [0, 0, 0, 0]);
      expect(changed).toBe(false);
    });
  });

  describe("DrawingHistoryStack", () => {
    it("pushes, undos, and redos states up to maxDepth", () => {
      const history = new DrawingHistoryStack<string>(3);
      history.push("state1");
      history.push("state2");
      history.push("state3");
      expect(history.length).toBe(3);

      // Pushing beyond maxDepth drops oldest
      history.push("state4");
      expect(history.length).toBe(3);

      expect(history.canUndo()).toBe(true);
      const restored = history.undo("stateCurrent");
      expect(restored).toBe("state4");
      expect(history.canRedo()).toBe(true);

      const redone = history.redo("state4Restored");
      expect(redone).toBe("stateCurrent");
    });
  });
});
