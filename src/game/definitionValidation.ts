import { ENEMY_DEFINITIONS, MAP_DEFINITIONS, MODE_DEFINITIONS, TOWER_DEFINITIONS, TOWER_ORDER, TOWER_PERK_DEFINITIONS, TOWER_PERK_ORDER } from "./config.ts";
import { isValidCustomEnemyDrawing } from "./customEnemyAppearance.ts";
import type { EnemyDefinition, EnemyKind, MapDefinition, ModeDefinition, TowerDefinition, TowerKind, TowerPerkDefinition, TowerPerkKind } from "./types.ts";

export interface DefinitionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface DefinitionValidationInput {
  readonly towers?: Readonly<Record<TowerKind, TowerDefinition>>;
  readonly towerOrder?: readonly TowerKind[];
  readonly perks?: Readonly<Record<TowerPerkKind, TowerPerkDefinition>>;
  readonly perkOrder?: readonly TowerPerkKind[];
  readonly enemies?: Readonly<Record<string, EnemyDefinition>>;
  readonly maps?: Readonly<Record<string, MapDefinition>>;
  readonly modes?: readonly ModeDefinition[];
}

const finite = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum;

const integer = (value: unknown, minimum = 0): value is number =>
  Number.isInteger(value) && finite(value, minimum);

const validateTowerControl = (control: NonNullable<TowerDefinition["control"]>, path: string, levelCount: number, errors: string[]): void => {
  const curve = (value: readonly number[] | undefined, name: string, minimum = 0): void => {
    if (!Array.isArray(value) || value.length !== levelCount || !value.every((entry) => finite(entry, minimum))) {
      errors.push(`${path}.${name} must contain ${levelCount} finite values >= ${minimum}.`);
    }
  };
  curve(control.movementSpeed, "movementSpeed", 0.0001);
  if (!finite(control.engagementRange, control.bodyRadius)) errors.push(`${path}.engagementRange must cover the chassis radius.`);
  for (const field of ["acceleration", "braking", "hullTurnRate", "turretTurnRate"] as const) curve(control[field], field, 0.0001);
  curve(control.cannonWidth, "cannonWidth", 0.0001);
  curve(control.cannonPierce, "cannonPierce", 1);
  curve(control.heat.max, "heat.max", 0.0001);
  curve(control.heat.cannonPerShot, "heat.cannonPerShot", 0);
  curve(control.heat.missile, "heat.missile", 0);
  curve(control.heat.beamPerSecond, "heat.beamPerSecond", 0);
  curve(control.heat.flamePerSecond, "heat.flamePerSecond", 0);
  curve(control.heat.ventPerSecond, "heat.ventPerSecond", 0.0001);
  curve(control.missiles.volley, "missiles.volley", 1);
  curve(control.missiles.damage, "missiles.damage", 0);
  curve(control.missiles.radius, "missiles.radius", 0.0001);
  curve(control.beam.duration, "beam.duration", 0.0001);
  curve(control.beam.damage, "beam.damage", 0);
  curve(control.beam.width, "beam.width", 0.0001);
  curve(control.flame.duration, "flame.duration", 0.0001);
  curve(control.flame.damage, "flame.damage", 0);
  curve(control.flame.range, "flame.range", 0.0001);
  curve(control.flame.halfAngle, "flame.halfAngle", 0.0001);
  curve(control.flame.burnDuration, "flame.burnDuration", 0.0001);
  curve(control.flame.burnDamage, "flame.burnDamage", 0);
  if (!finite(control.flame.burnTickInterval, 0.0001) || !finite(control.missiles.launchSpacing, 0) || !finite(control.missiles.spread, 0)) errors.push(`${path} burn/launch timing is invalid.`);
  if (!finite(control.bodyRadius, 0.0001) || !finite(control.heat.overheatLock, 0.0001) || !finite(control.heat.recoverAt, 0) || control.heat.max.some((max) => control.heat.recoverAt >= max)) {
    errors.push(`${path}.bodyRadius/heat limits are invalid.`);
  }
  if (!finite(control.missiles.fuse, 0) || !finite(control.missiles.speed, 0.0001) || !finite(control.beam.tickInterval, 0.0001) || !finite(control.flame.tickInterval, 0.0001)) {
    errors.push(`${path} projectile and channel timing is invalid.`);
  }
};

