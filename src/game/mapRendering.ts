import { DEFAULT_MAP_SCALE, MAP_SCALE_MAX, MAP_SCALE_MIN, PATH_HALF_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from "./config.ts";
import { clamp, Polyline } from "./math.ts";
import type { BlockedZone, MapDefinition, MapPathDefinition, MapPathType, PathPlacementBlocker, Point } from "./types.ts";

export interface MapWorldBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const normalizedMapScale = (value: number): number =>
  clamp(value || DEFAULT_MAP_SCALE, MAP_SCALE_MIN, MAP_SCALE_MAX);

export const mapWorldBounds = (mapScale: number): MapWorldBounds => {
  const scale = normalizedMapScale(mapScale);
  return {
    x: (WORLD_WIDTH - WORLD_WIDTH * scale) / 2,
    y: (WORLD_HEIGHT - WORLD_HEIGHT * scale) / 2,
    width: WORLD_WIDTH * scale,
    height: WORLD_HEIGHT * scale,
  };
};

export const scaleMapPoint = (point: Point, mapScale: number): Point => {
  const scale = normalizedMapScale(mapScale);
  return {
    x: WORLD_WIDTH / 2 + (point.x - WORLD_WIDTH / 2) * scale,
    y: WORLD_HEIGHT / 2 + (point.y - WORLD_HEIGHT / 2) * scale,
  };
};

/** Applies the authored map size to geometry while leaving tower/enemy art at its base world size. */
export const scaleMapDefinition = (map: MapDefinition): MapDefinition => {
  const scale = normalizedMapScale(map.mapScale);
  if (scale === 1) return map;
  return {
    ...map,
    path: map.path.map((point) => scaleMapPoint(point, scale)),
    paths: map.paths.map((route) => ({
      ...route,
      path: route.path.map((point) => scaleMapPoint(point, scale)),
      width: route.width * scale,
      core: scaleMapPoint(route.core, scale),
      entryLabel: scaleMapPoint(route.entryLabel, scale),
      pathLabel: scaleMapPoint(route.pathLabel, scale),
    })),
    core: scaleMapPoint(map.core, scale),
    entryLabel: scaleMapPoint(map.entryLabel, scale),
    pathLabel: scaleMapPoint(map.pathLabel, scale),
    blockedZones: map.blockedZones.map((zone) => {
      const position = scaleMapPoint({ x: zone.x, y: zone.y }, scale);
      return {
        ...zone,
        x: position.x,
        y: position.y,
        width: zone.width * scale,
        height: zone.height * scale,
      };
    }),
    pathBlockers: map.pathBlockers.map((blocker) => ({
      ...blocker,
      startDistance: blocker.startDistance * scale,
      length: blocker.length * scale,
    })),
  };
};

export interface MapViewport {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * Paints the complete screen behind the fixed-size world. Narrow displays
 * need extra field above/below the route to keep every map object at the same
 * proportions while avoiding solid letterbox bars.
 */
export const drawMapBackdrop = (
  context: CanvasRenderingContext2D,
  map: MapDefinition,
  viewport: MapViewport,
  width: number,
  height: number,
): void => {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = map.palette.field;
  context.fillRect(0, 0, width, height);

  const centerX = viewport.x + 800 * viewport.scale;
  const centerY = viewport.y + 350 * viewport.scale;
  const glow = context.createRadialGradient(
    centerX,
    centerY,
    Math.max(20, viewport.scale * 20),
    centerX,
    centerY,
    Math.max(width, height) * 0.86,
  );
  glow.addColorStop(0, map.palette.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const worldLeft = -viewport.x / viewport.scale;
  const worldTop = -viewport.y / viewport.scale;
  const worldRight = (width - viewport.x) / viewport.scale;
  const worldBottom = (height - viewport.y) / viewport.scale;
  const firstColumn = Math.floor(worldLeft / 40) * 40;
  const firstRow = Math.floor(worldTop / 40) * 40;
  for (let x = firstColumn; x <= worldRight; x += 40) {
    context.strokeStyle = x % 200 === 0 ? "rgba(177,187,184,.08)" : "rgba(177,187,184,.035)";
    context.beginPath();
    context.moveTo(viewport.x + x * viewport.scale, 0);
    context.lineTo(viewport.x + x * viewport.scale, height);
    context.stroke();
  }
  for (let y = firstRow; y <= worldBottom; y += 40) {
    context.strokeStyle = y % 200 === 0 ? "rgba(177,187,184,.08)" : "rgba(177,187,184,.035)";
    context.beginPath();
    context.moveTo(0, viewport.y + y * viewport.scale);
    context.lineTo(width, viewport.y + y * viewport.scale);
    context.stroke();
  }
  context.restore();
};

export const createMapPathShapes = (map: MapDefinition): Path2D[] => map.paths.map((route) => {
  const shape = new Path2D();
  route.path.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  return shape;
});

export const drawMapField = (context: CanvasRenderingContext2D, map: MapDefinition): void => {
  const scale = normalizedMapScale(map.mapScale);
  context.save();
  context.translate(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  context.scale(scale, scale);
  context.translate(-WORLD_WIDTH / 2, -WORLD_HEIGHT / 2);
  context.fillStyle = map.palette.field;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  const glow = context.createRadialGradient(800, 350, 20, 800, 350, 850);
  glow.addColorStop(0, map.palette.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  context.lineWidth = 1;
  for (let x = 0; x <= WORLD_WIDTH; x += 40) {
    context.strokeStyle = x % 200 === 0 ? "rgba(177,187,184,.08)" : "rgba(177,187,184,.035)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, WORLD_HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += 40) {
    context.strokeStyle = y % 200 === 0 ? "rgba(177,187,184,.08)" : "rgba(177,187,184,.035)";
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WORLD_WIDTH, y);
    context.stroke();
  }
  context.fillStyle = "rgba(207, 218, 213, 0.035)";
  [
    [92, 76, 245, 66],
    [640, 65, 220, 54],
    [1120, 566, 280, 64],
    [310, 580, 205, 48],
  ].forEach(([x = 0, y = 0, width = 0, height = 0]) => context.fillRect(x, y, width, height));
  context.restore();
};

export const drawBlockedZone = (
  context: CanvasRenderingContext2D,
  zone: BlockedZone,
  accent: string,
  selected = false,
): void => {
  context.save();
  context.fillStyle = "rgba(3, 5, 6, .48)";
  context.fillRect(zone.x, zone.y, zone.width, zone.height);
  context.beginPath();
  context.rect(zone.x, zone.y, zone.width, zone.height);
  context.clip();
  context.strokeStyle = `${accent}${selected ? "aa" : "4d"}`;
  context.lineWidth = selected ? 3 : 2;
  for (let offset = -zone.height; offset < zone.width + zone.height; offset += 24) {
    context.beginPath();
    context.moveTo(zone.x + offset, zone.y + zone.height);
    context.lineTo(zone.x + offset + zone.height, zone.y);
    context.stroke();
  }
  context.restore();
  context.save();
  context.strokeStyle = selected ? accent : `${accent}75`;
  context.lineWidth = selected ? 3 : 2;
  context.strokeRect(zone.x, zone.y, zone.width, zone.height);
  context.fillStyle = `${accent}b5`;
  context.font = "600 11px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText("NO BUILD", zone.x + zone.width / 2, zone.y + zone.height / 2 + 4);
  context.restore();
};

const pathBlockerShape = (route: { readonly path: readonly Point[] }, blocker: PathPlacementBlocker): Path2D => {
  const polyline = new Polyline(route.path);
  const shape = new Path2D();
  const start = clamp(blocker.startDistance, 0, polyline.totalLength);
  const end = clamp(blocker.startDistance + blocker.length, start, polyline.totalLength);
  const points = [polyline.sample(start).point];
  let distanceAtPoint = 0;
  route.path.slice(0, -1).forEach((point, index) => {
    const next = route.path[index + 1];
    if (!next) return;
    distanceAtPoint += Math.hypot(next.x - point.x, next.y - point.y);
    if (distanceAtPoint > start && distanceAtPoint < end) points.push({ ...next });
  });
  points.push(polyline.sample(end).point);
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  return shape;
};

const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const segmentDirection = (a: Point, b: Point): Point => {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
};
const leftNormal = (direction: Point): Point => ({ x: -direction.y, y: direction.x });

const offsetEdgePoints = (route: MapPathDefinition, side: 1 | -1, rounded: boolean): Point[] => {
  const halfWidth = Math.max(10, route.width) / 2;
  const points = route.path;
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)] ?? point;
    const after = points[Math.min(points.length - 1, index + 1)] ?? point;
    const beforeDirection = segmentDirection(before, point);
    const afterDirection = segmentDirection(point, after);
    const beforeNormal = leftNormal(beforeDirection);
    const afterNormal = leftNormal(afterDirection);
    if (index === 0) return { x: point.x + afterNormal.x * halfWidth * side, y: point.y + afterNormal.y * halfWidth * side };
    if (index === points.length - 1) return { x: point.x + beforeNormal.x * halfWidth * side, y: point.y + beforeNormal.y * halfWidth * side };

    if (rounded) {
      const normal = { x: beforeNormal.x + afterNormal.x, y: beforeNormal.y + afterNormal.y };
      const length = Math.hypot(normal.x, normal.y) || 1;
      return { x: point.x + (normal.x / length) * halfWidth * side, y: point.y + (normal.y / length) * halfWidth * side };
    }

    const first = { x: point.x + beforeNormal.x * halfWidth * side, y: point.y + beforeNormal.y * halfWidth * side };
    const second = { x: point.x + afterNormal.x * halfWidth * side, y: point.y + afterNormal.y * halfWidth * side };
    const denominator = cross(beforeDirection, afterDirection);
    if (Math.abs(denominator) < 0.0001) return second;
    const amount = cross({ x: second.x - first.x, y: second.y - first.y }, afterDirection) / denominator;
    return { x: first.x + beforeDirection.x * amount, y: first.y + beforeDirection.y * amount };
  });
};

