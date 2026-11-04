import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, NORMAL_MODE } from "./config.ts";
import { createCustomEnemy } from "./customEnemies.ts";
import { createEnemyAbilityPreset } from "./enemyAbilities.ts";
import { MULTIPLAYER_PROTOCOL_VERSION } from "./multiplayer.ts";
import { SimulationCore } from "./SimulationCore.ts";
import type { SimulationSessionConfig } from "./simulationProtocol.ts";

const config = (seed = 12345): SimulationSessionConfig => ({
  protocol: MULTIPLAYER_PROTOCOL_VERSION,
  sessionId: "TEST1234",
  seed,
  map: MAP_DEFINITIONS.sector07,
  mode: NORMAL_MODE,
  customEnemies: [],
  allowedTowers: ["bandit"],
  players: [
    { id: "test-host", username: "HOST", color: "#66d9ff", loadout: ["bandit"], perkLoadout: [] },
    { id: "test-guest", username: "GUEST", color: "#ff806f", loadout: ["bandit"], perkLoadout: [] },
  ],
});
const createCore = (seed = 12345): SimulationCore => new SimulationCore(config(seed), { onResult: () => undefined });

describe("authoritative SimulationCore", () => {
  it("advances identical seeded sessions deterministically at fixed ticks", () => {
    const left = createCore();
    const right = createCore();
    for (let index = 0; index < 180; index += 1) {
      left.advance();
      right.advance();
    }
    const leftSnapshot = left.createFrame()?.snapshot;
    const rightSnapshot = right.createFrame()?.snapshot;
    expect(left.tick).toBe(180);
    expect(right.tick).toBe(180);
    expect(leftSnapshot && {
      integrity: leftSnapshot.integrity,
      wave: leftSnapshot.wave,
      towers: leftSnapshot.towers,
      enemies: leftSnapshot.enemies,
      players: leftSnapshot.players,
    }).toEqual(rightSnapshot && {
      integrity: rightSnapshot.integrity,
      wave: rightSnapshot.wave,
      towers: rightSnapshot.towers,
      enemies: rightSnapshot.enemies,
      players: rightSnapshot.players,
    });
  });

  it("deduplicates command IDs and rejects unknown players", () => {
    const core = createCore();
    const envelope = {
      commandId: "test-host:1",
      playerId: "test-host",
      clientSequence: 1,
      command: { type: "pause" as const },
    };
    expect(core.submit(envelope).accepted).toBe(true);
    expect(core.submit(envelope).accepted).toBe(true);
    expect(core.createFrame()?.snapshot.paused).toBe(true);
    expect(core.submit({ ...envelope, commandId: "intruder:1", playerId: "intruder" }).accepted).toBe(false);
  });

  it("does not retain pilot acknowledgements for nonexistent towers", () => {
    const core = createCore();
    const input = {
      type: "pilot-input" as const,
      playerId: "test-guest",
      towerId: 99,
      sequence: 7,
      moveX: 1 as const,
      moveY: 0 as const,
      aim: { x: 500, y: 350 },
      firing: true,
    };
    // Invalid towers must not create retained acknowledgement entries.
    expect(core.submitPilotInput(input)).toBe(false);
    expect(core.submitPilotInput({ ...input, firing: false })).toBe(false);
    expect(core.submitPilotInput({ ...input, sequence: 8, firing: false })).toBe(false);
    expect(core.getPilotInputAcks()).toEqual([]);
    core.destroy();
  });

  it("keeps living enemies when both players vote to skip an eligible wave", () => {
    const core = new SimulationCore({
      ...config(),
      mode: {
        ...NORMAL_MODE,
        waves: [
          { groups: [{ kind: "dummy", count: 2, gap: 20 }], cashReward: 321, referenceHealth: 2_000, waveTimeSeconds: 60 },
          { groups: [{ kind: "dummy", count: 1, gap: 0 }], referenceHealth: 1_000, waveTimeSeconds: 60 },
        ],
      },
    }, { onResult: () => undefined });
    for (let tick = 0; tick < (3 + 18.2) * 30; tick += 1) core.advance();
    const before = core.createFrame()!.snapshot;
    expect(before.wave).toBe(1);
    expect(before.waveActive).toBe(true);
    expect(before.enemies.length).toBe(1);
    expect(core.submit({ commandId: "test-host:skip-too-early", playerId: "test-host", clientSequence: 1, command: { type: "skip-wave" } }).accepted).toBe(false);
    for (let tick = 0; tick < 12 * 30; tick += 1) core.advance();
    const beforeSkip = core.createFrame()!.snapshot;
    expect(beforeSkip.enemies.length).toBe(2);
    const beforeSkipCash = Object.fromEntries(beforeSkip.players.map((player) => [player.id, player.shards]));
    expect(core.submit({ commandId: "test-host:skip", playerId: "test-host", clientSequence: 2, command: { type: "skip-wave" } }).accepted).toBe(true);
    expect(core.createFrame()!.snapshot.wave).toBe(1);
    expect(core.submit({ commandId: "test-guest:skip", playerId: "test-guest", clientSequence: 1, command: { type: "skip-wave" } }).accepted).toBe(true);
    const after = core.createFrame()!.snapshot;
    expect(after.wave).toBe(2);
    expect(after.enemies.length).toBeGreaterThan(0);
    after.players.forEach((player) => expect(player.shards - beforeSkipCash[player.id]!).toBe(321));
    core.destroy();
  });

  it("filters guest loadouts to the host-authorized tower pool", () => {
    const core = new SimulationCore({
      ...config(),
      players: [
        { id: "test-host", username: "HOST", color: "#66d9ff", loadout: ["bandit"], perkLoadout: [] },
        { id: "test-guest", username: "GUEST", color: "#ff806f", loadout: ["samurai"], perkLoadout: [] },
      ],
    }, { onResult: () => undefined });
    expect(core.submit({
      commandId: "test-guest:deploy-samurai",
      playerId: "test-guest",
      clientSequence: 1,
      command: { type: "deploy", kind: "samurai", position: { x: 400, y: 300 } },
    }).accepted).toBe(false);
  });

  it("authoritatively deploys the new roster for both multiplayer owners", () => {
    const loadout = ["latch", "prism", "zenith"] as const;
    const core = new SimulationCore({
      ...config(),
      mode: { ...NORMAL_MODE, startingCash: 100_000 },
      allowedTowers: loadout,
      players: [
        { id: "test-host", username: "HOST", color: "#66d9ff", loadout, perkLoadout: [] },
        { id: "test-guest", username: "GUEST", color: "#ff806f", loadout, perkLoadout: [] },
      ],
    }, { onResult: () => undefined });
    const commands = [
      { commandId: "test-host:latch", playerId: "test-host", clientSequence: 1, command: { type: "deploy" as const, kind: "latch" as const, position: { x: 350, y: 250 } } },
      { commandId: "test-guest:prism", playerId: "test-guest", clientSequence: 1, command: { type: "deploy" as const, kind: "prism" as const, position: { x: 350, y: 350 } } },
      { commandId: "test-host:zenith", playerId: "test-host", clientSequence: 2, command: { type: "deploy" as const, kind: "zenith" as const, position: { x: 350, y: 450 } } },
    ];
    commands.forEach((command) => expect(core.submit(command).accepted).toBe(true));
    const snapshot = core.createFrame()!.snapshot;
    expect(snapshot.towers.map(({ kind, ownerId }) => ({ kind, ownerId }))).toEqual([
      { kind: "latch", ownerId: "test-host" },
      { kind: "prism", ownerId: "test-guest" },
      { kind: "zenith", ownerId: "test-host" },
    ]);
    expect(snapshot.players.find((player) => player.id === "test-host")?.copiesRemaining.zenith).toBe(1);
    expect(snapshot.players.find((player) => player.id === "test-guest")?.copiesRemaining.prism).toBe(2);
    core.destroy();
  });

  it("runs custom enemy powers in the authoritative multiplayer simulation", () => {
    const enemy = createCustomEnemy();
    enemy.hp = 1_000;
    const immediate = (preset: "haste" | "phase" | "blink") => { const ability = createEnemyAbilityPreset(preset); return ability.trigger.type === "interval" ? { ...ability, trigger: { ...ability.trigger, every: .2, initialDelay: 0 }, cooldown: .2 } : ability; };
    const drain = createEnemyAbilityPreset("shockwave");
    enemy.abilities = [
      immediate("haste"), immediate("phase"), immediate("blink"),
      { ...drain, name: "Drain", trigger: { type: "interval", every: .2, initialDelay: 0 }, cooldown: .2, conditions: [], actions: [{ id: "action-multiplayer-drain", type: "drain", delay: 0, damage: 3, healingPerTarget: 5 }] },
      { ...createEnemyAbilityPreset("last-stand"), id: "ability-multiplayer-fury", name: "Timed fury", trigger: { type: "elapsed-time", at: .1 }, maxUses: 1, actions: [{ id: "action-multiplayer-fury", type: "stat-change", delay: 0, duration: 10, speedMultiplier: 1.2, damageMultiplier: 1.5 }] },
    ];
    const core = new SimulationCore({
      ...config(),
      mode: {
        ...NORMAL_MODE,
        kind: "custom:power-test",
        name: "Power Test",
        isCustom: true,
        startingCash: 10_000,
        waves: [{ blocks: [{ command: "enemyGroup", enemy: enemy.id, count: 1, spawnDelay: 0.1, nextBlockDelay: 0 }], referenceHealth: enemy.hp, waveTimeSeconds: 30 }],
      },
      customEnemies: [enemy],
    }, { onResult: () => undefined });
    expect(core.submit({
      commandId: "test-host:power-target",
      playerId: "test-host",
      clientSequence: 1,
      command: { type: "deploy", kind: "bandit", position: { x: 100, y: 300 } },
    }).accepted).toBe(true);
    for (let tick = 0; tick < 150; tick += 1) core.advance();
    const frame = core.createFrame()!;
    expect(frame.events.map((event) => event.kind)).toEqual(expect.arrayContaining(["haste-pulse", "drain", "phase", "blink", "behavior"]));
    expect(frame.snapshot.enemies[0]).toEqual(expect.objectContaining({ hasteFactor: 1.5, behaviorSpeedFactor: 1.2, behaviorDamageFactor: 1.5 }));
    core.destroy();
  });
});
