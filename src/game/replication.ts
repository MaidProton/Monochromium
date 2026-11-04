import { MULTIPLAYER_PROTOCOL_VERSION, type MultiplayerGameSnapshot, type MultiplayerPilotInputAck, type MultiplayerPlayerState, type SerializedTimedBomb, type SerializedTower } from "./multiplayer.ts";
import { decodeCompact, encodeCompact } from "./compactCodec.ts";
import type { SimulationEvent } from "./simulationProtocol.ts";
import type { Enemy, Point } from "./types.ts";

const MAGIC = 0x4d4f4e4f;
const HEADER_BYTES = 28;
const FLAG_KEYFRAME = 1;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const enemyFields = ["pathIndex", "pathDistance", "hp", "shieldHp", "protection", "targetTowerId", "attackTimer", "stunTimer", "slowTimer", "slowFactor", "burnTimer", "burnSlowFactor", "burnTickInterval", "burnSpeedFactor", "hitFlash", "spawnScale", "hasteTimer", "hasteFactor", "phaseTimer", "lockTriggered", "lockTimeRemaining", "lockWavesRemaining", "behaviorMovementLockTimer", "behaviorInvulnerableTimer", "behaviorSpeedFactor", "behaviorDamageFactor"] as const satisfies readonly (keyof Enemy)[];
type EnemyPatch = readonly [id: number, mask: number, ...values: unknown[]];
const towerFields = [
  "perks", "position", "onPath", "pathIndex", "pathDistance", "level", "totalInvested", "targeting", "hp", "maxHp", "maxAggro", "engaged", "fireTimer", "counterCooldown", "autoCounter", "counterFlash", "hurtFlash", "selectedPulse", "fortifyCharges", "overdriveTimer", "overdriveMultiplier", "damageBuff", "abilityTimer", "perkPrepTimer", "senselessStance", "abilityCooldown", "abilityCooldowns", "aimPoint", "aiming", "focus", "samuraiFocusDecayTimer", "ammo", "attackRamp", "rampTimer", "rampStackTimers", "fireRateBuff", "stunTimer", "burstTimer", "burstTargetId", "burstShotsRemaining", "burstSpacing",
  "mutinyKillProgress", "mutinyDamageProgress", "mutinyStackTimers", "autoCounter", "mechaControlled", "mechaFiring", "mechaActiveAbility", "mechaAbilityTimer", "mechaHeat", "mechaOverheatTimer", "mechaHullAngle", "mechaTurretAngle", "mechaSpeed",
] as const satisfies readonly (keyof SerializedTower)[];
type TowerPatch = readonly [id: number, lowMask: number, highMask: number, ...values: unknown[]];
type MatchState = Pick<MultiplayerGameSnapshot, "integrity" | "maxIntegrity" | "wave" | "waveActive" | "intermissionRemaining" | "nextWaveIndex" | "paused" | "speed" | "started" | "gameOver" | "modeComplete">;
const matchFields = ["integrity", "maxIntegrity", "wave", "waveActive", "intermissionRemaining", "nextWaveIndex", "paused", "speed", "started", "gameOver", "modeComplete"] as const satisfies readonly (keyof MatchState)[];
type MatchPatch = readonly [mask: number, ...values: unknown[]];
const playerFields = ["shards", "pendingCasualtyRefund", "copiesRemaining"] as const satisfies readonly (keyof MultiplayerPlayerState)[];
type PlayerPatch = readonly [id: string, mask: number, ...values: unknown[]];
type WireEvent = readonly [
  id: number, tick: number, kind: SimulationEvent["kind"], entityId: number | null, targetId: number | null,
  position: Point | null, from: Point | null, visual: SimulationEvent["visual"] | null, speed: number | null,
  color: string | null, value: number | null, count: number | null, duration: number | null,
  label: string | null, tone: SimulationEvent["tone"] | null, abilityId: string | null,
  actionId: string | null, phase: SimulationEvent["phase"] | null, cosmeticSeed: number,
  occurrenceTickOffsets: readonly number[] | null,
];

