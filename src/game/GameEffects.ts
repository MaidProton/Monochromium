import type { AudioSystem } from "./audio.ts";
import { RANGE_SCALE } from "./config.ts";
import { getTowerBehavior } from "./towerBehaviors/index.ts";
import { clamp, distance } from "./math.ts";
import type { Particle, Point, Tower, TowerLevelStats } from "./types.ts";

const TAU = Math.PI * 2;

const colorWithAlpha = (color: string, alpha: number): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) return color;
  const red = Number.parseInt(match[1].slice(0, 2), 16);
  const green = Number.parseInt(match[1].slice(2, 4), 16);
  const blue = Number.parseInt(match[1].slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
};

export interface GameEffectsHost {
  readonly headless: boolean;
  readonly particles: Particle[];
  readonly towers: readonly Tower[];
  readonly audio: Pick<AudioSystem, "flameStream" | "shoot">;
  readonly towerStats: (tower: Tower) => TowerLevelStats;
  readonly fireRateCooldown: (tower: Tower, baseCooldown: number) => number;
}

export class GameEffects {
  private readonly infernusFlameStreams = new Map<number, {
    target: Point;
    remaining: number;
    level: number;
    emitTimer: number;
  }>();

  constructor(private readonly host: GameEffectsHost) {}
  updateParticles(delta: number): void {
    if (this.host.headless) return;
    this.host.particles.forEach((particle) => {
      if ((particle.delay ?? 0) > 0) {
        const remainingDelay = Math.max(0, (particle.delay ?? 0) - delta);
        particle.delay = remainingDelay;
        if (remainingDelay === 0 && particle.sound === "wraith-flurry") {
          particle.sound = undefined;
          this.host.audio.shoot(220, "wraith", "blade");
        }
        return;
      }
      particle.life -= delta;
      particle.position.x += particle.velocity.x * delta;
      particle.position.y += particle.velocity.y * delta;
      particle.rotation = (particle.rotation ?? 0) + (particle.angularVelocity ?? 0) * delta;
      const damping = Math.pow(particle.drag ?? 0.96, delta * 60);
      particle.velocity.x *= damping;
      particle.velocity.y *= damping;
    });
    const liveParticles = this.host.particles.filter((particle) => particle.life > 0);
    this.host.particles.splice(0, this.host.particles.length, ...liveParticles);
    this.updateInfernusFlameStreams(delta);
  }

  spawnSpark(position: Point, color: string, speed: number): void {
    if (this.host.headless) return;
    const angle = Math.random() * TAU;
    const life = 0.28 + Math.random() * 0.2;
    this.host.particles.push({
      position: { ...position },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life,
      maxLife: life,
      color,
      size: 2 + Math.random() * 2,
      type: "spark",
    });
  }

  spawnRing(position: Point, color: string, life: number, size: number, radius = 82): void {
    if (this.host.headless) return;
    this.host.particles.push({
      position: { ...position },
      velocity: { x: 0, y: 0 },
      life,
      maxLife: life,
      color,
      size,
      radius,
      type: "ring",
    });
  }

  spawnImpactDust(position: Point, color: string): void {
    if (this.host.headless) return;
    for (let index = 0; index < 3; index += 1) {
      this.spawnSpark(position, color, 18 + Math.random() * 24);
    }
  }

  spawnFlameCone(from: Point, to: Point, halfAngle: number): void {
    if (this.host.headless) return;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const reach = distance(from, to);
    // Fill the whole firing cone immediately, then carry embers outwards.
    for (let index = 0; index < 28; index += 1) {
      const heading = angle + (Math.random() * 2 - 1) * halfAngle;
      const travel = reach * (index / 28);
      const life = 0.26 + Math.random() * 0.16;
      this.host.particles.push({
        type: "flame-plume", position: { x: from.x + Math.cos(heading) * travel, y: from.y + Math.sin(heading) * travel },
        velocity: { x: Math.cos(heading) * 55, y: Math.sin(heading) * 55 },
        life, maxLife: life, size: 12 + travel * 0.16, length: 24 + travel * 0.2,
        color: index < 5 ? "#fff4b5" : "#ff9b36", endColor: "#ee3e19", rotation: heading, drag: 1,
      });
    }
    this.spawnMuzzleFlash(from, to, "#ffad42", 18);
  }