const offsetEdgeShape = (route: MapPathDefinition, side: 1 | -1, rounded: boolean): Path2D => {
  const shape = new Path2D();
  const points = route.path;
  const halfWidth = Math.max(10, route.width) / 2;
  if (points.length === 0) return shape;
  if (!rounded) {
    offsetEdgePoints(route, side, false).forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, point.y);
      else shape.lineTo(point.x, point.y);
    });
    return shape;
  }

  // A rounded centerline's contour is made from the two segment offsets and
  // an arc around each authored waypoint. Using one bisector point here
  // turns every corner into a sharp chamfer, which is especially visible in
  // edge-only/wireframe mode.
  const firstDirection = segmentDirection(points[0]!, points[1] ?? points[0]!);
  const firstNormal = leftNormal(firstDirection);
  shape.moveTo(points[0]!.x + firstNormal.x * halfWidth * side, points[0]!.y + firstNormal.y * halfWidth * side);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!;
    const beforeDirection = segmentDirection(points[index - 1]!, point);
    const afterDirection = segmentDirection(point, points[index + 1]!);
    const beforeNormal = leftNormal(beforeDirection);
    const afterNormal = leftNormal(afterDirection);
    const incoming = { x: point.x + beforeNormal.x * halfWidth * side, y: point.y + beforeNormal.y * halfWidth * side };
    const outgoing = { x: point.x + afterNormal.x * halfWidth * side, y: point.y + afterNormal.y * halfWidth * side };
    shape.lineTo(incoming.x, incoming.y);
    const startAngle = Math.atan2(incoming.y - point.y, incoming.x - point.x);
    const endAngle = Math.atan2(outgoing.y - point.y, outgoing.x - point.x);
    let delta = endAngle - startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    shape.arc(point.x, point.y, halfWidth, startAngle, endAngle, delta < 0);
  }
  const lastIndex = points.length - 1;
  const lastDirection = segmentDirection(points[lastIndex - 1] ?? points[lastIndex]!, points[lastIndex]!);
  const lastNormal = leftNormal(lastDirection);
  shape.lineTo(points[lastIndex]!.x + lastNormal.x * halfWidth * side, points[lastIndex]!.y + lastNormal.y * halfWidth * side);
  return shape;
};

