import { RANGE_SCALE } from "./config.ts";
import { getBackdraftEffect, getTowerAbilitySlotsWithPerks, getTowerAbilityWithPerks, getTowerPerkAttackIntervalMultiplier, getEffectiveTowerSplash, towerHasPerk } from "./towerPerks.ts";
import type {
  Tower,
  TowerDefinition,
  TowerInspectorData,
  TowerInspectorPopover,
  TowerInspectorPopoverRow,
  TowerInspectorStat,
  TowerLevelStats,
} from "./types.ts";

export interface TowerInspectorDataOptions {
  readonly tower: Tower;
  readonly definition: TowerDefinition;
  readonly levelStats: TowerLevelStats;
  /** Current base interval from the tower behavior, before shared buffs. */
  readonly baseAttackInterval?: number;
  readonly damageMultiplier: number;
  readonly sellValue: number;
  readonly incomingAttack: number | null;
  readonly behaviorStats?: readonly TowerInspectorStat[];
}

const cooldownReadout = (value: number): string => value <= 0 ? "READY" : `${value.toFixed(1)}s`;
const percentReadout = (value: number): string => `${Math.round(value * 100)}%`;
const targetReadout = (value: Tower["targeting"]): string => value.toUpperCase();
const numberReadout = (value: number): string => Number.isInteger(value) ? `${value}` : value.toFixed(1);
const dpsReadout = (value: number): string => value.toFixed(1);
const rangeReadout = (worldUnits: number): string => numberReadout(worldUnits / RANGE_SCALE);

const inspectorRow = (
  key: string,
  label: string,
  value: string,
  note?: string,
  tone: TowerInspectorPopoverRow["tone"] = "normal",
): TowerInspectorPopoverRow => ({ key, label, value, ...(note ? { note } : {}), tone });

const inspectorPopover = (
  key: TowerInspectorPopover["key"],
  title: string,
  subtitle: string,
  rows: readonly TowerInspectorPopoverRow[],
): TowerInspectorPopover => ({ key, title, subtitle, rows });

const volleyCount = (tower: Tower): number => {
  if (tower.kind === "bandit") return tower.level >= 3 ? 2 : 1;
  if (tower.kind === "warrior") return tower.level >= 4 ? 2 : 1;
  if (tower.kind === "tempest") return 2;
  if (tower.kind === "recon") return 5;
  if (tower.kind === "wraith") return tower.level >= 5 ? 4 : tower.level >= 4 ? 3 : tower.level >= 2 ? 2 : 1;
  if (tower.kind === "gunner") return tower.level >= 5 ? 6 : tower.level >= 4 ? 4 : 3;
  return 1;
};

/**
 * Returns the delay between shots in a burst. Bandit, Warrior, and Tempest
 * finish inside their normal fire cooldown; Gunner and Wraith add this burst
 * duration to their next fire cooldown in the authoritative behavior.
 */
const burstSpacing = (tower: Tower): number => {
  if (tower.kind === "bandit" && tower.level >= 3) return 0.3;
  if (tower.kind === "warrior" && tower.level >= 4) return 0.18;
  if (tower.kind === "tempest") return 0.6;
  if (tower.kind === "gunner") return tower.level >= 5 ? 0.1 : 0.2;
  if (tower.kind === "wraith") return tower.level >= 5 ? 0.24 : tower.level >= 4 ? 0.28 : 0.32;
  return 0;
};

const burstExtendsCycle = (tower: Tower): boolean => tower.kind === "gunner" || tower.kind === "wraith";

const pushStat = (
  stats: TowerInspectorStat[],
  key: string,
  label: string,
  value: string,
  group: TowerInspectorStat["group"],
): void => {
  stats.push({ key, label, value, group });
};