  spawnText(position: Point, text: string, color: string): void {
    if (this.host.headless) return;
    this.host.particles.push({
      position: { x: position.x, y: position.y - 32 },
      velocity: { x: 0, y: -24 },
      life: 0.9,
      maxLife: 0.9,
      color,
      size: 11,
      type: "text",
      text,
    });
  }

  spawnSlash(from: Point, to: Point, color: string, reach?: number, spread = 0.58, delay = 0, sound?: Particle["sound"], duration = 0.24, direction: 1 | -1 = 1): void {
    if (this.host.headless) return;
    const life = duration;
    this.host.particles.push({
      position: { ...from },
      velocity: { x: 0, y: 0 },
      delay,
      sound,
      life,
      maxLife: life,
      color,
      size: 8,
      radius: reach ?? clamp(distance(from, to), 36, 135),
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      direction,
      spread,
      type: "slash",
    });
    this.spawnImpactDust(to, color);
  }

  spawnWraithDashTrail(from: Point, to: Point, color: string, reach?: number): void {
    if (this.host.headless) return;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const perpendicular = { x: -Math.sin(angle), y: Math.cos(angle) };
    const span = reach ?? distance(from, to);
    this.spawnBeam(from, to, colorWithAlpha(color, 0.42), 12, 0, colorWithAlpha("#ffffff", 0.08), 0.18);
    this.spawnFlash(from, color, 30, angle);
    this.spawnFlash(to, "#fff2f4", 38, angle);
    for (let index = 1; index <= 6; index += 1) {
      const amount = index / 7;
      const center = {
        x: from.x + (to.x - from.x) * amount,
        y: from.y + (to.y - from.y) * amount,
      };
      const slashAngle = angle + (index % 2 === 0 ? 0.68 : -0.68);
      const slashEnd = {
        x: center.x + Math.cos(slashAngle) * Math.min(42, span * 0.18),
        y: center.y + Math.sin(slashAngle) * Math.min(42, span * 0.18),
      };
      this.spawnSlash(center, slashEnd, index % 2 === 0 ? color : "#ffb8c0", Math.min(42, span * 0.18), 0.34);
      this.spawnSpark(center, color, 65 + Math.random() * 55);
      this.spawnSpark(
        { x: center.x + perpendicular.x * 9, y: center.y + perpendicular.y * 9 },
        "#ffffff",
        35 + Math.random() * 40,
      );
    }
  }

  spawnWraithFlurry(position: Point, color: string, radius: number): void {
    if (this.host.headless) return;
    this.spawnRing(position, color, 0.72, 11, radius);
    this.spawnRing(position, "#fff2f4", 0.28, 4, radius * 0.62);
    this.spawnFlash(position, color, Math.min(64, radius * 0.42));
    // The individual crossed slashes are emitted by the timed flurry ticks;
    // this telegraph only marks the active area.
    this.spawnRadialSpray(position, color, "#ffb8c0", 22, radius * 0.9);
  }

  spawnWraithFlurrySlashes(position: Point, color: string, radius: number): void {
    if (this.host.headless) return;
    for (let index = 0; index < 30; index += 1) {
      const angle = Math.random() * TAU;
      const distanceFromCenter = Math.sqrt(Math.random()) * radius * 0.88;
      const center = {
        x: position.x + Math.cos(angle) * distanceFromCenter,
        y: position.y + Math.sin(angle) * distanceFromCenter,
      };
      const slashAngle = Math.random() * TAU;
      const reach = radius * (0.24 + Math.random() * 0.16);
      const aim = {
        x: center.x + Math.cos(slashAngle) * reach,
        y: center.y + Math.sin(slashAngle) * reach,
      };
      const slashColor = index % 5 === 0 ? "#ff9aa4" : color;
      const delay = 0.02 + index * 0.022 + Math.random() * 0.025;
      this.spawnSlash(center, aim, slashColor, reach, 0.38, delay, "wraith-flurry");
    }
  }