const pointValid = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as { readonly x?: unknown; readonly y?: unknown };
  return typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y);
};

const enemyPowerFields: Readonly<Record<string, readonly string[]>> = {
  summon: ["interval", "count"],
  shockwave: ["interval", "radius", "stunDuration"],
  regeneration: ["rate"],
  hastePulse: ["interval", "radius", "duration", "multiplier"],
  drain: ["interval", "radius", "damage", "healingPerTower"],
  phase: ["interval", "duration"],
  blink: ["interval", "distance"],
  timeLock: ["distance", "duration"],
  waveLock: ["distance", "waves"],
};

const validateEnemy = (enemy: EnemyDefinition, path: string, errors: string[]): void => {
  if (!enemy || typeof enemy !== "object") {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!enemy.kind || typeof enemy.kind !== "string") errors.push(`${path}.kind is missing.`);
  if (!enemy.name.trim()) errors.push(`${path}.name must not be empty.`);
  for (const [field, minimum] of [["hp", 0.0001], ["shieldHp", 0], ["speed", 0], ["damage", 0], ["attackInterval", 0.0001], ["telegraphDuration", 0], ["coreDamage", 0], ["radius", 0.0001]] as const) {
    if (!finite(enemy[field as keyof EnemyDefinition], minimum)) errors.push(`${path}.${field} must be a finite number >= ${minimum}.`);
  }
  if (enemy.defense !== undefined && !finite(enemy.defense, 0)) errors.push(`${path}.defense must be a finite non-negative number.`);
  if (enemy.protection !== undefined && !integer(enemy.protection, 0)) errors.push(`${path}.protection must be a non-negative integer.`);
  if (enemy.armor !== undefined && (!finite(enemy.armor, 0) || enemy.armor > 1)) errors.push(`${path}.armor must be between 0 and 1.`);
  if (enemy.superarmor !== undefined && (!finite(enemy.superarmor, 0) || enemy.superarmor > 1)) errors.push(`${path}.superarmor must be between 0 and 1.`);
  if (enemy.resistances !== undefined) {
    if (!enemy.resistances || typeof enemy.resistances !== "object") {
      errors.push(`${path}.resistances must be an object when present.`);
    } else {
      for (const [type, value] of Object.entries(enemy.resistances)) {
        if (typeof value !== "number" || !Number.isFinite(value) || value > 1) {
          errors.push(`${path}.resistances.${type} must be a finite number <= 1.`);
        }
      }
    }
  }
  if (!enemy.sprite || typeof enemy.sprite !== "object") errors.push(`${path}.sprite is missing.`);
  else {
    if (enemy.sprite.appearance !== undefined && enemy.sprite.appearance !== "procedural" && enemy.sprite.appearance !== "drawing") errors.push(`${path}.sprite.appearance is invalid.`);
    if (enemy.sprite.opacity !== undefined && (!finite(enemy.sprite.opacity, 0) || enemy.sprite.opacity > 1)) errors.push(`${path}.sprite.opacity must be between 0 and 1.`);
    if (enemy.sprite.drawing !== undefined && !isValidCustomEnemyDrawing(enemy.sprite.drawing)) errors.push(`${path}.sprite.drawing must be a valid bounded PNG data URL.`);
    if (enemy.sprite.appearance === "drawing" && enemy.sprite.drawing === undefined) errors.push(`${path}.sprite.drawing is required for drawing appearance.`);
  }
  for (const [power, fields] of Object.entries(enemyPowerFields)) {
    const value = enemy[power as keyof EnemyDefinition];
    if (value === undefined) continue;
    if (!value || typeof value !== "object") {
      errors.push(`${path}.${power} must be an object when present.`);
      continue;
    }
    for (const field of fields) {
      const numberValue = (value as Record<string, unknown>)[field];
      const minimum = (power === "timeLock" || power === "waveLock") && field === "distance" ? 0 : 0.0001;
      if (!finite(numberValue, minimum)) errors.push(`${path}.${power}.${field} must be a finite number >= ${minimum}.`);
    }
  }
  if (enemy.summon && (!integer(enemy.summon.count, 1) || enemy.summon.kinds.length === 0)) {
    errors.push(`${path}.summon.count must be >= 1 and kinds must not be empty.`);
  }
  if (enemy.summon?.modifiers) {
    const modifiers = enemy.summon.modifiers;
    for (const field of ["hitCashMultiplier", "hpMultiplier", "shieldMultiplier", "speedMultiplier", "damageMultiplier", "attackIntervalMultiplier", "coreDamageMultiplier"] as const) {
      if (!finite(modifiers[field], 0)) errors.push(`${path}.summon.modifiers.${field} must be non-negative.`);
    }
    for (const field of ["defenseBonus", "protectionBonus", "armorBonus", "superarmorBonus"] as const) {
      if (typeof modifiers[field] !== "number" || !Number.isFinite(modifiers[field])) errors.push(`${path}.summon.modifiers.${field} must be finite.`);
    }
    if (modifiers.armorBonus < -1 || modifiers.armorBonus > 1 || modifiers.superarmorBonus < -1 || modifiers.superarmorBonus > 1) errors.push(`${path}.summon.modifiers armor bonuses must be between -1 and 1.`);
    if (modifiers.resistanceBonuses !== undefined) {
      if (!modifiers.resistanceBonuses || typeof modifiers.resistanceBonuses !== "object") {
        errors.push(`${path}.summon.modifiers.resistanceBonuses must be an object when present.`);
      } else {
        for (const [type, value] of Object.entries(modifiers.resistanceBonuses)) {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            errors.push(`${path}.summon.modifiers.resistanceBonuses.${type} must be a finite number.`);
          }
        }
      }
    }
  }
  enemy.attacks?.forEach((attack, attackIndex) => {
    const attackPath = `${path}.attacks[${attackIndex}]`;
    if (!attack.id.trim() || !attack.name.trim()) errors.push(`${attackPath} must have an id and name.`);
    if (!finite(attack.cooldown, 0.0001) || !integer(attack.maxUses, 0)) errors.push(`${attackPath} cooldown/maxUses are invalid.`);
    if (!finite(attack.range, 0) || !integer(attack.maxTargets, 1) || !finite(attack.width, 0) || !finite(attack.depth, 0) || !finite(attack.angle, 0) || !finite(attack.projectileSpeed, 0.0001)) errors.push(`${attackPath} targeting/delivery values are invalid.`);
    if (!attack.effects.length || !attack.visuals.length) errors.push(`${attackPath} must contain at least one effect and visual.`);
    attack.effects.forEach((effect, effectIndex) => {
      if (effect.type === "damage" && !finite(effect.amount, 0)) errors.push(`${attackPath}.effects[${effectIndex}].amount is invalid.`);
      if (effect.type === "stun" && !finite(effect.duration, 0)) errors.push(`${attackPath}.effects[${effectIndex}].duration is invalid.`);
    });
  });
  enemy.behaviorRules?.forEach((rule, index) => {
    const rulePath = `${path}.behaviorRules[${index}]`;
    if (!rule.id.trim() || !rule.name.trim()) errors.push(`${rulePath} must have an id and name.`);
    for (const [field, minimum] of [["cooldown", 0], ["maxUses", 0]] as const) {
      if (!integer(rule[field], minimum)) errors.push(`${rulePath}.${field} must be a non-negative integer.`);
    }
    rule.actions.forEach((action, actionIndex) => {
      if (!finite(action.delay, 0)) errors.push(`${rulePath}.actions[${actionIndex}].delay must be non-negative.`);
    });
  });
};

