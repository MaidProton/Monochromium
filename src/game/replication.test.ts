import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE, TOWER_ORDER } from "./config.ts";
import { Game } from "./Game.ts";
import type { MultiplayerGameSnapshot, SerializedTimedBomb, SerializedTower } from "./multiplayer.ts";
import { ReplicationDecoder, ReplicationEncoder } from "./replication.ts";
import type { SimulationEvent } from "./simulationProtocol.ts";
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
  coreDamage: 1,
  defense: 0,
  protection: 0,
  armor: 0,
  superarmor: 0,
  hitCashMultiplier: 1,
  summonModifiers: { hitCashMultiplier: 1, hpMultiplier: 1, shieldMultiplier: 1, speedMultiplier: 1, damageMultiplier: 1, attackIntervalMultiplier: 1, coreDamageMultiplier: 1, defenseBonus: 0, protectionBonus: 0, armorBonus: 0, superarmorBonus: 0 },
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
  burnTickInterval: 1,
  burnSpeedFactor: 1,
  hitFlash: 0,
  spawnScale: 1,
  summonTimer: 0,
  abilityTimer: 0,
  regenerationVfxTimer: 0,
  hasteCooldown: 0,
  hasteTimer: 0,
  hasteFactor: 1,
  drainCooldown: 0,
  phaseCooldown: 0,
  phaseTimer: 0,
  blinkCooldown: 0,
  aliveTime: 0,
  lockTriggered: false,
  lockTimeRemaining: 0,
  lockWavesRemaining: 0,
  attackCooldowns: [],
  attackUses: [],
  behaviorMovementLockTimer: 0,
  behaviorInvulnerableTimer: 0,
  behaviorSpeedFactor: 1,
  behaviorDamageFactor: 1,
  behaviorRuleUses: [],
  behaviorRuleCooldowns: [],
  behaviorActionQueue: [],
  behaviorEffects: [],
});