  spawnSwordStrike(position: Point, color: string): void {
    if (this.host.headless) return;
    const life = 0.2;
    this.host.particles.push({
      position: { ...position },
      velocity: { x: 0, y: 0 },
      life,
      maxLife: life,
      color,
      size: 4.5,
      angle: Math.random() * TAU,
      length: 86,
      type: "strike",
    });
    this.spawnImpactDust(position, color);
  }

  spawnTracer(from: Point, to: Point, color: string): void {
    if (this.host.headless) return;
    const steps = 9;
    for (let index = 1; index < steps; index += 1) {
      const amount = index / steps;
      this.host.particles.push({
        position: {
          x: from.x + (to.x - from.x) * amount,
          y: from.y + (to.y - from.y) * amount,
        },
        velocity: { x: 0, y: 0 },
        life: 0.09,
        maxLife: 0.09,
        color,
        size: 2,
        type: "spark",
      });
    }
  }

  spawnBulletTracer(from: Point, to: Point, color: string, width: number): void {
    if (this.host.headless) return;
    // A compact tracer and a sharp muzzle flash read as a fired round, while
    // the thin beam keeps the hit visible at the game's zoom level.
    this.spawnBeam(from, to, colorWithAlpha(color, 0.82), width, 0, colorWithAlpha("#ffffff", 0.08), 0.09);
    this.spawnTracer(from, to, color);
    this.spawnMuzzleFlash(from, to, color, width >= 2.5 ? 19 : 16);
  }

  spawnArc(from: Point, to: Point, color: string): void {
    if (this.host.headless) return;
    const steps = 7;
    for (let index = 1; index < steps; index += 1) {
      const amount = index / steps;
      const point = {
        x: from.x + (to.x - from.x) * amount + (Math.random() - 0.5) * 12,
        y: from.y + (to.y - from.y) * amount + (Math.random() - 0.5) * 12,
      };
      this.host.particles.push({
        position: point,
        velocity: { x: 0, y: 0 },
        life: 0.13,
        maxLife: 0.13,
        color,
        size: 2.5,
        type: "spark",
      });
    }
  }

  startInfernusFlameStream(tower: Tower, target: Point): void {
    if (this.host.headless) return;
    const stats = this.host.towerStats(tower);
    const interval = clamp(this.host.fireRateCooldown(tower, stats.fireRate), 0.08, 1);
    const current = this.infernusFlameStreams.get(tower.id);
    this.infernusFlameStreams.set(tower.id, {
      target: { ...target },
      remaining: Math.max(current?.remaining ?? 0, interval * 1.35 + 0.04),
      level: tower.level,
      emitTimer: 0,
    });
    this.host.audio.flameStream(tower.id, true, tower.level);
  }

  updateInfernusFlameStreams(delta: number): void {
    if (this.host.headless) return;
    const activeTowerIds = new Set(this.host.towers.filter((tower) => getTowerBehavior(tower.kind)?.flameStream).map((tower) => tower.id));
    for (const [towerId, stream] of this.infernusFlameStreams) {
      const tower = this.host.towers.find((candidate) => candidate.id === towerId);
      if (!tower || !getTowerBehavior(tower.kind)?.flameStream || !activeTowerIds.has(towerId)) {
        this.infernusFlameStreams.delete(towerId);
        this.host.audio.flameStream(towerId, false);
        continue;
      }
      stream.remaining -= delta;
      if (stream.remaining <= 0) {
        this.infernusFlameStreams.delete(towerId);
        this.host.audio.flameStream(towerId, false);
        continue;
      }

      stream.emitTimer -= delta;
      while (stream.emitTimer <= 0) {
        // Use the old chunky spray shape, but emit a small batch continuously.
        // This keeps the cone full without creating a particle for every frame.
        this.spawnInfernusFlameParticle(tower, stream.target, stream.level);
        this.spawnInfernusFlameParticle(tower, stream.target, stream.level);
        stream.emitTimer += 0.06;
      }
    }
  }