const drawStandardPath = (context: CanvasRenderingContext2D, route: MapPathDefinition, shape: Path2D, pathColor: string, rounded: boolean): void => {
  const width = Math.max(20, route.width || PATH_HALF_WIDTH * 2);
  context.lineCap = rounded ? "round" : "butt";
  context.lineJoin = rounded ? "round" : "miter";
  context.strokeStyle = "rgba(0, 0, 0, .58)";
  context.lineWidth = width + 18;
  context.stroke(shape);
  context.strokeStyle = pathColor;
  context.lineWidth = width;
  context.stroke(shape);
  context.strokeStyle = "rgba(235, 238, 229, .12)";
  context.lineWidth = Math.max(8, width - 14);
  context.stroke(shape);
};

const drawEdgePath = (context: CanvasRenderingContext2D, route: MapPathDefinition, pathColor: string, accent: string, rounded: boolean): void => {
  const edges = [offsetEdgeShape(route, 1, rounded), offsetEdgeShape(route, -1, rounded)];
  context.lineJoin = rounded ? "round" : "miter";
  context.lineCap = rounded ? "round" : "butt";
  context.strokeStyle = "rgba(0, 0, 0, .8)";
  context.lineWidth = 7;
  edges.forEach((edge) => context.stroke(edge));
  context.strokeStyle = pathColor;
  context.lineWidth = 3;
  edges.forEach((edge) => context.stroke(edge));
  context.strokeStyle = `${accent}88`;
  context.lineWidth = 1;
  edges.forEach((edge) => context.stroke(edge));
};

