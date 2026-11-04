import {
  MAP_PATH_WIDTH_MAX,
  MAP_PATH_WIDTH_MIN,
  PATH_BLOCKER_LENGTH_MAX,
  PATH_BLOCKER_LENGTH_MIN,
  type CustomMapDraft,
  type MapEdge,
} from "../../game/customMaps.ts";
import type { CustomModeDraft } from "../../game/customModes.ts";
import type { MapPathType, PathPlacementBlocker } from "../../game/types.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

export type MapSelectionState =
  | { type: "point"; pathIndex: number; index: number }
  | { type: "zone"; id: string }
  | { type: "pathBlocker"; id: string };

export const isPathBlockerSelection = (
  selection: MapSelectionState | null,
): selection is Extract<MapSelectionState, { type: "pathBlocker" }> => selection?.type === "pathBlocker";

export const MAP_EDGE_OPTIONS: readonly MapEdge[] = ["left", "right", "top", "bottom"];

export const MAP_PATH_TYPE_OPTIONS: readonly [MapPathType, string][] = [
  ["round", "ROUND CORNERS"],
  ["sharp", "FLAT / SHARP CORNERS"],
  ["rubble", "RUBBLE / BROKEN"],
];

export const MAP_PATH_SURFACE_OPTIONS: readonly ["solid" | "edges", string][] = [
  ["solid", "SOLID PATH"],
  ["edges", "EDGE-ONLY / TRANSPARENT"],
];

export function renderMapPathListHtml(
  paths: readonly CustomMapDraft["paths"][number][],
  activePathIndex: number,
): string {
  const edgeOptions = (edge: MapEdge): string =>
    MAP_EDGE_OPTIONS.map((candidate) => `<option value="${candidate}"${candidate === edge ? " selected" : ""}>${candidate.toUpperCase()}</option>`).join("");
  const pathTypeOptions = (pathType: MapPathType): string =>
    MAP_PATH_TYPE_OPTIONS.map(([value, label]) => `<option value="${value}"${value === pathType ? " selected" : ""}>${label}</option>`).join("");
  const pathSurfaceOptions = (pathSurface: "solid" | "edges"): string =>
    MAP_PATH_SURFACE_OPTIONS.map(([value, label]) => `<option value="${value}"${value === pathSurface ? " selected" : ""}>${label}</option>`).join("");

  return paths.map((route, index) =>
    `<article class="map-path-card${index === activePathIndex ? " active" : ""}"><button class="map-path-select" data-action="map-select-path" data-path-index="${index}"><span>PATH ${String(index + 1).padStart(2, "0")}</span><small>${route.path.length} NODES // ${Math.round(route.width)}W // ${route.pathType.toUpperCase()} / ${route.pathSurface.toUpperCase()}</small></button><div class="map-path-fields"><label><span>ENTRANCE</span><select data-map-path-field="entryEdge" data-path-index="${index}">${edgeOptions(route.entryEdge)}</select></label><label><span>BASE NODE</span><select data-map-path-field="exitEdge" data-path-index="${index}">${edgeOptions(route.exitEdge)}</select></label><label><span>WIDTH</span><input type="number" min="${MAP_PATH_WIDTH_MIN}" max="${MAP_PATH_WIDTH_MAX}" step="10" value="${Math.round(route.width)}" data-map-path-field="width" data-path-index="${index}"></label><label><span>PATH ALPHA <output data-map-path-opacity-value="${index}">${Math.round((route.pathOpacity ?? 1) * 100)}%</output></span><input type="range" min="0.1" max="1" step="0.05" value="${route.pathOpacity ?? 1}" data-map-path-field="pathOpacity" data-path-index="${index}"></label><label><span>CORNER STYLE</span><select data-map-path-field="pathType" data-path-index="${index}">${pathTypeOptions(route.pathType)}</select></label><label><span>SURFACE</span><select data-map-path-field="pathSurface" data-path-index="${index}"${route.pathType === "rubble" ? " disabled" : ""}>${pathSurfaceOptions(route.pathSurface)}</select></label></div>${paths.length > 1 ? `<button class="map-path-delete danger" data-action="map-delete-path" data-path-index="${index}">REMOVE PATH</button>` : ""}</article>`
  ).join("");
}

export function renderMapBlockerListHtml(
  pathBlockers: readonly PathPlacementBlocker[],
  pathCount: number,
  selectionState: MapSelectionState | null,
): string {
  return pathBlockers.map((blocker) => {
    const blockerId = escapeHtml(blocker.id);
    const active = isPathBlockerSelection(selectionState) && selectionState.id === blocker.id;
    return `<article class="map-blocker-card${active ? " active" : ""}"><button class="map-blocker-select" data-action="map-select-path-blocker" data-blocker-id="${blockerId}"><span>BLOCKER // PATH ${String(blocker.pathIndex + 1).padStart(2, "0")}</span><small>${Math.round(blocker.length)} UNITS</small></button><div class="map-blocker-fields"><label><span>PATH</span><select data-map-blocker-field="pathIndex" data-blocker-id="${blockerId}">${Array.from({ length: pathCount }, (_, index) => `<option value="${index}"${index === blocker.pathIndex ? " selected" : ""}>${String(index + 1).padStart(2, "0")}</option>`).join("")}</select></label><label><span>START</span><input type="number" min="0" step="20" value="${Math.round(blocker.startDistance)}" data-map-blocker-field="startDistance" data-blocker-id="${blockerId}"></label><label><span>LENGTH</span><input type="number" min="${PATH_BLOCKER_LENGTH_MIN}" max="${PATH_BLOCKER_LENGTH_MAX}" step="20" value="${Math.round(blocker.length)}" data-map-blocker-field="length" data-blocker-id="${blockerId}"></label></div></article>`;
  }).join("");
}

