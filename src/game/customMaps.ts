import { DEFAULT_MAP_SCALE, MAP_SCALE_MAX, MAP_SCALE_MIN, WORLD_HEIGHT, WORLD_WIDTH } from "./config.ts";
import { clamp, distance, Polyline } from "./math.ts";
import { saveDiskSection } from "./persistence.ts";
import type { BlockedZone, CustomMapKind, MapDefinition, Point } from "./types.ts";

const STORAGE_KEY = "monochromium.custom-maps.v1";
const TERMINAL_OFFSET = 35;
const EDITOR_MARGIN = 80;
const GRID_SIZE = 20;

export type MapEdge = "left" | "right" | "top" | "bottom";

export interface CustomMapDraft {
  version: 1;
  id: CustomMapKind;
  /** Existing maps predate publication and are promoted during sanitization. */
  official: boolean;
  name: string;
  description: string;
  difficulty: "Easy" | "Medium" | "Hard";
  entryEdge: MapEdge;
  exitEdge: MapEdge;
  mapScale: number;
  path: Point[];
  blockedZones: BlockedZone[];
  palette: {
    field: string;
    path: string;
    accent: string;
  };
  updatedAt: number;
}

export interface MapValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly pathLength: number;
}

export const MAP_THEME_PRESETS = [
  { id: "industrial", name: "Industrial", field: "#0b0e0f", path: "#1b2021", accent: "#c3ceca" },
  { id: "ashen", name: "Ashen", field: "#100d0c", path: "#29201c", accent: "#e2a06f" },
  { id: "null", name: "Null", field: "#0a0d13", path: "#171e2c", accent: "#8ca9ff" },
  { id: "toxic", name: "Toxic", field: "#09100d", path: "#15241d", accent: "#7ee7a1" },
] as const;

