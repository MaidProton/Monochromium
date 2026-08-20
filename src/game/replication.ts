import { MULTIPLAYER_PROTOCOL_VERSION, type MultiplayerGameSnapshot, type SerializedTower } from "./multiplayer.ts";
import type { Enemy } from "./types.ts";
import type { SimulationEvent } from "./simulationProtocol.ts";

const MAGIC = 0x4d4f4e4f;
const HEADER_BYTES = 28;
const FLAG_KEYFRAME = 1;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const enemyFields = [
  "pathDistance", "hp", "shieldHp", "targetTowerId", "attackTimer", "stunTimer", "slowTimer",
  "slowFactor", "burnTimer", "burnSlowFactor", "hitFlash", "spawnScale",
] as const satisfies readonly (keyof Enemy)[];

type EnemyField = typeof enemyFields[number];
type EnemyPatch = readonly [id: number, mask: number, ...values: unknown[]];
const towerFields = [
  "position", "onPath", "pathDistance", "level", "totalInvested", "targeting", "hp", "maxHp", "maxAggro",
  "engaged", "fireTimer", "counterCooldown", "counterFlash", "hurtFlash", "selectedPulse", "fortifyCharges",
  "overdriveTimer", "damageBuff", "abilityTimer", "abilityCooldown", "focus", "ammo", "attackRamp", "rampTimer", "stunTimer",
] as const satisfies readonly (keyof SerializedTower)[];
type TowerField = typeof towerFields[number];
type TowerPatch = readonly [id: number, lowMask: number, highMask: number, ...values: unknown[]];

interface DeltaPayload {
  readonly sentAt: number;
  readonly match: Omit<MultiplayerGameSnapshot, "sequence" | "sentAt" | "towers" | "enemies" | "projectiles" | "particles" | "spawnQueue">;
  readonly towerCreates: MultiplayerGameSnapshot["towers"];
  readonly towerUpdates: readonly TowerPatch[];
  readonly towerRemoves: readonly number[];
  readonly enemyCreates: readonly Enemy[];
  readonly enemyUpdates: readonly EnemyPatch[];
  readonly enemyRemoves: readonly number[];
  readonly events: readonly SimulationEvent[];
}

export interface DecodedReplicationFrame {
  readonly sequence: number;
  readonly serverTick: number;
  readonly baselineSequence: number;
  readonly keyframe: boolean;
  readonly snapshot: MultiplayerGameSnapshot;
  readonly events: readonly SimulationEvent[];
  readonly bytes: number;
}

const sessionHash = (sessionId: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const sameValue = (left: unknown, right: unknown): boolean => {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 0.001;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => value === right[index]);
  if (left && right && typeof left === "object" && typeof right === "object" && "x" in left && "y" in left && "x" in right && "y" in right) {
    return sameValue(left.x, right.x) && sameValue(left.y, right.y);
  }
  return left === right;
};

const cloneSnapshot = (snapshot: MultiplayerGameSnapshot): MultiplayerGameSnapshot => ({
  ...snapshot,
  players: snapshot.players.map((player) => ({ ...player, copiesRemaining: { ...player.copiesRemaining } })),
  towers: snapshot.towers.map((tower) => ({ ...tower, position: { ...tower.position }, engaged: [...tower.engaged] })),
  enemies: snapshot.enemies.map((enemy) => ({ ...enemy })),
  projectiles: [],
  particles: [],
  timedBombs: snapshot.timedBombs.map((bomb) => ({ ...bomb, position: { ...bomb.position } })),
  spawnQueue: [],
});

const clientProjection = (snapshot: MultiplayerGameSnapshot): MultiplayerGameSnapshot => {
  const projected = cloneSnapshot(snapshot);
  return {
    ...projected,
    towers: projected.towers.map((tower) => ({
      ...tower,
      fireTimer: 0,
      meleeTimer: 0,
      shotCounter: 0,
      idleTimer: 0,
      rocketTimer: 0,
      fieldTimer: 0,
      fieldTickTimer: 0,
      fieldVfxTimer: 0,
      regenTimer: 0,
      burstTimer: 0,
      burstTargetId: null,
    })),
    enemies: projected.enemies.map((enemy) => ({
      ...enemy,
      shockStacks: 0,
      burnTickTimer: 0,
      burnDamage: 0,
      burnOwnerId: null,
      summonTimer: 0,
      abilityTimer: 0,
    })),
    // Proximity bombs use Infinity as an internal sentinel. JSON turns that
    // into null, which would make an otherwise valid replica fail validation.
    timedBombs: projected.timedBombs.map((bomb) => ({
      ...bomb,
      timer: Number.isFinite(bomb.timer) ? bomb.timer : 0,
    })),
  };
};

