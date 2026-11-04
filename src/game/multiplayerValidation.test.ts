import { HARD_MODE, NORMAL_MODE } from "./config.ts";
import { calculateOfficialRunReward } from "./runRewards.ts";
import { describe, expect, it } from "vitest";
import { makeTestSimulationConfig } from "./testSupport.ts";
import {
  isValidMultiplayerLobbyState,
  isValidMultiplayerResult,
  isValidMultiplayerSessionStart,
} from "./multiplayerValidation.ts";

const makeSession = () => {
  const config = makeTestSimulationConfig();
  return {
    id: config.sessionId,
    round: 1,
    map: config.map,
    mode: config.mode,
    customEnemies: config.customEnemies,
    allowedTowers: config.allowedTowers,
    players: config.players,
  };
};

const resultContext = (session: ReturnType<typeof makeSession>) => ({
  session,
  activeModeWaves: session.mode.waves.length,
  activeMapKind: session.map.kind,
  activeModeKind: session.mode.kind,
  activeModeIsCustom: session.mode.isCustom,
  activeMapIsCustom: session.map.isCustom,
  mapTestActive: false,
  rewardCoins: session.mode.reward.coins,
  rewardTokens: session.mode.reward.tokens,
  mapRewardMultiplier: session.map.rewardMultiplier,
});

describe("multiplayer payload validation", () => {
  it("accepts a complete session snapshot and matching lobby state", () => {
    const session = makeSession();
    expect(isValidMultiplayerSessionStart(session, session.id)).toBe(true);
    expect(isValidMultiplayerLobbyState({ id: session.id, round: 1, phase: "lobby", session, guestReady: false }, session.id)).toBe(true);
  });

  it("rejects malformed or oversized session content", () => {
    const session = makeSession();
    expect(isValidMultiplayerSessionStart({ ...session, id: "wrong-room" }, session.id)).toBe(false);
    expect(isValidMultiplayerSessionStart({ ...session, mode: { ...session.mode, description: "bad\u0000content" } }, session.id)).toBe(false);
    expect(isValidMultiplayerSessionStart({ ...session, players: [...session.players, session.players[0]] }, session.id)).toBe(false);
    expect(isValidMultiplayerLobbyState({ id: session.id, round: 2, phase: "lobby", session, guestReady: false }, session.id)).toBe(false);
  });

  it("accepts only result amounts derived from the active session", () => {
    const session = makeSession();
    const context = resultContext(session);
    const wave = session.mode.waves.length;
    const valid = {
      id: `${session.id}:${session.round}:victory:${wave}`,
      round: session.round,
      victory: true,
      wave,
      coins: session.mode.reward.coins,
      tokens: session.mode.reward.tokens,
      official: true,
      mapKind: session.map.kind,
      modeKind: session.mode.kind,
    };
    expect(isValidMultiplayerResult(valid, context)).toBe(true);
    expect(isValidMultiplayerResult({ ...valid, coins: valid.coins + 1 }, context)).toBe(false);
    expect(isValidMultiplayerResult({ ...valid, id: `${session.id}:2:victory:${wave}`, round: 2 }, context)).toBe(false);
  });
});

it("accepts canonical defeat rewards including Hard's zero tokens", () => {
  for (const mode of [NORMAL_MODE, HARD_MODE]) {
    const session = { ...makeSession(), mode };
    const wave = 20;
    const reward = calculateOfficialRunReward(false, wave, mode, session.map.rewardMultiplier);
    expect(isValidMultiplayerResult({
      id: `${session.id}:${session.round}:defeat:${wave}`, round: session.round,
      victory: false, official: true, wave, ...reward,
      mapKind: session.map.kind, modeKind: mode.kind,
    }, resultContext(session))).toBe(true);
  }
});