const createId = (): CustomMapKind => {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-map:${value}`;
};

const createZoneId = (): string => typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const numberInRange = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, minimum, maximum) : fallback;
};

const safeText = (value: unknown, fallback: string, maximumLength: number): string => {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maximumLength) || fallback;
};

const safeColor = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

const safeEdge = (value: unknown, fallback: MapEdge): MapEdge =>
  value === "left" || value === "right" || value === "top" || value === "bottom" ? value : fallback;

export const snapMapCoordinate = (value: number): number => Math.round(value / GRID_SIZE) * GRID_SIZE;

export const terminalPoint = (edge: MapEdge, position: number): Point => {
  if (edge === "left") return { x: -TERMINAL_OFFSET, y: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_HEIGHT - EDITOR_MARGIN) };
  if (edge === "right") return { x: WORLD_WIDTH + TERMINAL_OFFSET, y: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_HEIGHT - EDITOR_MARGIN) };
  if (edge === "top") return { x: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_WIDTH - EDITOR_MARGIN), y: -TERMINAL_OFFSET };
  return { x: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_WIDTH - EDITOR_MARGIN), y: WORLD_HEIGHT + TERMINAL_OFFSET };
};

export const terminalPosition = (edge: MapEdge, point: Point): number =>
  edge === "left" || edge === "right" ? point.y : point.x;

export const createBlockedZone = (x = 680, y = 270): BlockedZone => ({
  id: createZoneId(),
  x: snapMapCoordinate(clamp(x, 0, WORLD_WIDTH - 160)),
  y: snapMapCoordinate(clamp(y, 0, WORLD_HEIGHT - 120)),
  width: 160,
  height: 120,
});

export const createCustomMap = (): CustomMapDraft => ({
  version: 1,
  id: createId(),
  official: false,
  name: "Untitled Map",
  description: "A custom sandbox battlefield.",
  difficulty: "Medium",
  entryEdge: "left",
  exitEdge: "right",
  mapScale: DEFAULT_MAP_SCALE,
  path: [
    terminalPoint("left", 350),
    { x: 280, y: 360 },
    { x: 280, y: 120 },
    { x: 780, y: 120 },
    { x: 780, y: 580 },
    { x: 1300, y: 580 },
    { x: 1300, y: 360 },
    terminalPoint("right", 350),
  ],
  blockedZones: [],
  palette: { field: "#0b0e0f", path: "#1b2021", accent: "#c3ceca" },
  updatedAt: Date.now(),
});

const rectsOverlap = (a: BlockedZone, b: BlockedZone): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const rectDistanceToPoint = (zone: BlockedZone, point: Point): number => {
  const dx = Math.max(zone.x - point.x, 0, point.x - (zone.x + zone.width));
  const dy = Math.max(zone.y - point.y, 0, point.y - (zone.y + zone.height));
  return Math.hypot(dx, dy);
};

export const validateCustomMap = (draft: CustomMapDraft): MapValidationResult => {
  const errors: string[] = [];
  if (draft.path.length < 2 || draft.path.length > 32) errors.push("Routes require 2 to 32 points.");
  const segments = draft.path.slice(0, -1).map((point, index) => ({ a: point, b: draft.path[index + 1]! }));
  segments.forEach((segment, index) => {
    if (distance(segment.a, segment.b) < 100) errors.push(`Route segment ${index + 1} must be at least 100 units long.`);
  });
  let pathLength = 0;
  segments.forEach((segment) => { pathLength += distance(segment.a, segment.b); });
  if (pathLength < 1500) errors.push("The complete route must be at least 1,500 units long.");
  let core = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  if (segments.length > 0 && pathLength > 0) core = new Polyline(draft.path).sample(pathLength - 110).point;
  if (draft.blockedZones.length > 24) errors.push("Maps may contain at most 24 blocked zones.");
  draft.blockedZones.forEach((zone, index) => {
    if (zone.width < 80 || zone.height < 80) errors.push(`Blocked zone ${index + 1} must be at least 80 by 80 units.`);
    if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > WORLD_WIDTH || zone.y + zone.height > WORLD_HEIGHT) {
      errors.push(`Blocked zone ${index + 1} must remain inside the battlefield.`);
    }
    if (rectDistanceToPoint(zone, core) < 75) errors.push(`Blocked zone ${index + 1} is too close to the core.`);
    for (let other = index + 1; other < draft.blockedZones.length; other += 1) {
      const candidate = draft.blockedZones[other];
      if (candidate && rectsOverlap(zone, candidate)) errors.push(`Blocked zones ${index + 1} and ${other + 1} overlap.`);
    }
  });
  return { valid: errors.length === 0, errors: [...new Set(errors)], pathLength };
};

const sanitizePoint = (value: unknown, fallback: Point): Point => {
  const source = value && typeof value === "object" ? value as Partial<Point> : {};
  return {
    x: numberInRange(source.x, fallback.x, -TERMINAL_OFFSET, WORLD_WIDTH + TERMINAL_OFFSET),
    y: numberInRange(source.y, fallback.y, -TERMINAL_OFFSET, WORLD_HEIGHT + TERMINAL_OFFSET),
  };
};

const sanitizeZone = (value: unknown, index: number): BlockedZone | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<BlockedZone>;
  const width = numberInRange(source.width, 120, 80, WORLD_WIDTH);
  const height = numberInRange(source.height, 120, 80, WORLD_HEIGHT);
  return {
    id: typeof source.id === "string" && source.id.length <= 80 ? source.id : `zone-${index}-${createZoneId()}`,
    x: numberInRange(source.x, 200, 0, WORLD_WIDTH - width),
    y: numberInRange(source.y, 200, 0, WORLD_HEIGHT - height),
    width,
    height,
  };
};

const sanitizeMap = (value: unknown): CustomMapDraft | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<CustomMapDraft>;
  const fallback = createCustomMap();
  const entryEdge = safeEdge(source.entryEdge, "left");
  const exitEdge = safeEdge(source.exitEdge, "right");
  const sourcePath = Array.isArray(source.path) ? source.path.slice(0, 32) : fallback.path;
  const path = sourcePath.map((point, index) => sanitizePoint(point, fallback.path[index] ?? { x: 800, y: 350 }));
  if (path.length < 2) return null;
  path[0] = terminalPoint(entryEdge, terminalPosition(entryEdge, path[0]!));
  path[path.length - 1] = terminalPoint(exitEdge, terminalPosition(exitEdge, path[path.length - 1]!));
  for (let index = 1; index < path.length - 1; index += 1) {
    const point = path[index]!;
    path[index] = {
      x: clamp(snapMapCoordinate(point.x), EDITOR_MARGIN, WORLD_WIDTH - EDITOR_MARGIN),
      y: clamp(snapMapCoordinate(point.y), EDITOR_MARGIN, WORLD_HEIGHT - EDITOR_MARGIN),
    };
  }
  const paletteSource = source.palette && typeof source.palette === "object" ? source.palette : fallback.palette;
  const seenZoneIds = new Set<string>();
  const blockedZones = Array.isArray(source.blockedZones)
    ? source.blockedZones.slice(0, 24).map(sanitizeZone).filter((zone): zone is BlockedZone => zone !== null).map((zone) => {
      const id = seenZoneIds.has(zone.id) ? createZoneId() : zone.id;
      seenZoneIds.add(id);
      return { ...zone, id };
    })
    : [];
  const draft: CustomMapDraft = {
    version: 1,
    id: typeof source.id === "string" && source.id.startsWith("custom-map:") ? source.id as CustomMapKind : createId(),
    // Maps created before publication support had no flag; promote those maps
    // on load so the existing library becomes an official map roster.
    official: source.official !== false,
    name: safeText(source.name, "Untitled Map", 48),
    description: safeText(source.description, "A custom sandbox battlefield.", 220),
    difficulty: source.difficulty === "Easy" || source.difficulty === "Medium" || source.difficulty === "Hard" ? source.difficulty : "Medium",
    entryEdge,
    exitEdge,
    mapScale: numberInRange(source.mapScale, DEFAULT_MAP_SCALE, MAP_SCALE_MIN, MAP_SCALE_MAX),
    path,
    blockedZones,
    palette: {
      field: safeColor(paletteSource.field, fallback.palette.field),
      path: safeColor(paletteSource.path, fallback.palette.path),
      accent: safeColor(paletteSource.accent, fallback.palette.accent),
    },
    updatedAt: Math.round(numberInRange(source.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)),
  };
  return validateCustomMap(draft).valid ? draft : null;
};

export const sanitizeCustomMaps = (value: unknown): CustomMapDraft[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Map<CustomMapKind, CustomMapDraft>();
  value.forEach((candidate) => {
    const sanitized = sanitizeMap(candidate);
    if (sanitized) unique.set(sanitized.id, sanitized);
  });
  return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt);
};

export const loadCustomMaps = (): CustomMapDraft[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeCustomMaps(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
};

export const cacheCustomMapsLocally = (maps: readonly CustomMapDraft[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  } catch {
    // Keep the editor usable for the current session when storage is blocked.
  }
};

export const saveCustomMaps = (maps: readonly CustomMapDraft[]): void => {
  cacheCustomMapsLocally(maps);
  void saveDiskSection("custom-maps", maps);
};

export const cloneCustomMap = (map: CustomMapDraft): CustomMapDraft => ({
  ...map,
  path: map.path.map((point) => ({ ...point })),
  blockedZones: map.blockedZones.map((zone) => ({ ...zone })),
  palette: { ...map.palette },
});

export const customMapToDefinition = (draft: CustomMapDraft): MapDefinition => {
  const polyline = new Polyline(draft.path);
  const core = polyline.sample(polyline.totalLength - 110).point;
  const entrySample = polyline.sample(125);
  const middleSample = polyline.sample(polyline.totalLength * 0.5);
  const labelFromSample = (sample: typeof entrySample): Point => ({
    x: clamp(sample.point.x - sample.direction.y * 65, 70, WORLD_WIDTH - 70),
    y: clamp(sample.point.y + sample.direction.x * 65, 45, WORLD_HEIGHT - 45),
  });
  const accent = draft.palette.accent.slice(1);
  const red = Number.parseInt(accent.slice(0, 2), 16);
  const green = Number.parseInt(accent.slice(2, 4), 16);
  const blue = Number.parseInt(accent.slice(4, 6), 16);
  return {
    kind: draft.id,
    name: draft.name,
    index: 0,
    isCustom: !draft.official,
    difficulty: draft.difficulty,
    description: draft.description,
    rewardMultiplier: draft.official
      ? draft.difficulty === "Hard" ? 1.3 : draft.difficulty === "Medium" ? 1.15 : 1
      : 1,
    mapScale: numberInRange(draft.mapScale, DEFAULT_MAP_SCALE, MAP_SCALE_MIN, MAP_SCALE_MAX),
    path: draft.path.map((point) => ({ ...point })),
    core,
    entryLabel: labelFromSample(entrySample),
    pathLabel: labelFromSample(middleSample),
    blockedZones: draft.blockedZones.map((zone) => ({ ...zone })),
    palette: {
      field: draft.palette.field,
      path: draft.palette.path,
      accent: draft.palette.accent,
      glow: `rgba(${red},${green},${blue},.14)`,
    },
  };
};

export const upsertCustomMap = (maps: readonly CustomMapDraft[], draft: CustomMapDraft): CustomMapDraft[] => {
  const candidate = cloneCustomMap({ ...draft, updatedAt: Date.now() });
  candidate.name = candidate.name.trim().slice(0, 48) || "Untitled Map";
  candidate.description = candidate.description.trim().slice(0, 220) || "A custom sandbox battlefield.";
  if (!validateCustomMap(candidate).valid) return [...maps];
  const next = [...maps.filter((map) => map.id !== candidate.id), candidate].sort((a, b) => b.updatedAt - a.updatedAt);
  saveCustomMaps(next);
  return next;
};

export const deleteCustomMap = (maps: readonly CustomMapDraft[], id: string): CustomMapDraft[] => {
  const next = maps.filter((map) => map.id !== id);
  saveCustomMaps(next);
  return next;
};