interface DeltaPayload {
  readonly sentAt: number;
  readonly matchCreate?: MatchState;
  readonly matchUpdate?: MatchPatch;
  readonly playerCreates: readonly MultiplayerPlayerState[];
  readonly playerUpdates: readonly PlayerPatch[];
  readonly playerRemoves: readonly string[];
  readonly towerCreates: readonly SerializedTower[];
  readonly towerUpdates: readonly TowerPatch[];
  readonly towerRemoves: readonly number[];
  readonly enemyCreates: readonly Enemy[];
  readonly enemyUpdates: readonly EnemyPatch[];
  readonly enemyRemoves: readonly number[];
  readonly timedBombs?: readonly SerializedTimedBomb[];
  readonly events: readonly SimulationEvent[];
  readonly hostCursor?: Point | null;
  readonly guestPulseSequence: number;
  readonly pilotInputAcks: readonly MultiplayerPilotInputAck[];
}
type WirePayload = readonly [
  sentAt: number, matchCreate: MatchState | null, matchUpdate: MatchPatch | null,
  playerCreates: readonly MultiplayerPlayerState[], playerUpdates: readonly PlayerPatch[], playerRemoves: readonly string[],
  towerCreates: readonly SerializedTower[], towerUpdates: readonly TowerPatch[], towerRemoves: readonly number[],
  enemyCreates: readonly Enemy[], enemyUpdates: readonly EnemyPatch[], enemyRemoves: readonly number[],
  timedBombs: readonly SerializedTimedBomb[] | null, events: readonly WireEvent[], hostCursor: Point | null,
  guestPulseSequence: number, pilotInputAcks: readonly MultiplayerPilotInputAck[],
];

export interface ReplicationPacketOptions {
  readonly events?: readonly SimulationEvent[];
  readonly hostCursor?: Point | null;
  readonly guestPulseSequence?: number;
  readonly pilotInputAcks?: readonly MultiplayerPilotInputAck[];
}

export interface DecodedReplicationFrame {
  readonly sequence: number;
  readonly serverTick: number;
  readonly baselineSequence: number;
  readonly keyframe: boolean;
  readonly snapshot: MultiplayerGameSnapshot;
  readonly events: readonly SimulationEvent[];
  readonly hostCursor?: Point | null;
  readonly guestPulseSequence: number;
  readonly pilotInputAcks: readonly MultiplayerPilotInputAck[];
  readonly bytes: number;
}