export class ReplicationEncoder {
  private previous: MultiplayerGameSnapshot | null = null;
  private sequence = 0;

  reset(): void {
    this.previous = null;
    this.sequence = 0;
  }

  encode(sessionId: string, serverTick: number, source: MultiplayerGameSnapshot, events: readonly SimulationEvent[] = [], forceKeyframe = false): ArrayBuffer {
    const current = clientProjection(source);
    const keyframe = forceKeyframe || this.previous === null;
    const baselineSequence = keyframe ? 0 : this.sequence;
    const priorEnemies = new Map((this.previous?.enemies ?? []).map((enemy) => [enemy.id, enemy]));
    const priorTowers = new Map((this.previous?.towers ?? []).map((tower) => [tower.id, tower]));
    const currentIds = new Set(current.enemies.map((enemy) => enemy.id));
    const currentTowerIds = new Set(current.towers.map((tower) => tower.id));
    const enemyCreates: Enemy[] = [];
    const enemyUpdates: EnemyPatch[] = [];
    const towerCreates: SerializedTower[] = [];
    const towerUpdates: TowerPatch[] = [];

    for (const tower of current.towers) {
      const prior = priorTowers.get(tower.id);
      if (keyframe || !prior) {
        towerCreates.push(tower);
        continue;
      }
      let lowMask = 0;
      let highMask = 0;
      const values: unknown[] = [];
      towerFields.forEach((field, index) => {
        if (sameValue(prior[field], tower[field])) return;
        if (index < 32) lowMask |= 1 << index;
        else highMask |= 1 << (index - 32);
        values.push(tower[field]);
      });
      if (lowMask !== 0 || highMask !== 0) towerUpdates.push([tower.id, lowMask, highMask, ...values]);
    }

    for (const enemy of current.enemies) {
      const prior = priorEnemies.get(enemy.id);
      if (keyframe || !prior) {
        enemyCreates.push(enemy);
        continue;
      }
      let mask = 0;
      const values: unknown[] = [];
      enemyFields.forEach((field, index) => {
        if (sameValue(prior[field], enemy[field])) return;
        mask |= 1 << index;
        values.push(enemy[field]);
      });
      if (mask !== 0) enemyUpdates.push([enemy.id, mask, ...values]);
    }

    const match = {
      integrity: current.integrity,
      maxIntegrity: current.maxIntegrity,
      wave: current.wave,
      waveActive: current.waveActive,
      intermissionRemaining: current.intermissionRemaining,
      nextWaveIndex: current.nextWaveIndex,
      paused: current.paused,
      speed: current.speed,
      started: current.started,
      gameOver: current.gameOver,
      modeComplete: current.modeComplete,
      players: current.players,
      timedBombs: current.timedBombs,
    } satisfies DeltaPayload["match"];
    const payload: DeltaPayload = {
      sentAt: current.sentAt,
      match,
      towerCreates,
      towerUpdates,
      towerRemoves: keyframe ? [] : [...priorTowers.keys()].filter((id) => !currentTowerIds.has(id)),
      enemyCreates,
      enemyUpdates,
      enemyRemoves: keyframe ? [] : [...priorEnemies.keys()].filter((id) => !currentIds.has(id)),
      events,
    };
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    if (encoded.byteLength + HEADER_BYTES > MAX_FRAME_BYTES) throw new Error("Replication frame exceeds the 8 MB limit.");
    const frameSequence = ++this.sequence;
    const buffer = new ArrayBuffer(HEADER_BYTES + encoded.byteLength);
    const view = new DataView(buffer);
    view.setUint32(0, MAGIC);
    view.setUint16(4, MULTIPLAYER_PROTOCOL_VERSION);
    view.setUint8(6, keyframe ? FLAG_KEYFRAME : 0);
    view.setUint8(7, 0);
    view.setUint32(8, sessionHash(sessionId));
    view.setUint32(12, frameSequence);
    view.setUint32(16, serverTick);
    view.setUint32(20, baselineSequence);
    view.setUint32(24, encoded.byteLength);
    new Uint8Array(buffer, HEADER_BYTES).set(encoded);
    this.previous = current;
    return buffer;
  }
}

export class ReplicationDecoder {
  private snapshot: MultiplayerGameSnapshot | null = null;
  private sequence = 0;

  get currentSequence(): number { return this.sequence; }

