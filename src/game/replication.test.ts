import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE, TOWER_ORDER } from "./config.ts";
import { Game } from "./Game.ts";
import type { MultiplayerGameSnapshot, SerializedTower } from "./multiplayer.ts";
import { ReplicationDecoder, ReplicationEncoder } from "./replication.ts";
import type { Enemy } from "./types.ts";

const enemy = (id: number, pathDistance: number, hp = 100): Enemy => ({
  id,
  kind: "dummy",
  pathDistance,
  hp,
  maxHp: 100,
  shieldHp: 0,
  maxShieldHp: 0,
  speed: 50,
  damage: 1,
  attackInterval: 1,
  telegraphDuration: 0.4,
  targetTowerId: null,
  attackTimer: 1,
  stunTimer: 0,
  slowTimer: 0,
  slowFactor: 1,
  shockStacks: 0,
  burnTimer: 0,
  burnTickTimer: 0,
  burnDamage: 0,
  burnOwnerId: null,
  burnSlowFactor: 1,
  hitFlash: 0,
  spawnScale: 1,
  summonTimer: 0,
  abilityTimer: 0,
});

const tower = (hp = 100, stunTimer = 0): SerializedTower => ({
  id: 50,
  ownerId: "player-one",
  kind: "bandit",
  position: { x: 100, y: 100 },
  onPath: false,
  pathDistance: 0,
  level: 0,
  totalInvested: 100,
  targeting: "first",
  hp,
  maxHp: 100,
  maxAggro: 1,
  engaged: [],
  fireTimer: 0,
  counterCooldown: 0,
  counterFlash: 0,
  hurtFlash: 0,
  selectedPulse: 0,
  fortifyCharges: 0,
  overdriveTimer: 0,
  damageBuff: 1,
  abilityTimer: 0,
  abilityCooldown: 0,
  focus: 0,
  meleeTimer: 0,
  ammo: 1,
  shotCounter: 0,
  attackRamp: 0,
  rampTimer: 0,
  idleTimer: 0,
  rocketTimer: 0,
  fieldTimer: 0,
  fieldTickTimer: 0,
  fieldVfxTimer: 0,
  regenTimer: 0,
  burstTimer: 0,
  burstTargetId: null,
  stunTimer,
});

const snapshot = (sequence: number, enemies: readonly Enemy[], towers: readonly SerializedTower[] = []): MultiplayerGameSnapshot => ({
  sequence,
  sentAt: 100 + sequence,
  integrity: 20,
  maxIntegrity: 20,
  wave: 1,
  waveActive: true,
  intermissionRemaining: 0,
  nextWaveIndex: 0,
  paused: false,
  speed: 1,
  started: true,
  gameOver: false,
  modeComplete: false,
  players: [{
    id: "player-one",
    shards: 500,
    pendingCasualtyRefund: 0,
    copiesRemaining: Object.fromEntries(TOWER_ORDER.map((kind) => [kind, 4])) as Record<typeof TOWER_ORDER[number], number>,
  }],
  towers,
  enemies,
  projectiles: [],
  particles: [],
  timedBombs: [],
  spawnQueue: [],
});

