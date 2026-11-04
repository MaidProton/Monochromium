import { RANGE_SCALE, TOWER_DEFINITIONS } from "./config.ts";
import { DAMAGE_TYPES } from "./damageTypes.ts";
import { getEnemyDefinition } from "./enemyRegistry.ts";
import {
  drawMapBackdrop,
  drawMapCore,
  drawMapField,
  drawMapPath,
  mapWorldBounds,
} from "./mapRendering.ts";
import { clamp, distance } from "./math.ts";
import { getTowerBehavior } from "./towerBehaviors/index.ts";
import type { TowerRenderBehaviorContext } from "./towerBehaviors/index.ts";
import { towerHealthBarColor, type TowerHealthBarTracker } from "./towerHealthBar.ts";
import { layoutTowerOverlays } from "./towerOverlay.ts";
import type { TowerOverlayItem } from "./towerOverlay.ts";
import type {
  Enemy,
  MapDefinition,
  Particle,
  PlacementPreview,
  Point,
  Projectile,
  Tower,
  TowerKind,
  TowerLevelStats,
} from "./types.ts";
import type { PendingPlacementFeedback, RemoteCursor, TimedBomb, VisualProjectile } from "./presentationTypes.ts";
import { getTowerAbility } from "./types.ts";
import { advanceMechaChassisPose, type MechaChassisPose } from "./mechaPresentation.ts";

const DAMAGE_BUFF_COLOR = "#ff5c64";
const FIRE_RATE_BUFF_COLOR = "#ffe66d";
const BURN_EFFECT_COLOR = "#ff8a4c";
const TAU = Math.PI * 2;

const mixHexColors = (start: string, end: string, amount: number): string => {
  const parse = (color: string): [number, number, number] | null => {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match?.[1]) return null;
    return [
      Number.parseInt(match[1].slice(0, 2), 16),
      Number.parseInt(match[1].slice(2, 4), 16),
      Number.parseInt(match[1].slice(4, 6), 16),
    ];
  };
  const from = parse(start);
  const to = parse(end);
  if (!from || !to) return start;
  const channel = (index: number): number => Math.round(from[index]! + (to[index]! - from[index]!) * clamp(amount, 0, 1));
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

export interface GameRendererHost {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly staticMapCanvas: HTMLCanvasElement;
  readonly vignetteCanvas: HTMLCanvasElement;
  readonly map: MapDefinition;
  readonly mapPathShapes: readonly Path2D[];
  readonly enemyImageCache: Map<string, HTMLImageElement>;
  readonly mirrorZenithCharges: ReadonlyMap<number, { readonly remaining: number; readonly targetId: number; readonly angle?: number }>;
  readonly towerHealthBars: TowerHealthBarTracker;
  readonly particles: readonly Particle[];
  readonly visualProjectiles: readonly VisualProjectile[];
  readonly timedBombs: readonly TimedBomb[];
  readonly towers: readonly Tower[];
  readonly enemies: readonly Enemy[];
  readonly projectiles: readonly Projectile[];
  readonly pointer: Point | null;
  readonly placement: PlacementPreview | null;
  readonly pendingPlacementFeedback: readonly PendingPlacementFeedback[];
  readonly selectedKind: TowerKind | null;
  readonly selectedTower: Tower | null;
  readonly selectedTowerId: number | null;
  readonly relocatingTowerId: number | null;
  readonly remoteCursor: RemoteCursor | null;
  readonly playerProfiles: ReadonlyMap<string, { readonly username: string; readonly color: string }>;
  readonly localPlayerId: string;
  readonly integrity: number;
  readonly shake: number;
  readonly screenShakeStrength: number;
  readonly elapsed: number;
  readonly canvasGlow: boolean;
  readonly reducedMotion: boolean;
  readonly particleCullMode: "full" | "third" | "half" | "sparse";
  readonly headless: boolean;
  readonly inspectorOpen: boolean;
  readonly isMirror: boolean;
  readonly multiplayerActive: boolean;
  readonly now: () => number;
  readonly viewport: { readonly x: number; readonly y: number; readonly scale: number };
  readonly clampAdmiralAimPoint: (tower: Tower, point: Point) => Point;
  readonly enemyDrawingImage: (dataUrl: string) => HTMLImageElement | null;
  readonly enemyMovementLocked: (enemy: Enemy) => boolean;
  readonly enemyPosition: (enemy: Enemy) => Point;
  readonly towerStats: (tower: Tower) => TowerLevelStats;
  readonly towerRenderBehaviorContext: (
    tower: Tower,
    showSupplementalStats?: boolean,
    addOverlay?: (item: TowerOverlayItem) => void,
  ) => TowerRenderBehaviorContext;
}

