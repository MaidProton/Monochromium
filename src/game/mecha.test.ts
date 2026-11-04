import { describe, expect, it, vi } from "vitest";
import { TOWER_DEFINITIONS } from "./config.ts";
import type { SimulationEvent } from "./simulationProtocol.ts";
import { ReplicationDecoder, ReplicationEncoder } from "./replication.ts";
import {
  createHeadlessGame,
  getTestGameInternals,
  makeTestEnemy,
  makeTestPlayer,
  makeTestTower,
  makeStraightTestMap,
} from "./testSupport.ts";

const mecha = (level = 0, overrides: Partial<import("./types.ts").Tower> = {}) => makeTestTower("mecha", level, {
  ownerId: "solo",
  position: { x: 100, y: 360 },
  onPath: true,
  pathIndex: 0,
  pathDistance: 135,
  maxAggro: 3,
  mechaControlled: false,
  mechaFiring: false,
  mechaActiveAbility: null,
  mechaAbilityTimer: 0,
  mechaHeat: 0,
  mechaOverheatTimer: 0,
  aimPoint: { x: 165, y: 360 },
  ...overrides,
});

const target = (id = 1, pathDistance = 200, hp = 1_000) => makeTestEnemy({ id, pathDistance, hp, maxHp: hp });

const pilot = (tower: ReturnType<typeof mecha>, map?: import("./types.ts").MapDefinition) => {
  const game = createHeadlessGame({ availableTowers: ["mecha"], ...(map ? { map } : {}) });
  const internals = getTestGameInternals(game);
  internals.towers = [tower];
  internals.selectedTowerId = tower.id;
  expect(game.toggleSelectedMechaControl()).toBe(true);
  return { game, internals };
};

