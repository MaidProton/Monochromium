export const TOWER_HEALTH_BAR_HOLD_MS = 1_500;
export const TOWER_HEALTH_BAR_FADE_MS = 500;

/** Green at full health, yellow at half health, and red at zero health. */
export const towerHealthBarColor = (healthRatio: number): string => {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(healthRatio) ? healthRatio : 0));
  return `hsl(${ratio * 120}, 85%, 50%)`;
};

export interface TowerHealthObservation {
  readonly id: number;
  readonly hp: number;
  readonly maxHp: number;
}

interface TrackedTowerHealth {
  hp: number;
  maxHp: number;
  lastDamagedAt: number | null;
}

export const towerHealthBarOpacity = (
  selected: boolean,
  hovered: boolean,
  lastDamagedAt: number | null,
  now: number,
): number => {
  if (selected || hovered) return 1;
  if (lastDamagedAt === null || now < lastDamagedAt) return 0;
  const elapsed = now - lastDamagedAt;
  if (elapsed <= TOWER_HEALTH_BAR_HOLD_MS) return 1;
  if (elapsed >= TOWER_HEALTH_BAR_HOLD_MS + TOWER_HEALTH_BAR_FADE_MS) return 0;
  return 1 - (elapsed - TOWER_HEALTH_BAR_HOLD_MS) / TOWER_HEALTH_BAR_FADE_MS;
};

/** Presentation-only damage history used to reveal contextual tower health bars. */
export class TowerHealthBarTracker {
  private readonly towers = new Map<number, TrackedTowerHealth>();

  opacityFor(
    tower: TowerHealthObservation,
    now: number,
    selected: boolean,
    hovered: boolean,
  ): number {
    const previous = this.towers.get(tower.id);
    let lastDamagedAt = previous?.lastDamagedAt ?? null;
    if (previous) {
      if (tower.maxHp !== previous.maxHp) lastDamagedAt = null;
      else if (tower.hp < previous.hp) lastDamagedAt = now;
    }
    this.towers.set(tower.id, { hp: tower.hp, maxHp: tower.maxHp, lastDamagedAt });
    return towerHealthBarOpacity(selected, hovered, lastDamagedAt, now);
  }

  retain(activeTowerIds: ReadonlySet<number>): void {
    this.towers.forEach((_value, id) => {
      if (!activeTowerIds.has(id)) this.towers.delete(id);
    });
  }

  clear(): void {
    this.towers.clear();
  }
}