  reset(): void {
    this.snapshot = null;
    this.sequence = 0;
  }

  decode(sessionId: string, input: unknown): DecodedReplicationFrame {
    // WebRTC implementations normally deliver an ArrayBuffer, but Chromium
    // can surface an ArrayBufferView when a channel has been transformed by a
    // relay. Copy the exact view range so the header is always at byte zero.
    const buffer = input instanceof ArrayBuffer
      ? input
      : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice().buffer
        : null;
    if (!buffer || buffer.byteLength < HEADER_BYTES || buffer.byteLength > MAX_FRAME_BYTES) throw new Error("Invalid replication frame size.");
    const view = new DataView(buffer);
    if (view.getUint32(0) !== MAGIC) throw new Error("Invalid replication frame magic.");
    if (view.getUint16(4) !== MULTIPLAYER_PROTOCOL_VERSION) throw new Error("Incompatible multiplayer protocol.");
    if (view.getUint32(8) !== sessionHash(sessionId)) throw new Error("Replication frame belongs to another session.");
    const keyframe = (view.getUint8(6) & FLAG_KEYFRAME) !== 0;
    const sequence = view.getUint32(12);
    const serverTick = view.getUint32(16);
    const baselineSequence = view.getUint32(20);
    const payloadLength = view.getUint32(24);
    if (HEADER_BYTES + payloadLength !== buffer.byteLength || sequence <= this.sequence) throw new Error("Stale or truncated replication frame.");
    if (!keyframe && (!this.snapshot || baselineSequence !== this.sequence)) throw new Error("Replication baseline gap.");
    const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, HEADER_BYTES))) as DeltaPayload;
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.towerCreates) || !Array.isArray(payload.towerUpdates) || !Array.isArray(payload.towerRemoves) || !Array.isArray(payload.enemyCreates) || !Array.isArray(payload.enemyUpdates) || !Array.isArray(payload.enemyRemoves)) throw new Error("Malformed replication payload.");

    const towers = new Map<number, SerializedTower>((keyframe ? [] : this.snapshot?.towers ?? []).map((tower) => [tower.id, { ...tower, position: { ...tower.position }, engaged: [...tower.engaged] }]));
    payload.towerRemoves.forEach((id) => towers.delete(id));
    payload.towerCreates.forEach((tower) => towers.set(tower.id, { ...tower, position: { ...tower.position }, engaged: [...tower.engaged] }));
    payload.towerUpdates.forEach((patch) => {
      const [id, lowMask, highMask, ...values] = patch;
      const tower = towers.get(id);
      if (!tower) throw new Error("Replication patch references a missing tower.");
      let valueIndex = 0;
      towerFields.forEach((field, fieldIndex) => {
        const included = fieldIndex < 32 ? (lowMask & (1 << fieldIndex)) !== 0 : (highMask & (1 << (fieldIndex - 32))) !== 0;
        if (!included) return;
        (tower as unknown as Record<TowerField, unknown>)[field] = values[valueIndex++];
      });
      if (valueIndex !== values.length) throw new Error("Replication tower patch field count mismatch.");
    });

    const enemies = new Map<number, Enemy>((keyframe ? [] : this.snapshot?.enemies ?? []).map((enemy) => [enemy.id, { ...enemy }]));
    payload.enemyRemoves.forEach((id) => enemies.delete(id));
    payload.enemyCreates.forEach((enemy) => enemies.set(enemy.id, { ...enemy }));
    payload.enemyUpdates.forEach((patch) => {
      const [id, mask, ...values] = patch;
      const enemy = enemies.get(id);
      if (!enemy) throw new Error("Replication patch references a missing enemy.");
      let valueIndex = 0;
      enemyFields.forEach((field, fieldIndex) => {
        if ((mask & (1 << fieldIndex)) === 0) return;
        (enemy as unknown as Record<EnemyField, unknown>)[field] = values[valueIndex++];
      });
      if (valueIndex !== values.length) throw new Error("Replication patch field count mismatch.");
    });

    const snapshot: MultiplayerGameSnapshot = {
      sequence,
      sentAt: payload.sentAt,
      ...payload.match,
      towers: [...towers.values()],
      enemies: [...enemies.values()],
      projectiles: [],
      particles: [],
      spawnQueue: [],
    };
    this.snapshot = cloneSnapshot(snapshot);
    this.sequence = sequence;
    return { sequence, serverTick, baselineSequence, keyframe, snapshot, events: payload.events ?? [], bytes: buffer.byteLength };
  }
}
