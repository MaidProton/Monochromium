import { describe, expect, it } from "vitest";
import { combineSummonModifiers, NEUTRAL_SUMMON_MODIFIERS, resolveEnemyDamage } from "./enemyDamage.ts";

describe("enemy defense pipeline", () => {
  const resolve = (amount: number, overrides: Partial<Parameters<typeof resolveEnemyDamage>[0]> = {}) => resolveEnemyDamage({
    amount,
    defense: 0,
    protection: 0,
    armor: 0,
    superarmor: 0,
    ...overrides,
  });

  it("subtracts Defense and keeps positive direct damage at one", () => {
    expect(resolve(5, { defense: 3 }).mitigatedDamage).toBe(2);
    expect(resolve(5, { defense: 9 }).mitigatedDamage).toBe(1);
  });

  it("applies Superarmor before Armor and Defense, rounding only that stage", () => {
    expect(resolve(100, { superarmor: 0.35 }).mitigatedDamage).toBe(20);
    expect(resolve(100, { superarmor: 0.35, armor: 0.5 }).mitigatedDamage).toBe(10);
  });

  it("lets Armor reduce status damage while status damage skips Superarmor and Defense", () => {
    expect(resolve(5, { statusEffect: true, superarmor: 0.9, defense: 99, armor: 0.5 }).mitigatedDamage).toBe(2.5);
    expect(resolve(5, { superarmor: 0.9, defense: 99, armor: 0.5 }).mitigatedDamage).toBe(1);
  });

  it("does not force minimum damage when Armor reaches zero", () => {
    const result = resolve(25, { armor: 1, protection: 2 });
    expect(result.mitigatedDamage).toBe(0);
    expect(result.protectionTriggered).toBe(false);
    expect(result.remainingProtection).toBe(2);
  });

  it("consumes Protection once per positive damage packet", () => {
    const first = resolve(4, { protection: 2 });
    const second = resolve(4, { protection: first.remainingProtection });
    const third = resolve(4, { protection: second.remainingProtection });
    expect(first).toMatchObject({ mitigatedDamage: 0, protectionTriggered: true, remainingProtection: 1 });
    expect(second).toMatchObject({ mitigatedDamage: 0, protectionTriggered: true, remainingProtection: 0 });
    expect(third.mitigatedDamage).toBe(4);
  });

  it("applies damage type resistance and caps positive resistance at 100%", () => {
    expect(resolve(10, { damageType: "bullet", resistances: { bullet: 0.5 } }).mitigatedDamage).toBe(5);
    const immune = resolve(10, { damageType: "energy", resistances: { energy: 1.0 }, protection: 2 });
    expect(immune.mitigatedDamage).toBe(0);
    expect(immune.protectionTriggered).toBe(false);
    expect(immune.remainingProtection).toBe(2);

    const overCapped = resolve(10, { damageType: "explosive", resistances: { explosive: 1.5 } });
    expect(overCapped.mitigatedDamage).toBe(0);
  });

  it("amplifies damage with negative resistance without an arbitrary limit", () => {
    expect(resolve(10, { damageType: "fire", resistances: { fire: -0.7 } }).mitigatedDamage).toBeCloseTo(17);
    expect(resolve(10, { damageType: "melee", resistances: { melee: -2.0 } }).mitigatedDamage).toBeCloseTo(30);
  });

  it("applies resistance to status effects like fire DoT", () => {
    expect(resolve(10, { statusEffect: true, damageType: "fire", resistances: { fire: 0.4 } }).mitigatedDamage).toBeCloseTo(6);
    expect(resolve(10, { statusEffect: true, damageType: "fire", resistances: { fire: -0.5 } }).mitigatedDamage).toBeCloseTo(15);
  });
});

describe("summon modifier composition", () => {
  it("multiplies scalar modifiers and adds defense bonuses for nested summons", () => {
    const result = combineSummonModifiers(
      { ...NEUTRAL_SUMMON_MODIFIERS, hitCashMultiplier: 0.5, hpMultiplier: 2, attackIntervalMultiplier: 0.8, armorBonus: 0.2, resistanceBonuses: { fire: 0.2, bullet: -0.1 } },
      { ...NEUTRAL_SUMMON_MODIFIERS, hitCashMultiplier: 0, hpMultiplier: 1.5, attackIntervalMultiplier: 0.5, defenseBonus: 4, armorBonus: 0.1, resistanceBonuses: { fire: 0.3, bullet: -0.2, energy: 0.5 } },
    );
    expect(result.hitCashMultiplier).toBe(0);
    expect(result.hpMultiplier).toBe(3);
    expect(result.attackIntervalMultiplier).toBeCloseTo(0.4);
    expect(result.defenseBonus).toBe(4);
    expect(result.armorBonus).toBeCloseTo(0.3);
    expect(result.resistanceBonuses?.fire).toBeCloseTo(0.5);
    expect(result.resistanceBonuses?.bullet).toBeCloseTo(-0.3);
    expect(result.resistanceBonuses?.energy).toBeCloseTo(0.5);
  });
});