const tower = (hp = 100, stunTimer = 0, autoCounter = false): SerializedTower => ({
  id: 50,
  ownerId: "player-one",
  kind: "bandit",
  perks: [],
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
  autoCounter,
  counterFlash: 0,
  hurtFlash: 0,
  selectedPulse: 0,
  fortifyCharges: 0,
  overdriveTimer: 0,
  damageBuff: 1,
  abilityTimer: 0,
  perkPrepTimer: 0,
  abilityCooldown: 0,
  focus: 0,
  aimPoint: null,
  meleeTimer: 0,
  ammo: 1,
  shotCounter: 0,
  attackRamp: 0,
  rampTimer: 0,
  rampStackTimers: [],
  fireRateBuff: 0,
  idleTimer: 0,
  rocketTimer: 0,
  fieldTimer: 0,
  fieldTickTimer: 0,
  fieldVfxTimer: 0,
  regenTimer: 0,
  burstTimer: 0,
  burstTargetId: null,
  burstShotsRemaining: 0,
  burstSpacing: 0,
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
  it("round-trips latest accepted pilot inputs alongside a state checkpoint", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, []), true, {
      pilotInputAcks: [{ playerId: "player-one", towerId: 50, sequence: 12 }],
    }));
    expect(decoded.pilotInputAcks).toEqual([{ playerId: "player-one", towerId: 50, sequence: 12 }]);
  });
  it("round-trips a keyframe and applies enemy field-mask deltas", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const first = encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), true);
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
    decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [], [tower()]), true));
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 6, snapshot(2, [], [tower(75, 2, true)])));
    expect(decoded.snapshot.towers[0]?.hp).toBe(75);
    expect(decoded.snapshot.towers[0]?.stunTimer).toBe(2);
    expect(decoded.snapshot.towers[0]?.autoCounter).toBe(true);
  });

  it("defaults AutoCounter when reading a legacy tower keyframe", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const legacyTower = { ...tower() } as Partial<SerializedTower> & Pick<SerializedTower, "id">;
    delete legacyTower.autoCounter;
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [], [legacyTower as SerializedTower]), true));
    expect(decoded.snapshot.towers[0]?.autoCounter).toBe(false);
  });

  it("replicates Mutiny trigger meters and independently decaying stacks", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [], [tower()]), true));
    const powered = {
      ...tower(),
      kind: "mercenary" as const,
      perks: ["mutiny" as const],
      mutinyKillProgress: 3,
      mutinyDamageProgress: 42.5,
      mutinyStackTimers: [15, 2.345],
    };
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 6, snapshot(2, [], [powered]))).snapshot.towers[0]!;
    expect(decoded.mutinyKillProgress).toBe(3);
    expect(decoded.mutinyDamageProgress).toBe(42.5);
    expect(decoded.mutinyStackTimers).toEqual([15, Math.round(2.345 * 60) / 60]);
  });

  it("keeps Zenith charge state out of replicated tower snapshots", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const charged = { ...tower(), kind: "zenith" as const, zenithChargeTimer: 2, zenithChargeTargetId: 9, zenithChargeAngle: 0.5 };
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [], [charged]), true));
    expect(decoded.snapshot.towers[0]?.zenithChargeTimer).toBeUndefined();
    expect(decoded.snapshot.towers[0]?.zenithChargeTargetId).toBeUndefined();
    expect(decoded.snapshot.towers[0]?.zenithChargeAngle).toBeUndefined();
  });

  it("starts a guest-local Zenith charge clock from a lifecycle event", () => {
    const player = { id: "player-one", username: "ONE", color: "#66d9ff", loadout: ["zenith"] as const, perkLoadout: [] as const };
    const client = new Game(null as unknown as HTMLCanvasElement, {
      onUi: () => undefined,
      onLog: () => undefined,
      onGameOver: () => undefined,
      onVictory: () => undefined,
    }, null, { headless: true });
    client.configureMultiplayer("guest", player, [player]);
    client.startRun(MAP_DEFINITIONS.sector07, player.loadout, NORMAL_MODE);
    const charged = { ...tower(), kind: "zenith" as const };
    const decoder = new ReplicationDecoder();
    const snapshotFrame = decoder.decode("ROOM1234", new ReplicationEncoder().encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)], [charged]), true));
    expect(client.applyMultiplayerSnapshot(snapshotFrame.snapshot)).toBe(true);
    client.applySimulationEvents([{
      id: 1,
      tick: 3,
      kind: "charge",
      entityId: charged.id,
      targetId: 1,
      position: { x: 220, y: 100 },
      from: { x: 100, y: 100 },
      duration: 2,
      label: "start",
      cosmeticSeed: 1,
    }]);
    const mirrorCharges = (client as unknown as { mirrorZenithCharges: Map<number, { remaining: number }> }).mirrorZenithCharges;
    expect(mirrorCharges.get(charged.id)?.remaining).toBe(2);
    client.destroy();
  });

  it("replicates active haste and phase state through enemy deltas", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), true));
    const powered = { ...enemy(1, 18), hasteTimer: 2.345, hasteFactor: 1.75, phaseTimer: 0.875 };
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 6, snapshot(2, [powered]))).snapshot.enemies[0]!;
    expect(decoded.hasteTimer).toBe(Math.round(powered.hasteTimer * 60) / 60);
    expect(decoded.hasteFactor).toBe(1.75);
    expect(decoded.phaseTimer).toBe(Math.round(powered.phaseTimer * 60) / 60);
  });

  it("replicates active behavior-engine state through enemy deltas", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), true));
    const powered = { ...enemy(1, 18), behaviorMovementLockTimer: 4.25, behaviorInvulnerableTimer: 3.5, behaviorSpeedFactor: 2.25, behaviorDamageFactor: 1.75 };
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 6, snapshot(2, [powered]))).snapshot.enemies[0]!;
    expect(decoded.behaviorMovementLockTimer).toBe(4.25);
    expect(decoded.behaviorInvulnerableTimer).toBe(3.5);
    expect(decoded.behaviorSpeedFactor).toBe(2.25);
    expect(decoded.behaviorDamageFactor).toBe(1.75);
  });

  it("replicates protection charges and one-time movement lock state", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), true));
    const powered = {
      ...enemy(1, 18),
      protection: 3,
      lockTriggered: true,
      lockTimeRemaining: 2.345,
      lockWavesRemaining: 2,
    };
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 6, snapshot(2, [powered]))).snapshot.enemies[0]!;
    expect(decoded.protection).toBe(3);
    expect(decoded.lockTriggered).toBe(true);
    expect(decoded.lockTimeRemaining).toBe(Math.round(powered.lockTimeRemaining * 60) / 60);
    expect(decoded.lockWavesRemaining).toBe(2);
  });

  it("quantizes presentation-safe values without changing authoritative inputs", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const sourceEnemy = { ...enemy(1, 12.031, 75.006), shieldHp: 3.146, maxShieldHp: 10.004, slowFactor: 0.8764, slowTimer: 1.234 };
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [sourceEnemy]), true)).snapshot.enemies[0]!;
    expect(decoded.pathDistance).toBe(Math.round(sourceEnemy.pathDistance * 16) / 16);
    expect(decoded.hp).toBe(Math.round(sourceEnemy.hp * 100) / 100);
    expect(decoded.shieldHp).toBe(Math.round(sourceEnemy.shieldHp * 100) / 100);
    expect(decoded.maxShieldHp).toBe(Math.round(sourceEnemy.maxShieldHp * 100) / 100);
    expect(decoded.slowFactor).toBe(Math.round(sourceEnemy.slowFactor * 1_000) / 1_000);
    expect(decoded.slowTimer).toBe(Math.round(sourceEnemy.slowTimer * 60) / 60);
    expect(sourceEnemy.pathDistance).toBe(12.031);
  });

  it("multiplexes retained events, host cursor, and guest pulse acknowledgement", () => {
    const encoder = new ReplicationEncoder();
    const event: SimulationEvent = { id: 11, tick: 30, kind: "attack", entityId: 4, targetId: 1, count: 3, occurrenceTickOffsets: [-6, -3, 0], abilityId: "ability-wire-test", actionId: "action-wire-test", phase: "impact", cosmeticSeed: 42 };
    const decoded = new ReplicationDecoder().decode("ROOM1234", encoder.encode("ROOM1234", 30, snapshot(1, [enemy(1, 12)]), true, {
      events: [event],
      hostCursor: { x: 12.37, y: 45.62 },
      guestPulseSequence: 8,
    }));
    expect(decoded.events).toEqual([event]);
    expect(decoded.hostCursor).toEqual({ x: 12.375, y: 45.625 });
    expect(decoded.guestPulseSequence).toBe(8);
  });

  it("sends timed-bomb lifecycle changes without repeating timer countdowns", () => {
    const bomb: SerializedTimedBomb = { position: { x: 20, y: 30 }, damage: 50, radius: 42, color: "#ffcc00", playerId: "player-one", sourceTowerId: 50, sourceKind: "bomber", timer: 3 };
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const firstSource = { ...snapshot(1, []), timedBombs: [bomb] };
    decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, firstSource, true));
    const timerOnly = { ...snapshot(2, []), timedBombs: [{ ...bomb, timer: 2.5 }] };
    const frame = encoder.encode("ROOM1234", 6, timerOnly);
    const decoded = decoder.decode("ROOM1234", frame);
    expect(decoded.snapshot.timedBombs[0]?.timer).toBe(3);
    expect(frame.byteLength).toBeLessThan(160);
  });

  it("rejects wrong sessions, stale frames, and baseline gaps", () => {
    const encoder = new ReplicationEncoder();
    const first = encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), true);
    expect(() => new ReplicationDecoder().decode("OTHER123", first)).toThrow(/another session/i);
    const decoder = new ReplicationDecoder();
    decoder.decode("ROOM1234", first);
    expect(() => decoder.decode("ROOM1234", first)).toThrow(/stale/i);

    const missingBaseline = encoder.encode("ROOM1234", 6, snapshot(2, [enemy(1, 20)]));
    expect(() => new ReplicationDecoder().decode("ROOM1234", missingBaseline)).toThrow(/baseline gap/i);
  });

  it("accepts a typed-array view delivered by a WebSocket relay", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const frame = encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)]), true);
    const padded = new Uint8Array(frame.byteLength + 7);
    padded.set(new Uint8Array(frame), 4);
    const view = padded.subarray(4, 4 + frame.byteLength);
    expect(decoder.decode("ROOM1234", view).snapshot.enemies[0]?.id).toBe(1);
  });

  it("applies a decoded keyframe to a presentation client", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const player = { id: "player-one", username: "ONE", color: "#66d9ff", loadout: ["bandit"] as const, perkLoadout: [] as const };
    const client = new Game(null as unknown as HTMLCanvasElement, {
      onUi: () => undefined,
      onLog: () => undefined,
      onGameOver: () => undefined,
      onVictory: () => undefined,
    }, null, { headless: true });
    client.configureMultiplayer("guest", player, [player]);
    client.startRun(MAP_DEFINITIONS.sector07, player.loadout, NORMAL_MODE);
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)], [tower()]), true));
    expect(client.applyMultiplayerSnapshot(decoded.snapshot)).toBe(true);
    client.destroy();
  });

  it("rejects oversized behavior runtime collections in presentation snapshots", () => {
    const encoder = new ReplicationEncoder();
    const decoder = new ReplicationDecoder();
    const player = { id: "player-one", username: "ONE", color: "#66d9ff", loadout: ["bandit"] as const, perkLoadout: [] as const };
    const client = new Game(null as unknown as HTMLCanvasElement, { onUi: () => undefined, onLog: () => undefined, onGameOver: () => undefined, onVictory: () => undefined }, null, { headless: true });
    client.configureMultiplayer("guest", player, [player]);
    client.startRun(MAP_DEFINITIONS.sector07, player.loadout, NORMAL_MODE);
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, snapshot(1, [enemy(1, 12)], [tower()]), true));
    const hostile = { ...decoded.snapshot, sequence: 2, enemies: [{ ...decoded.snapshot.enemies[0]!, behaviorRuleUses: Array.from({ length: 33 }, () => 0) }] };
    expect(client.applyMultiplayerSnapshot(hostile)).toBe(false);
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
    const decoded = decoder.decode("ROOM1234", encoder.encode("ROOM1234", 3, source, true));
    expect(decoded.snapshot.particles).toEqual([]);
    expect(decoded.snapshot.projectiles).toEqual([]);
    expect(decoded.snapshot.spawnQueue).toEqual([]);
  });

  it("reduces steady-state enemy replication by at least 85 percent", () => {
    const enemies = Array.from({ length: 1_000 }, (_, index) => enemy(index + 1, index));
    const encoder = new ReplicationEncoder();
    encoder.encode("ROOM1234", 3, snapshot(1, enemies), true);
    const moved = enemies.map((value) => ({ ...value, pathDistance: value.pathDistance + 5 }));
    const delta = encoder.encode("ROOM1234", 6, snapshot(2, moved));
    const legacyBytes = new TextEncoder().encode(JSON.stringify({ type: "snapshot", snapshot: snapshot(2, moved) })).byteLength;
    expect(delta.byteLength).toBeLessThan(legacyBytes * 0.15);
  });

  it("keeps an unchanged active packet below the 160-byte idle target", () => {
    const encoder = new ReplicationEncoder();
    encoder.encode("ROOM1234", 3, snapshot(1, []), true);
    const delta = encoder.encode("ROOM1234", 6, snapshot(2, []));
    expect(delta.byteLength).toBeLessThan(160);
  });
});
