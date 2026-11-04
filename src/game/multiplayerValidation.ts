import {
  MAP_DEFINITIONS,
  MAP_SCALE_MAX,
  MAP_SCALE_MIN,
  MODE_DEFINITIONS,
  TOWER_ORDER,
  TOWER_PERK_ORDER,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./config.ts";
import type {
  MultiplayerLobbyState,
  MultiplayerResult,
  MultiplayerSessionStart,
} from "./multiplayer.ts";
import { calculateOfficialRunReward } from "./runRewards.ts";
import type { Point } from "./types.ts";
import {
  MAX_MAP_PATHS,
  MAX_PATH_BLOCKERS,
  MAP_PATH_WIDTH_MAX,
  MAP_PATH_WIDTH_MIN,
  PATH_BLOCKER_LENGTH_MAX,
  PATH_BLOCKER_LENGTH_MIN,
} from "./customMaps.ts";
import { isValidCustomEnemyDrawing } from "./customEnemyAppearance.ts";

type JsonRecord = any;

const record = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

const finite = (value: unknown, minimum = -1_000_000_000, maximum = 1_000_000_000): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

const safeInteger = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);

const point = (value: unknown): value is Point => {
  const candidate = record(value);
  return Boolean(candidate && finite(candidate.x, -100_000, 100_000) && finite(candidate.y, -100_000, 100_000));
};