const validateTower = (tower: TowerDefinition, path: string, errors: string[]): void => {
  if (!tower || typeof tower !== "object") {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!tower.kind || typeof tower.kind !== "string") errors.push(`${path}.kind is missing.`);
  if (!tower.name.trim()) errors.push(`${path}.name must not be empty.`);
  for (const [field, minimum] of [["cost", 0], ["unlockCost", 0], ["copyLimit", 1]] as const) {
    if (!finite(tower[field], minimum)) errors.push(`${path}.${field} must be a finite number >= ${minimum}.`);
  }
  if (!finite(tower.onPath?.hp, 0.0001) || !finite(tower.onPath?.maxAggro, 0)) errors.push(`${path}.onPath stats are invalid.`);
  if (tower.levels.length === 0) errors.push(`${path}.levels must not be empty.`);
  tower.levels.forEach((level, index) => {
    for (const [field, minimum] of [["damage", 0], ["fireRate", 0.0001], ["range", 0], ["hpMultiplier", 0.0001], ["aggroBonus", 0]] as const) {
      if (!finite(level[field], minimum)) errors.push(`${path}.levels[${index}].${field} is invalid.`);
    }
    for (const field of ["splash", "ammo", "reload"] as const) {
      if (level[field] !== undefined && !finite(level[field], 0)) errors.push(`${path}.levels[${index}].${field} is invalid.`);
    }
  });
  if (tower.upgrades.length !== Math.max(0, tower.levels.length - 1)) errors.push(`${path}.upgrades must contain one entry per level after level 0.`);
  tower.upgrades.forEach((upgrade, index) => {
    if (upgrade.level !== index + 1) errors.push(`${path}.upgrades[${index}].level must be ${index + 1}.`);
    if (!finite(upgrade.cost, 0)) errors.push(`${path}.upgrades[${index}].cost is invalid.`);
  });
  if (tower.kind === "mecha" && !tower.control) errors.push(`${path}.control is required for Tank.`);
  if (tower.control) validateTowerControl(tower.control, `${path}.control`, tower.levels.length, errors);
  const abilities = [
    ...(tower.ability ? [{ slot: "f", value: tower.ability }] : []),
    ...Object.entries(tower.abilities ?? {}).flatMap(([slot, value]) => value ? [{ slot, value }] : []),
  ];
  abilities.forEach(({ slot, value }) => {
    if (!integer(value.unlockLevel, 0) || value.unlockLevel >= tower.levels.length) errors.push(`${path}.abilities.${slot}.unlockLevel is outside the tower level range.`);
    if (!finite(value.cooldown, 0)) errors.push(`${path}.abilities.${slot}.cooldown is invalid.`);
    if (value.duration !== undefined && !finite(value.duration, 0.0001)) errors.push(`${path}.abilities.${slot}.duration is invalid.`);
  });
};

