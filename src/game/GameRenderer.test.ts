import { describe, expect, it, vi } from "vitest";
import { MAP_DEFINITIONS } from "./config.ts";
import { GameRenderer, type GameRendererHost } from "./GameRenderer.ts";
import { mapWorldBounds } from "./mapRendering.ts";
import type { RemoteCursor } from "./presentationTypes.ts";
import { TowerHealthBarTracker } from "./towerHealthBar.ts";

describe("GameRenderer remote cursor rendering", () => {
  it("renders remote cursor outside the map clipping region and handles out-of-bounds cursor points", () => {
    const clipCalls: { inClip: boolean; op: string; args: unknown[] }[] = [];
    let saveCount = 0;
    let clipActive = false;

    const explicitMocks: Record<string, unknown> = {
      save: vi.fn(() => {
        saveCount += 1;
      }),
      restore: vi.fn(() => {
        saveCount -= 1;
        if (saveCount === 0) {
          clipActive = false;
        }
      }),
      clip: vi.fn(() => {
        clipActive = true;
      }),
      translate: vi.fn((x: number, y: number) => {
        clipCalls.push({ inClip: clipActive, op: "translate", args: [x, y] });
      }),
      setTransform: vi.fn((...args: unknown[]) => {
        clipCalls.push({ inClip: clipActive, op: "setTransform", args });
      }),
      strokeText: vi.fn((text: string, x: number, y: number) => {
        clipCalls.push({ inClip: clipActive, op: "strokeText", args: [text, x, y] });
      }),
      fillText: vi.fn((text: string, x: number, y: number) => {
        clipCalls.push({ inClip: clipActive, op: "fillText", args: [text, x, y] });
      }),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };

    const mockContext = new Proxy(explicitMocks, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (typeof prop === "string") {
          target[prop] = vi.fn();
          return target[prop];
        }
        return undefined;
      },
    }) as unknown as CanvasRenderingContext2D;

    const map = MAP_DEFINITIONS.sector07;
    const bounds = mapWorldBounds(map.mapScale);

    // Cursor position well outside map boundaries (e.g. during zoom out or pan)
    const outOfBoundsPoint = { x: bounds.x - 300, y: bounds.y - 200 };

    const remoteCursor: RemoteCursor = {
      player: {
        id: "peer-1",
        username: "COOP_BUDDY",
        color: "#ff8800",
        loadout: ["recon"],
        perkLoadout: [],
      },
      point: { ...outOfBoundsPoint },
      targetPoint: { ...outOfBoundsPoint },
      updatedAt: 1000,
      lastRenderAt: 1000,
    };

    const host: GameRendererHost = {
      canvas: { width: 1920, height: 1080 } as HTMLCanvasElement,
      context: mockContext,
      staticMapCanvas: { width: 1920, height: 1080 } as HTMLCanvasElement,
      vignetteCanvas: { width: 1920, height: 1080 } as HTMLCanvasElement,
      map,
      mapPathShapes: [],
      enemyImageCache: new Map(),
      mirrorZenithCharges: new Map(),
      towerHealthBars: new TowerHealthBarTracker(),
      particles: [],
      visualProjectiles: [],
      timedBombs: [],
      towers: [],
      enemies: [],
      projectiles: [],
      pointer: null,
      placement: null,
      pendingPlacementFeedback: [],
      selectedKind: null,
      selectedTower: null,
      selectedTowerId: null,
      relocatingTowerId: null,
      remoteCursor,
      playerProfiles: new Map(),
      localPlayerId: "local",
      integrity: 100,
      shake: 0,
      screenShakeStrength: 1,
      elapsed: 1.0,
      canvasGlow: false,
      reducedMotion: true,
      particleCullMode: "full",
      headless: false,
      inspectorOpen: false,
      isMirror: false,
      multiplayerActive: true,
      now: () => 1050,
      viewport: { x: 100, y: 50, scale: 1.5 },
      clampAdmiralAimPoint: (_t, p) => p,
      enemyDrawingImage: () => null,
      enemyMovementLocked: () => false,
      enemyPosition: (e) => ({ x: e.pathDistance, y: 350 }),
      towerStats: () => ({ range: 100 } as any),
      towerRenderBehaviorContext: () => ({} as any),
    };

    const renderer = new GameRenderer(host);
    renderer.draw();

    // Verify remote cursor username was rendered
    const usernameDraw = clipCalls.find(
      (call) => call.op === "fillText" && call.args[0] === "COOP_BUDDY",
    );
    expect(usernameDraw).toBeDefined();

    // Crucial check: remote cursor must NOT be drawn while clip is active
    expect(usernameDraw?.inClip).toBe(false);

    // Verify translate positioned at the out-of-bounds point
    const cursorTranslate = clipCalls.find(
      (call) =>
        call.op === "translate" &&
        !call.inClip &&
        Math.abs((call.args[0] as number) - outOfBoundsPoint.x) < 0.001 &&
        Math.abs((call.args[1] as number) - outOfBoundsPoint.y) < 0.001,
    );
    expect(cursorTranslate).toBeDefined();
  });
});