const sessionHash = (sessionId: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sessionId.length; index += 1) { hash ^= sessionId.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
};
export const isReplicationKeyframe = (input: unknown): boolean => {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : null;
  return Boolean(bytes && bytes.byteLength >= HEADER_BYTES && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === MAGIC && (bytes[6]! & FLAG_KEYFRAME) !== 0);
};
const q = (value: number, scale: number): number => Math.round(value * scale);
const uq = (value: unknown, scale: number): number => Number(value) / scale;
const pointToWire = (value: Point | null | undefined): Point | null | undefined => value === undefined ? undefined : value === null ? null : { x: q(value.x, 16), y: q(value.y, 16) };
const pointFromWire = (value: unknown): Point | null | undefined => value === undefined ? undefined : value === null ? null : { x: uq((value as Point).x, 16), y: uq((value as Point).y, 16) };
const timerFields = new Set(["attackTimer", "stunTimer", "slowTimer", "burnTimer", "burnTickInterval", "hitFlash", "spawnScale", "hasteTimer", "phaseTimer", "lockTimeRemaining", "behaviorMovementLockTimer", "behaviorInvulnerableTimer", "fireTimer", "counterCooldown", "counterFlash", "hurtFlash", "selectedPulse", "overdriveTimer", "abilityTimer", "perkPrepTimer", "abilityCooldown", "rampTimer", "fieldTimer", "burstTimer", "burstSpacing", "mechaAbilityTimer", "mechaOverheatTimer"]);
const heatFields = new Set(["mechaHeat", "mechaSpeed"]);
const angleFields = new Set(["mechaHullAngle", "mechaTurretAngle"]);
const hpFields = new Set(["hp", "maxHp", "shieldHp", "maxShieldHp", "integrity", "maxIntegrity"]);
const factorFields = new Set(["slowFactor", "burnSlowFactor", "burnSpeedFactor", "hasteFactor", "behaviorSpeedFactor", "behaviorDamageFactor", "damageBuff", "focus", "attackRamp", "fireRateBuff"]);
const fieldToWire = (field: string, value: unknown): unknown => {
  if (field === "position" || field === "aimPoint") return pointToWire(value as Point | null | undefined);
  if (field === "pathDistance") return q(Number(value), 16);
  if (timerFields.has(field)) return q(Number(value), 60);
  if (heatFields.has(field)) return q(Number(value), 100);
  if (angleFields.has(field)) return q(Number(value), 1_000);
  if (hpFields.has(field)) return q(Number(value), 100);
  if (factorFields.has(field)) return q(Number(value), 1_000);
  if (field === "abilityCooldowns" && value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, number>).map(([slot, timer]) => [slot, q(timer, 60)]));
  if ((field === "rampStackTimers" || field === "mutinyStackTimers") && Array.isArray(value)) return value.map((timer) => q(Number(timer), 60));
  return value;
};
const fieldFromWire = (field: string, value: unknown): unknown => {
  if (field === "position" || field === "aimPoint") return pointFromWire(value);
  if (field === "pathDistance") return uq(value, 16);
  if (timerFields.has(field)) return uq(value, 60);
  if (heatFields.has(field)) return uq(value, 100);
  if (angleFields.has(field)) return uq(value, 1_000);
  if (hpFields.has(field)) return uq(value, 100);
  if (factorFields.has(field)) return uq(value, 1_000);
  if (field === "abilityCooldowns" && value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, number>).map(([slot, timer]) => [slot, uq(timer, 60)]));
  if ((field === "rampStackTimers" || field === "mutinyStackTimers") && Array.isArray(value)) return value.map((timer) => uq(timer, 60));
  return value;
};
const objectToWire = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => [field, fieldToWire(field, fieldValue)])) as T;
const objectFromWire = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => [field, fieldFromWire(field, fieldValue)])) as T;
const sameWireValue = (field: string, left: unknown, right: unknown): boolean => {
  const a = fieldToWire(field, left); const b = fieldToWire(field, right);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => value === b[index]);
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
};
const sameBombIdentity = (left: SerializedTimedBomb, right: SerializedTimedBomb): boolean => q(left.position.x, 16) === q(right.position.x, 16) && q(left.position.y, 16) === q(right.position.y, 16) && left.playerId === right.playerId && left.sourceTowerId === right.sourceTowerId && left.proximity === right.proximity;
const sameBombSet = (left: readonly SerializedTimedBomb[], right: readonly SerializedTimedBomb[]): boolean => left.length === right.length && left.every((bomb, index) => Boolean(right[index] && sameBombIdentity(bomb, right[index]!)));
const eventToWire = (event: SimulationEvent): WireEvent => [
  event.id, event.tick, event.kind, event.entityId ?? null, event.targetId ?? null,
  pointToWire(event.position) ?? null, pointToWire(event.from) ?? null, event.visual ?? null, event.speed ?? null,
  event.color ?? null, event.value ?? null, event.count ?? null, event.duration === undefined ? null : q(event.duration, 60),
  event.label ?? null, event.tone ?? null, event.abilityId ?? null, event.actionId ?? null, event.phase ?? null, event.cosmeticSeed,
  event.occurrenceTickOffsets ?? null,
];
const eventFromWire = (value: unknown): SimulationEvent => {
  if (!Array.isArray(value) || value.length !== 20 || !Number.isSafeInteger(value[0]) || !Number.isSafeInteger(value[1]) || typeof value[2] !== "string" || !Number.isSafeInteger(value[18])) throw new Error("Malformed replication event.");
  if (value[15] !== null && (typeof value[15] !== "string" || value[15].length > 80) || value[16] !== null && (typeof value[16] !== "string" || value[16].length > 80) || value[17] !== null && !["trigger", "telegraph", "target-lock", "impact", "action", "complete"].includes(String(value[17]))) throw new Error("Malformed replication event lifecycle.");
  if (value[19] !== null && (!Array.isArray(value[19]) || value[19].length > 16 || !value[19].every((offset) => Number.isSafeInteger(offset) && offset >= -90 && offset <= 0))) throw new Error("Malformed replication event timing.");
  return {
    id: value[0] as number, tick: value[1] as number, kind: value[2] as SimulationEvent["kind"],
    ...(value[3] === null ? {} : { entityId: Number(value[3]) }), ...(value[4] === null ? {} : { targetId: Number(value[4]) }),
    ...(value[5] === null ? {} : { position: pointFromWire(value[5]) as Point }), ...(value[6] === null ? {} : { from: pointFromWire(value[6]) as Point }),
    ...(value[7] === null ? {} : { visual: value[7] as SimulationEvent["visual"] }), ...(value[8] === null ? {} : { speed: Number(value[8]) }),
    ...(value[9] === null ? {} : { color: String(value[9]) }), ...(value[10] === null ? {} : { value: Number(value[10]) }),
    ...(value[11] === null ? {} : { count: Number(value[11]) }), ...(value[12] === null ? {} : { duration: uq(value[12], 60) }),
    ...(value[13] === null ? {} : { label: String(value[13]) }), ...(value[14] === null ? {} : { tone: value[14] as SimulationEvent["tone"] }),
    ...(value[15] === null ? {} : { abilityId: String(value[15]) }), ...(value[16] === null ? {} : { actionId: String(value[16]) }),
    ...(value[17] === null ? {} : { phase: value[17] as SimulationEvent["phase"] }), cosmeticSeed: value[18] as number,
    ...(value[19] === null ? {} : { occurrenceTickOffsets: value[19] as number[] }),
  };
};
export const replicationEventBytes = (events: readonly SimulationEvent[]): number => encodeCompact(events.map(eventToWire)).byteLength;