const validatePerk = (perk: TowerPerkDefinition, path: string, towerKinds: readonly TowerKind[], errors: string[]): void => {
  if (!perk || typeof perk !== "object") {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!perk.kind || typeof perk.kind !== "string") errors.push(`${path}.kind is missing.`);
  if (!perk.name.trim() || !perk.description.trim() || !perk.tradeoff.trim()) errors.push(`${path} text fields must not be empty.`);
  if (!towerKinds.includes(perk.target)) errors.push(`${path}.target must reference a known tower.`);
  if (perk.currency !== "coins" && perk.currency !== "tokens") errors.push(`${path}.currency is invalid.`);
  if (!integer(perk.cost, 1)) errors.push(`${path}.cost must be a positive integer.`);
  const effect = perk.effect;
  if (!effect || typeof effect !== "object") {
    errors.push(`${path}.effect is missing.`);
    return;
  }
  if (effect.type === "backdraft") {
    if (!finite(effect.burnTickRateMultiplier, 1) || effect.hasteByLevel.length < 6 || !effect.hasteByLevel.every((value) => finite(value, 1))) errors.push(`${path}.effect backdraft curve is invalid.`);
  } else if (effect.type === "high-noon") {
    if (!finite(effect.prepDuration, 0.0001) || !finite(effect.cooldown, 0.0001) || effect.damageBonusByLevel.length < 6 || effect.fireRateBonusByLevel.length < 6 || effect.durationByLevel.length < 6 ||
      !effect.damageBonusByLevel.every((value) => finite(value, 0)) || !effect.fireRateBonusByLevel.every((value) => finite(value, 0)) || !effect.durationByLevel.every((value) => finite(value, 0)) ||
      !effect.ability.automatic || effect.ability.unlockLevel < 0 || effect.ability.cooldown !== effect.cooldown) errors.push(`${path}.effect High Noon metadata or curves are invalid.`);
  } else if (effect.type === "glass-cannon") {
    if (!finite(effect.damageMultiplier, 0.0001) || !finite(effect.attackIntervalMultiplier, 0.0001) || !finite(effect.splashMultiplier, 0.0001)) errors.push(`${path}.effect Glass Cannon multipliers are invalid.`);
  } else if (effect.type === "cold-chamber") {
    if (!finite(effect.damageMultiplier, 0.0001) || !integer(effect.chargedShotEvery, 1) || !finite(effect.chargedShotStunDuration, 0.0001)) errors.push(`${path}.effect Cold Chamber metadata is invalid.`);
  } else if (effect.type === "mutiny") {
    if (effect.killTargetByLevel.length < 1 || effect.damageBonusByLevel.length < 1 || effect.durationByLevel.length < 1 ||
      !finite(effect.damageMultiplier, 0.0001) || !effect.killTargetByLevel.every((value) => integer(value, 1)) || !finite(effect.damageTriggerSeconds, 0.0001) ||
      !effect.damageBonusByLevel.every((value) => finite(value, 0)) || !effect.durationByLevel.every((value) => finite(value, 0.0001))) {
      errors.push(`${path}.effect Mutiny curves or trigger metadata are invalid.`);
    }
  } else {
    errors.push(`${path}.effect type is invalid.`);
  }
};