const paletteValue = (value: unknown): value is string =>
  text(value, 128) && /^(#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i.test(value);

const validCustomEnemyAppearance = (value: unknown): boolean => {
  const appearance = record(value);
  if (!appearance) return false;
  if (appearance.mode !== "procedural" && appearance.mode !== "drawing") return false;
  if (appearance.pngDataUrl !== null && !isValidCustomEnemyDrawing(appearance.pngDataUrl)) return false;
  return appearance.mode === "procedural" ? appearance.pngDataUrl === null || isValidCustomEnemyDrawing(appearance.pngDataUrl) : isValidCustomEnemyDrawing(appearance.pngDataUrl);
};

const stableId = (value: unknown): value is string => text(value, 80) && /^[a-z0-9][a-z0-9:_-]{2,79}$/i.test(value);
const hpOperand = (value: unknown): boolean => {
  const operand = record(value);
  return Boolean(operand && (operand.unit === "absolute" || operand.unit === "percent") && finite(operand.value, 0, operand.unit === "percent" ? 100 : 10_000_000));
};
const abilityTrigger = (value: unknown): boolean => {
  const trigger = record(value);
  if (!trigger || !text(trigger.type, 32)) return false;
  if (["spawn", "blocked", "stunned", "attack", "death"].includes(trigger.type)) return true;
  if (trigger.type === "elapsed-time") return finite(trigger.at, 0, 86_400);
  if (trigger.type === "interval") return finite(trigger.every, 1 / 30, 600) && finite(trigger.initialDelay, 0, 600);
  return trigger.type === "hp-threshold" && (trigger.direction === "above" || trigger.direction === "below") && hpOperand(trigger.threshold);
};
const abilityCondition = (value: unknown): boolean => {
  const condition = record(value);
  if (!condition || !text(condition.type, 32)) return false;
  if (condition.type === "cooldown-ready" || condition.type === "uses-remaining") return true;
  if (condition.type === "hp") return (condition.minimum === null || hpOperand(condition.minimum)) && (condition.maximum === null || hpOperand(condition.maximum));
  if (condition.type === "age") return (condition.minimum === null || finite(condition.minimum, 0, 86_400)) && (condition.maximum === null || finite(condition.maximum, 0, 86_400));
  if (condition.type === "path-distance") return (condition.minimum === null || finite(condition.minimum, 0, 1_000_000)) && (condition.maximum === null || finite(condition.maximum, 0, 1_000_000));
  return condition.type === "target-state" && ["blocked", "unblocked", "target-present", "target-missing", "target-stunned", "target-not-stunned", "target-damaged", "target-full-health"].includes(condition.state);
};
const abilityAttack = (value: unknown): boolean => {
  if (value === null) return true;
  const attack = record(value); const delivery = record(attack?.delivery); const visuals = attack?.visuals;
  if (!attack || !delivery || !["first", "last", "strongest", "weakest", "closest"].includes(attack.targeting) || !finite(attack.range, 4, 2_000) || !safeInteger(attack.maxTargets, 1, 64) || !finite(attack.telegraphDuration, 0, 30) || !finite(attack.impactTime, attack.telegraphDuration, 600) || !["activation", "impact"].includes(attack.targetLock) || !Array.isArray(visuals) || visuals.length > 16) return false;
  if (delivery.type === "cone" && (!finite(delivery.depth, 4, 2_000) || !finite(delivery.angle, 5, 180)) || delivery.type === "wave" && (!finite(delivery.depth, 4, 2_000) || !finite(delivery.width, 4, 1_000)) || delivery.type === "radial" && !finite(delivery.radius, 4, 2_000) || !["targeted", "cone", "wave", "radial"].includes(delivery.type)) return false;
  const ids = new Set<string>();
  return visuals.every((value: unknown) => { const visual = record(value); if (!visual || !stableId(visual.id) || ids.has(visual.id) || !["projectile", "beam", "explosion", "lightning", "wave", "slash"].includes(visual.type) || !paletteValue(visual.color) || !finite(visual.size, 0.1, 10) || !finite(visual.width, 0.5, 100) || !finite(visual.duration, 0.05, 10) || !finite(visual.speed, 40, 2_000) || !finite(visual.startOffset, 0, 600)) return false; ids.add(visual.id); return true; });
};
const summonModifiers = (value: unknown): boolean => {
  const modifiers = record(value);
  const baseValid = Boolean(modifiers && ["hitCashMultiplier", "hpMultiplier", "shieldMultiplier", "speedMultiplier", "damageMultiplier", "attackIntervalMultiplier", "coreDamageMultiplier"].every((key) => finite(modifiers[key], key === "attackIntervalMultiplier" ? 0.1 : 0, 10)) && finite(modifiers.defenseBonus, -1_000_000, 1_000_000) && safeInteger(modifiers.protectionBonus, -999, 999) && finite(modifiers.armorBonus, -1, 1) && finite(modifiers.superarmorBonus, -1, 1));
  if (!baseValid) return false;
  if (modifiers?.resistanceBonuses !== undefined) {
    const res = record(modifiers.resistanceBonuses);
    if (!res) return false;
    for (const val of Object.values(res)) {
      if (typeof val !== "number" || !Number.isFinite(val)) return false;
    }
  }
  return true;
};
const abilityAction = (value: unknown): boolean => {
  const action = record(value);
  if (!action || !stableId(action.id) || !finite(action.delay, 0, 600) || !text(action.type, 32)) return false;
  if (action.type === "damage") return finite(action.amount, 0, 1_000_000);
  if (action.type === "stun") return finite(action.duration, 0, 60);
  if (action.type === "summon") return safeInteger(action.count, 1, 100) && Array.isArray(action.kinds) && action.kinds.length > 0 && action.kinds.length <= 64 && action.kinds.every((kind: unknown) => text(kind, 128)) && summonModifiers(action.modifiers);
  if (action.type === "regeneration") return ["total", "rate"].includes(action.mode) && finite(action.amount, 0, 10_000_000) && (action.duration === null || finite(action.duration, 0.1, 600));
  if (action.type === "movement-lock") return finite(action.duration, 0, 600) && safeInteger(action.waves, 0, 999);
  if (action.type === "blink") return finite(action.distance, 5, 1_000);
  if (action.type === "invulnerability" || action.type === "phase") return finite(action.duration, 0.1, 600);
  if (action.type === "stat-change") return finite(action.duration, 0.1, 600) && finite(action.speedMultiplier, 0, 10) && finite(action.damageMultiplier, 0, 10);
  if (action.type === "haste") return finite(action.radius, 20, 1_000) && finite(action.duration, 0.1, 60) && finite(action.multiplier, 1, 5);
  return action.type === "drain" && finite(action.damage, 0, 1_000_000) && finite(action.healingPerTarget, 0, 1_000_000);
};
const validAbility = (value: unknown): boolean => {
  const ability = record(value); const conditions = ability?.conditions; const actions = ability?.actions;
  if (!ability || !stableId(ability.id) || !text(ability.name, 40) || typeof ability.enabled !== "boolean" || !["basic", "advanced"].includes(ability.editorMode) || !safeInteger(ability.priority, -999, 999) || !finite(ability.cooldown, 0, 600) || !safeInteger(ability.maxUses, 0, 999) || !(ability.exclusiveGroup === null || text(ability.exclusiveGroup, 40)) || !abilityTrigger(ability.trigger) || !Array.isArray(conditions) || conditions.length > 16 || !conditions.every(abilityCondition) || !abilityAttack(ability.attack) || !Array.isArray(actions) || actions.length === 0 || actions.length > 32 || !actions.every(abilityAction)) return false;
  const actionIds = actions.map((action: JsonRecord) => action.id); const targetAction = actions.some((action: JsonRecord) => ["damage", "stun", "drain"].includes(action.type));
  return new Set(actionIds).size === actionIds.length && (!targetAction || ability.attack !== null);
};

const validCustomEnemyPayload = (value: unknown): boolean => {
  const enemy = record(value);
  if (!enemy) return false;
  if (enemy.version !== 4 || !text(enemy.id, 128) || !text(enemy.name, 40) || !Array.isArray(enemy.abilities) || enemy.abilities.length > 64 || !enemy.abilities.every(validAbility) || new Set(enemy.abilities.map((ability: JsonRecord) => ability.id)).size !== enemy.abilities.length) return false;
  if (enemy.opacity !== undefined && !finite(enemy.opacity, 0, 1)) return false;
  if (enemy.appearance !== undefined && !validCustomEnemyAppearance(enemy.appearance)) return false;
  if (enemy.resistances !== undefined) {
    const res = record(enemy.resistances);
    if (!res) return false;
    for (const val of Object.values(res)) {
      if (typeof val !== "number" || !Number.isFinite(val) || val > 1) return false;
    }
  }
  return true;
};

const hasSummonCycle = (values: readonly unknown[]): boolean => {
  const enemies = values.map(record).filter((enemy): enemy is JsonRecord => Boolean(enemy));
  const known = new Set(enemies.map((enemy) => enemy.id));
  const edges = new Map<string, string[]>(enemies.map((enemy) => [enemy.id, enemy.abilities.flatMap((ability: JsonRecord) => ability.actions.flatMap((action: JsonRecord) => action.type === "summon" ? action.kinds.filter((kind: string) => known.has(kind)) : []))]));
  const visit = (id: string, visiting: Set<string>, visited: Set<string>): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((edges.get(id) ?? []).some((next) => visit(next, visiting, visited))) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  const visited = new Set<string>();
  return [...known].some((id) => visit(id, new Set(), visited));
};

/** Validates the complete host-authorized session snapshot received by a guest. */
export function isValidMultiplayerSessionStart(session: unknown, expectedSessionId: string): session is MultiplayerSessionStart {
  try {
    const root = record(session);
    const map = record(root?.map);
    const mode = record(root?.mode);
    const palette = record(map?.palette);
    const players = root?.players;
    const allowedTowers = root?.allowedTowers;
    const customEnemies = root?.customEnemies;
    const waves = mode?.waves;
    if (!root || !map || !mode || !palette || root.id !== expectedSessionId || !safeInteger(root.round, 1, 1_000_000) ||
      !text(map.kind, 128) || !text(map.name, 120) || !text(map.description, 500) || typeof map.isCustom !== "boolean" ||
      !safeInteger(map.index, 0, 1_000) || !finite(map.rewardMultiplier, 0, 10) || !finite(map.mapScale, MAP_SCALE_MIN, MAP_SCALE_MAX) ||
      !Array.isArray(map.path) || map.path.length < 2 || map.path.length > 64 || !map.path.every(point) ||
      !Array.isArray(map.paths) || map.paths.length < 1 || map.paths.length > MAX_MAP_PATHS || !map.paths.every((value: unknown) => {
        const route = record(value);
        return Boolean(route && text(route.id, 128) && finite(route.width, MAP_PATH_WIDTH_MIN, MAP_PATH_WIDTH_MAX) && (route.pathType === "round" || route.pathType === "sharp" || route.pathType === "rubble") && (route.pathSurface === "solid" || route.pathSurface === "edges") && Array.isArray(route.path) && route.path.length >= 2 && route.path.length <= 64 && route.path.every(point) && point(route.core) && point(route.entryLabel) && point(route.pathLabel));
      }) || (map.enemyRouting !== undefined && map.enemyRouting !== "split" && map.enemyRouting !== "multiply") ||
      !point(map.core) || !point(map.entryLabel) || !point(map.pathLabel) || !Array.isArray(map.blockedZones) || map.blockedZones.length > 64 ||
      !map.blockedZones.every((value: unknown) => {
        const zone = record(value);
        return Boolean(zone && text(zone.id, 128) && finite(zone.x, -100_000, 100_000) && finite(zone.y, -100_000, 100_000) && finite(zone.width, 0, WORLD_WIDTH) && finite(zone.height, 0, WORLD_HEIGHT));
      }) || !Array.isArray(map.pathBlockers) || map.pathBlockers.length > MAX_PATH_BLOCKERS ||
      !map.pathBlockers.every((value: unknown) => {
        const blocker = record(value);
        return Boolean(blocker && text(blocker.id, 128) && safeInteger(blocker.pathIndex, 0, MAX_MAP_PATHS - 1) && finite(blocker.startDistance, 0, 1_000_000) && finite(blocker.length, PATH_BLOCKER_LENGTH_MIN, PATH_BLOCKER_LENGTH_MAX));
      }) || !paletteValue(palette.field) || !paletteValue(palette.glow) || !paletteValue(palette.path) || !paletteValue(palette.accent) ||
      !text(mode.kind, 128) || !text(mode.name, 120) || !text(mode.description, 500) || typeof mode.isCustom !== "boolean" ||
      !safeInteger(mode.index, 0, 1_000) || !finite(mode.startingCash, 0, 1_000_000_000) || !finite(mode.coreIntegrity, 1, 1_000_000) ||
      !finite(mode.multiplayerHitCashMultiplier, 0, 1) || !record(mode.reward) || !finite(record(mode.reward)?.coins, 0, 1_000_000_000) || !finite(record(mode.reward)?.tokens, 0, 1_000_000_000) ||
      !Array.isArray(waves) || waves.length === 0 || waves.length > 250 || !Array.isArray(allowedTowers) || allowedTowers.length === 0 || allowedTowers.length > TOWER_ORDER.length || new Set(allowedTowers).size !== allowedTowers.length || !allowedTowers.every((kind: unknown) => TOWER_ORDER.includes(kind as typeof TOWER_ORDER[number])) || !Array.isArray(players) || players.length !== 2 ||
      !Array.isArray(customEnemies) || customEnemies.length > 256 || !customEnemies.every(validCustomEnemyPayload) || hasSummonCycle(customEnemies)) return false;

    const officialMap = !map.isCustom && typeof map.kind === "string"
      ? Object.values(MAP_DEFINITIONS).find((candidate) => candidate.kind === map.kind)
      : null;
    const officialMode = !mode.isCustom && typeof mode.kind === "string"
      ? MODE_DEFINITIONS.find((candidate) => candidate.kind === mode.kind)
      : null;
    if ((!map.isCustom && (!officialMap || map.rewardMultiplier !== officialMap.rewardMultiplier)) ||
      (!mode.isCustom && (!officialMode || record(mode.reward)?.coins !== officialMode.reward.coins || record(mode.reward)?.tokens !== officialMode.reward.tokens))) return false;

    const playerIds = new Set<string>();
    if (!players.every((value: unknown) => {
      const player = record(value);
      if (!player || !text(player.id, 64) || !/^[a-z0-9-]{4,64}$/i.test(player.id) || playerIds.has(player.id) ||
        !text(player.username, 20) || typeof player.color !== "string" || !/^#[0-9a-f]{6}$/i.test(player.color) ||
        !Array.isArray(player.loadout) || player.loadout.length > 5 ||
        !player.loadout.every((kind: unknown) => typeof kind === "string" && allowedTowers.includes(kind)) ||
        !Array.isArray(player.perkLoadout) || player.perkLoadout.length > 3 || new Set(player.perkLoadout).size !== player.perkLoadout.length ||
        !player.perkLoadout.every((kind: unknown) => typeof kind === "string" && TOWER_PERK_ORDER.includes(kind as typeof TOWER_PERK_ORDER[number]))) return false;
      playerIds.add(player.id);
      return true;
    })) return false;

    const validWave = (value: unknown): boolean => {
      const wave = record(value);
      if (!wave || !finite(wave.referenceHealth, 0, 1_000_000_000_000) ||
        !(wave.waveTimeSeconds === null || finite(wave.waveTimeSeconds, 0, 86_400)) ||
        (wave.cashReward !== undefined && !finite(wave.cashReward, 0, 1_000_000_000)) ||
        (wave.message !== undefined && !text(wave.message, 1_000))) return false;
      let enemyCount = 0;
      const validGroup = (candidate: unknown): boolean => {
        const group = record(candidate);
        if (!group || typeof group.kind !== "string" || group.kind.length > 128 || !safeInteger(group.count, 0, 10_000) || !finite(group.gap, 0, 3_600)) return false;
        enemyCount += group.count;
        return enemyCount <= 100_000;
      };
      const validBlock = (candidate: unknown): boolean => {
        const block = record(candidate);
        if (!block || block.command !== "enemyGroup" || typeof block.enemy !== "string" || block.enemy.length > 128 || !safeInteger(block.count, 0, 10_000) || !finite(block.spawnDelay, 0, 3_600) || !finite(block.nextBlockDelay, 0, 3_600)) return false;
        if (block.spawnPathIndex !== undefined && !safeInteger(block.spawnPathIndex, 0, 1_000)) return false;
        enemyCount += block.count;
        return enemyCount <= 100_000;
      };
      const groups = wave.groups;
      const blocks = wave.blocks;
      return (groups === undefined || (Array.isArray(groups) && groups.length <= 100 && groups.every(validGroup))) &&
        (blocks === undefined || (Array.isArray(blocks) && blocks.length <= 100 && blocks.every(validBlock)));
    };
    return waves.every(validWave);
  } catch {
    return false;
  }
}

export function isValidMultiplayerLobbyState(state: unknown, expectedSessionId: string): state is MultiplayerLobbyState {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const candidate = state as any;
  if (candidate.id !== expectedSessionId || !Number.isSafeInteger(candidate.round) || candidate.round < 0 || candidate.round > 1_000_000 ||
    (candidate.phase !== "lobby" && candidate.phase !== "playing") || typeof candidate.guestReady !== "boolean") return false;
  return candidate.session === null || (isValidMultiplayerSessionStart(candidate.session, expectedSessionId) && candidate.session.round === candidate.round);
}

export interface MultiplayerResultValidationContext {
  readonly session: MultiplayerSessionStart;
  readonly activeModeWaves: number;
  readonly activeMapKind: string;
  readonly activeModeKind: string;
  readonly activeModeIsCustom: boolean;
  readonly activeMapIsCustom: boolean;
  readonly mapTestActive: boolean;
  readonly rewardCoins: number;
  readonly rewardTokens: number;
  readonly mapRewardMultiplier: number;
}

export function isValidMultiplayerResult(result: unknown, context: MultiplayerResultValidationContext): result is MultiplayerResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const candidate = result as any;
  if (typeof candidate.id !== "string" || !Number.isSafeInteger(candidate.round) || candidate.round !== context.session.round || typeof candidate.victory !== "boolean" || typeof candidate.official !== "boolean" ||
    !Number.isSafeInteger(candidate.wave) || candidate.wave < 0 || candidate.wave > context.activeModeWaves ||
    !Number.isSafeInteger(candidate.coins) || candidate.coins < 0 || candidate.coins > 1_000_000_000 ||
    !Number.isSafeInteger(candidate.tokens) || candidate.tokens < 0 || candidate.tokens > 1_000_000_000 ||
    candidate.mapKind !== context.activeMapKind || candidate.modeKind !== context.activeModeKind) return false;
  const official = !context.activeModeIsCustom && !context.activeMapIsCustom && !context.mapTestActive;
  const { coins: expectedCoins, tokens: expectedTokens } = calculateOfficialRunReward(
    candidate.victory, candidate.wave, context.session.mode, context.mapRewardMultiplier,
  );
  return candidate.id === `${context.session.id}:${candidate.round}:${candidate.victory ? "victory" : "defeat"}:${candidate.wave}` &&
    candidate.official === official && candidate.coins === (official ? expectedCoins : 0) && candidate.tokens === (official ? expectedTokens : 0);
}