export class GameRenderer {
  private readonly mechaChassisPoses = new Map<number, MechaChassisPose>();
  private lastPoseTime = 0;
  constructor(private readonly host: GameRendererHost) {}
  draw(): void {
    const poseDelta = Math.min(0.1, Math.max(0, this.host.elapsed - this.lastPoseTime));
    this.lastPoseTime = this.host.elapsed;
    const mechaIds = new Set<number>();
    for (const tower of this.host.towers) {
      if (tower.kind !== "mecha") continue;
      mechaIds.add(tower.id);
      this.mechaChassisPoses.set(tower.id, advanceMechaChassisPose(this.mechaChassisPoses.get(tower.id), tower.position, poseDelta, this.host.reducedMotion));
    }
    for (const id of this.mechaChassisPoses.keys()) if (!mechaIds.has(id)) this.mechaChassisPoses.delete(id);
    const context = this.host.context;
    const viewport = this.host.viewport;
    context.setTransform(1, 0, 0, 1, 0, 0);
    drawMapBackdrop(context, this.host.map, viewport, this.host.canvas.width, this.host.canvas.height);
    context.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
    const shakeStrength = this.host.reducedMotion ? 0 : this.host.screenShakeStrength;
    const shakeX = this.host.shake > 0 ? (Math.random() - 0.5) * this.host.shake * 8 * shakeStrength : 0;
    const shakeY = this.host.shake > 0 ? (Math.random() - 0.5) * this.host.shake * 8 * shakeStrength : 0;
    context.save();
    const bounds = mapWorldBounds(this.host.map.mapScale);
    context.beginPath();
    context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.clip();
    context.translate(shakeX, shakeY);
    context.drawImage(this.host.staticMapCanvas, bounds.x, bounds.y);
    this.drawPathSignal();
    this.drawCore();
    this.drawTowerRanges();
    this.drawTowerBehaviorAim();
    for (const projectile of this.host.projectiles) {
      if (projectile.delay <= 0) this.drawProjectile(projectile);
    }
    this.host.visualProjectiles.forEach((projectile) => this.drawVisualProjectile(projectile));
    this.host.timedBombs.forEach((bomb) => this.drawTimedBomb(bomb));
    this.host.towerHealthBars.retain(new Set(this.host.towers.map((tower) => tower.id)));
    this.host.towers.forEach((tower) => this.drawTower(tower));
    this.host.enemies.forEach((enemy) => this.drawEnemy(enemy));
    this.host.towers.forEach((tower) => this.drawTowerOverlays(tower));
    this.drawPlacement();
    this.drawPendingPlacements();
    this.drawParticles();
    this.host.enemies.forEach((enemy) => this.drawEnemyHoverInfo(enemy));
    context.restore();
    context.save();
    context.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
    context.strokeStyle = `${this.host.map.palette.accent}55`;
    context.lineWidth = 1 / Math.max(0.01, viewport.scale);
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.restore();
    this.drawVignette();
    this.drawRemoteCursor(shakeX, shakeY);
  }

  drawField(context: CanvasRenderingContext2D): void {
    drawMapField(context, this.host.map);
  }

  drawStaticPath(context: CanvasRenderingContext2D): void {
    drawMapPath(context, this.host.map, this.host.mapPathShapes);
  }

  enemyDrawingImage(dataUrl: string): HTMLImageElement | null {
    if (this.host.headless) return null;
    const cached = this.host.enemyImageCache.get(dataUrl);
    if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
    const image = new Image();
    this.host.enemyImageCache.set(dataUrl, image);
    image.src = dataUrl;
    return null;
  }

  private drawPathSignal(): void {
    const context = this.host.context;
    context.save();
    context.lineCap = "butt";
    context.lineJoin = "round";
    context.setLineDash([10, 13]);
    context.lineDashOffset = -this.host.elapsed * 11;
    context.strokeStyle = `${this.host.map.palette.accent}33`;
    context.lineWidth = 2;
    this.host.mapPathShapes.forEach((shape) => context.stroke(shape));
    context.restore();
  }

  private drawCore(): void {
    drawMapCore(this.host.context, this.host.map, this.host.elapsed * 0.18, this.host.integrity <= 6);
  }

  private drawTowerRanges(): void {
    const tower = this.host.selectedTower;
    if (!tower) return;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const context = this.host.context;
    context.save();
    context.beginPath();
    const range = this.host.towerStats(tower).range * RANGE_SCALE;
    context.arc(tower.position.x, tower.position.y, range, 0, TAU);
    context.fillStyle = `${definition.accent}0b`;
    context.fill();
    context.setLineDash([5, 7]);
    context.strokeStyle = `${definition.accent}55`;
    context.lineWidth = 1;
    context.stroke();
    context.restore();
    getTowerBehavior(tower.kind)?.drawRange?.(this.host.towerRenderBehaviorContext(tower));
  }

  private drawTowerBehaviorWorld(tower: Tower): void {
    getTowerBehavior(tower.kind)?.drawWorld?.({ ...this.host.towerRenderBehaviorContext(tower), chassisPose: this.mechaChassisPoses.get(tower.id) });
  }

  /** Compatibility helper for deterministic renderer fixtures; rendering is behavior-owned. */
  drawZenithCharge(tower: Tower): void {
    this.drawTowerBehaviorWorld(tower);
  }