const cloneSnapshot = (snapshot: MultiplayerGameSnapshot): MultiplayerGameSnapshot => ({
  ...snapshot,
  players: snapshot.players.map((player) => ({ ...player, copiesRemaining: { ...player.copiesRemaining } })),
  towers: snapshot.towers.map((tower) => ({ ...tower, perks: [...tower.perks], position: { ...tower.position },
    aimPoint: tower.aimPoint ? { ...tower.aimPoint } : tower.aimPoint,
    ...(tower.abilityCooldowns ? { abilityCooldowns: { ...tower.abilityCooldowns } } : {}),
    rampStackTimers: [...tower.rampStackTimers], engaged: [...tower.engaged], mutinyStackTimers: [...(tower.mutinyStackTimers ?? [])] })),
  enemies: snapshot.enemies.map((enemy) => ({ ...enemy })), projectiles: [], particles: [],
  timedBombs: snapshot.timedBombs.map((bomb) => ({ ...bomb, position: { ...bomb.position } })), spawnQueue: [],
});
const clientProjection = (snapshot: MultiplayerGameSnapshot): MultiplayerGameSnapshot => {
  const projected = cloneSnapshot(snapshot);
  const projectedTowers = projected.towers.map((tower) => {
    const next = { ...tower };
    // Charge is a client-side presentation lifecycle. The authoritative
    // server still owns these fields, but they never enter state packets.
    delete next.zenithChargeTimer;
    delete next.zenithChargeTargetId;
    delete next.zenithChargeAngle;
    return next;
  });
  const projectedEnemies = projected.enemies.map((enemy) => {
    const next = { ...enemy };
    delete next.abilityRuntime;
    return next;
  });
  return {
    ...projected,
    towers: projectedTowers.map((tower) => ({ ...tower, fireTimer: tower.kind === "admiral" || tower.kind === "mecha" ? tower.fireTimer : 0, meleeTimer: 0, shotCounter: 0, idleTimer: 0, rocketTimer: 0, fieldTickTimer: 0, fieldVfxTimer: 0, regenTimer: 0, burstTargetId: null, burstShotsRemaining: 0, rampStackTimers: [] })),
    enemies: projectedEnemies.map((enemy) => ({ ...enemy, shockStacks: 0, burnTickTimer: 0, burnDamage: 0, burnOwnerId: null, summonTimer: 0, abilityTimer: 0, regenerationVfxTimer: 0, hasteCooldown: 0, drainCooldown: 0, phaseCooldown: 0, blinkCooldown: 0, aliveTime: 0, attackCooldowns: [], attackUses: [], behaviorMovementLockTimer: enemy.behaviorMovementLockTimer ?? 0, behaviorInvulnerableTimer: enemy.behaviorInvulnerableTimer ?? 0, behaviorSpeedFactor: enemy.behaviorSpeedFactor ?? 1, behaviorDamageFactor: enemy.behaviorDamageFactor ?? 1, behaviorRuleUses: [], behaviorRuleCooldowns: [], behaviorActionQueue: [], behaviorEffects: [] })),
    timedBombs: projected.timedBombs.map((bomb) => ({ ...bomb, timer: Number.isFinite(bomb.timer) ? bomb.timer : 0 })),
  };
};
const matchState = (snapshot: MultiplayerGameSnapshot): MatchState => Object.fromEntries(matchFields.map((field) => [field, snapshot[field]])) as MatchState;