describe("binary multiplayer replication", () => {
  it("round-trips a keyframe and applies enemy field-mask deltas", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const first = encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), [], true);
    const decodedFirst = decoder.decode("ROOM1234", first);
    expect(decodedFirst.keyframe).toBe(true);
    expect(decodedFirst.snapshot.enemies[0]?.pathDistance).toBe(12);

    const second = encoder.encode("ROOM1234", 6, snapshot(2, [enemy(1, 24, 75), enemy(2, 2)]));
    const decodedSecond = decoder.decode("ROOM1234", second);
    expect(decodedSecond.keyframe).toBe(false);
    expect(decodedSecond.snapshot.enemies.map(({ id, pathDistance, hp }) => ({ id, pathDistance, hp }))).toEqual([
      { id: 1, pathDistance: 24, hp: 75 },
      { id: 2, pathDistance: 2, hp: 100 },
    ]);

    const third = encoder.encode("ROOM1234", 9, snapshot(3, [enemy(2, 10)]));
    expect(decoder.decode("ROOM1234", third).snapshot.enemies.map(({ id }) => id)).toEqual([2]);
  });

  it("applies tower field masks", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [], [tower()]), [], true));
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 6, snapshot(2, [], [tower(75, 2)])));
    expect(decoded.snapshot.towers[0]?.hp).toBe(75);
    expect(decoded.snapshot.towers[0]?.stunTimer).toBe(2);
  });

  it("rejects wrong sessions, stale frames, and baseline gaps", () => {
    const encoder = new ReplicationEncoder();
    const first = encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), [], true);
    expect(() => new ReplicationDecoder().decode("OTHER123", first)).toThrow(/another session/i);
    const decoder = new ReplicationDecoder();
    decoder.decode("ROOM1234", first);
    expect(() => decoder.decode("ROOM1234", first)).toThrow(/stale/i);

    const missingBaseline = encoder.encode("ROOM1234", 6, snapshot(2, [enemy(1, 20)]));
    expect(() => new ReplicationDecoder().decode("ROOM1234", missingBaseline)).toThrow(/baseline gap/i);
  });

  it("accepts a typed-array view delivered by a WebRTC relay", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const frame = encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), [], true);
    const padded = new Uint8Array(frame.byteLength + 7);
    padded.set(new Uint8Array(frame), 4);
    const view = padded.subarray(4, 4 + frame.byteLength);
    expect(decoder.decode("ROOM1234", view).snapshot.enemies[0]?.id).toBe(1);
  });

  it("applies a decoded keyframe to a presentation client", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const player = { id: "player-one", username: "ONE", color: "#66d9ff", loadout: ["bandit"] as const };
    const client = new Game(null as unknown as HTMLCanvasElement, {
      onUi: () => undefined,
      onLog: () => undefined,
      onGameOver: () => undefined,
      onVictory: () => undefined,
    }, null, { headless: true });
    client.configureMultiplayer("guest", player, [player]);
    client.startRun(MAP_DEFINITIONS.sector07, player.loadout, NORMAL_MODE);
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)], [tower()]), [], true));
    expect(client.applyMultiplayerSnapshot(decoded.snapshot)).toBe(true);
    client.destroy();
  });

  it("never carries particles, projectiles, or spawn queues into the replica", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const source = {
      ...snapshot(1, []),
      particles: [{ position: { x: 1, y: 2 }, velocity: { x: 0, y: 0 }, life: 1, maxLife: 1, color: "#ffffff", size: 4, type: "spark" as const }],
      projectiles: [{ position: { x: 1, y: 2 }, delay: 0, targetId: 1, ownerId: "player-one", damage: 5, kind: "bandit" as const, speed: 100, splash: 0, chain: 0, towerLevel: 0 }],
      spawnQueue: [{ kind: "dummy", spawnAt: 1, hp: 100 }],
    };
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, source, [], true));
    expect(decoded.snapshot.particles).toEqual([]);
    expect(decoded.snapshot.projectiles).toEqual([]);
    expect(decoded.snapshot.spawnQueue).toEqual([]);
  });

  it("reduces steady-state enemy replication by at least 85 percent", () => {
    const enemies = Array.from({ length: 1_000 }, (_, index) => enemy(index + 1, index));
    const encoder = new ReplicationEncoder();
    encoder.encode("ROOM1234", 3, snapshot(1, enemies), [], true);
    const moved = enemies.map((value) => ({ ...value, pathDistance: value.pathDistance + 5 }));
    const delta = encoder.encode("ROOM1234", 6, snapshot(2, moved));
    const legacyBytes = new TextEncoder().encode(JSON.stringify({ type: "snapshot", snapshot: snapshot(2, moved) })).byteLength;
    expect(delta.byteLength).toBeLessThan(legacyBytes * 0.15);
  });
});
