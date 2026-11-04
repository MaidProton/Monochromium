import { DEFAULT_MAP_SCALE, MAP_SCALE_MAX, MAP_SCALE_MIN, WORLD_HEIGHT, WORLD_WIDTH } from "./config.ts";
import { clamp, distance, Polyline } from "./math.ts";
import { saveDiskSection } from "./persistence.ts";
import type { BlockedZone, CustomMapKind, MapDefinition, MapPathDefinition, MapPathSurface, MapPathType, PathPlacementBlocker, Point } from "./types.ts";

const STORAGE_KEY = "monochromium.custom-maps.v1";
const TERMINAL_OFFSET = 35;
const EDITOR_MARGIN = 80;
const GRID_SIZE = 20;
export const MAX_MAP_PATHS = 5;
export const MAP_PATH_WIDTH_MIN = 40;
export const MAP_PATH_WIDTH_MAX = 240;
export const DEFAULT_MAP_PATH_WIDTH = 100;
/** Keep adjacent editor points distinct without forcing large route bends. */
export const MAP_PATH_SEGMENT_MIN = GRID_SIZE;
export const PATH_BLOCKER_LENGTH_MIN = 80;
export const PATH_BLOCKER_LENGTH_MAX = 900;
export const MAX_PATH_BLOCKERS = 24;

export type MapEdge = "left" | "right" | "top" | "bottom";

export interface CustomMapPathDraft {
  id: string;
  entryEdge: MapEdge;
  exitEdge: MapEdge;
  width: number;
  pathOpacity?: number;
  pathType: MapPathType;
  pathSurface: MapPathSurface;
  path: Point[];
}

