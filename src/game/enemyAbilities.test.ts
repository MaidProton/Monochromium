import { describe, expect, it } from "vitest";
import { createCustomEnemy, sanitizeCustomEnemies, validateCustomEnemyDraft } from "./customEnemies.ts";
import { cloneEnemyAbility, createEnemyAbilityPreset, enemyAbilityTimeline, normalizeEnemyAbilities, validateEnemyAbilities } from "./enemyAbilities.ts";
import type { EnemyAbilityDefinition, EnemyDefinition } from "./types.ts";

describe("enemy ability contracts", () => {
  it("creates the documented attack and utility preset defaults", () => {
    expect(createEnemyAbilityPreset("ranged")).toEqual(expect.objectContaining({
      editorMode: "basic", trigger: { type: "interval", every: 8, initialDelay: 8 },
      attack: expect.objectContaining({ range: 220, maxTargets: 1, telegraphDuration: .4, impactTime: .4, targetLock: "activation" }),
      actions: [expect.objectContaining({ type: "damage", amount: 20 })],
    }));
    expect(createEnemyAbilityPreset("last-stand")).toEqual(expect.objectContaining({ maxUses: 1, trigger: { type: "hp-threshold", direction: "below", threshold: { unit: "percent", value: 25 } } }));
    expect(createEnemyAbilityPreset("summoner").actions[0]).toEqual(expect.objectContaining({ type: "summon", count: 2, kinds: ["dummy"] }));
    expect(createEnemyAbilityPreset("regeneration").actions[0]).toEqual(expect.objectContaining({ type: "regeneration", mode: "rate", amount: 5, duration: null }));
  });

  it("deep duplicates every stable child id without resetting hidden advanced values", () => {
    const source = { ...createEnemyAbilityPreset("ranged"), editorMode: "advanced" as const, priority: 7, exclusiveGroup: "attack-cycle", cooldown: 12 };
    const duplicate = cloneEnemyAbility(source, true);
    expect(duplicate).toEqual(expect.objectContaining({ editorMode: "advanced", priority: 7, exclusiveGroup: "attack-cycle", cooldown: 12 }));
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.actions[0]?.id).not.toBe(source.actions[0]?.id);
    expect(duplicate.attack?.visuals[0]?.id).not.toBe(source.attack?.visuals[0]?.id);
  });

  it("orders target action delays from impact and world actions from activation", () => {
    const ability: EnemyAbilityDefinition = {
      ...createEnemyAbilityPreset("ranged"),
      actions: [
        { id: "action-damage-delay", type: "damage", delay: .2, amount: 10 },
        { id: "action-blink-delay", type: "blink", delay: .2, distance: 30 },
      ],
    };
    const timeline = enemyAbilityTimeline(ability);
    expect(timeline.find((item) => item.label.includes("blink"))?.at).toBeCloseTo(.2);
    expect(timeline.find((item) => item.label.includes("damage"))?.at).toBeCloseTo(.6);
  });

  it("returns stable blocking codes for malformed IDs, timing, visuals, actions, and missing attacks", () => {
    const malformed = {
      ...createEnemyAbilityPreset("ranged"), id: "?", cooldown: Number.NaN, attack: null,
      actions: [{ id: "duplicate-action", type: "damage", delay: -1, amount: Number.POSITIVE_INFINITY }, { id: "duplicate-action", type: "damage", delay: 0, amount: 2 }],
    } as unknown as EnemyAbilityDefinition;
    const issues = validateEnemyAbilities([malformed], { maxHp: 100 });
    expect(issues.filter((issue) => issue.severity === "error").map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "ability-id-malformed", "value-malformed", "attack-missing", "action-delay-unsafe", "action-value-malformed", "action-id-duplicate",
    ]));
  });

  it("blocks transitive summon cycles while keeping unknown references as warnings", () => {
    const left = createCustomEnemy(); const right = createCustomEnemy();
    left.abilities = [{ ...createEnemyAbilityPreset("summoner"), actions: [{ ...createEnemyAbilityPreset("summoner").actions[0] as Extract<ReturnType<typeof createEnemyAbilityPreset>["actions"][number], { type: "summon" }>, kinds: [right.id] }] }];
    right.abilities = [{ ...createEnemyAbilityPreset("summoner"), actions: [{ ...createEnemyAbilityPreset("summoner").actions[0] as Extract<ReturnType<typeof createEnemyAbilityPreset>["actions"][number], { type: "summon" }>, kinds: [left.id, "custom-enemy:not-installed"] }] }];
    const issues = validateCustomEnemyDraft(left, [right]);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "summon-cycle", severity: "error" })]));
    expect(validateCustomEnemyDraft(right, []).some((issue) => issue.code === "summon-reference-missing" && issue.severity === "warning")).toBe(true);
  });

  it("memoizes official legacy compilation and gives imported attacks instant compatibility timing", () => {
    const definition: EnemyDefinition = {
      kind: "dummy", name: "Legacy", hp: 100, shieldHp: 0, speed: 1, damage: 1, attackInterval: 1, telegraphDuration: .5, coreDamage: 1, radius: 10,
      attacks: [{ id: "attack-official-test", name: "Attack", cooldown: 2, maxUses: 0, minHp: null, maxHp: null, minAliveTime: null, maxAliveTime: null, targeting: "first", range: 100, maxTargets: 1, delivery: "ranged", width: 10, depth: 10, angle: 30, projectileSpeed: 300, effects: [{ type: "damage", amount: 3 }], visuals: [] }],
      sprite: { shape: "circle", fill: "#ffffff", stroke: "#ffffff", accent: "#ffffff", glyph: "L" },
    };
    const first = normalizeEnemyAbilities(definition); const second = normalizeEnemyAbilities(definition);
    expect(first).toBe(second);
    expect(first[0]?.attack).toEqual(expect.objectContaining({ telegraphDuration: 0, impactTime: 0 }));
  });
});

it("ignores malformed legacy fields on v4 enemies", () => {
  for (const behaviorRules of [{}, [null], [{ actions: {} }]]) {
    expect(sanitizeCustomEnemies([{ ...createCustomEnemy(), behaviorRules }])).toHaveLength(1);
  }
});