  private drawTower(tower: Tower): void {
    this.drawTowerBehaviorWorld(tower);
    const context = this.host.context;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const selected = tower.id === this.host.selectedTowerId;
    const pulse = 1 + Math.sin(this.host.elapsed * 4 + tower.id) * 0.04;
    context.save();
    context.translate(tower.position.x, tower.position.y);
    context.scale(pulse, pulse);
    const owner = this.host.playerProfiles.get(tower.ownerId);
    if (this.host.multiplayerActive && owner) {
      context.beginPath();
      context.arc(0, 0, 38, 0, TAU);
      context.strokeStyle = `${owner.color}cc`;
      context.lineWidth = tower.ownerId === this.host.localPlayerId ? 2 : 3;
      context.stroke();
    }
    if (tower.stunTimer > 0) {
      context.beginPath();
      context.arc(0, 0, 37, 0, TAU);
      context.setLineDash([3, 5]);
      context.lineDashOffset = -this.host.elapsed * 18;
      context.strokeStyle = "#ffc866";
      context.lineWidth = 2;
      context.stroke();
      context.setLineDash([]);
    }
    if (tower.damageBuff > 1) {
      context.beginPath();
      context.arc(0, 0, 34 + Math.sin(this.host.elapsed * 7) * 2, 0, TAU);
      context.strokeStyle = `${DAMAGE_BUFF_COLOR}${Math.round(70 + Math.min(1, (tower.damageBuff - 1) / 0.35) * 120).toString(16).padStart(2, "0")}`;
      context.lineWidth = 2;
      context.stroke();
    }
    if (tower.fireRateBuff > 0) {
      context.beginPath();
      context.arc(0, 0, 30 + Math.sin(this.host.elapsed * 10) * 1.5, 0, TAU);
      context.strokeStyle = `${FIRE_RATE_BUFF_COLOR}${Math.round(70 + Math.min(1, tower.fireRateBuff / 4) * 120).toString(16).padStart(2, "0")}`;
      context.lineWidth = 1.5 + Math.min(2, tower.fireRateBuff / 2);
      context.stroke();
    }
    if (selected) {
      context.beginPath();
      context.arc(0, 0, 28, 0, TAU);
      context.fillStyle = `${definition.accent}12`;
      context.fill();
    }
    if (tower.counterFlash > 0 || Boolean(getTowerBehavior(tower.kind)?.activeGlow?.(tower))) {
      context.shadowBlur = this.host.canvasGlow ? 28 : 0;
      context.shadowColor = definition.accent;
    }
    context.fillStyle = tower.hurtFlash > 0 ? "#fff4ef" : "#111617";
    context.strokeStyle = definition.accent;
    context.lineWidth = 2.5;
    context.beginPath();
    if (tower.kind === "mecha") {
      context.arc(0, 0, 19, 0, TAU);
    } else if (tower.onPath) {
      context.rect(-23, -23, 46, 46);
    } else {
      context.arc(0, 0, 23, 0, TAU);
    }
    context.fill();
    context.stroke();
    const emblemAngle = tower.kind === "mecha" ? 0 : tower.onPath ? Math.PI / 4 : this.host.elapsed * 0.22;
    context.rotate(emblemAngle);
    context.strokeStyle = `${definition.accent}88`;
    context.lineWidth = 1;
    context.strokeRect(-13, -13, 26, 26);
    context.rotate(-emblemAngle);
    context.fillStyle = definition.accent;
    context.font = "700 18px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(definition.glyph, 0, 1);
    const counterReady = tower.onPath && tower.counterCooldown <= 0;
    const ability = getTowerAbility(definition, "f");
    const abilityReady = Boolean(
      ability && tower.level >= ability.unlockLevel && (tower.abilityCooldowns?.f ?? tower.abilityCooldown) <= 0,
    );
    if (counterReady) {
      context.beginPath();
      context.arc(0, 0, 28, -Math.PI / 2, -Math.PI / 2 + TAU * (0.82 + Math.sin(this.host.elapsed * 3) * 0.05));
      context.strokeStyle = `${definition.accent}99`;
      context.lineWidth = 2;
      context.stroke();
    }
    if (abilityReady) {
      context.beginPath();
      context.setLineDash([3, 4]);
      context.lineDashOffset = -this.host.elapsed * 12;
      context.arc(0, 0, 32, 0, TAU);
      context.strokeStyle = "rgba(241,208,122,.8)";
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }
    context.restore();
  }

  private drawTowerOverlays(tower: Tower): void {
    const context = this.host.context;
    const definition = TOWER_DEFINITIONS[tower.kind];
    const selected = tower.id === this.host.selectedTowerId;
    const hovered = this.host.pointer !== null && distance(tower.position, this.host.pointer) <= 31;
    const showSupplementalStats = hovered || (selected && this.host.inspectorOpen);
    const overlays: TowerOverlayItem[] = [];
    const addOverlay = (item: TowerOverlayItem): void => {
      overlays.push(item);
    };
    const owner = this.host.playerProfiles.get(tower.ownerId);

    const healthBarOpacity = this.host.towerHealthBars.opacityFor(tower, this.host.now(), selected, hovered);
    if (healthBarOpacity > 0) {
      addOverlay({
        key: "health",
        side: "above",
        priority: 1_000,
        height: 7,
        render: ({ context: overlayContext, x, centerY }) => {
          overlayContext.save();
          overlayContext.globalAlpha = healthBarOpacity;
          this.drawBar(x - 26, centerY - 2.5, 52, 5, tower.hp / tower.maxHp, towerHealthBarColor(tower.hp / tower.maxHp));
          overlayContext.restore();
        },
      });
    }

    if (this.host.multiplayerActive && owner && tower.ownerId !== this.host.localPlayerId && (hovered || selected)) {
      addOverlay({
        key: "owner",
        side: "above",
        priority: 900,
        height: 12,
        render: ({ context: overlayContext, x, centerY }) => {
          overlayContext.save();
          overlayContext.font = "700 9px ui-monospace, monospace";
          overlayContext.textAlign = "center";
          overlayContext.textBaseline = "middle";
          overlayContext.fillStyle = owner.color;
          overlayContext.fillText(owner.username.toUpperCase(), x, centerY);
          overlayContext.restore();
        },
      });
    }

    if (tower.stunTimer > 0) {
      addOverlay({
        key: "stun",
        side: "above",
        priority: 800,
        height: 12,
        render: ({ context: overlayContext, x, centerY }) => {
          overlayContext.save();
          overlayContext.font = "700 10px ui-monospace, monospace";
          overlayContext.textAlign = "center";
          overlayContext.textBaseline = "middle";
          overlayContext.fillStyle = "#ffc866";
          overlayContext.fillText(`STUN ${tower.stunTimer.toFixed(1)}`, x, centerY);
          overlayContext.restore();
        },
      });
    }

    if (tower.onPath) {
      addOverlay({
        key: "aggro",
        side: "above",
        priority: 700,
        height: 22,
        render: ({ context: overlayContext, x, centerY }) => {
          const width = tower.maxAggro * 9 - 3;
          overlayContext.save();
          overlayContext.textAlign = "center";
          overlayContext.font = "600 11px ui-monospace, monospace";
          overlayContext.textBaseline = "middle";
          overlayContext.fillStyle = tower.engaged.size >= tower.maxAggro ? "#ff776d" : "rgba(231,235,227,.62)";
          overlayContext.fillText(`AGGRO ${tower.engaged.size}/${tower.maxAggro}`, x, centerY - 6);
          for (let index = 0; index < tower.maxAggro; index += 1) {
            overlayContext.fillStyle = index < tower.engaged.size ? "#ff6c62" : "rgba(255,255,255,.11)";
            overlayContext.fillRect(x - width / 2 + index * 9, centerY + 4, 6, 3);
          }
          overlayContext.restore();
        },
      });
    }

    const levelCount = definition.levels.length;
    addOverlay({
      key: "levels",
      side: "below",
      priority: 1_000,
      height: 5,
      render: ({ context: overlayContext, x, centerY }) => {
        const pipStart = x - ((levelCount - 1) * 8 + 5) / 2;
        overlayContext.save();
        for (let index = 0; index < levelCount; index += 1) {
          overlayContext.fillStyle = index <= tower.level ? definition.accent : "rgba(255,255,255,.14)";
          overlayContext.fillRect(pipStart + index * 8, centerY - 1.5, 5, 3);
        }
        overlayContext.restore();
      },
    });

    const activeBuffs = [
      ...(tower.fireRateBuff > 0 ? [{ key: "fire-rate-buff", label: `FIRE RATE +${Math.round(tower.fireRateBuff * 100)}%`, color: FIRE_RATE_BUFF_COLOR, priority: 890 }] : []),
      ...(tower.damageBuff > 1 ? [{ key: "damage-buff", label: `DAMAGE +${Math.round((tower.damageBuff - 1) * 100)}%`, color: DAMAGE_BUFF_COLOR, priority: 900 }] : []),
    ];
    if (showSupplementalStats) {
      activeBuffs.forEach((buff) => addOverlay({
        key: buff.key,
        side: "below",
        priority: buff.priority,
        height: 12,
        render: ({ context: overlayContext, x, centerY }) => {
          overlayContext.save();
          overlayContext.font = "700 9px ui-monospace, monospace";
          overlayContext.textAlign = "center";
          overlayContext.textBaseline = "middle";
          overlayContext.fillStyle = buff.color;
          overlayContext.fillText(buff.label, x, centerY);
          overlayContext.restore();
        },
      }));
    }

    getTowerBehavior(tower.kind)?.drawSupplemental?.(this.host.towerRenderBehaviorContext(tower, showSupplementalStats, addOverlay));
    layoutTowerOverlays(overlays, tower.position.y).forEach(({ item, centerY }) => {
      item.render({ context, x: tower.position.x, centerY });
    });
  }