const drawRubblePath = (context: CanvasRenderingContext2D, route: MapPathDefinition, shape: Path2D, pathColor: string, accent: string): void => {
  const width = Math.max(20, route.width || PATH_HALF_WIDTH * 2);
  context.lineCap = "butt";
  context.lineJoin = "miter";
  context.setLineDash([70, 28]);
  context.strokeStyle = "rgba(0, 0, 0, .66)";
  context.lineWidth = width + 18;
  context.stroke(shape);
  context.strokeStyle = pathColor;
  context.lineWidth = width;
  context.stroke(shape);
  context.setLineDash([]);

  const polyline = new Polyline(route.path);
  const steps = Math.max(8, Math.ceil(polyline.totalLength / 62));
  for (let index = 0; index < steps; index += 1) {
    const sample = polyline.sample((polyline.totalLength * (index + 0.31)) / steps);
    const size = 5 + (index % 3) * 2;
    const angle = Math.atan2(sample.direction.y, sample.direction.x) + (index % 2 === 0 ? 0.45 : -0.55);
    context.save();
    context.translate(sample.point.x, sample.point.y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(-size, -size * 0.45);
    context.lineTo(size * 0.55, -size);
    context.lineTo(size, size * 0.35);
    context.lineTo(-size * 0.35, size);
    context.closePath();
    context.fillStyle = index % 2 === 0 ? pathColor : `${accent}b8`;
    context.strokeStyle = "rgba(0, 0, 0, .62)";
    context.lineWidth = 2;
    context.fill();
    context.stroke();
    context.restore();
  }
};

const drawStyledPath = (context: CanvasRenderingContext2D, route: MapPathDefinition, shape: Path2D, pathColor: string, accent: string): void => {
  if (route.pathSurface === "edges") drawEdgePath(context, route, pathColor, accent, route.pathType === "round");
  else if (route.pathType === "rubble") drawRubblePath(context, route, shape, pathColor, accent);
  else drawStandardPath(context, route, shape, pathColor, route.pathType !== "sharp");
};

export const drawPathPlacementBlocker = (
  context: CanvasRenderingContext2D,
  route: { readonly path: readonly Point[]; readonly width: number; readonly pathType: MapPathType },
  blocker: PathPlacementBlocker,
  accent: string,
  selected = false,
  opacity = 0.72,
): void => {
  const shape = pathBlockerShape(route, blocker);
  const routeWidth = Math.max(20, route.width);
  context.save();
  // Use one deterministic geometry treatment for both strokes: flat blocker
  // tips, with only the authored corner style changing at route turns.
  const rounded = route.pathType === "round";
  context.lineCap = "butt";
  context.lineJoin = rounded ? "round" : "miter";
  context.miterLimit = 4;
  context.strokeStyle = "rgba(3, 5, 6, .94)";
  context.lineWidth = routeWidth + 20;
  context.stroke(shape);
  context.setLineDash([14, 10]);
  context.strokeStyle = accent;
  context.globalAlpha = selected ? 1 : opacity;
  context.lineWidth = Math.max(12, routeWidth - 8);
  context.stroke(shape);
  context.setLineDash([]);
  context.restore();
};

export const drawMapPath = (
  context: CanvasRenderingContext2D,
  map: MapDefinition,
  pathShapes: readonly Path2D[],
  showLabels = true,
): void => {
  map.blockedZones.forEach((zone) => drawBlockedZone(context, zone, map.palette.accent));
  context.save();
  map.paths.forEach((route, index) => {
    const shape = pathShapes[index];
    if (!shape) return;
    context.globalAlpha = route.pathOpacity ?? 1;
    drawStyledPath(context, route, shape, map.palette.path, map.palette.accent);
  });
  context.setLineDash([]);
  context.restore();
  map.pathBlockers.forEach((blocker) => {
    const route = map.paths[blocker.pathIndex];
    if (route) drawPathPlacementBlocker(context, route, blocker, map.palette.accent, false, map.palette.blockerOpacity ?? 0.72);
  });
  if (!showLabels) return;
  context.save();
  context.font = "600 13px ui-monospace, monospace";
  context.fillStyle = "rgba(218, 224, 218, .25)";
  context.textAlign = "center";
  map.paths.forEach((route, index) => {
    context.fillText(`ENTRY // ${String(index + 1).padStart(2, "0")}`, route.entryLabel.x, route.entryLabel.y);
    context.fillText(`PATH ${String(index + 1).padStart(2, "0")} // ${Math.round(route.width)}W`, route.pathLabel.x, route.pathLabel.y);
  });
  context.restore();
};

export const drawMapCore = (
  context: CanvasRenderingContext2D,
  map: MapDefinition,
  rotation = 0,
  critical = false,
): void => {
  map.paths.forEach((route, index) => {
    const core = route.core;
    context.save();
    context.translate(core.x, core.y);
    context.rotate(rotation);
    context.strokeStyle = critical ? "#f25e57" : "#d5d9d2";
    context.lineWidth = 2;
    for (let size = 25; size <= 43; size += 9) {
      context.strokeRect(-size, -size, size * 2, size * 2);
      context.rotate(Math.PI / 8);
    }
    context.fillStyle = critical ? "rgba(242,94,87,.2)" : "rgba(213,217,210,.1)";
    context.fillRect(-19, -19, 38, 38);
    context.restore();
    context.fillStyle = "rgba(231,235,227,.55)";
    context.font = "600 13px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(`BASE ${String(index + 1).padStart(2, "0")}`, core.x, core.y + 64);
  });
};