export interface CustomMapDraft {
  version: 1;
  id: CustomMapKind;
  name: string;
  description: string;
  difficulty: "Easy" | "Medium" | "Hard";
  /** Default is shared: one wave pool is distributed across all paths. */
  enemyRouting: "split" | "multiply";
  // Primary-route aliases keep old imports and simple UI consumers compatible.
  entryEdge: MapEdge;
  exitEdge: MapEdge;
  mapScale: number;
  paths: CustomMapPathDraft[];
  /** Legacy alias for the first route; kept in saved records during migration. */
  path: Point[];
  blockedZones: BlockedZone[];
  pathBlockers: PathPlacementBlocker[];
  palette: { field: string; path: string; accent: string; blockerOpacity: number };
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
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-map:${value}`;
};
const createPathId = (): string => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `path-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const createZoneId = (): string => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const createPathBlockerId = (): string => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `path-blocker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const isSafeMapId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9:_-]{0,79}$/i.test(value);
const isSafeCustomMapId = (value: unknown): value is CustomMapKind => typeof value === "string" && /^custom-map:[a-z0-9-]{8,80}$/i.test(value);
const numberInRange = (value: unknown, fallback: number, minimum: number, maximum: number): number => { const numeric = typeof value === "number" ? value : Number(value); return Number.isFinite(numeric) ? clamp(numeric, minimum, maximum) : fallback; };
const safeText = (value: unknown, fallback: string, maximumLength: number): string => typeof value === "string" ? value.trim().slice(0, maximumLength) || fallback : fallback;
const safeColor = (value: unknown, fallback: string): string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const safeEdge = (value: unknown, fallback: MapEdge): MapEdge => value === "left" || value === "right" || value === "top" || value === "bottom" ? value : fallback;
const safePathType = (value: unknown, fallback: MapPathType = "round"): MapPathType => value === "sharp" || value === "rubble" || value === "round" ? value : fallback;
const safePathSurface = (value: unknown, fallback: MapPathSurface = "solid"): MapPathSurface => value === "edges" || value === "solid" ? value : fallback;

export const snapMapCoordinate = (value: number): number => Math.round(value / GRID_SIZE) * GRID_SIZE;
export const terminalPoint = (edge: MapEdge, position: number): Point => {
  if (edge === "left") return { x: -TERMINAL_OFFSET, y: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_HEIGHT - EDITOR_MARGIN) };
  if (edge === "right") return { x: WORLD_WIDTH + TERMINAL_OFFSET, y: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_HEIGHT - EDITOR_MARGIN) };
  if (edge === "top") return { x: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_WIDTH - EDITOR_MARGIN), y: -TERMINAL_OFFSET };
  return { x: clamp(snapMapCoordinate(position), EDITOR_MARGIN, WORLD_WIDTH - EDITOR_MARGIN), y: WORLD_HEIGHT + TERMINAL_OFFSET };
};
export const terminalPosition = (edge: MapEdge, point: Point): number => edge === "left" || edge === "right" ? point.y : point.x;

const starterPath = (): CustomMapPathDraft => ({
  id: createPathId(), entryEdge: "left", exitEdge: "right", width: DEFAULT_MAP_PATH_WIDTH, pathOpacity: 1, pathType: "round", pathSurface: "solid",
  path: [terminalPoint("left", 350), { x: 280, y: 360 }, { x: 280, y: 120 }, { x: 780, y: 120 }, { x: 780, y: 580 }, { x: 1300, y: 580 }, { x: 1300, y: 360 }, terminalPoint("right", 350)],
});

/** Preset routes are long enough to pass validation immediately after insertion. */
export const createCustomMapPath = (index: number): CustomMapPathDraft => {
  const presets: readonly CustomMapPathDraft[] = [
    starterPath(),
    { id: "", entryEdge: "top", exitEdge: "bottom", width: DEFAULT_MAP_PATH_WIDTH, pathType: "round", pathSurface: "solid", path: [terminalPoint("top", 260), { x: 260, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 580 }, { x: 1420, y: 580 }, terminalPoint("bottom", 1420)] },
    { id: "", entryEdge: "bottom", exitEdge: "top", width: DEFAULT_MAP_PATH_WIDTH, pathType: "round", pathSurface: "solid", path: [terminalPoint("bottom", 1180), { x: 1180, y: 580 }, { x: 180, y: 580 }, { x: 180, y: 120 }, { x: 1360, y: 120 }, terminalPoint("top", 1360)] },
    { id: "", entryEdge: "right", exitEdge: "left", width: DEFAULT_MAP_PATH_WIDTH, pathType: "round", pathSurface: "solid", path: [terminalPoint("right", 170), { x: 1320, y: 170 }, { x: 1320, y: 580 }, { x: 220, y: 580 }, { x: 220, y: 430 }, terminalPoint("left", 430)] },
    { id: "", entryEdge: "left", exitEdge: "bottom", width: DEFAULT_MAP_PATH_WIDTH, pathType: "round", pathSurface: "solid", path: [terminalPoint("left", 570), { x: 260, y: 570 }, { x: 260, y: 100 }, { x: 1160, y: 100 }, { x: 1160, y: 580 }, terminalPoint("bottom", 1160)] },
  ];
  const selected = presets[index % presets.length]!;
  return { ...selected, id: createPathId(), pathOpacity: 1, path: selected.path.map((point) => ({ ...point })) };
};

export const createBlockedZone = (x = 680, y = 270): BlockedZone => ({ id: createZoneId(), x: snapMapCoordinate(clamp(x, 0, WORLD_WIDTH - 160)), y: snapMapCoordinate(clamp(y, 0, WORLD_HEIGHT - 120)), width: 160, height: 120 });
export const createPathPlacementBlocker = (pathIndex: number, startDistance = 420, length = 180): PathPlacementBlocker => ({ id: createPathBlockerId(), pathIndex, startDistance, length });

export const createCustomMap = (): CustomMapDraft => {
  const path = starterPath();
  return { version: 1, id: createId(), name: "Untitled Map", description: "A custom sandbox battlefield.", difficulty: "Medium", enemyRouting: "split", entryEdge: path.entryEdge, exitEdge: path.exitEdge, mapScale: DEFAULT_MAP_SCALE, paths: [path], path: path.path.map((point) => ({ ...point })), blockedZones: [], pathBlockers: [], palette: { field: "#0b0e0f", path: "#1b2021", accent: "#c3ceca", blockerOpacity: 0.72 }, updatedAt: Date.now() };
};

const rectsOverlap = (a: BlockedZone, b: BlockedZone): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const rectDistanceToPoint = (zone: BlockedZone, point: Point): number => Math.hypot(Math.max(zone.x - point.x, 0, point.x - (zone.x + zone.width)), Math.max(zone.y - point.y, 0, point.y - (zone.y + zone.height)));

export const validateCustomMap = (draft: CustomMapDraft): MapValidationResult => {
  const errors: string[] = [];
  if (draft.paths.length < 1 || draft.paths.length > MAX_MAP_PATHS) errors.push(`Maps require 1 to ${MAX_MAP_PATHS} paths.`);
  let pathLength = 0;
  const cores: Point[] = [];
  draft.paths.forEach((route, routeIndex) => {
    if (route.path.length < 2 || route.path.length > 32) errors.push(`Path ${routeIndex + 1} requires 2 to 32 points.`);
    const segments = route.path.slice(0, -1).map((point, index) => ({ a: point, b: route.path[index + 1]! }));
    segments.forEach((segment, segmentIndex) => { if (distance(segment.a, segment.b) < MAP_PATH_SEGMENT_MIN) errors.push(`Path ${routeIndex + 1} segment ${segmentIndex + 1} must be at least ${MAP_PATH_SEGMENT_MIN} units long.`); });
    const routeLength = segments.reduce((total, segment) => total + distance(segment.a, segment.b), 0);
    pathLength += routeLength;
    if (routeLength < 1500) errors.push(`Path ${routeIndex + 1} must be at least 1,500 units long.`);
    if (route.width < MAP_PATH_WIDTH_MIN || route.width > MAP_PATH_WIDTH_MAX) errors.push(`Path ${routeIndex + 1} width must be ${MAP_PATH_WIDTH_MIN} to ${MAP_PATH_WIDTH_MAX} units.`);
    if (segments.length > 0 && routeLength > 0) cores.push(new Polyline(route.path).sample(routeLength - 110).point);
  });
  if (draft.blockedZones.length > 24) errors.push("Maps may contain at most 24 blocked zones.");
  draft.blockedZones.forEach((zone, index) => {
    if (zone.width < 80 || zone.height < 80) errors.push(`Blocked zone ${index + 1} must be at least 80 by 80 units.`);
    if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > WORLD_WIDTH || zone.y + zone.height > WORLD_HEIGHT) errors.push(`Blocked zone ${index + 1} must remain inside the battlefield.`);
    if (cores.some((core) => rectDistanceToPoint(zone, core) < 75)) errors.push(`Blocked zone ${index + 1} is too close to a base.`);
    for (let other = index + 1; other < draft.blockedZones.length; other += 1) if (draft.blockedZones[other] && rectsOverlap(zone, draft.blockedZones[other]!)) errors.push(`Blocked zones ${index + 1} and ${other + 1} overlap.`);
  });
  if (draft.pathBlockers.length > MAX_PATH_BLOCKERS) errors.push(`Maps may contain at most ${MAX_PATH_BLOCKERS} path blockers.`);
  draft.pathBlockers.forEach((blocker, index) => {
    const route = draft.paths[blocker.pathIndex];
    const routeLength = route ? new Polyline(route.path).totalLength : 0;
    if (!route) errors.push(`Path blocker ${index + 1} must reference an existing path.`);
    if (blocker.startDistance < 0 || blocker.length < PATH_BLOCKER_LENGTH_MIN || blocker.length > PATH_BLOCKER_LENGTH_MAX || blocker.startDistance + blocker.length > routeLength) errors.push(`Path blocker ${index + 1} must fit on its path and be ${PATH_BLOCKER_LENGTH_MIN} to ${PATH_BLOCKER_LENGTH_MAX} units long.`);
  });
  return { valid: errors.length === 0, errors: [...new Set(errors)], pathLength };
};

const sanitizePoint = (value: unknown, fallback: Point): Point => { const source = value && typeof value === "object" ? value as Partial<Point> : {}; return { x: numberInRange(source.x, fallback.x, -TERMINAL_OFFSET, WORLD_WIDTH + TERMINAL_OFFSET), y: numberInRange(source.y, fallback.y, -TERMINAL_OFFSET, WORLD_HEIGHT + TERMINAL_OFFSET) }; };
const sanitizePath = (value: unknown, fallback: CustomMapPathDraft, index: number): CustomMapPathDraft => {
  const source = value && typeof value === "object" ? value as Partial<CustomMapPathDraft> : {};
  const entryEdge = safeEdge(source.entryEdge, fallback.entryEdge); const exitEdge = safeEdge(source.exitEdge, fallback.exitEdge);
  const legacyEdges = (source as { pathType?: unknown }).pathType === "edges";
  const pathType = safePathType(legacyEdges ? "round" : source.pathType, fallback.pathType);
  const pathSurface = safePathSurface(legacyEdges ? "edges" : source.pathSurface, fallback.pathSurface);
  const rawPath = Array.isArray(source.path) ? source.path.slice(0, 32) : fallback.path;
  const path = rawPath.map((point, pointIndex) => sanitizePoint(point, fallback.path[pointIndex] ?? { x: 800, y: 350 }));
  if (path.length < 2) return { ...fallback, id: `path-${index}-${createPathId()}` };
  path[0] = terminalPoint(entryEdge, terminalPosition(entryEdge, path[0]!)); path[path.length - 1] = terminalPoint(exitEdge, terminalPosition(exitEdge, path[path.length - 1]!));
  for (let pointIndex = 1; pointIndex < path.length - 1; pointIndex += 1) path[pointIndex] = { x: clamp(snapMapCoordinate(path[pointIndex]!.x), EDITOR_MARGIN, WORLD_WIDTH - EDITOR_MARGIN), y: clamp(snapMapCoordinate(path[pointIndex]!.y), EDITOR_MARGIN, WORLD_HEIGHT - EDITOR_MARGIN) };
  return { id: isSafeMapId(source.id) ? source.id : `path-${index}-${createPathId()}`, entryEdge, exitEdge, width: numberInRange(source.width, DEFAULT_MAP_PATH_WIDTH, MAP_PATH_WIDTH_MIN, MAP_PATH_WIDTH_MAX), pathOpacity: numberInRange(source.pathOpacity, fallback.pathOpacity ?? 1, 0.1, 1), pathType, pathSurface, path };
};
const sanitizeZone = (value: unknown, index: number): BlockedZone | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<BlockedZone>; const width = numberInRange(source.width, 120, 80, WORLD_WIDTH); const height = numberInRange(source.height, 120, 80, WORLD_HEIGHT);
  return { id: isSafeMapId(source.id) ? source.id : `zone-${index}-${createZoneId()}`, x: numberInRange(source.x, 200, 0, WORLD_WIDTH - width), y: numberInRange(source.y, 200, 0, WORLD_HEIGHT - height), width, height };
};
const sanitizePathBlocker = (value: unknown, index: number, paths: readonly CustomMapPathDraft[]): PathPlacementBlocker | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<PathPlacementBlocker>;
  const pathIndex = Math.round(numberInRange(source.pathIndex, 0, 0, Math.max(0, paths.length - 1)));
  const routeLength = new Polyline(paths[pathIndex]!.path).totalLength;
  const length = numberInRange(source.length, 180, PATH_BLOCKER_LENGTH_MIN, Math.min(PATH_BLOCKER_LENGTH_MAX, routeLength));
  return { id: isSafeMapId(source.id) ? source.id : `path-blocker-${index}-${createPathBlockerId()}`, pathIndex, startDistance: numberInRange(source.startDistance, 420, 0, Math.max(0, routeLength - length)), length };
};

const sanitizeMap = (value: unknown): CustomMapDraft | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<CustomMapDraft> & { path?: unknown }; const fallback = createCustomMap();
  const legacyRoute: CustomMapPathDraft = { ...fallback.paths[0]!, entryEdge: safeEdge(source.entryEdge, "left"), exitEdge: safeEdge(source.exitEdge, "right"), path: Array.isArray(source.path) ? source.path as Point[] : fallback.paths[0]!.path };
  const rawPaths = Array.isArray(source.paths) && source.paths.length > 0 ? source.paths.slice(0, MAX_MAP_PATHS) : [legacyRoute]; const seenPathIds = new Set<string>();
  const paths = rawPaths.map((route, index) => { const sanitized = sanitizePath(route, fallback.paths[index] ?? createCustomMapPath(index), index); const id = seenPathIds.has(sanitized.id) ? createPathId() : sanitized.id; seenPathIds.add(id); return { ...sanitized, id }; });
  const paletteSource = source.palette && typeof source.palette === "object" ? source.palette as { field?: unknown; path?: unknown; accent?: unknown; blockerOpacity?: unknown } : fallback.palette;
  const seenZoneIds = new Set<string>();
  const blockedZones = Array.isArray(source.blockedZones) ? source.blockedZones.slice(0, 24).map(sanitizeZone).filter((zone): zone is BlockedZone => zone !== null).map((zone) => { const id = seenZoneIds.has(zone.id) ? createZoneId() : zone.id; seenZoneIds.add(id); return { ...zone, id }; }) : [];
  const seenPathBlockerIds = new Set<string>();
  const pathBlockers = Array.isArray(source.pathBlockers) ? source.pathBlockers.slice(0, MAX_PATH_BLOCKERS).map((blocker, index) => sanitizePathBlocker(blocker, index, paths)).filter((blocker): blocker is PathPlacementBlocker => blocker !== null).map((blocker) => { const id = seenPathBlockerIds.has(blocker.id) ? createPathBlockerId() : blocker.id; seenPathBlockerIds.add(id); return { ...blocker, id }; }) : [];
  const draft: CustomMapDraft = { version: 1, id: isSafeCustomMapId(source.id) ? source.id : createId(), name: safeText(source.name, "Untitled Map", 48), description: safeText(source.description, "A custom sandbox battlefield.", 220), difficulty: source.difficulty === "Easy" || source.difficulty === "Medium" || source.difficulty === "Hard" ? source.difficulty : "Medium", enemyRouting: source.enemyRouting === "multiply" ? "multiply" : "split", entryEdge: paths[0]!.entryEdge, exitEdge: paths[0]!.exitEdge, mapScale: numberInRange(source.mapScale, DEFAULT_MAP_SCALE, MAP_SCALE_MIN, MAP_SCALE_MAX), paths, path: paths[0]!.path.map((point) => ({ ...point })), blockedZones, pathBlockers, palette: { field: safeColor(paletteSource.field, fallback.palette.field), path: safeColor(paletteSource.path, fallback.palette.path), accent: safeColor(paletteSource.accent, fallback.palette.accent), blockerOpacity: numberInRange(paletteSource.blockerOpacity, fallback.palette.blockerOpacity, 0.15, 1) }, updatedAt: Math.round(numberInRange(source.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)) };
  return validateCustomMap(draft).valid ? draft : null;
};

export const sanitizeCustomMaps = (value: unknown): CustomMapDraft[] => { if (!Array.isArray(value)) return []; const unique = new Map<CustomMapKind, CustomMapDraft>(); value.forEach((candidate) => { const sanitized = sanitizeMap(candidate); if (sanitized) unique.set(sanitized.id, sanitized); }); return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt); };
export const loadCustomMaps = (): CustomMapDraft[] => { try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return []; const maps = sanitizeCustomMaps(JSON.parse(raw)); if (JSON.stringify(maps) !== raw) cacheCustomMapsLocally(maps); return maps; } catch { return []; } };
export const cacheCustomMapsLocally = (maps: readonly CustomMapDraft[]): void => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(maps)); } catch { /* Browser fallback is optional. */ } };
export const saveCustomMaps = (maps: readonly CustomMapDraft[]): void => { cacheCustomMapsLocally(maps); void saveDiskSection("custom-maps", maps); };
export const cloneCustomMap = (map: CustomMapDraft): CustomMapDraft => ({ ...map, paths: map.paths.map((route) => ({ ...route, path: route.path.map((point) => ({ ...point })) })), path: map.path.map((point) => ({ ...point })), blockedZones: map.blockedZones.map((zone) => ({ ...zone })), pathBlockers: map.pathBlockers.map((blocker) => ({ ...blocker })), palette: { ...map.palette } });

export const customMapToDefinition = (draft: CustomMapDraft): MapDefinition => {
  const labelFromSample = (sample: { point: Point; direction: Point }): Point => ({ x: clamp(sample.point.x - sample.direction.y * 65, 70, WORLD_WIDTH - 70), y: clamp(sample.point.y + sample.direction.x * 65, 45, WORLD_HEIGHT - 45) });
  const paths: MapPathDefinition[] = draft.paths.map((route, routeIndex) => { const polyline = new Polyline(route.path); const entrySample = polyline.sample(125); return { id: route.id || `path-${routeIndex + 1}`, path: route.path.map((point) => ({ ...point })), width: route.width, pathOpacity: route.pathOpacity ?? 1, pathType: route.pathType, pathSurface: route.pathSurface, core: polyline.sample(polyline.totalLength - 110).point, entryLabel: labelFromSample(entrySample), pathLabel: labelFromSample(polyline.sample(polyline.totalLength * 0.5)) }; });
  const primary = paths[0]!; const accent = draft.palette.accent.slice(1); const red = Number.parseInt(accent.slice(0, 2), 16); const green = Number.parseInt(accent.slice(2, 4), 16); const blue = Number.parseInt(accent.slice(4, 6), 16);
  return { kind: draft.id, name: draft.name, index: 0, isCustom: true, difficulty: draft.difficulty, description: draft.description, rewardMultiplier: 1, mapScale: numberInRange(draft.mapScale, DEFAULT_MAP_SCALE, MAP_SCALE_MIN, MAP_SCALE_MAX), enemyRouting: draft.enemyRouting, paths, path: primary.path, core: primary.core, entryLabel: primary.entryLabel, pathLabel: primary.pathLabel, blockedZones: draft.blockedZones.map((zone) => ({ ...zone })), pathBlockers: draft.pathBlockers.map((blocker) => ({ ...blocker })), palette: { field: draft.palette.field, path: draft.palette.path, accent: draft.palette.accent, blockerOpacity: draft.palette.blockerOpacity, glow: `rgba(${red},${green},${blue},.14)` } };
};
export const upsertCustomMap = (maps: readonly CustomMapDraft[], draft: CustomMapDraft): CustomMapDraft[] => { const candidate = cloneCustomMap({ ...draft, updatedAt: Date.now() }); candidate.name = candidate.name.trim().slice(0, 48) || "Untitled Map"; candidate.description = candidate.description.trim().slice(0, 220) || "A custom sandbox battlefield."; if (!validateCustomMap(candidate).valid) return [...maps]; const next = [...maps.filter((map) => map.id !== candidate.id), candidate].sort((a, b) => b.updatedAt - a.updatedAt); saveCustomMaps(next); return next; };
export const deleteCustomMap = (maps: readonly CustomMapDraft[], id: string): CustomMapDraft[] => { const next = maps.filter((map) => map.id !== id); saveCustomMaps(next); return next; };