  private drawRemoteCursor(shakeX = 0, shakeY = 0): void {
    const cursor = this.host.remoteCursor;
    const now = this.host.now();
    if (!cursor?.point || !cursor.targetPoint || now - cursor.updatedAt > 8_000) return;
    const delta = Math.min(0.1, Math.max(0, (now - cursor.lastRenderAt) / 1_000));
    const blend = 1 - Math.exp(-delta * 20);
    cursor.point = {
      x: cursor.point.x + (cursor.targetPoint.x - cursor.point.x) * blend,
      y: cursor.point.y + (cursor.targetPoint.y - cursor.point.y) * blend,
    };
    cursor.lastRenderAt = now;
    const context = this.host.context;
    const viewport = this.host.viewport;
    const { point, player } = cursor;
    context.save();
    context.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
    context.translate(point.x + shakeX, point.y + shakeY);
    context.fillStyle = player.color;
    context.strokeStyle = "rgba(7,10,11,.92)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(2, 23);
    context.lineTo(8, 16);
    context.lineTo(15, 25);
    context.lineTo(20, 21);
    context.lineTo(13, 13);
    context.lineTo(23, 11);
    context.closePath();
    context.stroke();
    context.fill();
    context.font = "700 11px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.strokeText(player.username.toUpperCase(), 8, -8);
    context.fillText(player.username.toUpperCase(), 8, -8);
    context.restore();
  }

  private drawEnemy(enemy: Enemy): void {
    const context = this.host.context;
    const position = this.host.enemyPosition(enemy);
    const definition = getEnemyDefinition(enemy.kind);
    const { sprite, radius } = definition;
    context.save();
    context.translate(position.x, position.y);
    context.scale(enemy.spawnScale, enemy.spawnScale);

    if (enemy.hasteTimer > 0) {
      context.beginPath();
      context.arc(0, 0, radius + 10 + Math.sin(this.host.elapsed * 11 + enemy.id) * 2, 0, TAU);
      context.strokeStyle = "rgba(112,255,157,.82)";
      context.lineWidth = 2;
      context.setLineDash([5, 4]);
      context.lineDashOffset = -this.host.elapsed * 20;
      context.stroke();
      context.setLineDash([]);
    }

    if (enemy.phaseTimer > 0) {
      context.globalAlpha = 0.42;
      context.beginPath();
      context.arc(0, 0, radius + 13 + Math.sin(this.host.elapsed * 13 + enemy.id) * 3, 0, TAU);
      context.strokeStyle = "#c7e5ff";
      context.lineWidth = 2.5;
      context.stroke();
    }

    if (enemy.behaviorInvulnerableTimer > 0) {
      context.beginPath();
      context.arc(0, 0, radius + 16 + Math.sin(this.host.elapsed * 10 + enemy.id) * 2, 0, TAU);
      context.strokeStyle = "#fff0a8";
      context.lineWidth = 3;
      context.setLineDash([3, 3]);
      context.stroke();
      context.setLineDash([]);
    }

    if (enemy.burnTimer > 0) {
      context.beginPath();
      context.arc(0, 0, radius + 7 + Math.sin(this.host.elapsed * 9 + enemy.id) * 2, 0, TAU);
      context.strokeStyle = "rgba(255,124,62,.78)";
      context.lineWidth = 2;
      context.shadowBlur = this.host.canvasGlow ? 10 : 0;
      context.shadowColor = BURN_EFFECT_COLOR;
      context.stroke();
      context.shadowBlur = 0;
    }

    if (enemy.targetTowerId !== null && enemy.attackTimer <= enemy.telegraphDuration) {
      const progress = clamp(enemy.attackTimer / enemy.telegraphDuration, 0, 1);
      const ringRadius = radius + 5 + progress * 42;
      context.beginPath();
      context.arc(0, 0, ringRadius, 0, TAU);
      context.strokeStyle = `rgba(255, 74, 67, ${0.55 + (1 - progress) * 0.4})`;
      context.lineWidth = 2.4 + (1 - progress) * 2;
      context.shadowBlur = this.host.canvasGlow ? 13 : 0;
      context.shadowColor = "#ff3d37";
      context.stroke();
      context.shadowBlur = 0;
      context.beginPath();
      context.arc(0, 0, radius + 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - progress));
      context.strokeStyle = "rgba(255, 99, 89, .9)";
      context.lineWidth = 2;
      context.stroke();
    }

