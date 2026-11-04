import { describe, expect, it } from "vitest";
import { createCustomEnemy } from "../../game/customEnemies.ts";
import { createEnemyAbilityPreset } from "../../game/enemyAbilities.ts";
import type { EnemyAbilityDefinition } from "../../game/types.ts";
import { EnemyAbilityLab } from "./lab.ts";

const immediate = (ability: EnemyAbilityDefinition): EnemyAbilityDefinition => ability.trigger.type === "interval" ? { ...ability, cooldown: 0, trigger: { ...ability.trigger, initialDelay: 0 } } : ability;

describe("deterministic enemy ability lab", () => {
  it("keeps due intervals armed until path and target requirements pass", () => {
    const draft = createCustomEnemy(); draft.speed = 60; draft.abilities = [immediate(createEnemyAbilityPreset("blink"))];
    const lab = new EnemyAbilityLab(draft);
    for (let tick = 0; tick < 25; tick += 1) lab.step();
    expect(lab.runtimeState.entries[draft.abilities[0]!.id]?.uses).toBe(1);
    expect(lab.state.pathDistance).toBeGreaterThan(120);
  });

  it("resolves priority and exclusive groups deterministically", () => {
    const draft = createCustomEnemy(); draft.speed = 0;
    const lower = { ...createEnemyAbilityPreset("blink"), id: "ability-exclusive-low", trigger: { type: "spawn" as const }, priority: 1, exclusiveGroup: "phase", conditions: [], actions: [{ id: "action-exclusive-low", type: "blink" as const, delay: 0, distance: 10 }] };
    const higher = { ...lower, id: "ability-exclusive-high", priority: 9, actions: [{ id: "action-exclusive-high", type: "blink" as const, delay: 0, distance: 30 }] };
    draft.abilities = [lower, higher]; const lab = new EnemyAbilityLab(draft); lab.step();
    expect(lab.state.pathDistance).toBe(30);
    expect(lab.runtimeState.entries[higher.id]?.uses).toBe(1);
    expect(lab.runtimeState.entries[lower.id]?.uses).toBe(0);
  });

  it("records commands, checkpoints, scrub replay, and truncates future edits", () => {
    const draft = createCustomEnemy(); draft.abilities = [createEnemyAbilityPreset("last-stand")]; const lab = new EnemyAbilityLab(draft);
    for (let tick = 0; tick < 90; tick += 1) lab.step();
    lab.command({ type: "hp", value: 20 }); lab.step(); const traceCount = lab.traces.length;
    lab.scrub(30); expect(lab.state.tick).toBe(30);
    lab.command({ type: "hp", value: 80 });
    expect(lab.maxTick).toBe(30);
    expect(lab.commands.every((command) => command.tick <= 30)).toBe(true);
    expect(lab.traces.length).toBeLessThanOrEqual(traceCount);
  });

  it("uses captured context for delayed death summons and diagnoses self-only death actions", () => {
    const draft = createCustomEnemy();
    const death = { ...createEnemyAbilityPreset("summoner"), id: "ability-death-summon", trigger: { type: "death" as const }, actions: [{ ...createEnemyAbilityPreset("summoner").actions[0] as any, id: "action-death-summon", delay: .2 }] };
    const self = { ...createEnemyAbilityPreset("last-stand"), id: "ability-death-self", trigger: { type: "death" as const }, actions: [{ id: "action-death-self", type: "invulnerability" as const, delay: 0, duration: 2 }] };
    draft.abilities = [death, self]; const lab = new EnemyAbilityLab(draft); lab.command({ type: "hp", value: 0 });
    for (let tick = 0; tick < 8; tick += 1) lab.step();
    expect(lab.state.summons).toBe(2);
    expect(lab.traces).toEqual(expect.arrayContaining([expect.objectContaining({ actionId: "action-death-self", code: "action-ineffective" })]));
  });

  it("bounds history to 300 seconds", () => {
    const draft = createCustomEnemy(); const lab = new EnemyAbilityLab(draft);
    for (let tick = 0; tick < 9_100; tick += 1) lab.step();
    expect(lab.state.tick).toBe(9_000);
  });
});