const buildInspectorPopovers = ({
  tower,
  definition,
  levelStats,
  configuredAttackInterval,
  attackInterval,
  effectiveDamage,
  volley,
  attackCycle,
  effectiveFireRate,
  effectiveDps,
}: {
  readonly tower: Tower;
  readonly definition: TowerDefinition;
  readonly levelStats: TowerLevelStats;
  readonly configuredAttackInterval: number;
  readonly attackInterval: number;
  readonly effectiveDamage: number;
  readonly volley: number;
  readonly attackCycle: number;
  readonly effectiveFireRate: number;
  readonly effectiveDps: number;
}): readonly TowerInspectorPopover[] => {
  const attackCooldown = attackInterval / Math.max(0.01, 1 + tower.fireRateBuff);
  const spacing = burstSpacing(tower) / Math.max(0.01, 1 + tower.fireRateBuff * 0.25);
  const mainAttackDamage = effectiveDamage * volley;
  const activeAbilities = getTowerAbilitySlotsWithPerks(definition, tower.perks)
    .map((slot) => ({ slot, ability: getTowerAbilityWithPerks(definition, tower.perks, slot) }))
    .filter((entry): entry is { slot: typeof entry.slot; ability: NonNullable<typeof entry.ability> } =>
      entry.ability !== undefined && tower.level >= entry.ability.unlockLevel);

  const damageRows: TowerInspectorPopoverRow[] = [
    inspectorRow(
      "main",
      "MAIN ATTACK",
      `${numberReadout(effectiveDamage)}${volley > 1 ? ` × ${volley} = ${numberReadout(mainAttackDamage)}` : ""}`,
      volley > 1 ? "damage per full volley" : "damage per hit",
      "accent",
    ),
  ];
  const rateRows: TowerInspectorPopoverRow[] = [
    inspectorRow("main", "MAIN ATTACK", `${attackCooldown.toFixed(2)}s`, "cooldown before the next attack cycle", "accent"),
  ];
  const rangeRows: TowerInspectorPopoverRow[] = [
    inspectorRow("main", "MAIN ATTACK", `${numberReadout(levelStats.range)}`, "tower targeting range", "accent"),
  ];
  const dpsRows: TowerInspectorPopoverRow[] = [];
  let maxDps = effectiveDps;
  let dpsTotalNote = "sum of the listed sustained outputs";

  const addRate = (key: string, label: string, value: string, note?: string): void => {
    rateRows.push(inspectorRow(key, label, value, note));
  };
  const addDamage = (key: string, label: string, value: string, note?: string): void => {
    damageRows.push(inspectorRow(key, label, value, note));
  };
  const addRange = (key: string, label: string, value: string, note?: string): void => {
    rangeRows.push(inspectorRow(key, label, value, note));
  };
  const addDps = (key: string, label: string, value: number, note?: string): void => {
    dpsRows.push(inspectorRow(key, label, dpsReadout(value), note));
  };

  if (volley > 1 && spacing > 0) {
    addRate(
      "burst-delay",
      "BURST DELAY",
      `${spacing.toFixed(2)}s`,
      burstExtendsCycle(tower)
        ? `${volley - 1} gaps added to the full cycle`
        : "between shots inside the attack cooldown",
    );
  }
  if (Math.abs(attackInterval - configuredAttackInterval) > 0.005) {
    addRate(
      "base-cycle",
      "BASE CYCLE",
      `${attackCooldown.toFixed(2)}s BASE`,
      `${configuredAttackInterval.toFixed(2)}s configured → ${attackInterval.toFixed(2)}s current base cycle • before shared fire-rate buffs`,
    );
  }
  if (tower.kind === "admiral" && levelStats.splash !== undefined) {
    addRange("admiral-splash", "IMPACT RADIUS", numberReadout(getEffectiveTowerSplash(tower, levelStats.splash)), towerHasPerk(tower, "glass-cannon") ? "Glass Cannon ×0.50" : "artillery splash radius");
  }

  let mainDps = effectiveDps;
  let mainDpsLabel = "MAIN ATTACK";

  if (tower.kind === "bandit") {
    addDps("main", "PISTOL VOLLEY", effectiveDps, volley > 1 ? "full pistol burst, including the delayed shot" : "single-target sustained DPS");
    if (tower.level >= 2 && !towerHasPerk(tower, "high-noon")) {
      const bladeDamage = effectiveDamage * 2;
      addDamage("bandit-blade", "BLADE", numberReadout(bladeDamage), "area slash per target • 3.5s trigger cooldown");
      addRate("bandit-blade", "BLADE", "3.50s", "inner-ring ability cooldown");
      addRange("bandit-blade", "BLADE REACH", rangeReadout(92), "separate inner-ring range");
      addDps("bandit-blade", "BLADE", bladeDamage / 3.5, "one target • ideal cooldown uptime");
      mainDps = effectiveDps;
      maxDps = mainDps + bladeDamage / 3.5;
    }
  } else if (tower.kind === "warrior") {
    addDps("main", "SWORD HIT", effectiveDamage / attackCycle, "primary hit per attack cycle");
    if (tower.level >= 4) {
      addDamage("warrior-double", "DOUBLE STRIKE", numberReadout(effectiveDamage), "delayed follow-up • +0.18s after the primary hit");
      addRate("warrior-double", "DOUBLE STRIKE", "0.18s", "delay after the primary hit");
      addRange("warrior-arrival", "ARRIVAL SLASH", numberReadout(levelStats.range), "uses the tower range after relocating");
      addDps("warrior-double", "DOUBLE STRIKE", effectiveDamage / attackCycle, "single-target follow-up");
      addDps("warrior-arrival", "ARRIVAL SLASH", 0, "event-based after relocating; not included in sustained DPS");
      mainDps = effectiveDamage / attackCycle;
      maxDps = mainDps + effectiveDamage / attackCycle;
    }
  } else if (tower.kind === "cyborg") {
    const howitzerInterval = tower.level === 3
      ? levelStats.ammo ?? 20
      : tower.level >= 4
        ? tower.level >= 5 ? 20 : 30
        : 0;
    if (howitzerInterval > 0) {
      const normalDps = effectiveDps * (howitzerInterval - 1) / howitzerInterval;
      const howitzerDps = effectiveDamage * 10 * effectiveFireRate / howitzerInterval;
      mainDpsLabel = "NORMAL ATTACK";
      mainDps = normalDps;
      addDamage(
        "cyborg-howitzer",
        "HOWITZER",
        numberReadout(effectiveDamage * 10),
        tower.level === 3 ? "final magazine shot • 10× area damage" : `10× area damage every ${howitzerInterval} shots`,
      );
      addRate("cyborg-howitzer", "HOWITZER", `EVERY ${howitzerInterval} SHOTS`, "replaces that cycle's normal shot");
      addRange("cyborg-howitzer", "HOWITZER BLAST", rangeReadout(46), "separate impact radius");
      addDps("cyborg-howitzer", "HOWITZER", howitzerDps, `average contribution • every ${howitzerInterval} shots`);
      maxDps = normalDps + howitzerDps;
    } else addDps("main", "MAIN ATTACK", effectiveDps, "sustained single-target DPS");
    if (tower.level >= 5) {
      const missileDamage = 140 * tower.damageBuff;
      addDamage("cyborg-missiles", "JETSTREAM MISSILES", `${numberReadout(missileDamage)} × 3 = ${numberReadout(missileDamage * 3)}`, "three missiles per volley");
      addRate("cyborg-missiles", "JETSTREAM", "8.00s", "recharge • missiles launch with 1.00s spacing");
      addRange("cyborg-missiles", "JETSTREAM", numberReadout(levelStats.range), "uses main targeting range");
      addDps("cyborg-missiles", "JETSTREAM MISSILES", missileDamage * 3 / 8, "three missiles every 8 seconds");
      maxDps += missileDamage * 3 / 8;
    }
  } else if (tower.kind === "bomber") {
    if (tower.level >= 3) {
      const normalDps = effectiveDps * 3 / 4;
      const dynamiteDps = effectiveDamage * 3 * effectiveFireRate / 4;
      mainDpsLabel = "NORMAL BOMBS";
      mainDps = normalDps;
      addDamage("bomber-dynamite", "DYNAMITE", numberReadout(effectiveDamage * 3), "every fourth bomb • 3× area damage");
      addRate("bomber-dynamite", "DYNAMITE", "EVERY 4 SHOTS", "shot-counter trigger");
      addDps("bomber-dynamite", "DYNAMITE", dynamiteDps, "average contribution from critical bombs");
      maxDps = normalDps + dynamiteDps;
    } else addDps("main", "MAIN ATTACK", effectiveDps, "sustained area-bomb DPS");
    if (tower.level >= 4) {
      const timedBombDamage = 500 * tower.damageBuff;
      addDamage("bomber-time-bomb", "TIME BOMB", numberReadout(timedBombDamage), "area detonation after 5.00s");
      addRate("bomber-time-bomb", "TIME BOMB", "60.00s", "ability cooldown • 5.00s fuse");
      addRange("bomber-time-bomb", "TIME BOMB", numberReadout(levelStats.range), "uses main targeting range");
      addDps("bomber-time-bomb", "TIME BOMB", timedBombDamage / 60, "average contribution at perfect uptime");
      maxDps += timedBombDamage / 60;
    }
  } else if (tower.kind === "infernus") {
    const burnDuration = tower.level >= 5 ? 10 : tower.level >= 2 ? 6 : 3;
    const burnDamage = tower.level >= 5 ? 10 : tower.level >= 4 ? 4 : tower.level >= 3 ? 3 : 1;
    const burnInterval = (tower.level >= 4 ? 0.5 : 1) / (towerHasPerk(tower, "backdraft") ? 1.5 : 1);
    const burnDps = burnDamage * tower.damageBuff / burnInterval;
    const haste = towerHasPerk(tower, "backdraft")
      ? `${Math.round(((getBackdraftEffect().hasteByLevel[Math.min(5, tower.level)] ?? 1) - 1) * 100)}% haste`
      : "normal slow profile";
    addDamage("infernus-burn", "BURN", `${numberReadout(burnDamage * tower.damageBuff)} / TICK`, `${burnDuration}.00s duration • ${burnInterval.toFixed(2)}s ticks • ${haste}`);
    addDps("main", "DIRECT FLAME", effectiveDps, "direct cone damage");
    if (burnDamage > 0) {
      addDps("infernus-burn", "BURN", burnDps, "per affected target while the burn is maintained");
      maxDps += burnDps;
    }
  } else if (tower.kind === "tempest") {
    addDps("main", "LIGHTNING STRIKES", effectiveDps, "two hits per attack cycle");
    const fieldDuration = tower.level >= 5 ? 9 : 6;
    addDamage("tempest-field", "LIGHTNING FIELD", "8% MAX HP", `${fieldDuration}.00s field • each field is capped at 28–200 total damage`);
    addRate("tempest-field", "LIGHTNING FIELD", "EVERY 6 ATTACKS", "also starts on deploy and upgrade");
    addRange("tempest-field", "FIELD RADIUS", rangeReadout(150), "separate area around the tower");
    addDps("tempest-field", "LIGHTNING FIELD", 0, `target-HP scaling over ${fieldDuration}.00s; excluded from numeric total`);
    dpsTotalNote = "field adds target-HP-scaled damage beyond the numeric total";
  } else if (tower.kind === "latch") {
    const tetherInterval = tower.level >= 4 ? 4 : 5;
    addDps("main", "KINETIC BOLTS", effectiveDps, "single-target sustained DPS");
    addDamage("latch-tether", "TETHER", "0 BONUS DAMAGE", `stuns on every ${tetherInterval}th bolt`);
    addRate("latch-tether", "TETHER", `EVERY ${tetherInterval} BOLTS`, "shot-counter trigger");
  } else if (tower.kind === "prism") {
    const chainTargets = tower.level >= 5 ? 5 : tower.level >= 4 ? 4 : tower.level >= 2 ? 3 : 2;
    const retention = tower.level >= 3 ? 0.8 : 0.72;
    const chainDamage = Array.from({ length: chainTargets }, (_, index) => effectiveDamage * retention ** index)
      .reduce((sum, value) => sum + value, 0);
    addDamage("prism-chain", "REFRACTION CHAIN", `${numberReadout(effectiveDamage)} → ${numberReadout(effectiveDamage * retention ** (chainTargets - 1))}`, `${chainTargets} targets max • ${Math.round(retention * 100)}% per bounce`);
    addRange("prism-chain", "BOUNCE RANGE", rangeReadout(tower.level >= 5 ? 135 : tower.level >= 3 ? 120 : 105), "separate distance between chained targets");
    addDps("main", "PRISM CHAIN", chainDamage / attackCycle, `ideal ${chainTargets}-target chain`);
    mainDps = chainDamage / attackCycle;
    maxDps = mainDps;
  } else if (tower.kind === "vanguard") {
    const smashMultiplier = tower.level >= 4 ? 3 : 2;
    const smashCooldown = tower.level >= 3 ? 3 : 4;
    const smashRadius = tower.level >= 5 ? 112 : tower.level >= 3 ? 96 : 82;
    addDamage("vanguard-smash", "CHARGED SMASH", numberReadout(effectiveDamage * smashMultiplier), `${smashMultiplier}× area impact • automatic passive`);
    addRate("vanguard-smash", "CHARGED SMASH", `${smashCooldown.toFixed(2)}s`, "automatic recharge");
    addRange("vanguard-smash", "SMASH RADIUS", rangeReadout(smashRadius), "separate impact radius");
    addDps("main", "MACE STRIKES", effectiveDps, "normal single-target DPS");
    addDps("vanguard-smash", "CHARGED SMASH", effectiveDamage * smashMultiplier / smashCooldown, "average contribution at perfect uptime");
    maxDps = effectiveDps + effectiveDamage * smashMultiplier / smashCooldown;
  } else if (tower.kind === "wraith") {
    addDps("main", "PHASE DASHES", effectiveDps, `${volley} dash${volley === 1 ? "" : "es"} per attack cycle`);
    if (tower.level >= 4) {
      const flurryRadius = tower.level >= 5 ? 210 : 180;
      const pulseDamage = effectiveDamage * (tower.level >= 5 ? 0.7 : 0.55);
      const flurryDps = pulseDamage * 10 / 3;
      addDamage("wraith-flurry", "CRIMSON FLURRY", `${numberReadout(pulseDamage)} × 10`, "repeated area pulses during the 3.00s active window");
      addRate("wraith-flurry", "FLURRY", "60.00s", "ability cooldown • 0.30s pulse spacing");
      addRange("wraith-flurry", "FLURRY RADIUS", rangeReadout(flurryRadius), "separate area around the tower");
      addDps("wraith-flurry", "CRIMSON FLURRY", flurryDps, "ten pulses over 3 seconds");
      maxDps += flurryDps;
    }
  } else if (tower.kind === "samurai") {
    addDps("main", "BLADE ARC", effectiveDps, "current stance and focus are reflected in the main DPS");
    if (tower.level >= 3) {
      const stormDamage = effectiveDamage * 10;
      addDamage("samurai-bladestorm", "BLADESTORM", numberReadout(stormDamage), "area strike when Blade Stance starts at 60%+ focus");
      addDps("samurai-bladestorm", "BLADESTORM", 0, "activation burst; excluded from sustained DPS total");
      dpsTotalNote = "activation bursts are shown separately and excluded from sustained DPS";
    }
  } else if (tower.kind === "mecha" && definition.control) {
    const control = definition.control;
    const missileVolley = control.missiles.volley[tower.level] ?? control.missiles.volley[0]!;
    const missileDamage = (control.missiles.damage[tower.level] ?? control.missiles.damage[0]!) * tower.damageBuff;
    const missileCooldown = getTowerAbilityWithPerks(definition, tower.perks, "f")?.cooldown ?? 0;
    const beamDamage = (control.beam.damage[tower.level] ?? control.beam.damage[0]!) * tower.damageBuff;
    const flameDamage = (control.flame.damage[tower.level] ?? control.flame.damage[0]!) * tower.damageBuff;
    const flameBurnDps = (control.flame.burnDamage[tower.level] ?? 0) * tower.damageBuff / control.flame.burnTickInterval;
    addDps("main", "PILOT CANNON", effectiveDps, "hold LMB while in Pilot Mode; dormant chassis never fires");
    addDamage("mecha-cannon", "CANNON", numberReadout(effectiveDamage), `${control.cannonPierce[tower.level] ?? 1} target pierce • manual hitscan line`);
    addRate("mecha-cannon", "CANNON", `${attackCooldown.toFixed(2)}s`, "hold LMB to fire while heat permits");
    addDps("mecha-cannon", "CANNON", effectiveDps, "manual sustained output while piloted");
    if (tower.level >= 1) {
      addDamage("mecha-missile", "MISSILES", `${numberReadout(missileDamage)} × ${missileVolley}`, "area salvo at the aimed endpoint");
      addRate("mecha-missile", "MISSILES", `${missileCooldown.toFixed(2)}s`, "F cooldown • timed impact fuse");
      addDps("mecha-missile", "MISSILES", missileDamage * missileVolley / Math.max(0.01, missileCooldown), "single-target average; blast can hit multiple hostiles");
      maxDps += missileDamage * missileVolley / Math.max(0.01, missileCooldown);
    }
    if (tower.level >= 3) {
      addDamage("mecha-beam", "PLASMA BEAM", `${numberReadout(beamDamage)} / TICK`, `${control.beam.width[tower.level] ?? 0} width • fixed ${control.beam.tickInterval.toFixed(2)}s ticks`);
      addRate("mecha-beam", "PLASMA BEAM", `${(control.beam.duration[tower.level] ?? 0).toFixed(2)}s`, "G channel duration");
      addDps("mecha-beam", "PLASMA BEAM", beamDamage / control.beam.tickInterval, "one target while the beam is held");
      maxDps = Math.max(maxDps, beamDamage / control.beam.tickInterval);
    }
    if (tower.level >= 5) {
      addDamage("mecha-flame", "FLAMETHROWER", `${numberReadout(flameDamage)} / TICK`, `${control.flame.range[tower.level] ?? 0} range cone • applies burn`);
      addRate("mecha-flame", "FLAMETHROWER", `${(control.flame.duration[tower.level] ?? 0).toFixed(2)}s`, "H channel duration");
      addDps("mecha-flame", "FLAMETHROWER", flameDamage / control.flame.tickInterval + flameBurnDps, "direct cone plus maintained burn on one target");
      maxDps = Math.max(maxDps, flameDamage / control.flame.tickInterval + flameBurnDps);
    }
    dpsTotalNote = "manual weapon output assumes Pilot Mode, aim alignment, and heat availability";
  } else {
    addDps("main", mainDpsLabel, mainDps, "sustained single-target DPS");
  }

  if (!dpsRows.some((row) => row.key === "main")) addDps("main", mainDpsLabel, mainDps, "sustained single-target DPS");

  const handledAbilitySlots = new Set<string>();
  if (tower.kind === "samurai" && tower.level >= 3) handledAbilitySlots.add("f");
  if (tower.kind === "mecha") ["f", "g", "h"].forEach((slot) => handledAbilitySlots.add(slot));
  activeAbilities.forEach(({ slot, ability }) => {
    const abilityCooldown = tower.kind === "mercenary" && tower.level >= 6 && slot === "f" ? 30 : ability.cooldown;
    if (slot === "f" && (tower.kind === "bomber" || tower.kind === "wraith")) handledAbilitySlots.add(slot);
    if (!handledAbilitySlots.has(slot)) {
      addDamage(`ability-${slot}`, ability.name.toUpperCase(), "UTILITY / NO DIRECT DAMAGE", ability.description);
      addDps(`ability-${slot}`, ability.name.toUpperCase(), 0, "utility ability; no direct damage");
    }
    if (!(slot === "f" && (tower.kind === "bomber" || tower.kind === "wraith"))) {
      addRate(`ability-${slot}`, ability.name.toUpperCase(), abilityCooldown > 0 ? `${abilityCooldown.toFixed(2)}s` : "NO COOLDOWN", abilityCooldown > 0 ? "ability recharge" : "manual utility action");
    }
  });

  dpsRows.push(inspectorRow("total", "MAX OUTPUT", dpsTotalNote.startsWith("field adds") ? `${dpsReadout(maxDps)} + SCALING` : dpsReadout(maxDps), dpsTotalNote, "total"));

  return [
    inspectorPopover("damage", "DAMAGE CHANNELS", "Every unlocked attack, passive, and ability", damageRows),
    inspectorPopover("fire-rate", "FIRE TIMING", "Cooldowns, burst spacing, and shot triggers", rateRows),
    inspectorPopover("range", "REACH PROFILE", "Main range plus separate ability areas", rangeRows),
    inspectorPopover("dps", "DPS BREAKDOWN", "Sustained single-target estimates at ideal uptime", dpsRows),
  ];
};