export class ReplicationEncoder {
  private previous: MultiplayerGameSnapshot | null = null;
  private sequence = 0;
  reset(): void { this.previous = null; this.sequence = 0; }
  encode(sessionId: string, serverTick: number, source: MultiplayerGameSnapshot, forceKeyframe = false, options: ReplicationPacketOptions = {}): ArrayBuffer {
    const current = clientProjection(source); const keyframe = forceKeyframe || this.previous === null; const baselineSequence = keyframe ? 0 : this.sequence;
    const priorEnemies = new Map((this.previous?.enemies ?? []).map((enemy) => [enemy.id, enemy])); const priorTowers = new Map((this.previous?.towers ?? []).map((tower) => [tower.id, tower])); const priorPlayers = new Map((this.previous?.players ?? []).map((player) => [player.id, player]));
    const currentEnemyIds = new Set(current.enemies.map((enemy) => enemy.id)); const currentTowerIds = new Set(current.towers.map((tower) => tower.id)); const currentPlayerIds = new Set(current.players.map((player) => player.id));
    const enemyCreates: Enemy[] = []; const enemyUpdates: EnemyPatch[] = []; const towerCreates: SerializedTower[] = []; const towerUpdates: TowerPatch[] = []; const playerCreates: MultiplayerPlayerState[] = []; const playerUpdates: PlayerPatch[] = [];
    for (const tower of current.towers) {
      const prior = priorTowers.get(tower.id); if (keyframe || !prior) { towerCreates.push(objectToWire(tower as unknown as Record<string, unknown>) as unknown as SerializedTower); continue; }
      let lowMask = 0; let highMask = 0; const values: unknown[] = [];
      towerFields.forEach((field, index) => { if (sameWireValue(field, prior[field], tower[field])) return; if (index < 32) lowMask |= 1 << index; else highMask |= 1 << (index - 32); values.push(fieldToWire(field, tower[field])); });
      if (lowMask !== 0 || highMask !== 0) towerUpdates.push([tower.id, lowMask, highMask, ...values]);
    }
    for (const enemy of current.enemies) {
      const prior = priorEnemies.get(enemy.id); if (keyframe || !prior) { enemyCreates.push(objectToWire(enemy as unknown as Record<string, unknown>) as unknown as Enemy); continue; }
      let mask = 0; const values: unknown[] = []; enemyFields.forEach((field, index) => { if (sameWireValue(field, prior[field], enemy[field])) return; mask |= 1 << index; values.push(fieldToWire(field, enemy[field])); }); if (mask !== 0) enemyUpdates.push([enemy.id, mask, ...values]);
    }
    for (const player of current.players) {
      const prior = priorPlayers.get(player.id); if (keyframe || !prior) { playerCreates.push(player); continue; }
      let mask = 0; const values: unknown[] = []; playerFields.forEach((field, index) => { if (sameWireValue(field, prior[field], player[field])) return; mask |= 1 << index; values.push(fieldToWire(field, player[field])); }); if (mask !== 0) playerUpdates.push([player.id, mask, ...values]);
    }
    let matchUpdate: MatchPatch | undefined;
    if (!keyframe && this.previous) { let mask = 0; const values: unknown[] = []; matchFields.forEach((field, index) => { if (sameWireValue(field, this.previous![field], current[field])) return; mask |= 1 << index; values.push(fieldToWire(field, current[field])); }); if (mask !== 0) matchUpdate = [mask, ...values]; }
    const payload: DeltaPayload = {
      sentAt: current.sentAt,
      ...(keyframe ? { matchCreate: objectToWire(matchState(current) as unknown as Record<string, unknown>) as unknown as MatchState } : {}), ...(matchUpdate ? { matchUpdate } : {}),
      playerCreates, playerUpdates, playerRemoves: keyframe ? [] : [...priorPlayers.keys()].filter((id) => !currentPlayerIds.has(id)),
      towerCreates, towerUpdates, towerRemoves: keyframe ? [] : [...priorTowers.keys()].filter((id) => !currentTowerIds.has(id)),
      enemyCreates, enemyUpdates, enemyRemoves: keyframe ? [] : [...priorEnemies.keys()].filter((id) => !currentEnemyIds.has(id)),
      ...(keyframe || !this.previous || !sameBombSet(this.previous.timedBombs, current.timedBombs) ? { timedBombs: current.timedBombs.map((bomb) => objectToWire(bomb as unknown as Record<string, unknown>) as unknown as SerializedTimedBomb) } : {}),
      events: options.events ?? [], ...(options.hostCursor === undefined ? {} : { hostCursor: pointToWire(options.hostCursor) as Point | null }), guestPulseSequence: options.guestPulseSequence ?? 0,
      pilotInputAcks: options.pilotInputAcks ?? [],
    };
    const wirePayload: WirePayload = [
      payload.sentAt, payload.matchCreate ?? null, payload.matchUpdate ?? null,
      payload.playerCreates, payload.playerUpdates, payload.playerRemoves,
      payload.towerCreates, payload.towerUpdates, payload.towerRemoves,
      payload.enemyCreates, payload.enemyUpdates, payload.enemyRemoves,
      payload.timedBombs ?? null, payload.events.map(eventToWire), (payload.hostCursor ?? null), payload.guestPulseSequence, payload.pilotInputAcks,
    ];
    const encoded = encodeCompact(wirePayload); if (encoded.byteLength + HEADER_BYTES > MAX_FRAME_BYTES) throw new Error("Replication frame exceeds the 8 MB limit.");
    const frameSequence = ++this.sequence; const buffer = new ArrayBuffer(HEADER_BYTES + encoded.byteLength); const view = new DataView(buffer);
    view.setUint32(0, MAGIC); view.setUint16(4, MULTIPLAYER_PROTOCOL_VERSION); view.setUint8(6, keyframe ? FLAG_KEYFRAME : 0); view.setUint8(7, 0); view.setUint32(8, sessionHash(sessionId)); view.setUint32(12, frameSequence); view.setUint32(16, serverTick); view.setUint32(20, baselineSequence); view.setUint32(24, encoded.byteLength); new Uint8Array(buffer, HEADER_BYTES).set(encoded); this.previous = current; return buffer;
  }
}