describe("Mecha definition and control", () => {
  it("makes Gyro Stabilizer and Thermal Management meaningful upgrade breakpoints", () => {
    const control = TOWER_DEFINITIONS.mecha.control!;
    expect(control.hullTurnRate[4]! / control.hullTurnRate[3]!).toBeGreaterThan(1.25);
    expect(control.turretTurnRate[4]! / control.turretTurnRate[3]!).toBeGreaterThan(1.3);
    expect(control.heat.ventPerSecond[6]! / control.heat.ventPerSecond[5]!).toBe(1.5);
    for (const curve of [control.heat.cannonPerShot, control.heat.missile, control.heat.beamPerSecond, control.heat.flamePerSecond]) expect(curve[6]! / curve[5]!).toBeLessThanOrEqual(0.76);
    const before = pilot(mecha(5, { mechaHeat: 60 }));
    const after = pilot(mecha(6, { mechaHeat: 60 }));
    before.internals.updateTowers(1);
    after.internals.updateTowers(1);
    expect(before.internals.towers[0]!.mechaHeat).toBe(46);
    expect(after.internals.towers[0]!.mechaHeat).toBe(39);
    before.game.destroy(); after.game.destroy();
  });
  it("defines the expensive one-copy eight-level endgame chassis", () => {
    const definition = TOWER_DEFINITIONS.mecha;
    expect(definition.name).toBe("Tank");
    expect(definition.cost).toBe(6_000);
    expect(definition.unlockCost).toBe(18_000);
    expect(definition.copyLimit).toBe(1);
    expect(definition.levels).toHaveLength(8);
    expect(definition.upgrades).toHaveLength(7);
    expect(definition.levels.at(-1)!.damage / definition.levels.at(-1)!.fireRate).toBe(780);
    expect(definition.levels.map((level) => level.damage)).toEqual([20, 25, 31, 39, 48, 57, 64, 78]);
    expect(definition.levels.map((level) => level.fireRate)).toEqual([0.30, 0.27, 0.24, 0.21, 0.18, 0.15, 0.12, 0.10]);
    expect(definition.levels.map((level) => level.range)).toEqual([26, 27, 28, 29, 30, 31, 33, 35]);
    expect(definition.levels.map((level) => level.aggroBonus)).toEqual([0, 0, 1, 1, 2, 2, 3, 4]);
    expect(definition.control?.heat.max).toEqual([200, 200, 200, 200, 200, 200, 400, 400]);
    expect(definition.control?.heat.cannonPerShot).toEqual([4, 3.8, 3.5, 3.1, 2.8, 2.4, 1.6, 1.4]);
    expect(definition.control?.missiles.damage).toEqual([70, 82, 105, 130, 165, 210, 265, 330]);
    expect(definition.control?.missiles.radius).toEqual([65, 70, 76, 82, 90, 98, 106, 115]);
    expect(definition.control?.missiles.spread).toBe(32);
    expect(definition.abilities?.f?.cooldown).toBe(18);
    expect(definition.abilities?.g?.cooldown).toBe(28);
    expect(definition.abilities?.h?.cooldown).toBe(24);
    expect(definition.abilities?.f?.unlockLevel).toBe(1);
    expect(definition.abilities?.g?.unlockLevel).toBe(3);
    expect(definition.abilities?.h?.unlockLevel).toBe(5);
    expect(definition.control?.movementSpeed).toHaveLength(8);
    expect(definition.control?.beam.duration.at(-1)).toBe(4.5);
    expect(definition.control?.flame.duration.at(-1)).toBe(5);
  });

  it("moves with normalized WASD input and clamps the body to map bounds", () => {
    const tower = mecha();
    const { game, internals } = pilot(tower);
    expect(game.setMechaMovementKey("d", true)).toBe(true);
    expect(game.setMechaMovementKey("s", true)).toBe(true);
    internals.updateControlledMecha(0.5);
    expect(tower.position.x).toBeGreaterThan(100);
    expect(tower.position.y).toBeGreaterThan(360);
    expect(Math.hypot(tower.position.x - 100, tower.position.y - 360)).toBeLessThan(150 * 0.5);
    expect(tower.mechaHullAngle).toBeCloseTo(Math.PI / 4);
    expect(tower.mechaSpeed).toBeGreaterThan(0);

    tower.position = { x: 1_599, y: 699 };
    internals.updateControlledMecha(0.5);
    expect(tower.position.x).toBe(1_572);
    expect(tower.position.y).toBe(672);
    game.destroy();
  });

  it("stays dormant outside Pilot Mode and fires a holdable cannon while piloted", () => {
    const events: SimulationEvent[] = [];
    const game = createHeadlessGame({ availableTowers: ["mecha"], onSimulationEvent: (event) => events.push(event) });
    const internals = getTestGameInternals(game);
    const dormant = mecha();
    const enemy = target();
    internals.towers = [dormant];
    internals.enemies = [enemy];
    internals.updateTowers(0);
    expect(enemy.hp).toBe(1_000);
    expect(dormant.fireTimer).toBe(0);
    internals.selectedTowerId = dormant.id;
    expect(game.counterSelected()).toBe(false);
    expect(game.toggleSelectedAutoCounter()).toBe(false);
    expect(dormant.autoCounter).toBe(false);

    expect(game.toggleSelectedMechaControl()).toBe(true);
    expect(game.setMechaAim({ x: 165, y: 360 })).toBe(true);
    expect(game.setMechaFiring(true)).toBe(true);
    internals.updateTowers(0);
    expect(enemy.hp).toBe(980);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ label: "mecha-cannon", visual: "hitscan" })]));
    internals.updateTowers(0.45);
    expect(enemy.hp).toBe(960);
    game.destroy();
  });

  it("keeps path aggro while moving on-route and releases enemies on departure", () => {
    const tower = mecha();
    const enemy = target(1, 130);
    const { game, internals } = pilot(tower);
    internals.enemies = [enemy];
    internals.updateControlledMecha(0);
    internals.updateEnemies(0);
    expect(enemy.targetTowerId).toBe(tower.id);
    expect(tower.engaged.has(enemy.id)).toBe(true);
    const enemyDistance = enemy.pathDistance;

    expect(game.setMechaMovementKey("w", true)).toBe(true);
    internals.updateControlledMecha(1.4);
    expect(tower.onPath).toBe(false);
    expect(enemy.targetTowerId).toBeNull();
    expect(tower.engaged.size).toBe(0);
    expect(enemy.pathDistance).toBe(enemyDistance);
    game.destroy();
  });

  it.each([1, -1])("releases enemies left behind while driving along the same route (direction %s)", (direction) => {
    const tower = mecha(0, { position: { x: 400, y: 350 }, pathDistance: 400, mechaHullAngle: direction > 0 ? 0 : Math.PI });
    const enemy = makeTestEnemy({ pathDistance: 395, speed: 40 });
    const { game, internals } = pilot(tower, makeStraightTestMap());
    try {
      internals.enemies = [enemy];
      internals.updateEnemies(0);
      expect(enemy.targetTowerId).toBe(tower.id);
      const blockedAt = enemy.pathDistance;
      game.setMechaMovementKey(direction > 0 ? "d" : "a", true);
      internals.updateControlledMecha(0.1);
      expect(enemy.targetTowerId).toBe(tower.id);
      enemy.stunTimer = 2; // Leash checks must run even for stunned enemies.
      internals.updateControlledMecha(1.1);
      expect(tower.onPath).toBe(true);
      expect(enemy.targetTowerId).toBeNull();
      expect(tower.engaged.size).toBe(0);
      expect(enemy.pathDistance).toBe(blockedAt);
      enemy.stunTimer = 0;
      enemy.attackTimer = 0;
      const hp = tower.hp;
      internals.updateEnemies(0.1);
      expect(tower.hp).toBe(hp);
      expect(enemy.targetTowerId).toBeNull();
      expect(enemy.pathDistance).toBeGreaterThan(blockedAt);
    } finally { game.destroy(); }
  });

  it("releases only out-of-reach enemies and permits them to engage again on return", () => {
    const tower = mecha(0, { position: { x: 100, y: 350 }, pathDistance: 100 });
    const { game, internals } = pilot(tower, makeStraightTestMap());
    try {
      const oldEnemy = target(1, 75);
      const nearby = target(2, 185);
      oldEnemy.targetTowerId = nearby.targetTowerId = tower.id;
      tower.engaged.add(1); tower.engaged.add(2);
      tower.position = { ...tower.position, x: 190 };
      internals.enemies = [oldEnemy, nearby];
      internals.updateControlledMecha(0);
      expect(oldEnemy.targetTowerId).toBeNull();
      expect(nearby.targetTowerId).toBe(tower.id);
      expect([...tower.engaged]).toEqual([2]);
      tower.position = { ...tower.position, x: 80 };
      internals.updateControlledMecha(0);
      internals.updateEnemies(0);
      expect(oldEnemy.targetTowerId).toBe(tower.id);
      expect(nearby.targetTowerId).toBeNull();
    } finally { game.destroy(); }
  });
});