    if (sprite.appearance !== "drawing") {
      context.beginPath();
      context.arc(0, 0, radius + (definition.boss ? 7 : 4), 0, TAU);
      context.strokeStyle = `${sprite.accent}${definition.boss ? "dd" : "99"}`;
      context.lineWidth = definition.boss ? 2.5 : 1.25;
      if (definition.hidden) {
        context.setLineDash([3, 4]);
        context.lineDashOffset = -this.host.elapsed * 14;
      }
      context.stroke();
      context.setLineDash([]);
    }

    const drawing = sprite.appearance === "drawing" && sprite.drawing ? this.host.enemyDrawingImage(sprite.drawing) : null;
    context.save();
    context.globalAlpha = clamp(sprite.opacity ?? 1, 0, 1);
    if (drawing) {
      context.drawImage(drawing, -radius, -radius, radius * 2, radius * 2);
    } else {
      context.fillStyle = enemy.hitFlash > 0 ? "#ffffff" : enemy.stunTimer > 0 ? "#9ae6ed" : sprite.fill;
      context.strokeStyle = enemy.targetTowerId !== null ? "#ff6a62" : sprite.stroke;
      context.lineWidth = 2;
      context.beginPath();
      if (sprite.shape === "circle") {
        context.arc(0, 0, radius, 0, TAU);
      } else if (sprite.shape === "square") {
        context.rect(-radius, -radius, radius * 2, radius * 2);
      } else if (sprite.shape === "diamond") {
        context.moveTo(0, -radius);
        context.lineTo(radius, 0);
        context.lineTo(0, radius);
        context.lineTo(-radius, 0);
        context.closePath();
      } else {
        const sides = sprite.shape === "polygon" ? Math.round(clamp(sprite.sides ?? 6, 3, 12)) : 6;
        for (let side = 0; side < sides; side += 1) {
          const angle = -Math.PI / 2 + (side / sides) * TAU;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (side === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
      }
      context.fill();
      context.stroke();
      context.fillStyle = enemy.hitFlash > 0 ? "#202425" : sprite.accent;
      context.font = `700 ${Math.max(8, radius * 0.72)}px ui-monospace, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(sprite.glyph, 0, 1);
    }
    context.restore();
    context.restore();
    context.save();
    context.fillStyle = sprite.accent;
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText(definition.name.toUpperCase(), position.x, position.y - radius - 12);
    if (enemy.lockTriggered && (enemy.lockTimeRemaining > 0 || enemy.lockWavesRemaining > 0)) {
      const locks = [
        enemy.lockTimeRemaining > 0 ? `T ${enemy.lockTimeRemaining.toFixed(1)}s` : "",
        enemy.lockWavesRemaining > 0 ? `W ${enemy.lockWavesRemaining}` : "",
      ].filter(Boolean).join(" // ");
      context.fillStyle = "#b9d8ff";
      context.font = "700 9px ui-monospace, monospace";
      context.fillText(`LOCK ${locks}`, position.x, position.y - radius - 23);
    }
    context.restore();
    const barX = position.x - radius;
    const healthBarY = position.y - radius - 9;
    if (enemy.maxShieldHp > 0) {
      this.drawBar(barX, healthBarY - 6, radius * 2, definition.boss ? 4 : 3, enemy.shieldHp / enemy.maxShieldHp, "#f4c542");
    }
    this.drawBar(barX, healthBarY, radius * 2, definition.boss ? 5 : 4, enemy.hp / enemy.maxHp, sprite.accent);
  }

  /** Draws hovered enemy details last so tower overlays cannot cover the tooltip. */
  private drawEnemyHoverInfo(enemy: Enemy): void {
    const position = this.host.enemyPosition(enemy);
    const definition = getEnemyDefinition(enemy.kind);
    const radius = definition.radius;
    const pointer = this.host.pointer;
    if (pointer === null || distance(position, pointer) > radius + 16) return;
    const context = this.host.context;
    const attackCount = definition.attacks?.length ?? 0;
    const lockLabel = this.host.enemyMovementLocked(enemy)
      ? `LOCK ${enemy.lockTimeRemaining > 0 ? `${enemy.lockTimeRemaining.toFixed(1)}s` : ""}${enemy.lockWavesRemaining > 0 ? `${enemy.lockTimeRemaining > 0 ? " // " : ""}${enemy.lockWavesRemaining}W` : ""}`
      : "";
    const rows: { readonly label: string; readonly value: string; readonly color: string }[] = [
      { label: "DEFENSE", value: enemy.defense.toFixed(enemy.defense % 1 === 0 ? 0 : 1), color: "#d9e5df" },
      { label: "PROTECTION", value: `${Math.max(0, Math.round(enemy.protection))}`, color: "#d9e5df" },
      { label: "ARMOR", value: `${Math.round(enemy.armor * 100)}%`, color: "#d9e5df" },
      { label: "SUPERARMOR", value: `${Math.round(enemy.superarmor * 100)}%`, color: "#d9e5df" },
      ...(attackCount > 0 ? [{ label: "ATTACKS", value: `${attackCount}`, color: "#ffb08a" }] : []),
      ...(lockLabel ? [{ label: "LOCK", value: lockLabel.replace(/^LOCK\s*/, ""), color: "#b9d8ff" }] : []),
    ];
    if (enemy.resistances) {
      for (const type of DAMAGE_TYPES) {
        const val = enemy.resistances[type];
        if (typeof val === "number" && Math.round(val * 100) !== 0) {
          const pct = Math.round(val * 100);
          rows.push({
            label: `RES: ${type.toUpperCase()}`,
            value: `${pct > 0 ? `+${pct}` : pct}%`,
            color: pct > 0 ? "#7ce8a2" : "#ff7070",
          });
        }
      }
    }
    const tooltipWidth = 156;
    const tooltipHeight = 8 + 22 + rows.length * 13 + 7;
    const bounds = mapWorldBounds(this.host.map.mapScale);
    const tooltipX = clamp(pointer.x + 12, bounds.x + 4, bounds.x + bounds.width - tooltipWidth - 4);
    const tooltipY = clamp(pointer.y - 12 - tooltipHeight, bounds.y + 4, bounds.y + bounds.height - tooltipHeight - 4);
    context.save();
    context.fillStyle = "rgba(7, 11, 12, .94)";
    context.strokeStyle = `${definition.sprite.accent}bb`;
    context.lineWidth = 1;
    context.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    context.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = definition.sprite.accent;
    context.fillText(definition.name.toUpperCase(), tooltipX + 8, tooltipY + 11);
    context.strokeStyle = `${definition.sprite.accent}55`;
    context.beginPath();
    context.moveTo(tooltipX + 8, tooltipY + 22);
    context.lineTo(tooltipX + tooltipWidth - 8, tooltipY + 22);
    context.stroke();
    rows.forEach((row, index) => {
      const rowY = tooltipY + 29 + index * 13;
      context.font = "700 8px ui-monospace, monospace";
      context.textAlign = "left";
      context.fillStyle = "rgba(217,229,223,.62)";
      context.fillText(row.label, tooltipX + 8, rowY);
      context.textAlign = "right";
      context.fillStyle = row.color;
      context.fillText(row.value || "—", tooltipX + tooltipWidth - 8, rowY);
    });
    context.restore();
  }

  private drawProjectile(projectile: Projectile): void {
    const context = this.host.context;
    const accent = TOWER_DEFINITIONS[projectile.kind].accent;
    context.save();
    context.translate(projectile.position.x, projectile.position.y);
      context.shadowBlur = this.host.canvasGlow ? 12 : 0;
    context.shadowColor = accent;
    context.fillStyle = accent;
    context.beginPath();
    context.arc(0, 0, projectile.splash > 0 ? 4 : 3, 0, TAU);
    context.fill();
    context.restore();
  }

  private drawTowerBehaviorAim(): void {
    const tower = this.host.selectedTower;
    if (!tower) return;
    getTowerBehavior(tower.kind)?.drawAim?.(this.host.towerRenderBehaviorContext(tower));
  }

  private drawVisualProjectile(projectile: VisualProjectile): void {
    if (projectile.hidden) return;
    if (projectile.style === "mecha-missile") {
      const context = this.host.context;
      const progress = Math.min(1, projectile.age / Math.max(0.05, projectile.flightDuration ?? 1));
      const dx = projectile.endpoint.x - projectile.start.x;
      const dy = projectile.endpoint.y - projectile.start.y - Math.cos(progress * Math.PI) * Math.PI * 26;
      context.save();
      context.translate(projectile.position.x, projectile.position.y);
      context.rotate(Math.atan2(dy, dx));
      const trail = context.createLinearGradient(-52, 0, -5, 0);
      trail.addColorStop(0, "#ff873300"); trail.addColorStop(1, "#ffcc88cc");
      context.fillStyle = trail;
      context.beginPath(); context.moveTo(-52, 0); context.lineTo(-7, -5); context.lineTo(-7, 5); context.closePath(); context.fill();
      context.shadowBlur = this.host.canvasGlow ? 12 : 0;
      context.shadowColor = "#ff9c46";
      context.fillStyle = "#ffeab5";
      context.beginPath(); context.moveTo(11, 0); context.lineTo(3, -4); context.lineTo(-8, -4); context.lineTo(-11, -7); context.lineTo(-9, 0); context.lineTo(-11, 7); context.lineTo(-8, 4); context.lineTo(3, 4); context.closePath(); context.fill();
      context.fillStyle = "#ff843a"; context.fillRect(-13, -2, 6, 4);
      context.restore();
      return;
    }
    if (projectile.hidden) return;
    const context = this.host.context;
    context.save();
    context.translate(projectile.position.x, projectile.position.y);
    const scale = projectile.scale;
    context.scale(scale, scale);
      context.shadowBlur = this.host.canvasGlow ? projectile.splash ? 14 : 10 : 0;
    context.shadowColor = projectile.color;
    context.fillStyle = projectile.color;
    context.beginPath();
    context.arc(0, 0, projectile.style === "admiral" ? 5.3 : projectile.splash ? 4 : 3, 0, TAU);
    context.fill();
    if (projectile.style === "admiral") {
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(235,247,255,.9)";
      context.lineWidth = 1.2;
      context.stroke();
    }
    context.restore();
  }

  private drawTimedBomb(bomb: TimedBomb): void {
    // Missiles have airborne presentation; the timed bomb is only the damage schedule.
    if (bomb.label === "mecha-missile") return;
    const context = this.host.context;
    const pulse = 1 + Math.sin(this.host.elapsed * 12) * 0.1;
    context.save();
    context.translate(bomb.position.x, bomb.position.y);
    context.scale(pulse, pulse);
    context.beginPath();
    context.arc(0, 0, 15, 0, TAU);
    context.fillStyle = "#17120b";
    context.fill();
    context.strokeStyle = bomb.color;
    context.lineWidth = 3;
      context.shadowBlur = this.host.canvasGlow ? 14 : 0;
    context.shadowColor = bomb.color;
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = "#fff0bd";
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(bomb.proximity ? "P" : Math.ceil(bomb.timer).toString(), 0, 1);
    context.beginPath();
    context.arc(0, 0, bomb.radius, -Math.PI / 2, bomb.proximity ? -Math.PI / 2 + TAU : -Math.PI / 2 + TAU * (bomb.timer / 5));
    context.strokeStyle = `${bomb.color}66`;
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }

  private drawPlacement(): void {
    const relocatingTower = this.host.towers.find((tower) => tower.id === this.host.relocatingTowerId) ?? null;
    const kind = this.host.selectedKind ?? relocatingTower?.kind;
    if (!this.host.placement || !kind) return;
    const context = this.host.context;
    const definition = TOWER_DEFINITIONS[kind];
    const { position, onPath, valid } = this.host.placement;
    const color = valid ? definition.accent : "#ff5f57";
    context.save();
    context.globalAlpha = 0.72;
    context.fillStyle = `${color}18`;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    context.beginPath();
    if (onPath) context.rect(position.x - 25, position.y - 25, 50, 50);
    else context.arc(position.x, position.y, 25, 0, TAU);
    context.fill();
    context.stroke();
    context.beginPath();
    const previewStats = relocatingTower ? this.host.towerStats(relocatingTower) : definition.levels[0];
    context.arc(position.x, position.y, (previewStats?.range ?? 8) * RANGE_SCALE, 0, TAU);
    context.strokeStyle = `${color}55`;
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.font = "600 12px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillStyle = color;
    const label = valid
      ? `${relocatingTower ? "MOVE // " : ""}${onPath ? definition.onPath.title : definition.offPath.title}`
      : "INVALID SITE";
    context.fillText(label.toUpperCase(), position.x, position.y - 37);
    context.restore();
  }

  private drawPendingPlacements(): void {
    const context = this.host.context;
    for (const pending of this.host.pendingPlacementFeedback) {
      const definition = TOWER_DEFINITIONS[pending.kind];
      context.save();
      context.globalAlpha = 0.5 + Math.sin(this.host.elapsed * 8) * 0.12;
      context.strokeStyle = definition.accent;
      context.fillStyle = `${definition.accent}18`;
      context.setLineDash([3, 4]);
      context.lineWidth = 2;
      context.beginPath();
      if (pending.onPath) context.rect(pending.position.x - 25, pending.position.y - 25, 50, 50);
      else context.arc(pending.position.x, pending.position.y, 25, 0, TAU);
      context.fill();
      context.stroke();
      context.setLineDash([]);
      context.font = "700 10px ui-monospace, monospace";
      context.textAlign = "center";
      context.fillStyle = definition.accent;
      context.fillText("PENDING", pending.position.x, pending.position.y - 38);
      context.restore();
    }
  }

  private drawParticles(): void {
    const context = this.host.context;
    const hasGlow = this.host.canvasGlow;
    for (const [index, particle] of this.host.particles.entries()) {
      if (this.host.particleCullMode === "sparse" && index % 3 !== 0) continue;
      if (this.host.particleCullMode === "half" && index % 2 === 1) continue;
      if (this.host.particleCullMode === "third" && index % 3 === 2) continue;
      if ((particle.delay ?? 0) > 0) continue;
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      const progress = 1 - alpha;
      const displayColor = particle.endColor
        ? mixHexColors(particle.color, particle.endColor, progress)
        : particle.color;
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = displayColor;
      context.fillStyle = displayColor;
      if (particle.type === "spark") {
        context.fillRect(particle.position.x - particle.size / 2, particle.position.y - particle.size / 2, particle.size, particle.size);
      } else if (particle.type === "ring") {
        const finalRadius = particle.radius ?? 82;
        context.beginPath();
        context.arc(
          particle.position.x,
          particle.position.y,
          particle.size + progress * Math.max(0, finalRadius - particle.size),
          0,
          TAU,
        );
        context.lineWidth = Math.max(1, 4 * alpha);
        context.stroke();
      } else if (particle.type === "slash") {
        const angle = particle.angle ?? 0;
        const spread = particle.spread ?? 0.58;
        const radius = (particle.radius ?? 72) * (0.9 + progress * 0.1);
        const direction = particle.direction ?? 1;
        const start = angle - spread * direction;
        const sweep = clamp(progress * 3.8, 0.08, 1);
        const end = start + spread * 2 * sweep * direction;

        context.globalAlpha = alpha * 0.13;
        context.beginPath();
        context.moveTo(particle.position.x, particle.position.y);
        context.arc(particle.position.x, particle.position.y, radius, start, end, direction < 0);
        context.closePath();
        context.fill();

        context.globalAlpha = alpha;
        context.lineCap = "round";
        context.shadowBlur = hasGlow ? 15 * alpha : 0;
        context.shadowColor = displayColor;
        context.beginPath();
        context.arc(particle.position.x, particle.position.y, radius, start, end, direction < 0);
        context.lineWidth = Math.max(1.5, particle.size * alpha);
        context.stroke();

        context.globalAlpha = alpha * 0.5;
        context.beginPath();
        context.arc(particle.position.x, particle.position.y, radius * 0.72, start + 0.09 * direction, end - 0.09 * direction, direction < 0);
        context.lineWidth = Math.max(1, particle.size * 0.35 * alpha);
        context.stroke();
      } else if (particle.type === "strike") {
        const angle = particle.angle ?? -0.72;
        const growth = clamp(progress * 3.2, 0, 1);
        const length = 12 + ((particle.length ?? 86) - 12) * growth;
        const halfLength = length / 2;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        const start = {
          x: particle.position.x - direction.x * halfLength,
          y: particle.position.y - direction.y * halfLength,
        };
        const end = {
          x: particle.position.x + direction.x * halfLength,
          y: particle.position.y + direction.y * halfLength,
        };
        context.globalAlpha = alpha;
        context.lineCap = "round";
        context.shadowBlur = hasGlow ? 13 * alpha : 0;
        context.shadowColor = displayColor;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.lineWidth = Math.max(1.5, particle.size * (0.45 + growth * 0.85) * alpha);
        context.stroke();
        context.globalAlpha = alpha * 0.7;
        context.strokeStyle = "#ffffff";
        context.lineWidth = Math.max(0.75, particle.size * (0.14 + growth * 0.28) * alpha);
        context.stroke();
      } else if (particle.type === "flame-plume") {
        context.translate(particle.position.x, particle.position.y);
        context.rotate(particle.rotation ?? 0);
        context.globalCompositeOperation = "lighter";
        const length = particle.length ?? 24;
        const radius = particle.size * (0.65 + progress * 0.65);
        context.scale(length / radius, 1);
        const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
        glow.addColorStop(0, "#fff0a8");
        glow.addColorStop(0.25, displayColor);
        glow.addColorStop(0.65, "#ff641866");
        glow.addColorStop(1, "#f0320000");
        context.globalAlpha = alpha * 0.7;
        context.fillStyle = glow;
        context.beginPath();
        context.arc(0, 0, radius, 0, TAU);
        context.fill();
      } else if (particle.type === "flame-stream") {
        context.translate(particle.position.x, particle.position.y);
        context.rotate(particle.rotation ?? 0);
        context.globalCompositeOperation = "lighter";
        context.shadowBlur = hasGlow ? 12 * alpha : 0;
        context.shadowColor = displayColor;
        const length = particle.length ?? 12;
        context.fillStyle = displayColor;
        context.fillRect(-length / 2, -particle.size / 2, length, particle.size);
        context.globalAlpha = alpha * 0.55;
        context.fillStyle = "#fff5b0";
        context.fillRect(-length * 0.38, -particle.size * 0.22, length * 0.76, particle.size * 0.44);
      } else if (particle.type === "spray") {
        context.translate(particle.position.x, particle.position.y);
        context.rotate(particle.rotation ?? 0);
        const scale = 0.7 + progress * 0.75;
        context.shadowBlur = hasGlow ? 10 * alpha : 0;
        context.shadowColor = displayColor;
        context.fillRect(-particle.size * scale / 2, -particle.size * scale / 2, particle.size * scale, particle.size * scale);
      } else if (particle.type === "smoke") {
        context.globalAlpha = alpha * 0.38;
        context.beginPath();
        context.arc(particle.position.x, particle.position.y, particle.size * (0.55 + progress * 0.9), 0, TAU);
        context.fill();
      } else if (particle.type === "flash") {
        context.translate(particle.position.x, particle.position.y);
        context.rotate(particle.angle ?? 0);
        context.globalCompositeOperation = "lighter";
        context.shadowBlur = hasGlow ? 18 * alpha : 0;
        context.shadowColor = displayColor;
        context.beginPath();
        const points = 12;
        for (let point = 0; point < points; point += 1) {
          const angle = (point / points) * TAU;
          const radius = point % 2 === 0 ? particle.size * (0.7 + alpha * 0.5) : particle.size * 0.25;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        context.fill();
      } else if (particle.type === "beam") {
        const angle = particle.angle ?? 0;
        const endX = particle.position.x + Math.cos(angle) * (particle.length ?? 0);
        const endY = particle.position.y + Math.sin(angle) * (particle.length ?? 0);
        const taperedBeam = Boolean(particle.startColor);
        const beamGradient = particle.startColor
          ? context.createLinearGradient(particle.position.x, particle.position.y, endX, endY)
          : null;
        if (beamGradient && particle.startColor) {
          beamGradient.addColorStop(0, particle.startColor);
          beamGradient.addColorStop(1, displayColor);
        }
        context.globalCompositeOperation = taperedBeam ? "source-over" : "lighter";
        context.lineCap = "round";
        // Ordinary hitscan is emitted frequently (Recon can draw five beams
        // per shot). Canvas shadow filters are disproportionately expensive
        // here, especially when several beams overlap, so keep the glow as a
        // cheap additive second stroke instead.
        context.shadowBlur = 0;
        context.strokeStyle = beamGradient ?? displayColor;
        context.beginPath();
        context.moveTo(particle.position.x, particle.position.y);
        context.lineTo(endX, endY);
        context.lineWidth = Math.max(1, particle.size * alpha);
        context.stroke();
        context.globalAlpha = alpha * (taperedBeam ? 0.45 : 0.7);
        context.strokeStyle = taperedBeam ? displayColor : "#ffffff";
        context.lineWidth = Math.max(0.75, particle.size * (taperedBeam ? 0.26 : 0.3) * alpha);
        context.stroke();
      } else if (particle.type === "lightning") {
        const points = particle.points ?? [];
        const first = points[0];
        if (first) {
          context.globalCompositeOperation = "lighter";
          context.lineJoin = "round";
          context.lineCap = "round";
          context.shadowBlur = hasGlow ? 7 : 0;
          context.shadowColor = displayColor;
          context.beginPath();
          context.moveTo(first.x, first.y);
          points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
          context.lineWidth = Math.max(1, particle.size * alpha);
          context.stroke();
          context.globalAlpha = alpha * 0.8;
          context.strokeStyle = "#ffffff";
          context.lineWidth = Math.max(0.75, particle.size * 0.32 * alpha);
          context.stroke();
        }
      } else if (particle.type === "text") {
        context.font = "700 13px ui-monospace, monospace";
        context.textAlign = "center";
        context.fillText(particle.text ?? "", particle.position.x, particle.position.y);
      }
      context.restore();
    }
  }

  drawBar(x: number, y: number, width: number, height: number, value: number, color: string): void {
    const context = this.host.context;
    context.fillStyle = "rgba(0,0,0,.72)";
    context.fillRect(x - 1, y - 1, width + 2, height + 2);
    context.fillStyle = "rgba(255,255,255,.1)";
    context.fillRect(x, y, width, height);
    context.fillStyle = color;
    context.fillRect(x, y, width * clamp(value, 0, 1), height);
  }

  private drawVignette(): void {
    const context = this.host.context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(this.host.vignetteCanvas, 0, 0, this.host.canvas.width, this.host.canvas.height);
    context.restore();
  }
}