export const buildTowerInspectorData = (options: TowerInspectorDataOptions): TowerInspectorData => {
  const { tower, definition, levelStats, damageMultiplier, sellValue, incomingAttack } = options;
  const stats: TowerInspectorStat[] = [];
  const volley = volleyCount(tower);
  const configuredAttackInterval = Math.max(0.01, levelStats.fireRate);
  const attackInterval = Math.max(0.01, (options.baseAttackInterval ?? configuredAttackInterval) * getTowerPerkAttackIntervalMultiplier(tower));
  const fireRateMultiplier = Math.max(0.01, 1 + tower.fireRateBuff);
  const effectiveDamage = levelStats.damage * damageMultiplier;
  const scaledBurstSpacing = burstSpacing(tower) / Math.max(0.01, 1 + tower.fireRateBuff * 0.25);
  const burstCycleExtension = burstExtendsCycle(tower) ? scaledBurstSpacing * Math.max(0, volley - 1) : 0;
  const attackCycle = attackInterval / fireRateMultiplier + burstCycleExtension;
  const effectiveFireRate = volley / attackCycle;
  const effectiveDps = effectiveDamage * effectiveFireRate;
  const abilities = getTowerAbilitySlotsWithPerks(definition, tower.perks).map((slot) => {
    const cooldown = tower.abilityCooldowns?.[slot] ?? (slot === "f" ? tower.abilityCooldown : 0);
    return `${slot.toUpperCase()} ${cooldownReadout(cooldown)}`;
  }).join(" · ");

  pushStat(stats, "level", "LEVEL", `${tower.level}/${definition.levels.length - 1}`, "combat");
  pushStat(stats, "damage-type", "DAMAGE TYPE", (definition.damageType ?? "bullet").toUpperCase(), "combat");
  pushStat(stats, "damage", "DAMAGE / VOLLEY", `${numberReadout(effectiveDamage)} × ${volley}`, "combat");
  pushStat(stats, "effective-damage", "EFFECTIVE DAMAGE", numberReadout(effectiveDamage), "combat");
  pushStat(stats, "attack-rate", "ATTACKS / SEC", effectiveFireRate.toFixed(2), "combat");
  pushStat(stats, "dps", "EFFECTIVE DPS", effectiveDps.toFixed(1), "combat");
  pushStat(stats, "range", "RANGE", `${levelStats.range}`, "combat");
  pushStat(stats, "splash", "SPLASH", levelStats.splash === undefined ? "—" : `${numberReadout(getEffectiveTowerSplash(tower, levelStats.splash))}`, "combat");

  pushStat(stats, "targeting", "TARGET PRIORITY", targetReadout(tower.targeting), "targeting");
  pushStat(
    stats,
    "hidden-detection",
    "HIDDEN DETECTION",
    definition.hiddenDetectionLevel === undefined
      ? "NONE"
      : tower.level >= definition.hiddenDetectionLevel ? "ONLINE" : `LEVEL ${definition.hiddenDetectionLevel}`,
    "targeting",
  );
  pushStat(stats, "position", "DEPLOYMENT", tower.onPath ? "PATHBOUND" : "RANGED FIELD", "targeting");

  pushStat(stats, "integrity", "INTEGRITY", `${Math.ceil(tower.hp)}/${tower.maxHp}`, "systems");
  pushStat(stats, "aggro", "AGGRO", tower.onPath ? `${tower.engaged.size}/${tower.maxAggro}` : "N/A", "systems");
  pushStat(stats, "attack-cooldown", "ATTACK COOLDOWN", cooldownReadout(tower.fireTimer), "systems");
  pushStat(stats, "counter-cooldown", "COUNTER COOLDOWN", cooldownReadout(tower.counterCooldown), "systems");
  pushStat(stats, "auto-counter", "AUTOCOUNTER", tower.autoCounter ? "ONLINE" : "OFFLINE", "systems");
  pushStat(stats, "abilities", "ABILITY COOLDOWNS", abilities || "NONE", "systems");
  pushStat(
    stats,
    "ammo",
    "AMMO",
    levelStats.ammo === undefined || tower.ammo < 0 ? "∞" : `${tower.ammo}/${levelStats.ammo}`,
    "systems",
  );
  pushStat(stats, "reload", "RELOAD", levelStats.reload === undefined ? "—" : `${levelStats.reload.toFixed(1)}s`, "systems");
  const damageModifier = damageMultiplier - 1;
  pushStat(
    stats,
    "damage-buff",
    "DAMAGE MODIFIER",
    `×${damageMultiplier.toFixed(2)} (${percentReadout(damageModifier)} ${damageModifier >= 0 ? "bonus" : "penalty"})`,
    "systems",
  );
  pushStat(stats, "fire-rate-buff", "FIRE RATE BUFF", percentReadout(tower.fireRateBuff), "systems");
  pushStat(stats, "incoming-attack", "INCOMING ATTACK", incomingAttack === null ? "NONE" : `${incomingAttack.toFixed(1)}s`, "systems");
  pushStat(stats, "stun", "STUN", cooldownReadout(tower.stunTimer), "systems");

  pushStat(stats, "focus", "FOCUS", `${Math.round(tower.focus)}`, "advanced");
  pushStat(stats, "fortify", "FORTIFY CHARGES", `${tower.fortifyCharges}`, "advanced");
  pushStat(stats, "overdrive", "OVERDRIVE", tower.overdriveTimer > 0 ? `${tower.overdriveTimer.toFixed(1)}s` : "INACTIVE", "advanced");
  pushStat(stats, "burst", "BURST STATE", tower.burstShotsRemaining > 0 ? `${tower.burstShotsRemaining} SHOTS` : "IDLE", "advanced");
  pushStat(stats, "ramp", "ATTACK RAMP", tower.attackRamp > 0 ? `${percentReadout(tower.attackRamp)}` : "NONE", "advanced");
  pushStat(stats, "ability-state", "ABILITY STATE", tower.abilityTimer > 0 ? `${tower.abilityTimer.toFixed(1)}s ACTIVE` : "IDLE", "advanced");
  if (towerHasPerk(tower, "high-noon")) {
    pushStat(stats, "high-noon-prep", "HIGH NOON PREP", (tower.perkPrepTimer ?? 0) > 0 ? `${(tower.perkPrepTimer ?? 0).toFixed(1)}s` : "READY / CLEAR", "advanced");
  }
  pushStat(stats, "shot-counter", "SHOT COUNTER", `${tower.shotCounter}`, "advanced");
  pushStat(stats, "field-state", "FIELD STATE", tower.fieldTimer > 0 ? `${tower.fieldTimer.toFixed(1)}s ACTIVE` : "INACTIVE", "advanced");
  pushStat(stats, "rocket-cycle", "ROCKET CYCLE", tower.rocketTimer > 0 ? `${tower.rocketTimer.toFixed(1)}s` : "READY", "advanced");
  pushStat(stats, "stance", "STANCE", tower.senselessStance ? "SENSELESS" : "DEFAULT", "advanced");
  pushStat(stats, "zenith-charge", "CHARGE", (tower.zenithChargeTimer ?? 0) > 0 ? `${(tower.zenithChargeTimer ?? 0).toFixed(1)}s` : "NONE", "advanced");
  options.behaviorStats?.forEach((stat) => stats.push(stat));

  const popovers = buildInspectorPopovers({
    tower,
    definition,
    levelStats,
    configuredAttackInterval,
    attackInterval,
    effectiveDamage,
    volley,
    attackCycle,
    effectiveFireRate,
    effectiveDps,
  });

  return { stats, sellValue, popovers };
};
