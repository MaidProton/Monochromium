import { getEnemyDefinition } from "./enemyRegistry.ts";
import type { MapDefinition, ModeDefinition, EnemyKind } from "./types.ts";

export const WAVE_INTERMISSION_SECONDS = 3;
export const WAVE_SKIP_DELAY_AFTER_SPAWN_SECONDS = 10;

export interface WaveSpawn {
  readonly kind: EnemyKind;
  readonly spawnAt: number;
  readonly hp: number;
  readonly pathIndex: number;
}

export interface WaveSpawnPlan {
  readonly entries: readonly WaveSpawn[];
  readonly duration: number;
}

interface ScheduledEnemy {
  readonly kind: EnemyKind;
  readonly spawnAt: number;
  readonly spawnPathIndex?: number;
}

const scheduleWaveEnemies = (mode: ModeDefinition, waveIndex: number): ScheduledEnemy[] => {
  const definition = mode.waves[waveIndex];
  if (!definition) return [];

  const enemies: ScheduledEnemy[] = [];
  if (definition.blocks) {
    let blockStart = 0.12;
    definition.blocks.forEach((block) => {
      if (block.command === "enemyGroup") {
        for (let index = 0; index < block.count; index += 1) {
          enemies.push({
            kind: block.enemy,
            spawnAt: blockStart + index * block.spawnDelay,
            ...(typeof block.spawnPathIndex === "number" && block.spawnPathIndex >= 0
              ? { spawnPathIndex: block.spawnPathIndex }
              : {}),
          });
        }
      }
      blockStart += block.nextBlockDelay;
    });
    return enemies;
  }

  let spawnAt = 0.12;
  const groups = definition.groups ?? [];
  groups.forEach((group, groupIndex) => {
    for (let index = 0; index < group.count; index += 1) {
      enemies.push({ kind: group.kind, spawnAt });
      if (index < group.count - 1) spawnAt += group.gap;
    }
    if (groupIndex < groups.length - 1) spawnAt += 1.65;
  });
  return enemies;
};

/** Builds the authoritative spawn schedule for one mode wave. */
export const buildWaveSpawnPlan = (
  mode: ModeDefinition,
  map: MapDefinition,
  waveIndex: number,
  pathCount: number,
): WaveSpawnPlan => {
  const waveEnemies = scheduleWaveEnemies(mode, waveIndex);
  const routeCount = Math.max(1, pathCount);
  let splitIndex = 0;
  const routedEnemies: Array<{ kind: EnemyKind; spawnAt: number; pathIndex: number }> = [];

  for (const enemy of waveEnemies) {
    if (typeof enemy.spawnPathIndex === "number" && enemy.spawnPathIndex >= 0) {
      const pathIndex = Math.max(0, Math.min(enemy.spawnPathIndex, routeCount - 1));
      routedEnemies.push({ ...enemy, pathIndex });
    } else if (map.paths.length > 1 && map.enemyRouting === "multiply") {
      for (let pathIndex = 0; pathIndex < routeCount; pathIndex += 1) {
        routedEnemies.push({
          ...enemy,
          pathIndex,
          spawnAt: enemy.spawnAt + pathIndex * 0.025,
        });
      }
    } else {
      const pathIndex = splitIndex % routeCount;
      splitIndex += 1;
      routedEnemies.push({ ...enemy, pathIndex });
    }
  }

  const entries = routedEnemies
    .sort((left, right) => left.spawnAt - right.spawnAt)
    .map((enemy) => ({
      ...enemy,
      hp: getEnemyDefinition(enemy.kind).hp,
    }));
  return {
    entries,
    duration: entries.reduce((latest, enemy) => Math.max(latest, enemy.spawnAt), 0),
  };
};

export const spawnDurationForWave = (
  mode: ModeDefinition,
  map: MapDefinition,
  waveIndex: number,
  pathCount: number,
): number => buildWaveSpawnPlan(mode, map, waveIndex, pathCount).duration;