describe("Mecha weapons and heat", () => {
  it("fires along the traversing barrel rather than snapping damage to the mouse", () => {
    const tower = mecha();
    const enemy = target();
    const { game, internals } = pilot(tower);
    internals.enemies = [enemy];
    game.setMechaAim({ x: 100, y: 100 });
    game.setMechaFiring(true);
    internals.updateTowers(0);
    expect(enemy.hp).toBe(980); // Still facing right immediately after the mouse moves.
    internals.updateControlledMecha(1);
    expect(tower.mechaTurretAngle).toBeCloseTo(-Math.PI / 2);
    internals.updateTowers(0.5);
    expect(enemy.hp).toBe(980);
    game.destroy();
  });
  it("renders solo weapon effects through the same event presentation as multiplayer", () => {
    const tower = mecha(7);
    const { game, internals } = pilot(tower);
    // Enable only the presentation seam; no DOM or animation loop is started.
    internals.headless = false;
    const launchSound = vi.spyOn(internals.audio, "tankMissileLaunch");
    try {
      game.setMechaFiring(true);
      internals.updateTowers(0);
      expect(internals.particles.length).toBeGreaterThan(0);
      game.setMechaFiring(false);
      expect(game.activateSelectedAbility("f")).toBe(true);
      expect(internals.visualProjectiles).toHaveLength(8);
      expect(launchSound).not.toHaveBeenCalled();
      const rocket = internals.visualProjectiles[0]!;
      expect(rocket.style).toBe("mecha-missile");
      expect(rocket.position).toEqual(rocket.start);
      internals.updateVisualProjectiles(0.05);
      expect(launchSound).toHaveBeenCalledTimes(1);
      expect(rocket.position).not.toEqual(rocket.start);
      expect(rocket.position).not.toEqual(rocket.endpoint);
      const delayedRocket = internals.visualProjectiles[1]!;
      const oldOrigin = { ...delayedRocket.start };
      tower.position = { ...tower.position, x: tower.position.x + 15 };
      internals.updateVisualProjectiles(0.05);
      expect(delayedRocket.start.x).toBeCloseTo(oldOrigin.x + 15);
      expect(delayedRocket.hidden).toBe(false);
      internals.updateVisualProjectiles(0.01);
      expect(launchSound).toHaveBeenCalledTimes(2);
      expect(game.activateSelectedAbility("h")).toBe(true);
      internals.updateTowers(0);
      expect(internals.particles.some((particle) => (particle as { type: string }).type === "flame-plume")).toBe(true);
    } finally { launchSound.mockRestore(); internals.headless = true; game.destroy(); }
  });

  it("synchronizes sustained flame audio with channel state and window focus", () => {
    const tower = mecha(7);
    const { game, internals } = pilot(tower);
    expect(game.activateSelectedAbility("h")).toBe(true);
    const hasFocus = vi.fn(() => true);
    vi.stubGlobal("document", { hidden: false, hasFocus });
    const flameSound = vi.spyOn(internals.audio, "tankFlameStream");
    internals.headless = false;
    try {
      internals.syncTankWeaponAudio();
      expect(flameSound).toHaveBeenLastCalledWith(true, 7);
      hasFocus.mockReturnValue(false);
      internals.syncTankWeaponAudio();
      expect(flameSound).toHaveBeenLastCalledWith(false, 0);
      hasFocus.mockReturnValue(true);
      internals.syncTankWeaponAudio();
      expect(flameSound).toHaveBeenLastCalledWith(true, 7);
      tower.mechaOverheatTimer = 1;
      internals.syncTankWeaponAudio();
      expect(flameSound).toHaveBeenLastCalledWith(false, 0);
      tower.mechaOverheatTimer = 0;
      tower.mechaAbilityTimer = 0;
      internals.syncTankWeaponAudio();
      expect(flameSound).toHaveBeenLastCalledWith(false, 0);
    } finally {
      flameSound.mockRestore();
      vi.unstubAllGlobals();
      internals.headless = true;
      game.destroy();
    }
  });

  it("builds heat under sustained cannon fire, vents on release, and permits exit while paused", () => {
    const tower = mecha(7);
    const { game, internals } = pilot(tower);
    game.setMechaFiring(true);
    for (let tick = 0; tick < 60; tick += 1) internals.updateTowers(1 / 30);
    expect(tower.mechaHeat).toBeGreaterThan(20);
    game.setMechaFiring(false);
    const hot = tower.mechaHeat!;
    internals.updateTowers(0.5);
    expect(tower.mechaHeat).toBeLessThan(hot);
    game.setMechaMovementKey("d", true);
    game.setPaused(true);
    expect(game.toggleSelectedMechaControl()).toBe(true);
    expect(tower.mechaControlled).toBe(false);
    game.setPaused(false);
    const position = { ...tower.position };
    internals.updateControlledMecha(0.1);
    expect(tower.position).toEqual(position);
    game.destroy();
  });

  it("launches an authoritative missile volley at the aim endpoint", () => {
    const events: SimulationEvent[] = [];
    const tower = mecha(1);
    const enemy = target();
    const missileGame = createHeadlessGame({ availableTowers: ["mecha"], onSimulationEvent: (event) => events.push(event) });
    const missileInternals = getTestGameInternals(missileGame);
    missileInternals.towers = [tower];
    missileInternals.enemies = [enemy];
    missileInternals.selectedTowerId = tower.id;
    expect(missileGame.toggleSelectedMechaControl()).toBe(true);
    expect(missileGame.activateSelectedAbility("f")).toBe(true);
    expect(missileInternals.timedBombs).toHaveLength(3);
    expect(missileInternals.timedBombs.every((bomb) => bomb.damage === 82 && bomb.radius === 70)).toBe(true);
    const launches = events.filter((event) => event.label === "mecha-missile" && event.phase === "trigger");
    expect(launches).toHaveLength(3);
    expect(launches.every((event) => event.from && event.position && event.duration! >= Math.hypot(event.position.x - event.from.x, event.position.y - event.from.y) / event.speed!)).toBe(true);
    missileInternals.updateTimedBombs(0.05);
    expect(enemy.hp).toBe(1000);
    missileInternals.updateTimedBombs(1);
    expect(enemy.hp).toBe(754);
    expect(events.filter((event) => event.kind === "explosion" && event.label === "mecha-missile")).toHaveLength(3);
    missileGame.destroy();
  });

  it("ticks Plasma Beam, burns with Flamethrower, and keeps channels exclusive", () => {
    const beamTower = mecha(3);
    const beamEnemy = target();
    const { game: beamGame, internals: beamInternals } = pilot(beamTower);
    beamInternals.enemies = [beamEnemy];
    expect(beamGame.activateSelectedAbility("g")).toBe(true);
    beamInternals.updateTowers(0);
    expect(beamEnemy.hp).toBe(950);
    expect(beamTower.mechaActiveAbility).toBe("g");
    expect(beamGame.activateSelectedAbility("h")).toBe(false);
    beamGame.destroy();

    const flameTower = mecha(5);
    const flameEnemy = target();
    const { game: flameGame, internals: flameInternals } = pilot(flameTower);
    flameInternals.enemies = [flameEnemy];
    expect(flameGame.activateSelectedAbility("h")).toBe(true);
    flameInternals.updateTowers(0);
    expect(flameEnemy.hp).toBe(928);
    expect(flameEnemy.burnTimer).toBeGreaterThan(0);
    flameGame.destroy();
  });

  it("lets launched missiles finish their flight after the chassis is sold", () => {
    const tower = mecha(1);
    const enemy = target();
    const { game, internals } = pilot(tower);
    internals.enemies = [enemy];
    expect(game.activateSelectedAbility("f")).toBe(true);
    expect(game.sellSelected()).toBe(true);
    expect(internals.timedBombs).toHaveLength(3);
    internals.updateTimedBombs(1);
    expect(enemy.hp).toBe(754);
    game.destroy();
  });

  it("uses the doubled base and Thermal Management heat caps", () => {
    const tower = mecha(5, { mechaHeat: 199 });
    const { game, internals } = pilot(tower);
    internals.enemies = [target()];
    expect(game.activateSelectedAbility("h")).toBe(true);
    internals.updateTowers(0.1);
    expect(tower.mechaHeat).toBe(200);
    expect(tower.mechaActiveAbility).toBeNull();
    expect(tower.mechaOverheatTimer).toBeGreaterThan(2.5);
    game.destroy();

    const upgradedTower = mecha(6, { mechaHeat: 399 });
    const upgraded = pilot(upgradedTower);
    expect(upgraded.game.activateSelectedAbility("h")).toBe(true);
    upgraded.internals.updateTowers(0.1);
    expect(upgradedTower.mechaHeat).toBe(400);
    expect(upgradedTower.mechaActiveAbility).toBeNull();
    upgraded.game.destroy();
  });
});

