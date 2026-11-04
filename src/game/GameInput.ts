import { WORLD_HEIGHT, WORLD_WIDTH } from "./config.ts";
import { clamp } from "./math.ts";
import { getTowerBehavior } from "./towerBehaviors/index.ts";
import type { PlacementPreview, Point, Tower } from "./types.ts";

export const CAMERA_ZOOM_MIN = 0.65;
export const CAMERA_ZOOM_MAX = 2.5;
export const CAMERA_DRAG_THRESHOLD = 6;
export const CAMERA_EXTRA_SPACE = 240;

export function calculateCameraZoom(currentZoom: number, deltaY: number): number {
  return clamp(currentZoom * Math.exp(-deltaY * 0.001), CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
}

export function calculateZoomPanOffset(
  canvasPoint: Point,
  worldPoint: Point,
  canvasWidth: number,
  canvasHeight: number,
  worldWidth: number,
  worldHeight: number,
  scale: number,
): Point {
  return {
    x: canvasPoint.x - (canvasWidth - worldWidth * scale) / 2 - worldPoint.x * scale,
    y: canvasPoint.y - (canvasHeight - worldHeight * scale) / 2 - worldPoint.y * scale,
  };
}

export function clampCameraPan(
  pan: Point,
  canvasWidth: number,
  canvasHeight: number,
  mapBounds: { width: number; height: number },
  scale: number,
  extraSpace = CAMERA_EXTRA_SPACE,
): Point {
  const expandedWidth = mapBounds.width + extraSpace * 2;
  const expandedHeight = mapBounds.height + extraSpace * 2;
  const horizontalLimit = Math.max(0, (expandedWidth * scale - canvasWidth) / 2);
  const verticalLimit = Math.max(0, (expandedHeight * scale - canvasHeight) / 2);
  return {
    x: clamp(pan.x, -horizontalLimit, horizontalLimit) + 0,
    y: clamp(pan.y, -verticalLimit, verticalLimit) + 0,
  };
}

export interface CameraDragState {
  pointerId: number;
  panningEnabled: boolean;
  lastClientX: number;
  lastClientY: number;
  distance: number;
  panning: boolean;
}

export interface GameInputHost {
  readonly canvas: HTMLCanvasElement;
  readonly audio: { unlock: () => Promise<void> | void };
  readonly started: boolean;
  readonly gameOver: boolean;
  readonly paused: boolean;
  readonly selectedTower: Tower | null;
  readonly localPlayerId: string | null;
  readonly cameraPanLocked: boolean;
  cameraZoom: number;
  cameraPan: { x: number; y: number };
  readonly baseViewportScale: number;
  readonly relocatingTowerId: number | null;
  placement: PlacementPreview | null;
  mechaPointerId: number | null;
  mechaPointerClient: { clientX: number; clientY: number } | null;
  pointer: Point | null;

  setMechaAim(pointer: Point): void;
  setMechaFiring(firing: boolean): void;
  releaseMechaInput(): void;
  cancelAimSelected(): void;
  cancelPlacement(): void;
  updatePlacement(): void;
  emitUi(): void;
  panCameraBy(deltaX: number, deltaY: number): void;
  clampCameraPan(): void;
  eventToWorld(event: MouseEvent | PointerEvent): Point;
  eventToCanvasPixel(event: MouseEvent | PointerEvent): Point;
  handlePrimaryClick(point: Point): void;
  onCursor(point: Point | null): void;
}

export class GameInputController {
  private cameraDrag: CameraDragState | null = null;
  private readonly cleanupFns: (() => void)[] = [];

  constructor(private readonly host: GameInputHost) {}

  get isDraggingCamera(): boolean {
    return this.cameraDrag !== null;
  }

  get currentDrag(): CameraDragState | null {
    return this.cameraDrag;
  }

  resetCameraDrag(): void {
    this.cameraDrag = null;
    this.host.canvas.classList.remove("panning");
  }

  bind(): void {
    const { canvas, host } = { canvas: this.host.canvas, host: this.host };

    const onPointerMove = (event: PointerEvent): void => {
      host.mechaPointerClient = { clientX: event.clientX, clientY: event.clientY };
      const drag = this.cameraDrag;
      if (drag?.pointerId === event.pointerId) {
        const bounds = canvas.getBoundingClientRect();
        const pixelScaleX = canvas.width / Math.max(1, bounds.width);
        const pixelScaleY = canvas.height / Math.max(1, bounds.height);
        const deltaX = (event.clientX - drag.lastClientX) * pixelScaleX;
        const deltaY = (event.clientY - drag.lastClientY) * pixelScaleY;
        drag.lastClientX = event.clientX;
        drag.lastClientY = event.clientY;
        drag.distance += Math.hypot(deltaX, deltaY);
        if (drag.panningEnabled && !drag.panning && drag.distance >= CAMERA_DRAG_THRESHOLD) {
          drag.panning = true;
          canvas.classList.add("panning");
        }
        if (drag.panningEnabled && drag.panning) host.panCameraBy(deltaX, deltaY);
      }
      host.pointer = host.eventToWorld(event);
      host.onCursor(host.pointer);
      if (host.selectedTower?.kind === "mecha" && host.selectedTower.mechaControlled === true) {
        host.setMechaAim(host.pointer);
      }
      host.updatePlacement();
    };

    const onPointerLeave = (): void => {
      if (host.mechaPointerId !== null) return;
      host.mechaPointerClient = null;
      if (this.cameraDrag) return;
      if (host.selectedTower?.kind === "mecha" && host.selectedTower.mechaControlled === true) {
        host.setMechaFiring(false);
      }
      host.pointer = null;
      host.onCursor(null);
      host.placement = null;
      host.emitUi();
    };

    const onPointerDown = (event: PointerEvent): void => {
      void host.audio.unlock();
      if (event.button === 2) {
        const aimingTower = host.selectedTower;
        if (aimingTower?.kind === "mecha" && aimingTower.mechaControlled === true && aimingTower.ownerId === host.localPlayerId) {
          host.setMechaFiring(false);
          return;
        }
        if (aimingTower?.aiming && getTowerBehavior(aimingTower.kind)?.cancelAim) host.cancelAimSelected();
        else host.cancelPlacement();
        return;
      }
      if (event.button !== 0 || !host.started || host.gameOver) return;
      if (host.selectedTower?.kind === "mecha" && host.selectedTower.mechaControlled === true && host.selectedTower.ownerId === host.localPlayerId) {
        if (host.paused) return;
        host.mechaPointerClient = { clientX: event.clientX, clientY: event.clientY };
        host.pointer = host.eventToWorld(event);
        host.onCursor(host.pointer);
        host.setMechaAim(host.pointer);
        host.setMechaFiring(true);
        host.mechaPointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      this.cameraDrag = {
        pointerId: event.pointerId,
        panningEnabled: !host.cameraPanLocked,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        distance: 0,
        panning: false,
      };
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (event.button === 0 && host.mechaPointerId === event.pointerId && !host.selectedTower?.mechaControlled) {
        host.releaseMechaInput();
        return;
      }
      if (event.button === 0 && host.selectedTower?.kind === "mecha" && host.selectedTower.mechaControlled === true && host.selectedTower.ownerId === host.localPlayerId) {
        host.pointer = host.eventToWorld(event);
        host.onCursor(host.pointer);
        host.setMechaAim(host.pointer);
        host.setMechaFiring(false);
        host.mechaPointerId = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }
      const drag = this.cameraDrag;
      if (!drag || drag.pointerId !== event.pointerId || event.button !== 0) return;
      host.pointer = host.eventToWorld(event);
      host.onCursor(host.pointer);
      this.cameraDrag = null;
      canvas.classList.remove("panning");
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (drag.panning || drag.distance >= CAMERA_DRAG_THRESHOLD || !host.started || host.gameOver) {
        host.updatePlacement();
        return;
      }
      host.handlePrimaryClick(host.pointer);
    };

    const cancelCameraDrag = (event: PointerEvent): void => {
      if (event.type === "pointercancel" || host.mechaPointerId === event.pointerId) host.releaseMechaInput();
      if (!this.cameraDrag || this.cameraDrag.pointerId !== event.pointerId) return;
      this.cameraDrag = null;
      canvas.classList.remove("panning");
      host.placement = null;
      host.emitUi();
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const worldPoint = host.eventToWorld(event);
      const canvasPoint = host.eventToCanvasPixel(event);
      const nextZoom = calculateCameraZoom(host.cameraZoom, event.deltaY);
      if (nextZoom === host.cameraZoom) return;
      host.cameraZoom = nextZoom;
      const scale = host.baseViewportScale * host.cameraZoom;
      const offset = calculateZoomPanOffset(
        canvasPoint,
        worldPoint,
        canvas.width,
        canvas.height,
        WORLD_WIDTH,
        WORLD_HEIGHT,
        scale,
      );
      host.cameraPan.x = offset.x;
      host.cameraPan.y = offset.y;
      host.clampCameraPan();
      host.pointer = host.eventToWorld(event);
      host.onCursor(host.pointer);
      host.updatePlacement();
    };

    const onContextMenu = (event: MouseEvent): void => event.preventDefault();

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", cancelCameraDrag);
    canvas.addEventListener("lostpointercapture", cancelCameraDrag);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);

    this.cleanupFns.push(() => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", cancelCameraDrag);
      canvas.removeEventListener("lostpointercapture", cancelCameraDrag);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
    });
  }

  unbind(): void {
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns.length = 0;
  }
}