export function getMapSelectionLabel(
  mapDraft: CustomMapDraft,
  selectionState: MapSelectionState | null,
): string {
  if (selectionState?.type === "point") {
    const route = mapDraft.paths[selectionState.pathIndex];
    const point = route?.path[selectionState.index];
    return point
      ? `PATH ${selectionState.pathIndex + 1} // NODE ${selectionState.index.toString().padStart(2, "0")} // ${Math.round(point.x)}, ${Math.round(point.y)}`
      : "SELECT A ROUTE POINT, BLOCKED ZONE, OR PATH BLOCKER";
  }
  if (selectionState?.type === "zone") {
    const zone = mapDraft.blockedZones.find((candidate) => candidate.id === selectionState.id);
    return zone
      ? `BLOCK ZONE // ${Math.round(zone.width)} × ${Math.round(zone.height)} AT ${Math.round(zone.x)}, ${Math.round(zone.y)}`
      : "SELECT A ROUTE POINT, BLOCKED ZONE, OR PATH BLOCKER";
  }
  if (isPathBlockerSelection(selectionState)) {
    const blocker = mapDraft.pathBlockers.find((candidate) => candidate.id === selectionState.id);
    return blocker
      ? `PATH BLOCKER // PATH ${blocker.pathIndex + 1} // ${Math.round(blocker.startDistance)}–${Math.round(blocker.startDistance + blocker.length)} UNITS`
      : "SELECT A ROUTE POINT, BLOCKED ZONE, OR PATH BLOCKER";
  }
  return "SELECT A ROUTE POINT, BLOCKED ZONE, OR PATH BLOCKER";
}

export function renderCreatorWaveListHtml(
  waves: readonly CustomModeDraft["waves"][number][],
  activeWaveIndex: number,
): string {
  return waves.map((candidate, index) => {
    const enemyCount = candidate.blocks.reduce((total, block) => total + block.count, 0);
    return `<button class="${index === activeWaveIndex ? "active" : ""}" data-action="creator-select-wave" data-wave-index="${index}"><span>WAVE ${(index + 1).toString().padStart(2, "0")}</span><small>${candidate.blocks.length} BLOCKS // ${enemyCount} ENEMIES</small></button>`;
  }).join("");
}

export function renderCreatorBlockListHtml(
  blocks: readonly CustomModeDraft["waves"][number]["blocks"][number][],
  enemyOptionsGenerator: (currentEnemyKind: string) => string,
): string {
  let blockStart = 0;
  return blocks.map((block, index) => {
    const start = blockStart;
    blockStart += block.nextBlockDelay;
    const enemyOptions = enemyOptionsGenerator(block.enemy);
    const hasCustomPath = typeof block.spawnPathIndex === "number" && block.spawnPathIndex >= 0;
    const customPathNumber = hasCustomPath ? (block.spawnPathIndex as number) + 1 : 1;
    return `
      <article class="command-block" data-block-index="${index}">
        <header>
          <div><span>BLOCK ${(index + 1).toString().padStart(2, "0")}</span><strong>ENEMY GROUP</strong></div>
          <small>START +${start.toFixed(2)}s</small>
          <div class="block-actions">
            <button data-action="creator-block-up" data-block-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button data-action="creator-block-down" data-block-index="${index}" ${index === blocks.length - 1 ? "disabled" : ""}>↓</button>
            <button class="danger" data-action="creator-delete-block" data-block-index="${index}" ${blocks.length === 1 ? "disabled" : ""}>×</button>
          </div>
        </header>
        <div class="block-fields">
          <label class="enemy-field"><span>ENEMY</span><select data-block-field="enemy" data-block-index="${index}">${enemyOptions}</select></label>
          <label><span>AMOUNT</span><input type="number" min="1" max="10000" step="1" value="${block.count}" data-block-field="count" data-block-index="${index}"></label>
          <label><span>SPAWN DELAY</span><input type="number" min="0.02" step="0.01" value="${block.spawnDelay}" data-block-field="spawnDelay" data-block-index="${index}"><small>seconds between enemies</small></label>
          <label><span>NEXT BLOCK</span><input type="number" min="0" step="0.01" value="${block.nextBlockDelay}" data-block-field="nextBlockDelay" data-block-index="${index}"><small>seconds from this block's start</small></label>
          <div class="block-path-field">
            <div class="block-path-header">
              <span>TARGET PATH</span>
              <label class="block-path-toggle-label" title="Toggle specific spawn path">
                <input type="checkbox" data-block-field="customPathToggle" data-block-index="${index}" ${hasCustomPath ? "checked" : ""}>
                <span class="block-path-toggle-text">${hasCustomPath ? "CUSTOM" : "AUTO"}</span>
              </label>
            </div>
            <input type="number" min="1" max="100" step="1" value="${customPathNumber}" data-block-field="spawnPathIndex" data-block-index="${index}" ${hasCustomPath ? "" : "disabled"} placeholder="AUTO">
            <small>${hasCustomPath ? `Path ${customPathNumber}` : "Map default"}</small>
          </div>
        </div>
      </article>`;
  }).join("");
}