const validateMap = (map: MapDefinition, path: string, errors: string[]): void => {
  if (!map || typeof map !== "object") {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!map.name.trim()) errors.push(`${path}.name must not be empty.`);
  if (!finite(map.mapScale, 0.0001) || !finite(map.rewardMultiplier, 0)) errors.push(`${path}.mapScale/rewardMultiplier are invalid.`);
  if (!map.paths.length) errors.push(`${path}.paths must not be empty.`);
  map.paths.forEach((route, index) => {
    if (route.path.length < 2 || !route.path.every(pointValid)) errors.push(`${path}.paths[${index}].path must contain at least two valid points.`);
    if (!finite(route.width, 0.0001) || !pointValid(route.core) || !pointValid(route.entryLabel) || !pointValid(route.pathLabel)) errors.push(`${path}.paths[${index}] has invalid geometry.`);
  });
  map.blockedZones.forEach((zone, index) => {
    if (!finite(zone.x) || !finite(zone.y) || !finite(zone.width, 0.0001) || !finite(zone.height, 0.0001)) errors.push(`${path}.blockedZones[${index}] has invalid geometry.`);
  });
  map.pathBlockers.forEach((blocker, index) => {
    if (!integer(blocker.pathIndex, 0) || !finite(blocker.startDistance) || !finite(blocker.length, 0.0001)) errors.push(`${path}.pathBlockers[${index}] is invalid.`);
  });
};

