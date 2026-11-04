import { clamp, distance } from "../math.ts";
import type { TowerAttackBehaviorContext, TowerBehavior, TowerDashTarget } from "./types.ts";

const MAX_DASH_CANDIDATES = 64;

const pointSegmentDistance = (point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(point, start);
  const amount = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return distance(point, { x: start.x + dx * amount, y: start.y + dy * amount });
};

const performPhaseDash = (context: TowerAttackBehaviorContext): boolean => {
  const { tower } = context;
  const start = { ...tower.position };
  const visibleEnemies = context.nearbyEnemies(context.range * 1.35);
  if (visibleEnemies.length === 0) return false;

  const primary = context.selectTarget(visibleEnemies.map(({ enemy }) => enemy));
  const primaryData = visibleEnemies.find(({ enemy }) => enemy.id === primary?.id);
  const primaryPathDistance = primaryData
    ? context.closestPathDistance(primary?.pathIndex, primaryData.position)
    : tower.pathDistance;
  const offPathCandidates: Array<ReturnType<TowerAttackBehaviorContext["placementAt"]>> = [];
  const pathCandidates: Array<ReturnType<TowerAttackBehaviorContext["placementAt"]>> = [];
  const addCandidate = (position: { x: number; y: number }, fallback: boolean): void => {
    const placement = context.placementAt(position, tower.id);
    const jumpDistance = distance(start, placement.position);
    if (!placement.valid || jumpDistance < 54 || jumpDistance > context.range * 1.35) return;
    const candidates = fallback ? pathCandidates : offPathCandidates;
    if (
      candidates.length < MAX_DASH_CANDIDATES &&
      placement.onPath === fallback &&
      candidates.every((other) => distance(other.position, placement.position) >= 28)
    ) candidates.push(placement);
  };

  visibleEnemies.forEach(({ enemy, position }) => {
    const enemyPathDistance = context.closestPathDistance(enemy.pathIndex, position);
    [-240, -120, 0, 120, 240].forEach((offset) => {
      const samplePath = context.samplePath(enemy.pathIndex, clamp(
        enemyPathDistance + offset,
        150,
        context.samplePath(enemy.pathIndex, enemyPathDistance).totalLength - 150,
      ));
      const normal = { x: -samplePath.direction.y, y: samplePath.direction.x };
      [-1, 1].forEach((side) => {
        [86, 126, 170].forEach((lateralDistance) => {
          addCandidate({
            x: samplePath.point.x + normal.x * side * lateralDistance,
            y: samplePath.point.y + normal.y * side * lateralDistance,
          }, false);
        });
      });
    });
  });

  const primaryPath = context.samplePath(primary?.pathIndex ?? tower.pathIndex, primaryPathDistance);
  [-540, -420, -300, -240, -180, -120, -60, 0, 60, 120, 180, 240, 300, 420, 540].forEach((offset) => {
    const landing = context.samplePath(
      primary?.pathIndex ?? tower.pathIndex,
      clamp(primaryPathDistance + offset, 150, primaryPath.totalLength - 150),
    );
    addCandidate(landing.point, true);
  });

  const chooseBest = (candidates: readonly ReturnType<typeof context.placementAt>[], fallback: boolean): {
    readonly placement: ReturnType<typeof context.placementAt>;
    readonly hits: TowerDashTarget[];
    readonly score: number;
  } | null => {
    let best: {
      readonly placement: ReturnType<typeof context.placementAt>;
      readonly hits: TowerDashTarget[];
      readonly score: number;
    } | null = null;
    for (const placement of candidates) {
      const jumpDistance = distance(start, placement.position);
      const corridor = tower.level >= 3 ? 24 : 17;
      const hits: TowerDashTarget[] = [];
      let nearestEnemyDistance = Number.POSITIVE_INFINITY;
      visibleEnemies.forEach((target) => {
        const candidateDistance = distance(placement.position, target.position);
        if (fallback) nearestEnemyDistance = Math.min(nearestEnemyDistance, candidateDistance);
        if (pointSegmentDistance(target.position, start, placement.position) <= target.radius + corridor) hits.push(target);
      });
      if (hits.length === 0) continue;
      const primaryHit = primary ? hits.some(({ enemy }) => enemy.id === primary.id) : false;
      const hitHealth = hits.reduce((total, target) => total + Math.min(target.enemy.hp, 1_000), 0);
      const score = (primaryHit ? 100_000 : 0) + hits.length * 7_000 + hitHealth
        - Math.abs(placement.pathDistance - primaryPathDistance) * 0.08
        + (fallback ? jumpDistance * 2.4 + nearestEnemyDistance * 1.6 : -jumpDistance * 0.35);
      if (!best || score > best.score) best = { placement, hits, score };
    }
    return best;
  };

  const best = chooseBest(offPathCandidates, false) ?? chooseBest(pathCandidates, true);
  if (!best) return false;

  best.hits.forEach(({ enemy }) => {
    context.damageEnemy(enemy, context.damage);
    context.spawnImpactDust(context.enemyPosition(enemy));
  });
  context.commitRelocation(best.placement);
  tower.selectedPulse = 1;
  tower.counterFlash = 0.45;
  const jumpDistance = distance(start, best.placement.position);
  context.spawnDashTrail(start, best.placement.position, context.accent, jumpDistance);
  context.emitSimulationEvent({
    kind: "dash",
    entityId: tower.id,
    position: { ...best.placement.position },
    from: start,
    color: context.accent,
    value: jumpDistance,
    label: tower.kind,
  });
  context.spawnText(best.placement.position, `PHASE DASH // ${best.placement.onPath ? "PATH FALLBACK" : "OFF-PATH"} // ${best.hits.length}`);
  context.playAttackSound();
  context.addShake(0.08);
  return true;
};

