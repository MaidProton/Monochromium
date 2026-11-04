export interface BossHudEntry {
  readonly id: number;
}

export const MAX_VISIBLE_BOSS_BARS = 3;

export const visibleBossHudEntries = <T extends BossHudEntry>(
  bosses: readonly T[],
  dismissedBossIds: ReadonlySet<number>,
  maxVisible = MAX_VISIBLE_BOSS_BARS,
): readonly T[] => bosses
  .filter((boss) => !dismissedBossIds.has(boss.id))
  .slice(0, Math.max(0, maxVisible));

export const dismissBossHudEntry = (
  dismissedBossIds: ReadonlySet<number>,
  bossId: number,
): Set<number> => new Set(dismissedBossIds).add(bossId);
