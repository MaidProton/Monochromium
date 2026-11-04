export type TowerOverlaySide = "above" | "below";

export interface TowerOverlayRenderContext {
  readonly context: CanvasRenderingContext2D;
  readonly x: number;
  readonly centerY: number;
}

export interface TowerOverlayItem {
  readonly key: string;
  readonly side: TowerOverlaySide;
  /** Larger priorities are placed first in the list. Ties keep registration order. */
  readonly priority: number;
  /** Conservative vertical bounds used to guarantee a gap between items. */
  readonly height: number;
  readonly render: (context: TowerOverlayRenderContext) => void;
}

export interface TowerOverlayPlacement {
  readonly item: TowerOverlayItem;
  readonly centerY: number;
  readonly top: number;
  readonly bottom: number;
}

export const TOWER_OVERLAY_GAP = 4;
export const TOWER_OVERLAY_BODY_HALF_HEIGHT = 23;

const sortedItems = (items: readonly TowerOverlayItem[]): readonly TowerOverlayItem[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.priority - a.item.priority || a.index - b.index)
    .map(({ item }) => item);

const layoutAbove = (
  items: readonly TowerOverlayItem[],
  towerY: number,
  bodyHalfHeight: number,
  gap: number,
): TowerOverlayPlacement[] => {
  let bottom = towerY - bodyHalfHeight - gap;
  return sortedItems(items).map((item) => {
    const height = Math.max(0, item.height);
    const top = bottom - height;
    const placement = { item, centerY: (top + bottom) / 2, top, bottom };
    bottom = top - gap;
    return placement;
  });
};

const layoutBelow = (
  items: readonly TowerOverlayItem[],
  towerY: number,
  bodyHalfHeight: number,
  gap: number,
): TowerOverlayPlacement[] => {
  let top = towerY + bodyHalfHeight + gap;
  return sortedItems(items).map((item) => {
    const height = Math.max(0, item.height);
    const bottom = top + height;
    const placement = { item, centerY: (top + bottom) / 2, top, bottom };
    top = bottom + gap;
    return placement;
  });
};

/**
 * Builds two non-overlapping vertical stacks. Items are sorted on every call,
 * so an item appearing or disappearing automatically takes its priority slot.
 */
export const layoutTowerOverlays = (
  items: readonly TowerOverlayItem[],
  towerY: number,
  bodyHalfHeight = TOWER_OVERLAY_BODY_HALF_HEIGHT,
  gap = TOWER_OVERLAY_GAP,
): readonly TowerOverlayPlacement[] => [
  ...layoutAbove(items.filter((item) => item.side === "above"), towerY, bodyHalfHeight, gap),
  ...layoutBelow(items.filter((item) => item.side === "below"), towerY, bodyHalfHeight, gap),
];
