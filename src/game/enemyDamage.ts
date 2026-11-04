import { clamp } from "./math.ts";
import { calculateResistanceMultiplier, type DamageType, type EnemyResistances } from "./damageTypes.ts";
import type { EnemySummonModifiers } from "./types.ts";

export const NEUTRAL_SUMMON_MODIFIERS: EnemySummonModifiers = {
  hitCashMultiplier: 1,
  hpMultiplier: 1,
  shieldMultiplier: 1,
  speedMultiplier: 1,
  damageMultiplier: 1,
  attackIntervalMultiplier: 1,
  coreDamageMultiplier: 1,
  defenseBonus: 0,
  protectionBonus: 0,
  armorBonus: 0,
  superarmorBonus: 0,
};

export const NO_CASH_SUMMON_MODIFIERS: EnemySummonModifiers = {
  ...NEUTRAL_SUMMON_MODIFIERS,
  hitCashMultiplier: 0,
};

export const combineSummonModifiers = (
  parent: EnemySummonModifiers,
  child: EnemySummonModifiers,
): EnemySummonModifiers => {
  let resistanceBonuses: EnemyResistances | undefined;
  if (parent.resistanceBonuses || child.resistanceBonuses) {
    resistanceBonuses = {};
    const keys = new Set([
      ...Object.keys(parent.resistanceBonuses ?? {}),
      ...Object.keys(child.resistanceBonuses ?? {}),
    ]);
    for (const key of keys) {
      const pVal = parent.resistanceBonuses?.[key] ?? 0;
      const cVal = child.resistanceBonuses?.[key] ?? 0;
      resistanceBonuses[key] = pVal + cVal;
    }
  }

  return {
    hitCashMultiplier: parent.hitCashMultiplier * child.hitCashMultiplier,
    hpMultiplier: parent.hpMultiplier * child.hpMultiplier,
    shieldMultiplier: parent.shieldMultiplier * child.shieldMultiplier,
    speedMultiplier: parent.speedMultiplier * child.speedMultiplier,
    damageMultiplier: parent.damageMultiplier * child.damageMultiplier,
    attackIntervalMultiplier: parent.attackIntervalMultiplier * child.attackIntervalMultiplier,
    coreDamageMultiplier: parent.coreDamageMultiplier * child.coreDamageMultiplier,
    defenseBonus: parent.defenseBonus + child.defenseBonus,
    protectionBonus: parent.protectionBonus + child.protectionBonus,
    armorBonus: parent.armorBonus + child.armorBonus,
    superarmorBonus: parent.superarmorBonus + child.superarmorBonus,
    ...(resistanceBonuses ? { resistanceBonuses } : {}),
  };
};

export interface EnemyDamageInput {
  readonly amount: number;
  readonly defense: number;
  readonly protection: number;
  readonly armor: number;
  readonly superarmor: number;
  readonly statusEffect?: boolean;
  readonly damageType?: DamageType;
  readonly resistances?: EnemyResistances;
}

export interface EnemyDamageResolution {
  readonly rawDamage: number;
  readonly mitigatedDamage: number;
  readonly protectionTriggered: boolean;
  readonly remainingProtection: number;
}

/**
 * Resolves one damage packet against the enemy defense stack.
 *
 * Direct damage uses Superarmor -> Armor -> Resistance -> Defense -> minimum 1 -> Protection.
 * Status damage uses Armor -> Resistance -> Protection; Defense and Superarmor intentionally
 * do not affect it. Shield HP is applied by the caller after this resolver.
 */
export const resolveEnemyDamage = (input: EnemyDamageInput): EnemyDamageResolution => {
  const rawDamage = Math.max(0, Number.isFinite(input.amount) ? input.amount : 0);
  if (rawDamage <= 0) return { rawDamage: 0, mitigatedDamage: 0, protectionTriggered: false, remainingProtection: Math.max(0, Math.round(input.protection)) };

  let damage = rawDamage;
  const armor = clamp(Number.isFinite(input.armor) ? input.armor : 0, 0, 1);
  if (!input.statusEffect) {
    const superarmor = clamp(Number.isFinite(input.superarmor) ? input.superarmor : 0, 0, 1);
    if (superarmor > 0) damage = Math.round(Math.pow(damage, 1 - superarmor));
  }
  damage *= 1 - armor;
  if (input.damageType && input.resistances) {
    const resistance = input.resistances[input.damageType];
    const resistanceMultiplier = calculateResistanceMultiplier(resistance);
    damage *= resistanceMultiplier;
  }
  if (!input.statusEffect && damage > 0) {
    const defense = Math.max(0, Number.isFinite(input.defense) ? input.defense : 0);
    damage = Math.max(1, damage - defense);
  }

  const protection = Math.max(0, Math.round(Number.isFinite(input.protection) ? input.protection : 0));
  const protectionTriggered = damage > 0 && protection > 0;
  return {
    rawDamage,
    mitigatedDamage: protectionTriggered ? 0 : Math.max(0, damage),
    protectionTriggered,
    remainingProtection: protectionTriggered ? protection - 1 : protection,
  };
};