  spawnInfernusFlameParticle(tower: Tower, target: Point, level: number): void {
    const from = tower.position;
    const facing = Math.atan2(target.y - from.y, target.x - from.x);
    const halfAngle = level >= 3 ? 0.58 : level >= 1 ? 0.48 : 0.38;
    // Aim toward the selected enemy, but always fill Infernus's complete range.
    // This makes the piercing cone readable even when the target is nearby.
    const reach = this.host.towerStats(tower).range * RANGE_SCALE;
    const life = 0.36 + Math.random() * 0.22;
    const muzzleOffset = 8 + Math.random() * 8;
    // The full angle is intentional: Infernus should visibly fill the same
    // cone used by the damage calculation, rather than forming a thin lance.
    const angle = facing + (Math.random() * 2 - 1) * halfAngle;
    const rangeCoverage = Math.random() < 0.25 ? 1 : 0.84 + Math.random() * 0.16;
    const speed = (Math.max(1, reach - muzzleOffset) / life) * rangeCoverage;
    const startColor = level >= 5 ? "#fff0a2" : "#ffe66d";
    const endColor = level >= 5 ? "#d71920" : level >= 3 ? "#ef432e" : "#f04a32";
    this.host.particles.push({
      position: {
        x: from.x + Math.cos(angle) * muzzleOffset,
        y: from.y + Math.sin(angle) * muzzleOffset,
      },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life,
      maxLife: life,
      color: startColor,
      endColor,
      size: 5 + Math.min(level, 5) * 0.8 + Math.random() * 6,
      rotation: Math.random() * TAU,
      angularVelocity: (Math.random() * 2 - 1) * 10,
      drag: 1,
      type: "spray",
    });
  }

