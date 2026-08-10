import type { Point } from "./types.ts";

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

export interface PathSample {
  readonly point: Point;
  readonly distance: number;
  readonly direction: Point;
}

export interface ClosestPathPoint extends PathSample {
  readonly offset: number;
}

export class Polyline {
  readonly totalLength: number;
  private readonly segments: ReadonlyArray<{
    a: Point;
    b: Point;
    start: number;
    length: number;
    direction: Point;
  }>;

  constructor(points: readonly Point[]) {
    let cursor = 0;
    this.segments = points.slice(0, -1).map((a, index) => {
      const b = points[index + 1];
      if (!b) throw new Error("Invalid path segment");
      const length = distance(a, b);
      const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      const segment = { a, b, start: cursor, length, direction };
      cursor += length;
      return segment;
    });
    this.totalLength = cursor;
  }

  sample(pathDistance: number): PathSample {
    const resolved = clamp(pathDistance, 0, this.totalLength);
    const segment =
      this.segments.find((candidate) => resolved <= candidate.start + candidate.length) ??
      this.segments[this.segments.length - 1];
    if (!segment) throw new Error("Cannot sample an empty path");
    const local = clamp((resolved - segment.start) / segment.length, 0, 1);
    return {
      point: {
        x: lerp(segment.a.x, segment.b.x, local),
        y: lerp(segment.a.y, segment.b.y, local),
      },
      distance: resolved,
      direction: segment.direction,
    };
  }

  closest(point: Point): ClosestPathPoint {
    let best: ClosestPathPoint | null = null;
    for (const segment of this.segments) {
      const dx = segment.b.x - segment.a.x;
      const dy = segment.b.y - segment.a.y;
      const lengthSquared = dx * dx + dy * dy;
      const amount = clamp(
        ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared,
        0,
        1,
      );
      const projected = { x: segment.a.x + dx * amount, y: segment.a.y + dy * amount };
      const offset = distance(point, projected);
      if (!best || offset < best.offset) {
        best = {
          point: projected,
          offset,
          distance: segment.start + segment.length * amount,
          direction: segment.direction,
        };
      }
    }
    if (!best) throw new Error("Cannot project onto an empty path");
    return best;
  }
}