export const WRAITH_BEHAVIOR: TowerBehavior = {
  counterName: "PHASE CUT",

  drawWorld: ({ tower, context, accent, elapsed }) => {
    context.save();
    context.beginPath();
    context.arc(tower.position.x, tower.position.y, 30 + Math.sin(elapsed * 9 + tower.id) * 3, 0, Math.PI * 2);
    context.strokeStyle = `${accent}88`;
    context.lineWidth = 1.5 + (tower.burstShotsRemaining > 0 ? 1.5 : 0);
    context.setLineDash([3, 6]);
    context.lineDashOffset = -elapsed * 22;
    context.stroke();
    context.setLineDash([]);
    context.restore();
  },

  presentEvent: (context) => {
    const { event, position, color } = context;
    if (event.kind === "dash" && event.from && position) {
      context.spawnWraithDashTrail(event.from, position, color, event.value ?? 0);
      context.playShoot(280, "blade");
      return true;
    }
    if (event.kind === "flurry" && position) {
      context.spawnWraithFlurry(position, color, event.value ?? 170);
      return true;
    }
    if (event.kind === "flurry-pulse" && position) {
      context.spawnWraithFlurrySlashes(position, color, event.value ?? 170);
      return true;
    }
    if (event.kind === "cross-slash" && event.from && position) {
      context.spawnCrossSlash(event.from, position, color, event.value ?? 90, color);
      return true;
    }
    return false;
  },

  onEnemyKilled: ({ tower, healing, spawnText, spawnRing }) => {
    tower.hp += healing;
    spawnText(`+${Math.ceil(healing)} HP`);
    spawnRing();
  },

  beforeAttack: (context) => {
    if (context.tower.abilityTimer > 0) {
      if (context.tower.meleeTimer <= 0) {
        const radius = context.tower.level >= 5 ? 210 : context.tower.level >= 4 ? 180 : 155;
        const victims = context.areaTargets(radius);
        const slashDamage = context.baseDamage * (context.tower.level >= 5 ? 0.7 : 0.55) * context.tower.damageBuff;
        victims.forEach((enemy) => context.damageEnemy(enemy, slashDamage));
        context.emitWraithFlurryPulse(radius, victims.length);
        context.tower.focus = Math.max(0, context.tower.focus - 1);
        if (context.tower.focus === 0) context.tower.abilityTimer = 0;
        if (victims.length > 0) context.spawnText(context.tower.position, `FLURRY SLASH // ${victims.length}`);
        context.tower.meleeTimer = 0.3;
      }
      return true;
    }
    if (context.tower.burstShotsRemaining <= 0) return false;
    context.tower.burstTimer -= context.delta;
    if (context.tower.burstTimer > 0) return true;
    const target = context.selectTarget(context.candidates);
    if (!target) {
      context.tower.burstTimer = 0.05;
      return true;
    }
    context.tower.burstTargetId = target.id;
      if (!performPhaseDash(context)) {
      context.tower.burstShotsRemaining = 0;
      context.tower.burstTargetId = null;
      context.tower.burstSpacing = 0;
    } else {
      context.tower.burstShotsRemaining -= 1;
      if (context.tower.burstShotsRemaining > 0) context.tower.burstTimer = context.tower.burstSpacing;
      else {
        context.tower.burstTargetId = null;
        context.tower.burstSpacing = 0;
      }
    }
    return true;
  },

  attack: (context) => {
    if (!performPhaseDash(context)) return;
    const dashCount = context.tower.level >= 5 ? 4 : context.tower.level >= 4 ? 3 : context.tower.level >= 2 ? 2 : 1;
    const dashSpacing = context.burstSpacingCooldown(
      context.tower.level >= 5 ? 0.24 : context.tower.level >= 4 ? 0.28 : 0.32,
    );
    context.tower.burstShotsRemaining = dashCount - 1;
    context.tower.burstSpacing = dashSpacing;
    context.tower.burstTimer = context.tower.burstShotsRemaining > 0 ? dashSpacing : 0;
    context.tower.fireTimer = context.fireRateCooldown(context.fireRate) + context.tower.burstShotsRemaining * context.tower.burstSpacing;
    context.tower.idleTimer = 0;
  },

  counter: (context) => {
    context.victims.forEach((enemy) => {
      context.damageEnemy(enemy, context.damage * (context.tower.level >= 4 ? 3 : 2));
      context.emitSlashVisual(enemy, 110, 0.48);
    });
    context.emitWraithCounterVisual();
  },

  ability: (context) => {
    if (context.slot !== "f") return;
    if (context.tower.abilityCooldown > 0) {
      context.spawnAbilityText(context.tower.position, `FLURRY ${context.tower.abilityCooldown.toFixed(1)}s`, "#9ba1a3");
      context.failAbility();
      return false;
    }
    const radius = context.tower.level >= 5 ? 210 : context.tower.level >= 4 ? 180 : 155;
    context.tower.abilityTimer = 3;
    context.tower.focus = 10;
    context.tower.meleeTimer = 0;
    context.tower.abilityCooldown = 60;
    if (context.tower.abilityCooldowns) context.tower.abilityCooldowns.f = 60;
    context.tower.counterFlash = 0.9;
    context.emitWraithFlurryStart(radius);
    context.log("Wraith unleashed Crimson Flurry // repeated area slashes incoming.");
    context.playAbilitySound();
  },
};
