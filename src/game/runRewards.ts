import type { ModeDefinition } from "./types.ts";

/** Calculate profile rewards for an official run that has already ended. */
export const calculateOfficialRunReward = (
  victory: boolean,
  wave: number,
  mode: ModeDefinition,
  mapRewardMultiplier: number,
): { coins: number; tokens: number } => {
  const progressRatio = Math.min(1, Math.max(0, wave / mode.waves.length));
  const legacyRecoveryCoins = 15 + 75 * progressRatio;
  const completionRecoveryCoins = mode.reward.coins * progressRatio * 0.9;
  const coins = victory
    ? Math.round(mode.reward.coins * mapRewardMultiplier)
    : Math.round(Math.max(legacyRecoveryCoins, completionRecoveryCoins) * mapRewardMultiplier);
  const tokens = mode.kind === "hard" ? 0 : victory ? mode.reward.tokens : wave >= 20 ? 1 : 0;
  return { coins, tokens };
};
