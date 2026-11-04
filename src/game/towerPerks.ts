import { TOWER_DEFINITIONS, TOWER_PERK_DEFINITIONS } from "./config.ts";
import { getTowerAbility, type Tower, type TowerAbilityDefinition, type TowerAbilitySlot, type TowerDefinition, type TowerPerkKind } from "./types.ts";

const levelIndex = (level: number): number => Math.max(0, Math.min(5, Math.floor(level)));
const MUTINY_UNLOCK_LEVEL = TOWER_DEFINITIONS.mercenary.ability?.unlockLevel ?? 0;

export const towerHasPerk = (tower: Pick<Tower, "perks"> | { readonly perks?: readonly TowerPerkKind[] }, kind: TowerPerkKind): boolean =>
  Boolean(tower.perks?.includes(kind));

export const getTowerPerk = (tower: Pick<Tower, "perks"> | { readonly perks?: readonly TowerPerkKind[] }, kind: TowerPerkKind) =>
  towerHasPerk(tower, kind) ? TOWER_PERK_DEFINITIONS[kind] : undefined;

export const mutinyIsUnlocked = (tower: Pick<Tower, "kind" | "level" | "perks">): boolean =>
  tower.kind === "mercenary" && tower.level >= MUTINY_UNLOCK_LEVEL && towerHasPerk(tower, "mutiny");

export const getTowerPerkDamageMultiplier = (tower: Pick<Tower, "kind" | "level" | "perks">): number =>
  towerHasPerk(tower, "glass-cannon") && tower.kind === "admiral"
    ? glassCannonEffect().damageMultiplier
    : towerHasPerk(tower, "cold-chamber") && tower.kind === "gunner"
      ? coldChamberEffect().damageMultiplier
      : mutinyIsUnlocked(tower)
        ? mutinyEffect().damageMultiplier
        : 1;

export const getTowerPerkAttackIntervalMultiplier = (tower: Pick<Tower, "kind" | "perks">): number =>
  towerHasPerk(tower, "glass-cannon") && tower.kind === "admiral"
    ? glassCannonEffect().attackIntervalMultiplier
    : 1;

export const getTowerPerkSplashMultiplier = (tower: Pick<Tower, "kind" | "perks">): number =>
  towerHasPerk(tower, "glass-cannon") && tower.kind === "admiral"
    ? glassCannonEffect().splashMultiplier
    : 1;

export const getEffectiveTowerSplash = (tower: Pick<Tower, "kind" | "perks">, splash: number | undefined): number =>
  (splash ?? 0) * getTowerPerkSplashMultiplier(tower);

export const getHighNoonEffect = (level: number) => {
  const definition = TOWER_PERK_DEFINITIONS["high-noon"];
  const effect = definition.effect;
  if (effect.type !== "high-noon") throw new Error("High Noon perk definition is malformed.");
  const index = levelIndex(level);
  return {
    ...effect,
    damageBonus: effect.damageBonusByLevel[index] ?? 0,
    fireRateBonus: effect.fireRateBonusByLevel[index] ?? 0,
    duration: effect.durationByLevel[index] ?? 0,
  };
};

export const getBackdraftEffect = () => {
  const effect = TOWER_PERK_DEFINITIONS.backdraft.effect;
  if (effect.type !== "backdraft") throw new Error("Backdraft perk definition is malformed.");
  return effect;
};

export const getTowerAbilityWithPerks = (
  definition: TowerDefinition,
  perks: readonly TowerPerkKind[] | undefined,
  slot: TowerAbilitySlot,
): TowerAbilityDefinition | undefined => {
  if (definition.kind === "mercenary" && slot === "f" && perks?.includes("mutiny")) return undefined;
  const base = getTowerAbility(definition, slot);
  if (definition.kind === "bandit" && slot === "f" && perks?.includes("high-noon")) {
    return getHighNoonAbility();
  }
  return base;
};

export const getColdChamberEffect = () => {
  const effect = TOWER_PERK_DEFINITIONS["cold-chamber"].effect;
  if (effect.type !== "cold-chamber") throw new Error("Cold Chamber perk definition is malformed.");
  return effect;
};

export const getMutinyEffect = (level: number, baseDps: number) => {
  const effect = mutinyEffect();
  const index = Math.max(0, Math.min(effect.killTargetByLevel.length - 1, Math.floor(level)));
  return {
    ...effect,
    killTarget: effect.killTargetByLevel[index] ?? effect.killTargetByLevel[0] ?? 1,
    damageBonus: effect.damageBonusByLevel[index] ?? effect.damageBonusByLevel[0] ?? 0,
    duration: effect.durationByLevel[index] ?? effect.durationByLevel[0] ?? 0,
    damageThreshold: Math.max(0.01, baseDps) * effect.damageTriggerSeconds,
  };
};

const mutinyEffect = () => {
  const effect = TOWER_PERK_DEFINITIONS.mutiny.effect;
  if (effect.type !== "mutiny") throw new Error("Mutiny perk definition is malformed.");
  return effect;
};

const glassCannonEffect = () => {
  const effect = TOWER_PERK_DEFINITIONS["glass-cannon"].effect;
  if (effect.type !== "glass-cannon") throw new Error("Glass Cannon perk definition is malformed.");
  return effect;
};

const coldChamberEffect = () => {
  const effect = TOWER_PERK_DEFINITIONS["cold-chamber"].effect;
  if (effect.type !== "cold-chamber") throw new Error("Cold Chamber perk definition is malformed.");
  return effect;
};

const getHighNoonAbility = (): TowerAbilityDefinition => {
  const effect = TOWER_PERK_DEFINITIONS["high-noon"].effect;
  if (effect.type !== "high-noon") throw new Error("High Noon perk definition is malformed.");
  return effect.ability;
};

export const getTowerAbilitySlotsWithPerks = (
  definition: TowerDefinition,
  perks: readonly TowerPerkKind[] | undefined,
): readonly TowerAbilitySlot[] => {
  const slots: TowerAbilitySlot[] = ["f", "g", "h"];
  return slots.filter((slot) => getTowerAbilityWithPerks(definition, perks, slot) !== undefined);
};
