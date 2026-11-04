import { describe, expect, it } from "vitest";
import { createCustomEnemy } from "../../game/customEnemies.ts";
import { createEnemyAbilityPreset } from "../../game/enemyAbilities.ts";
import { addEnemyAbilityPreset, duplicateEnemyAbility, enemyAbilityCardView, removeEnemyAbility, reorderEnemyAbility } from "./model.ts";

describe("enemy creator v4 model", () => {
  it("adds, reorders, deep duplicates, and deletes stable-ID cards", () => {
    const draft = createCustomEnemy(); addEnemyAbilityPreset(draft, "ranged"); addEnemyAbilityPreset(draft, "last-stand");
    const original = draft.abilities[0]!; expect(reorderEnemyAbility(draft, 0, 1)).toBe(true); expect(draft.abilities[1]?.id).toBe(original.id);
    const duplicate = duplicateEnemyAbility(draft, 1)!; expect(duplicate.id).not.toBe(original.id); expect(duplicate.actions[0]?.id).not.toBe(original.actions[0]?.id);
    expect(removeEnemyAbility(draft, 2)).toBe(true);
  });

  it("preserves advanced values when switching the persisted view mode", () => {
    const ability = { ...createEnemyAbilityPreset("wave"), editorMode: "advanced" as const, priority: 8, cooldown: 17 };
    const basic = { ...ability, editorMode: "basic" as const };
    expect(enemyAbilityCardView(basic)).toEqual(expect.objectContaining({ advanced: false }));
    expect(basic).toEqual(expect.objectContaining({ priority: 8, cooldown: 17 }));
  });
});
