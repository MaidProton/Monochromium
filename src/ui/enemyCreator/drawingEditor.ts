import { clamp } from "../../game/math.ts";
import type { Point } from "../../game/types.ts";

export const DRAWING_ZOOM_LEVELS = [1, 2, 3, 4] as const;

export function colorRgba(color: string, alpha: number): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color : "#d46cff";
  const channels = [1, 3, 5].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
  return `rgba(${channels.join(",")},${clamp(alpha, 0, 1)})`;
}

export function drawingCursorSvg(diameter: number, color: string, eraser: boolean, pixel: boolean): string {
  const strokePadding = 2;
  const targetDiameter = Math.max(1, Math.round(diameter));
  const clampedDiameter = Math.max(2, Math.min(128 - strokePadding * 2, targetDiameter));
  const size = clampedDiameter + strokePadding * 2;
  const half = size / 2;
  const radius = clampedDiameter / 2;
  const stroke = eraser ? "#ff8c86" : color;
  const fill = eraser ? "none" : `${color}24`;
  const ring = pixel
    ? `<rect x="${strokePadding}" y="${strokePadding}" width="${clampedDiameter}" height="${clampedDiameter}" fill="${fill}" stroke="#050708" stroke-width="2"/><rect x="${strokePadding}" y="${strokePadding}" width="${clampedDiameter}" height="${clampedDiameter}" fill="none" stroke="${stroke}" stroke-width="1"/>`
    : `<circle cx="${half}" cy="${half}" r="${radius}" fill="${fill}" stroke="#050708" stroke-width="2"/><circle cx="${half}" cy="${half}" r="${radius}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${ring}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(half)} ${Math.round(half)}, crosshair`;
}

export function drawPreviewPolygon(context: CanvasRenderingContext2D, sides: number, radius = 48, center = 64): void {
  context.beginPath();
  for (let side = 0; side < sides; side += 1) {
    const angle = -Math.PI / 2 + (side / sides) * Math.PI * 2;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (side === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

export function createSoftBrushStamp(
  size: number,
  hardness: number,
  color: string,
  cache?: Map<string, HTMLCanvasElement>,
): HTMLCanvasElement {
  const key = `${Math.round(size * 100)}:${Math.round(hardness * 100)}:${color}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const padding = 2;
  const diameter = Math.max(1, Math.ceil(size));
  const canvas = document.createElement("canvas");
  canvas.width = diameter + padding * 2;
  canvas.height = diameter + padding * 2;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const radius = diameter / 2;
  const center = radius + padding;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (hardness >= 0.999) {
    context.fillStyle = colorRgba(color, 1);
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fill();
  } else {
    const gradient = context.createRadialGradient(center, center, Math.max(0, radius * hardness), center, center, radius);
    gradient.addColorStop(0, colorRgba(color, 1));
    if (hardness > 0) gradient.addColorStop(Math.min(0.999, hardness), colorRgba(color, 1));
    gradient.addColorStop(1, colorRgba(color, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  cache?.set(key, canvas);
  return canvas;
}

export function paintSmoothDrawingStroke(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
  hardness: number,
  color: string,
  cache?: Map<string, HTMLCanvasElement>,
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / Math.max(1, size * 0.22)));
  const stamp = createSoftBrushStamp(size, hardness, color, cache);
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    context.drawImage(stamp, x - stamp.width / 2, y - stamp.height / 2);
  }
}

export function paintPixelDrawingStroke(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
  color: string,
): void {
  const pixelSize = Math.max(1, Math.round(size));
  const half = pixelSize / 2;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / Math.max(1, pixelSize / 2)));
  context.fillStyle = colorRgba(color, 1);
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const x = Math.round(from.x + (to.x - from.x) * progress - half);
    const y = Math.round(from.y + (to.y - from.y) * progress - half);
    context.fillRect(x, y, pixelSize, pixelSize);
  }
}

export function floodFillImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startPoint: Point,
  fillRgba: [number, number, number, number],
  tolerance = 8,
): boolean {
  const x = clamp(Math.floor(startPoint.x), 0, width - 1);
  const y = clamp(Math.floor(startPoint.y), 0, height - 1);
  const startIndex = (y * width + x) * 4;
  const target = [data[startIndex]!, data[startIndex + 1]!, data[startIndex + 2]!, data[startIndex + 3]!];

  const matches = (index: number): boolean =>
    Math.abs(data[index]! - target[0]!) <= tolerance &&
    Math.abs(data[index + 1]! - target[1]!) <= tolerance &&
    Math.abs(data[index + 2]! - target[2]!) <= tolerance &&
    Math.abs(data[index + 3]! - target[3]!) <= tolerance;

  if (fillRgba.every((value, index) => value === target[index])) return false;

  const visited = new Uint8Array(width * height);
  const stack: Point[] = [{ x, y }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const curX = Math.floor(current.x);
    const curY = Math.floor(current.y);
    if (curX < 0 || curX >= width || curY < 0 || curY >= height) continue;
    const pixel = curY * width + curX;
    if (visited[pixel] === 1) continue;
    visited[pixel] = 1;
    const index = pixel * 4;
    if (!matches(index)) continue;
    data[index] = fillRgba[0]!;
    data[index + 1] = fillRgba[1]!;
    data[index + 2] = fillRgba[2]!;
    data[index + 3] = fillRgba[3]!;
    stack.push(
      { x: curX - 1, y: curY },
      { x: curX + 1, y: curY },
      { x: curX, y: curY - 1 },
      { x: curX, y: curY + 1 },
    );
  }
  return true;
}

export function findClosestDrawingZoom(nextZoom: number, levels: readonly number[] = DRAWING_ZOOM_LEVELS): number {
  return levels.reduce((best, value) => (Math.abs(value - nextZoom) < Math.abs(best - nextZoom) ? value : best), levels[0] ?? 1);
}

export class DrawingHistoryStack<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth = 32) {
    this.maxDepth = maxDepth;
  }

  get length(): number {
    return this.undoStack.length;
  }

  get redoLength(): number {
    return this.redoStack.length;
  }

  push(state: T): void {
    this.undoStack.push(state);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(currentState: T): T | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(currentState);
    return this.undoStack.pop() ?? null;
  }

  redo(currentState: T): T | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(currentState);
    return this.redoStack.pop() ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