const validateMode = (mode: ModeDefinition, knownEnemies: ReadonlySet<string>, path: string, errors: string[]): void => {
  if (!mode.name.trim()) errors.push(`${path}.name must not be empty.`);
  if (!finite(mode.startingCash) || !finite(mode.coreIntegrity, 0.0001) || !finite(mode.multiplayerHitCashMultiplier)) errors.push(`${path} economy values are invalid.`);
  if (!mode.waves.length) errors.push(`${path}.waves must not be empty.`);
  mode.waves.forEach((wave, waveIndex) => {
    if (!finite(wave.referenceHealth, 0.0001) || (wave.waveTimeSeconds !== null && !finite(wave.waveTimeSeconds, 0.0001))) errors.push(`${path}.waves[${waveIndex}] timing/reference values are invalid.`);
    wave.groups?.forEach((group, groupIndex) => {
      if (!knownEnemies.has(group.kind) || !integer(group.count, 1) || !finite(group.gap)) errors.push(`${path}.waves[${waveIndex}].groups[${groupIndex}] is invalid.`);
    });
    wave.blocks?.forEach((block, blockIndex) => {
      if (!knownEnemies.has(block.enemy) || !integer(block.count, 1) || !finite(block.spawnDelay) || !finite(block.nextBlockDelay) || (block.spawnPathIndex !== undefined && !integer(block.spawnPathIndex, 0))) errors.push(`${path}.waves[${waveIndex}].blocks[${blockIndex}] is invalid.`);
    });
    if (!wave.groups?.length && !wave.blocks?.length) errors.push(`${path}.waves[${waveIndex}] must contain groups or blocks.`);
  });
};

export const validateGameDefinitions = (input: DefinitionValidationInput = {}): DefinitionValidationResult => {
  const towers = input.towers ?? TOWER_DEFINITIONS;
  const towerOrder = input.towerOrder ?? TOWER_ORDER;
  const perks = input.perks ?? TOWER_PERK_DEFINITIONS;
  const perkOrder = input.perkOrder ?? TOWER_PERK_ORDER;
  const enemies = input.enemies ?? ENEMY_DEFINITIONS;
  const maps = input.maps ?? MAP_DEFINITIONS;
  const modes = input.modes ?? MODE_DEFINITIONS;
  const errors: string[] = [];
  const towerKeys = Object.keys(towers);
  const orderedKeys = [...towerOrder];
  if (new Set(towerKeys).size !== towerKeys.length) errors.push("TOWER_DEFINITIONS contains duplicate keys.");
  if (towerKeys.length !== orderedKeys.length || towerKeys.some((kind) => !orderedKeys.includes(kind as TowerKind)) || orderedKeys.some((kind) => !Object.hasOwn(towers, kind))) {
    errors.push("TOWER_ORDER and TOWER_DEFINITIONS do not contain the same tower kinds.");
  }
  Object.entries(towers).forEach(([kind, tower]) => validateTower(tower, `towers.${kind}`, errors));
  const perkKeys = Object.keys(perks);
  const orderedPerkKeys = [...perkOrder];
  if (perkKeys.length !== orderedPerkKeys.length || perkKeys.some((kind) => !orderedPerkKeys.includes(kind as TowerPerkKind)) || orderedPerkKeys.some((kind) => !Object.hasOwn(perks, kind))) {
    errors.push("TOWER_PERK_ORDER and TOWER_PERK_DEFINITIONS do not contain the same perk kinds.");
  }
  Object.entries(perks).forEach(([kind, perk]) => {
    if (perk.kind !== kind) errors.push(`perks.${kind}.kind must match its definition key.`);
    validatePerk(perk, `perks.${kind}`, towerOrder, errors);
  });
  Object.entries(enemies).forEach(([kind, enemy]) => validateEnemy(enemy, `enemies.${kind}`, errors));
  Object.entries(maps).forEach(([kind, map]) => validateMap(map, `maps.${kind}`, errors));
  const knownEnemies = new Set<EnemyKind>(Object.keys(enemies) as EnemyKind[]);
  modes.forEach((mode, index) => validateMode(mode, knownEnemies, `modes[${index}]`, errors));
  return { valid: errors.length === 0, errors };
};
