import { PATH_HALF_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from "./config.ts";
import type { BlockedZone, MapDefinition } from "./types.ts";

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

export const createMapPathShape = (map: MapDefinition): Path2D => {
  const shape = new Path2D();
  map.path.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  return shape;
};

export const drawMapField = (context: CanvasRenderingContext2D, map: MapDefinition): void => {
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

export const drawMapPath = (
  context: CanvasRenderingContext2D,
  map: MapDefinition,
  pathShape: Path2D,
  showLabels = true,
): void => {
  map.blockedZones.forEach((zone) => drawBlockedZone(context, zone, map.palette.accent));
  context.save();
  context.lineCap = "butt";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 0, 0, .58)";
  context.lineWidth = PATH_HALF_WIDTH * 2 + 18;
  context.stroke(pathShape);
  context.strokeStyle = map.palette.path;
  context.lineWidth = PATH_HALF_WIDTH * 2;
  context.stroke(pathShape);
  context.strokeStyle = "rgba(235, 238, 229, .12)";
  context.lineWidth = PATH_HALF_WIDTH * 2 - 14;
  context.stroke(pathShape);
  context.restore();
  if (!showLabels) return;
  context.save();
  context.font = "600 13px ui-monospace, monospace";
  context.fillStyle = "rgba(218, 224, 218, .25)";
  context.textAlign = "center";
  context.fillText("ENTRY // 00", map.entryLabel.x, map.entryLabel.y);
  context.fillText("PATHBOUND ZONE", map.pathLabel.x, map.pathLabel.y);
  context.restore();
};

export const drawMapCore = (
  context: CanvasRenderingContext2D,
  map: MapDefinition,
  rotation = 0,
  critical = false,
): void => {
  const core = map.core;
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
  context.fillText("CORE", core.x, core.y + 64);
};
