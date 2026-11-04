import { describe, expect, it } from "vitest";
import { captureDraftBaseline, getPauseMenuPolicy, hasDraftChanged } from "./interactionPolicy.ts";

describe("pause menu ownership", () => {
  it("pauses solo and creator tests on open and resumes them on close", () => {
    expect(getPauseMenuPolicy(false, false)).toEqual({
      pausesSimulationOnOpen: true,
      autoPaused: true,
      matchContinues: false,
      resumeSimulationOnClose: true,
    });
    expect(getPauseMenuPolicy(false, true).autoPaused).toBe(false);
  });

  it("never auto-pauses the shared multiplayer simulation", () => {
    expect(getPauseMenuPolicy(true, false)).toEqual({
      pausesSimulationOnOpen: false,
      autoPaused: false,
      matchContinues: true,
      resumeSimulationOnClose: false,
    });
    expect(getPauseMenuPolicy(true, true).matchContinues).toBe(false);
  });
});

describe("creator draft baselines", () => {
  it("only reports changes after the captured draft diverges", () => {
    const draft = { name: "Mode", waves: [{ count: 4 }] };
    const baseline = captureDraftBaseline(draft);
    expect(hasDraftChanged(draft, baseline)).toBe(false);
    draft.waves[0]!.count = 5;
    expect(hasDraftChanged(draft, baseline)).toBe(true);
  });

  it("does not warn for absent drafts or baselines", () => {
    expect(hasDraftChanged(null, "")).toBe(false);
    expect(hasDraftChanged({ name: "Draft" }, "")).toBe(false);
  });
});
