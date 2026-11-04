import {
  cloneEnemyAbility,
  createEnemyAbilityPreset,
  enemyAbilityConditionsMatch,
  enemyAbilityTimeline,
  summarizeEnemyAbility,
  type EnemyAbilityEvaluationState,
  type EnemyAbilityPreset,
} from "../../game/enemyAbilities.ts";
import type { CustomEnemyDraftV4 } from "../../game/customEnemies.ts";
import type { EnemyAbilityDefinition } from "../../game/types.ts";

export const ENEMY_ABILITY_PRESETS: readonly EnemyAbilityPreset[] = [
  "ranged", "cone", "wave", "last-stand", "summoner", "regeneration", "haste", "phase", "blink", "shockwave",
];

export const addEnemyAbilityPreset = (draft: CustomEnemyDraftV4, preset: EnemyAbilityPreset): EnemyAbilityDefinition | null => {
  if (draft.abilities.length >= 64) return null;
  const ability = createEnemyAbilityPreset(preset);
  draft.abilities.push(ability);
  return ability;
};

export const duplicateEnemyAbility = (draft: CustomEnemyDraftV4, index: number): EnemyAbilityDefinition | null => {
  const source = draft.abilities[index];
  if (!source || draft.abilities.length >= 64) return null;
  const duplicate = { ...cloneEnemyAbility(source, true), name: `${source.name} Copy`.slice(0, 40) };
  draft.abilities.splice(index + 1, 0, duplicate);
  return duplicate;
};

export const reorderEnemyAbility = (draft: CustomEnemyDraftV4, index: number, offset: -1 | 1): boolean => {
  const next = index + offset;
  if (!draft.abilities[index] || next < 0 || next >= draft.abilities.length) return false;
  const [ability] = draft.abilities.splice(index, 1);
  if (!ability) return false;
  draft.abilities.splice(next, 0, ability);
  return true;
};

export const removeEnemyAbility = (draft: CustomEnemyDraftV4, index: number): boolean => {
  if (!draft.abilities[index]) return false;
  draft.abilities.splice(index, 1);
  return true;
};

export const abilityEligibleForPreview = (ability: EnemyAbilityDefinition, state: EnemyAbilityEvaluationState): boolean =>
  ability.enabled && enemyAbilityConditionsMatch(ability.conditions, state);

export const enemyAbilityCardView = (ability: EnemyAbilityDefinition): {
  readonly summary: string;
  readonly timeline: readonly { readonly at: number; readonly label: string }[];
  readonly advanced: boolean;
} => ({ summary: summarizeEnemyAbility(ability), timeline: enemyAbilityTimeline(ability), advanced: ability.editorMode === "advanced" });

export const titleEnemyAbilityPreset = (preset: EnemyAbilityPreset): string => preset.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
