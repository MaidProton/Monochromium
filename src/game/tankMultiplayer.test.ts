import { describe, expect, it } from "vitest";
import { coalesceEvents } from "../server/replicationEvents.ts";
import { NORMAL_MODE } from "./config.ts";
import type { MultiplayerCommand } from "./multiplayer.ts";
import { ReplicationDecoder, ReplicationEncoder } from "./replication.ts";
import { SimulationCore } from "./SimulationCore.ts";
import type { SimulationEvent } from "./simulationProtocol.ts";
import { advanceTicks, createHeadlessGame, getTestGameInternals, makeStraightTestMap, makeTestEnemy, makeTestPlayer, makeTestSimulationConfig, makeTestTower } from "./testSupport.ts";

const players = [makeTestPlayer("test-host", ["mecha"]), makeTestPlayer("test-guest", ["mecha"])];

/** Real authority + encoded state/event transport + two independent mirrors. */
const session = () => {
  const events: SimulationEvent[] = [];
  let eventId = 0;
  let tick = 0;
  const authority = createHeadlessGame({ role: "host", localPlayer: players[0]!, players, map: makeStraightTestMap(), now: () => tick * 1000 / 30,
    onSimulationEvent: (event) => events.push({ ...event, id: ++eventId, tick, cosmeticSeed: eventId }) });
  const state = getTestGameInternals(authority);
  state.towers = players.map((player, index) => makeTestTower("mecha", 7, {
    id: index + 1, ownerId: player.id, position: { x: 400 + index * 400, y: 350 },
    onPath: true, pathDistance: 400 + index * 400, pathIndex: 0, maxAggro: 7,
    mechaControlled: false, mechaFiring: false, mechaHeat: 0, mechaOverheatTimer: 0,
    mechaHullAngle: 0, mechaTurretAngle: 0, mechaSpeed: 0, mechaActiveAbility: null, mechaAbilityTimer: 0,
    aimPoint: { x: 600 + index * 400, y: 350 },
  }));
  const clients = players.map((player) => createHeadlessGame({ role: "guest", localPlayer: player, players, map: makeStraightTestMap(),
    now: () => tick * 1000 / 30,
    onCommand: (command) => { authority.applyMultiplayerCommand(player.id, command); },
    onPilotInput: (input) => { authority.applyMultiplayerCommand(player.id, { type: "mecha-input", towerId: input.towerId, moveX: input.moveX, moveY: input.moveY, aim: input.aim, firing: input.firing, ...(input.brake === undefined ? {} : { brake: input.brake }) }); },
  }));
  const encoder = new ReplicationEncoder();
  const decoders = clients.map(() => new ReplicationDecoder());
  let sequence = 0;
  const packet = (keyframe = false) => encoder.encode("TANKTEST", tick, authority.createMultiplayerSnapshot(++sequence)!, keyframe, { events: coalesceEvents(events.splice(0)) });
  const deliver = (data: ArrayBuffer) => decoders.map((decoder, index) => {
    const decoded = decoder.decode("TANKTEST", data);
    expect(clients[index]!.applyMultiplayerSnapshot(decoded.snapshot, false)).toBe(true);
    return decoded;
  });
  const sync = () => deliver(packet());
  const step = (count = 1) => { for (let index = 0; index < count; index += 1) { authority.advanceFixedStep(); tick += 1; } };
  const command = (owner: number, command: MultiplayerCommand) => authority.applyMultiplayerCommand(players[owner]!.id, command);
  const input = (owner: number, moveX: -1 | 0 | 1 = 0, firing = false) => command(owner, {
    type: "mecha-input", towerId: owner + 1, moveX, moveY: 0, firing, aim: { x: 600 + owner * 400, y: 350 },
  });
  const close = () => { authority.destroy(); clients.forEach((client) => client.destroy()); };
  return { authority, state, clients, decoders, step, command, input, sync, packet, deliver, close };
};