describe("Mecha multiplayer authority and replication", () => {
  it("refreshes held input without mouse movement and sends key releases immediately", () => {
    const commands: import("./multiplayer.ts").MultiplayerCommand[] = [];
    const pilotInputs: import("./multiplayer.ts").MultiplayerPilotInput[] = [];
    let now = 0;
    const guest = makeTestPlayer("test-guest", ["mecha"]);
    const game = createHeadlessGame({ role: "guest", localPlayer: guest, players: [makeTestPlayer("test-host"), guest], now: () => now, onCommand: (command) => commands.push(command), onPilotInput: (input) => pilotInputs.push(input) });
    const internals = getTestGameInternals(game);
    const tower = mecha(0, { ownerId: guest.id });
    internals.towers = [tower]; internals.selectedTowerId = tower.id;
    game.toggleSelectedMechaControl();
    game.setMechaMovementKey("d", true);
    game.setMechaFiring(true);
    now = 200;
    internals.updateMechaPilotInput();
    expect(pilotInputs.at(-1)).toMatchObject({ type: "pilot-input", moveX: 1, firing: true, sequence: 3 });
    game.setMechaMovementKey("d", false);
    expect(pilotInputs.at(-1)).toMatchObject({ type: "pilot-input", moveX: 0 });
    game.releaseMechaInput();
    expect(pilotInputs.at(-1)).toMatchObject({ type: "pilot-input", moveX: 0, moveY: 0, firing: false });
    game.destroy();
  });

  it("allows only the owner to control it and releases stale remote input", () => {
    const host = makeTestPlayer("test-host", ["mecha"]);
    const guest = makeTestPlayer("test-guest", ["mecha"]);
    const game = createHeadlessGame({ role: "host", localPlayer: host, players: [host, guest], availableTowers: ["mecha"] });
    const internals = getTestGameInternals(game);
    const tower = mecha(0, { ownerId: guest.id });
    internals.towers = [tower];
    expect(game.applyMultiplayerCommand(host.id, { type: "mecha-control", towerId: tower.id, active: true })).toBe(false);
    expect(game.applyMultiplayerCommand(guest.id, { type: "mecha-control", towerId: tower.id, active: true })).toBe(true);
    internals.selectedTowerId = tower.id;
    game.deselectTower();
    expect(internals.selectedTowerId).toBeNull();
    expect(game.applyMultiplayerCommand(guest.id, { type: "mecha-input", towerId: tower.id, moveX: 1, moveY: 0, aim: { x: 300, y: 360 }, firing: true })).toBe(true);
    internals.updateControlledMecha(0.2);
    const movedX = tower.position.x;
    internals.updateControlledMecha(0.2);
    expect(tower.position.x).toBeCloseTo(movedX);
    expect(tower.mechaFiring).toBe(false);
    expect(tower.mechaSpeed).toBe(0);
    expect(game.applyMultiplayerCommand(guest.id, { type: "mecha-input", towerId: tower.id, moveX: 1, moveY: 0, aim: { x: 300, y: 360 }, firing: true, brake: "invalid" } as unknown as import("./multiplayer.ts").MultiplayerCommand)).toBe(false);
    expect(game.applyMultiplayerCommand(guest.id, { type: "mecha-input", towerId: tower.id, moveX: 1, moveY: 0, aim: { x: 300, y: 360 }, firing: true })).toBe(true);
    internals.updateControlledMecha(0.1);
    expect(tower.mechaSpeed).toBeGreaterThan(0);
    expect(game.applyMultiplayerCommand(guest.id, { type: "mecha-input", towerId: tower.id, moveX: 0, moveY: 0, aim: { x: 300, y: 360 }, firing: false, brake: true })).toBe(true);
    expect(tower.mechaSpeed).toBe(0);
    game.destroy();
  });

  it("round-trips controlled pose, aim, channel, firing, and heat fields", () => {
    const host = makeTestPlayer("test-host", ["mecha"]);
    const guest = makeTestPlayer("test-guest", ["mecha"]);
    const game = createHeadlessGame({ role: "host", localPlayer: host, players: [host, guest], availableTowers: ["mecha"] });
    const internals = getTestGameInternals(game);
    internals.towers = [mecha(5, {
      mechaControlled: true,
      mechaFiring: true,
      mechaActiveAbility: "h",
      mechaAbilityTimer: 2.75,
      mechaHeat: 64.5,
      mechaOverheatTimer: 1.2,
      mechaHullAngle: 1.234,
      mechaTurretAngle: -2.345,
      mechaSpeed: 87.25,
      aimPoint: { x: 333.25, y: 244.75 },
    })];
    const snapshot = game.createMultiplayerSnapshot(1);
    expect(snapshot).not.toBeNull();
    const decoder = new ReplicationDecoder();
    const encoder = new ReplicationEncoder();
    const decoded = decoder.decode("TEST1234", encoder.encode("TEST1234", 1, snapshot!, true)).snapshot.towers[0];
    expect(decoded?.position).toEqual({ x: 100, y: 360 });
    expect(decoded?.aimPoint?.x).toBeCloseTo(333.25);
    expect(decoded?.mechaControlled).toBe(true);
    expect(decoded?.mechaFiring).toBe(true);
    expect(decoded?.mechaActiveAbility).toBe("h");
    expect(decoded?.mechaAbilityTimer).toBeCloseTo(2.75);
    expect(decoded?.mechaHeat).toBeCloseTo(64.5);
    expect(decoded?.mechaOverheatTimer).toBeCloseTo(1.2);
    expect(decoded?.mechaHullAngle).toBeCloseTo(1.234, 3);
    expect(decoded?.mechaTurretAngle).toBeCloseTo(-2.345, 3);
    expect(decoded?.mechaSpeed).toBeCloseTo(87.25);
    internals.towers[0]!.mechaHullAngle = -0.765;
    internals.towers[0]!.mechaTurretAngle = 0.345;
    internals.towers[0]!.mechaSpeed = 12.5;
    const delta = decoder.decode("TEST1234", encoder.encode("TEST1234", 2, game.createMultiplayerSnapshot(2)!, false));
    expect(delta.keyframe).toBe(false);
    expect(delta.snapshot.towers[0]).toMatchObject({ mechaHullAngle: -0.765, mechaTurretAngle: 0.345, mechaSpeed: 12.5 });
    game.destroy();
  });

  it("rejects malformed authoritative heading and velocity fields", () => {
    const host = makeTestPlayer("test-host", ["mecha"]);
    const guest = makeTestPlayer("test-guest", ["mecha"]);
    const game = createHeadlessGame({ role: "host", localPlayer: host, players: [host, guest] });
    getTestGameInternals(game).towers = [mecha(0, { ownerId: host.id, mechaHullAngle: 0, mechaTurretAngle: 0, mechaSpeed: 0 })];
    const snapshot = game.createMultiplayerSnapshot(1)!;
    const mirror = createHeadlessGame({ role: "guest", localPlayer: guest, players: [host, guest] });
    for (const invalid of [{ mechaHullAngle: NaN }, { mechaTurretAngle: 99 }, { mechaSpeed: -1 }]) {
      expect(mirror.applyMultiplayerSnapshot({ ...snapshot, towers: [{ ...snapshot.towers[0]!, ...invalid }] })).toBe(false);
    }
    expect(mirror.applyMultiplayerSnapshot(snapshot)).toBe(true);
    game.destroy(); mirror.destroy();
  });
});