export class ReplicationDecoder {
  private snapshot: MultiplayerGameSnapshot | null = null; private sequence = 0;
  get currentSequence(): number { return this.sequence; }
  reset(): void { this.snapshot = null; this.sequence = 0; }
  decode(sessionId: string, input: unknown): DecodedReplicationFrame {
    const buffer = input instanceof ArrayBuffer ? input : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice().buffer : null;
    if (!buffer || buffer.byteLength < HEADER_BYTES || buffer.byteLength > MAX_FRAME_BYTES) throw new Error("Invalid replication frame size."); const view = new DataView(buffer);
    if (view.getUint32(0) !== MAGIC) throw new Error("Invalid replication frame magic."); if (view.getUint16(4) !== MULTIPLAYER_PROTOCOL_VERSION) throw new Error("Incompatible multiplayer protocol."); if (view.getUint32(8) !== sessionHash(sessionId)) throw new Error("Replication frame belongs to another session.");
    const keyframe = (view.getUint8(6) & FLAG_KEYFRAME) !== 0; const sequence = view.getUint32(12); const serverTick = view.getUint32(16); const baselineSequence = view.getUint32(20); const payloadLength = view.getUint32(24);
    if (HEADER_BYTES + payloadLength !== buffer.byteLength || sequence <= this.sequence) throw new Error("Stale or truncated replication frame."); if (!keyframe && (!this.snapshot || baselineSequence !== this.sequence)) throw new Error("Replication baseline gap.");
    const wirePayload = decodeCompact(new Uint8Array(buffer, HEADER_BYTES)) as unknown;
    if (!Array.isArray(wirePayload) || wirePayload.length !== 17) throw new Error("Malformed replication payload.");
    const payload: DeltaPayload = {
      sentAt: Number(wirePayload[0]),
      ...(wirePayload[1] === null ? {} : { matchCreate: wirePayload[1] as MatchState }),
      ...(wirePayload[2] === null ? {} : { matchUpdate: wirePayload[2] as MatchPatch }),
      playerCreates: wirePayload[3] as MultiplayerPlayerState[], playerUpdates: wirePayload[4] as PlayerPatch[], playerRemoves: wirePayload[5] as string[],
      towerCreates: wirePayload[6] as SerializedTower[], towerUpdates: wirePayload[7] as TowerPatch[], towerRemoves: wirePayload[8] as number[],
      enemyCreates: wirePayload[9] as Enemy[], enemyUpdates: wirePayload[10] as EnemyPatch[], enemyRemoves: wirePayload[11] as number[],
      ...(wirePayload[12] === null ? {} : { timedBombs: wirePayload[12] as SerializedTimedBomb[] }),
      events: (wirePayload[13] as unknown[]).map(eventFromWire), hostCursor: wirePayload[14] as Point | null, guestPulseSequence: Number(wirePayload[15]),
      pilotInputAcks: wirePayload[16] as MultiplayerPilotInputAck[],
    };
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.towerCreates) || !Array.isArray(payload.towerUpdates) || !Array.isArray(payload.enemyCreates) || !Array.isArray(payload.enemyUpdates) || !Array.isArray(payload.playerCreates) || !Array.isArray(payload.playerUpdates) || !Array.isArray(payload.events) || !Array.isArray(payload.pilotInputAcks) || !payload.pilotInputAcks.every((ack) => ack && typeof ack.playerId === "string" && Number.isSafeInteger(ack.towerId) && Number.isSafeInteger(ack.sequence))) throw new Error("Malformed replication payload.");
    const match = keyframe ? objectFromWire(payload.matchCreate as unknown as Record<string, unknown>) as unknown as MatchState : Object.fromEntries(matchFields.map((field) => [field, this.snapshot![field]])) as MatchState;
    if (payload.matchUpdate) { const [mask, ...values] = payload.matchUpdate; let cursor = 0; matchFields.forEach((field, index) => { if ((mask & (1 << index)) !== 0) (match as unknown as Record<string, unknown>)[field] = fieldFromWire(field, values[cursor++]); }); }
    const players = new Map<string, MultiplayerPlayerState>((keyframe ? [] : this.snapshot?.players ?? []).map((player) => [player.id, { ...player, copiesRemaining: { ...player.copiesRemaining } }])); payload.playerRemoves.forEach((id) => players.delete(id)); payload.playerCreates.forEach((player) => players.set(player.id, player));
    payload.playerUpdates.forEach(([id, mask, ...values]) => { const player = players.get(id); if (!player) throw new Error("Replication player patch references a missing player."); const next = { ...player } as unknown as Record<string, unknown>; let cursor = 0; playerFields.forEach((field, index) => { if ((mask & (1 << index)) !== 0) next[field] = fieldFromWire(field, values[cursor++]); }); players.set(id, next as unknown as MultiplayerPlayerState); });
    const towers = new Map<number, SerializedTower>((keyframe ? [] : this.snapshot?.towers ?? []).map((tower) => [tower.id, { ...tower, autoCounter: tower.autoCounter ?? false, position: { ...tower.position }, engaged: [...tower.engaged] }])); payload.towerRemoves.forEach((id) => towers.delete(id)); payload.towerCreates.forEach((tower) => { const decoded = objectFromWire(tower as unknown as Record<string, unknown>) as unknown as SerializedTower; towers.set(decoded.id, { ...decoded, autoCounter: decoded.autoCounter ?? false }); });
    payload.towerUpdates.forEach(([id, lowMask, highMask, ...values]) => { const tower = towers.get(id); if (!tower) throw new Error("Replication tower patch references a missing tower."); const next = { ...tower } as unknown as Record<string, unknown>; let cursor = 0; towerFields.forEach((field, index) => { const included = index < 32 ? (lowMask & (1 << index)) !== 0 : (highMask & (1 << (index - 32))) !== 0; if (included) next[field] = fieldFromWire(field, values[cursor++]); }); towers.set(id, next as unknown as SerializedTower); });
    const enemies = new Map<number, Enemy>((keyframe ? [] : this.snapshot?.enemies ?? []).map((enemy) => [enemy.id, { ...enemy }])); payload.enemyRemoves.forEach((id) => enemies.delete(id)); payload.enemyCreates.forEach((enemy) => { const decoded = objectFromWire(enemy as unknown as Record<string, unknown>) as unknown as Enemy; enemies.set(decoded.id, decoded); });
    payload.enemyUpdates.forEach(([id, mask, ...values]) => { const enemy = enemies.get(id); if (!enemy) throw new Error("Replication patch references a missing enemy."); const next = { ...enemy } as unknown as Record<string, unknown>; let cursor = 0; enemyFields.forEach((field, index) => { if ((mask & (1 << index)) !== 0) next[field] = fieldFromWire(field, values[cursor++]); }); enemies.set(id, next as unknown as Enemy); });
    const timedBombs = payload.timedBombs ? payload.timedBombs.map((bomb) => objectFromWire(bomb as unknown as Record<string, unknown>) as unknown as SerializedTimedBomb) : this.snapshot?.timedBombs ?? [];
    const snapshot: MultiplayerGameSnapshot = { sequence, sentAt: payload.sentAt, ...match, players: [...players.values()], towers: [...towers.values()], enemies: [...enemies.values()], projectiles: [], particles: [], timedBombs, spawnQueue: [] };
    this.snapshot = snapshot; this.sequence = sequence;
    // Mirrors count cooldowns down locally; never lend them the delta baseline.
    return { sequence, serverTick, baselineSequence, keyframe, snapshot: cloneSnapshot(snapshot), events: payload.events, hostCursor: pointFromWire(payload.hostCursor), guestPulseSequence: payload.guestPulseSequence ?? 0, pilotInputAcks: payload.pilotInputAcks, bytes: buffer.byteLength };
  }
}
