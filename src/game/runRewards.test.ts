import { describe, expect, it } from "vitest";
import { HARD_MODE, NORMAL_MODE } from "./config.ts";
import { calculateOfficialRunReward } from "./runRewards.ts";

describe("official run rewards", () => {
  it("makes near-complete Hard defeats pay close to the clear reward without tokens", () => {
    expect(calculateOfficialRunReward(false, 29, HARD_MODE, 1)).toEqual({ coins: 400, tokens: 0 });
    expect(calculateOfficialRunReward(false, 30, HARD_MODE, 1)).toEqual({ coins: 414, tokens: 0 });
    expect(calculateOfficialRunReward(true, 30, HARD_MODE, 1)).toEqual({ coins: 460, tokens: 0 });
  });

  it("keeps the legacy floor for early failures and Normal token recovery", () => {
    expect(calculateOfficialRunReward(false, 1, HARD_MODE, 1)).toEqual({ coins: 18, tokens: 0 });
    expect(calculateOfficialRunReward(false, 20, NORMAL_MODE, 1)).toEqual({ coins: 180, tokens: 1 });
  });
});