describe("Tank two-client multiplayer regressions", () => {
  it("releases distant enemies on authority and both mirrors without moving the enemy on release", () => {
    const run = session();
    try {
      const enemy = makeTestEnemy({ pathDistance: 395, speed: 0 });
      run.state.enemies = [enemy];
      expect(run.command(0, { type: "mecha-control", towerId: 1, active: true })).toBe(true);
      run.step(); run.sync();
      expect(enemy.targetTowerId).toBe(1);
      const distance = enemy.pathDistance;
      for (let frame = 0; frame < 12; frame += 1) { run.input(0, 1); run.step(3); run.sync(); }
      expect(run.state.towers[0]!.onPath).toBe(true);
      expect(enemy.targetTowerId).toBeNull();
      expect(enemy.pathDistance).toBe(distance);
      for (const client of run.clients) {
        const mirror = getTestGameInternals(client);
        expect(mirror.enemies[0]!.targetTowerId).toBeNull();
        expect(mirror.towers[0]!.engaged.size).toBe(0);
        expect(mirror.enemies[0]!.pathDistance).toBe(distance);
      }
    } finally { run.close(); }
  });

  it("keeps both pilots independent and brakes both on pause or lost input", () => {
    const run = session();
    try {
      run.sync();
      run.clients.forEach((client, index) => {
        getTestGameInternals(client).selectedTowerId = index + 1;
        expect(client.toggleSelectedMechaControl()).toBe(true);
      });
      run.sync();
      run.clients[0]!.setMechaMovementKey("d", true);
      run.clients[1]!.setMechaMovementKey("a", true);
      run.clients[0]!.setMechaFiring(true);
      run.clients[1]!.setMechaFiring(true);
      run.step(3);
      expect(run.state.towers[0]!.position.x).toBeGreaterThan(400);
      expect(run.state.towers[1]!.mechaHullAngle).toBeGreaterThan(0);
      expect(run.command(0, { type: "mecha-input", towerId: 2, moveX: 1, moveY: 0, aim: { x: 0, y: 0 }, firing: false })).toBe(false);
      expect(run.command(1, { type: "ability", towerId: 1, slot: "f" })).toBe(false);
      expect(run.command(0, { type: "pause" })).toBe(true);
      const positions = run.state.towers.map((tower) => ({ ...tower.position }));
      expect(run.state.towers.every((tower) => !tower.mechaFiring && tower.mechaSpeed === 0)).toBe(true);
      run.step(15); // Paused fixed clock still advances for command rate limits.
      expect(run.command(1, { type: "pause" })).toBe(true);
      run.step(3);
      expect(run.state.towers.map((tower) => tower.position)).toEqual(positions);
      run.input(0, 1, true); run.input(1, 1, true);
      run.step(15);
      expect(run.state.towers.every((tower) => !tower.mechaFiring && tower.mechaSpeed === 0)).toBe(true);
      const stopped = run.state.towers.map((tower) => ({ ...tower.position }));
      run.step(15);
      expect(run.state.towers.map((tower) => tower.position)).toEqual(stopped);
      run.sync();
      expect(run.command(1, { type: "mecha-control", towerId: 2, active: false })).toBe(true);
      expect(run.state.towers[0]!.mechaControlled).toBe(true);
    } finally { run.close(); }
  });

  it("preserves every staggered missile and replicates impacts exactly once per event", () => {
    const run = session();
    try {
      run.state.enemies = [makeTestEnemy({ hp: 100_000, maxHp: 100_000, pathDistance: 600 })];
      run.command(0, { type: "mecha-control", towerId: 1, active: true }); run.sync();
      expect(run.command(0, { type: "ability", towerId: 1, slot: "f" })).toBe(true);
      const launch = run.sync();
      for (const frame of launch) {
        const missiles = frame.events.filter((event) => event.label === "mecha-missile" && event.phase === "trigger");
        expect(missiles).toHaveLength(8);
        expect(missiles.map((event) => event.count)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(frame.snapshot.timedBombs).toHaveLength(8);
      }
      run.clients.forEach((client, index) => {
        const mirror = getTestGameInternals(client);
        mirror.headless = false;
        try {
          client.applySimulationEvents(launch[index]!.events);
          expect(mirror.visualProjectiles).toHaveLength(8);
          expect(mirror.visualProjectiles.map((rocket) => rocket.delay)).toEqual([0, .1, .2, .3, .4, .5, .6, .7].map((_, i) => i * .1));
        } finally { mirror.headless = true; }
      });
      run.step(60);
      const impact = run.sync();
      expect(run.state.enemies[0]!.hp).toBeLessThan(100_000);
      expect(impact[0]!.events.filter((event) => event.kind === "explosion" && event.label === "mecha-missile")).toHaveLength(8);
      expect(impact[1]!.events).toEqual(impact[0]!.events);
      expect(impact[0]!.snapshot.timedBombs).toHaveLength(0);
      expect(run.sync()[0]!.events).toHaveLength(0);
    } finally { run.close(); }
  });

  it("replicates channels and cooldowns, cancels on exit, and resynchronizes after a missing delta", () => {
    const run = session();
    try {
      run.command(1, { type: "mecha-control", towerId: 2, active: true }); run.sync();
      expect(run.command(1, { type: "ability", towerId: 2, slot: "g" })).toBe(true);
      expect(run.command(1, { type: "ability", towerId: 2, slot: "h" })).toBe(false);
      run.step(3);
      for (const frame of run.sync()) {
        expect(frame.snapshot.towers[1]).toMatchObject({ mechaActiveAbility: "g", mechaControlled: true });
        expect(frame.snapshot.towers[1]!.mechaHeat).toBeGreaterThan(0);
        expect(frame.snapshot.towers[1]!.abilityCooldowns?.g).toBeGreaterThan(27);
      }
      run.step(3); run.packet(); // Simulate a dropped/replaced delta.
      run.step(3); const missingBaseline = run.packet();
      run.decoders.forEach((decoder) => expect(() => decoder.decode("TANKTEST", missingBaseline)).toThrow(/baseline/));
      run.deliver(run.packet(true));
      expect(run.command(1, { type: "mecha-control", towerId: 2, active: false })).toBe(true);
      for (const frame of run.sync()) expect(frame.snapshot.towers[1]).toMatchObject({ mechaActiveAbility: null, mechaAbilityTimer: 0, mechaControlled: false, mechaFiring: false, mechaSpeed: 0 });
      expect(run.command(1, { type: "mecha-input", towerId: 2, moveX: 1, moveY: 0, aim: { x: 900, y: 350 }, firing: true })).toBe(false);
    } finally { run.close(); }
  });

  it("isolates codec cooldown baselines from local countdowns", () => {
    const run = session();
    try {
      run.command(1, { type: "mecha-control", towerId: 2, active: true }); run.sync();
      run.command(1, { type: "ability", towerId: 2, slot: "h" });
      const initial = run.sync();
      expect(initial[0]!.snapshot.towers[1]!.abilityCooldowns?.h).toBe(24);
      initial[0]!.snapshot.towers[1]!.abilityCooldowns!.h = 0;
      getTestGameInternals(run.clients[1]!).towers[1]!.abilityCooldowns!.h = 0;
      // No authority tick/change: the next delta must restore the true baseline.
      for (const frame of run.sync()) expect(frame.snapshot.towers[1]!.abilityCooldowns?.h).toBe(24);
    } finally { run.close(); }
  });

  it("follows only each client's own Tank and clears held input on replicated destruction", () => {
    const run = session();
    try {
      run.state.towers[1]!.position = { x: 1100, y: 350 };
      run.sync();
      run.clients.forEach((client, index) => {
        getTestGameInternals(client).selectedTowerId = index + 1;
        client.toggleSelectedMechaControl();
      });
      run.sync();
      for (let index = 0; index < 2; index += 1) {
        const mirror = getTestGameInternals(run.clients[index]!);
        mirror.canvas = { width: 1600, height: 700 } as HTMLCanvasElement;
        mirror.headless = false;
        try {
          mirror.updateMechaCameraFollow(0.05);
          expect(mirror.cameraPan.x * (index === 0 ? 1 : -1)).toBeGreaterThan(0);
        } finally { mirror.headless = true; }
      }
      const guest = run.clients[1]!;
      guest.setMechaMovementKey("d", true);
      guest.setMechaFiring(true);
      expect(getTestGameInternals(guest).mechaKeys.size).toBe(1);
      const camera = { ...getTestGameInternals(guest).cameraPan };
      run.state.towers[1]!.hp = 0;
      run.step(); run.sync();
      expect(getTestGameInternals(guest).mechaKeys.size).toBe(0);
      expect(getTestGameInternals(guest).selectedTowerId).toBeNull();
      const mirror = getTestGameInternals(guest);
      mirror.headless = false;
      try { mirror.updateMechaCameraFollow(.05); expect(mirror.cameraPan).toEqual(camera); }
      finally { mirror.headless = true; }
    } finally { run.close(); }
  });

  it("preserves newly held keys when a pre-entry snapshot is still in flight", () => {
    const run = session();
    try {
      run.sync();
      const inFlight = run.packet();
      const guest = run.clients[1]!;
      const mirror = getTestGameInternals(guest);
      mirror.selectedTowerId = 2;
      guest.toggleSelectedMechaControl();
      guest.setMechaMovementKey("d", true);
      run.deliver(inFlight);
      expect(mirror.mechaKeys.has("d")).toBe(true);
      run.step(3); run.sync();
      expect(mirror.towers[1]!.mechaControlled).toBe(true);
      mirror.updateMirror(1 / 60);
      expect(mirror.towers[1]!.position.x).toBeGreaterThan(800);
    } finally { run.close(); }
  });
});

describe("Tank delayed-input and smoothing regressions", () => {
  it("moves the locally owned Tank before the authority returns a checkpoint", () => {
    const run = session();
    try {
      run.sync();
      const guest = run.clients[1]!;
      const mirror = getTestGameInternals(guest);
      mirror.selectedTowerId = 2;
      guest.toggleSelectedMechaControl();
      run.sync();
      const before = { ...mirror.towers[1]!.position };
      guest.setMechaMovementKey("d", true);
      mirror.updateMirror(1 / 30);
      expect(mirror.towers[1]!.position.x).toBeGreaterThan(before.x);
      expect(run.state.towers[1]!.position).toEqual(before);
    } finally { run.close(); }
  });

  it("never resurrects released fire when an old firing snapshot is followed by mouse aim", () => {
    const run = session();
    try {
      run.sync();
      const guest = run.clients[1]!;
      const mirror = getTestGameInternals(guest);
      mirror.selectedTowerId = 2;
      guest.toggleSelectedMechaControl(); run.sync();
      guest.setMechaFiring(true);
      const inFlight = run.packet();
      guest.setMechaFiring(false);
      run.deliver(inFlight);
      expect(mirror.towers[1]!.mechaFiring).toBe(false); // Local release wins over an in-flight authoritative frame.
      guest.setMechaAim({ x: 1000, y: 360 });
      guest.setMechaMovementKey("d", true);
      mirror.updateMechaPilotInput();
      run.step(3);
      expect(run.state.towers[1]!.mechaFiring).toBe(false);
      expect(run.state.towers[1]!.mechaHeat).toBe(0);
    } finally { run.close(); }
  });

  it("smooths position and shortest-arc rotation without moving the authority or snapping on packets", () => {
    const run = session();
    try {
      run.command(1, { type: "mecha-control", towerId: 2, active: true });
      run.state.towers[1]!.mechaHullAngle = 3.1;
      run.sync();
      const mirror = getTestGameInternals(run.clients[1]!);
      run.state.towers[1]!.position = { x: 820, y: 350 };
      run.state.towers[1]!.mechaHullAngle = -3.1;
      run.sync();
      expect(mirror.towers[1]!.position.x).toBe(800);
      mirror.updateMirror(1 / 60);
      expect(mirror.towers[1]!.position.x).toBeGreaterThan(800);
      expect(mirror.towers[1]!.position.x).toBeLessThan(820);
      expect(Math.abs(mirror.towers[1]!.mechaHullAngle!)).toBeGreaterThan(3);
      expect(run.state.towers[1]!.position.x).toBe(820);
      for (let i = 0; i < 30; i += 1) mirror.updateMirror(1 / 60);
      expect(mirror.towers[1]!.position.x).toBeCloseTo(820, 3);
      run.state.towers[1]!.position = { x: 1200, y: 350 };
      run.sync();
      expect(mirror.towers[1]!.position.x).toBe(1200); // Large corrections don't glide across the map.
    } finally { run.close(); }
  });
});

describe("Tank authoritative command boundary", () => {
  it("deploys one Tank per owner, upgrades all levels, and rejects duplicates and unauthorized control", () => {
    const core = new SimulationCore(makeTestSimulationConfig({ players, allowedTowers: ["mecha"], map: makeStraightTestMap(), mode: { ...NORMAL_MODE, startingCash: 1_000_000 } }), { onResult: () => undefined });
    let sequence = 0;
    const send = (owner: number, command: MultiplayerCommand) => core.submit({ playerId: players[owner]!.id, commandId: `tank:${++sequence}`, clientSequence: sequence, command });
    try {
      for (const owner of [0, 1]) {
        expect(send(owner, { type: "deploy", kind: "mecha", position: { x: 400 + owner * 400, y: 350 } }).accepted).toBe(true);
        expect(send(owner, { type: "deploy", kind: "mecha", position: { x: 600 + owner * 400, y: 350 } }).accepted).toBe(false);
        for (let level = 1; level <= 7; level += 1) expect(send(owner, { type: "upgrade", towerId: owner + 1 }).accepted).toBe(true);
        expect(send(owner, { type: "mecha-control", towerId: owner + 1, active: true }).accepted).toBe(true);
      }
      expect(send(0, { type: "mecha-control", towerId: 2, active: false }).accepted).toBe(false);
      advanceTicks(core, 8); // Let the deployment cannon cooldown expire.
      expect(send(1, { type: "mecha-input", towerId: 2, moveX: 1, moveY: 0, aim: { x: 1100, y: 350 }, firing: true }).accepted).toBe(true);
      advanceTicks(core, 3);
      const frame = core.createFrame()!;
      expect(frame.snapshot.towers.map((tower) => tower.level)).toEqual([7, 7]);
      expect(frame.snapshot.towers[1]!.position.x).toBeGreaterThan(800);
      expect(frame.events.some((event) => event.label === "mecha-cannon")).toBe(true);
      advanceTicks(core, 15);
      expect(core.createFrame()!.snapshot.towers[1]).toMatchObject({ mechaFiring: false, mechaSpeed: 0 });
    } finally { core.destroy(); }
  });
});