  spawnRadialSpray(position: Point, startColor: string, endColor: string, count: number, reach: number): void {
    if (this.host.headless) return;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const life = 0.38 + Math.random() * 0.28;
      const rangeCoverage = index % 4 === 0 ? 1 : 0.68 + Math.random() * 0.32;
      const speed = (reach / life) * rangeCoverage;
      this.host.particles.push({
        position: { ...position },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life,
        maxLife: life,
        color: startColor,
        endColor,
        size: 5 + Math.random() * 7,
        rotation: Math.random() * TAU,
        angularVelocity: (Math.random() * 2 - 1) * 12,
        drag: 1,
        type: "spray",
      });
    }
  }

  spawnFlash(position: Point, color: string, size: number, angle = 0, delay = 0): void {
    if (this.host.headless) return;
    this.host.particles.push({
      position: { ...position },
      velocity: { x: 0, y: 0 },
      delay,
      life: 0.18,
      maxLife: 0.18,
      color,
      size,
      angle,
      type: "flash",
    });
  }

  spawnLightningAuraArc(center: Point, radius: number, color: string): void {
    if (this.host.headless) return;
    const randomPoint = (): Point => {
      const angle = Math.random() * TAU;
      const radialDistance = Math.sqrt(Math.random()) * radius * 0.92;
      return {
        x: center.x + Math.cos(angle) * radialDistance,
        y: center.y + Math.sin(angle) * radialDistance,
      };
    };
    const start = randomPoint();
    const end = randomPoint();
    const points: Point[] = [];
    const segments = 6;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const perpendicular = { x: -Math.sin(angle), y: Math.cos(angle) };
    for (let segment = 0; segment <= segments; segment += 1) {
      const progress = segment / segments;
      const jitter = segment === 0 || segment === segments ? 0 : (Math.random() - 0.5) * 24;
      const point = {
        x: start.x + (end.x - start.x) * progress + perpendicular.x * jitter,
        y: start.y + (end.y - start.y) * progress + perpendicular.y * jitter,
      };
      const offsetX = point.x - center.x;
      const offsetY = point.y - center.y;
      const pointDistance = Math.hypot(offsetX, offsetY);
      if (pointDistance > radius) {
        point.x = center.x + (offsetX / pointDistance) * radius;
        point.y = center.y + (offsetY / pointDistance) * radius;
      }
      points.push(point);
    }
    this.host.particles.push({
      position: { ...center },
      velocity: { x: 0, y: 0 },
      life: 0.17,
      maxLife: 0.17,
      color,
      size: 3,
      points,
      type: "lightning",
    });
  }

  spawnMuzzleFlash(from: Point, to: Point, color: string, size: number): void {
    if (this.host.headless) return;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const muzzle = { x: from.x + Math.cos(angle) * 25, y: from.y + Math.sin(angle) * 25 };
    this.spawnFlash(muzzle, color, size, angle);
    for (let index = 0; index < 5; index += 1) this.spawnSpark(muzzle, color, 55 + Math.random() * 70);
  }

  spawnBeam(
    from: Point,
    to: Point,
    color: string,
    width: number,
    delay = 0,
    startColor?: string,
    life = 0.13,
  ): void {
    if (this.host.headless) return;
    this.host.particles.push({
      position: { ...from },
      velocity: { x: 0, y: 0 },
      delay,
      life,
      maxLife: life,
      color,
      startColor,
      size: width,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      length: distance(from, to),
      type: "beam",
    });
  }

  spawnCyborgBeam(from: Point, to: Point, color: string, width: number): void {
    this.spawnBeam(from, to, colorWithAlpha(color, 0.78), width, 0, colorWithAlpha(color, 0.08), 0.08);
  }

  spawnSmoke(position: Point, color = "#626866", count = 8): void {
    if (this.host.headless) return;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const life = 0.55 + Math.random() * 0.45;
      this.host.particles.push({
        position: { ...position },
        velocity: { x: Math.cos(angle) * (18 + Math.random() * 42), y: Math.sin(angle) * (18 + Math.random() * 42) - 18 },
        life,
        maxLife: life,
        color,
        size: 8 + Math.random() * 12,
        type: "smoke",
      });
    }
  }

  spawnExplosion(position: Point, color: string, radius: number, shockwaveSpeed = 1): void {
    if (this.host.headless) return;
    this.spawnFlash(position, "#fff1a8", Math.min(52, radius * 0.7));
    this.spawnRing(position, color, 0.5 / shockwaveSpeed, 10, radius);
    this.spawnRing(position, "#ffffff", 0.24 / shockwaveSpeed, 4, radius * 0.65);
    this.spawnRadialSpray(position, "#ffe477", "#e14c2d", 18, radius);
    this.spawnSmoke(position, "#545959", 9);
    for (let index = 0; index < 12; index += 1) this.spawnSpark(position, color, 80 + Math.random() * 150);
  }

  spawnCrossSlash(from: Point, to: Point, color: string, reach: number, secondaryColor = "#ffffff"): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    for (const offset of [-0.48, 0.48]) {
      const aim = { x: from.x + Math.cos(angle + offset) * reach, y: from.y + Math.sin(angle + offset) * reach };
      this.spawnSlash(from, aim, offset < 0 ? color : secondaryColor, reach, 0.38);
    }
    this.spawnFlash(from, color, 34, angle);
  }

  spawnShieldFlash(position: Point, color: string, radius: number): void {
    this.spawnRing(position, color, 0.42, 8, radius);
    this.spawnRing(position, "#ffffff", 0.25, 3, radius * 0.6);
    this.spawnFlash(position, color, 30);
  }

  spawnVanguardSmash(position: Point, color: string, radius = 82): void {
    if (this.host.headless) return;
    // Grounded shock rings and dust communicate blunt impact, separate from
    // the fiery radial treatment used by bombs.
    this.spawnRing(position, color, 0.24, 16, radius);
    this.spawnRing(position, "#fff1c2", 0.12, 6, radius * 0.58);
    this.spawnFlash(position, "#fff1c2", 28);
    this.spawnImpactDust(position, color);
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * TAU;
      const edge = { x: position.x + Math.cos(angle) * radius * 0.72, y: position.y + Math.sin(angle) * radius * 0.72 };
      this.spawnSpark(edge, color, 35 + Math.random() * 35);
    }
  }

  spawnCounterBurst(position: Point, color: string): void {
    this.spawnRing(position, color, 0.7, 10, 92);
    this.spawnRing(position, "#ffffff", 0.3, 4, 54);
    this.spawnFlash(position, color, 38);
  }

}
