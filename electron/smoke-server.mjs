import { app, utilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import protocol from "../shared/multiplayer-protocol.json" with { type: "json" };
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.commandLine.appendSwitch("disable-gpu");
app.disableHardwareAcceleration();
const players = [
  { id: "smoke-host", username: "HOST", color: "#66d9ff", loadout: ["bandit", "mecha"] },
  { id: "smoke-guest", username: "GUEST", color: "#ff806f", loadout: ["bandit", "mecha"] },
];
const config = {
  protocol: protocol.protocolVersion,
  sessionId: "SMOKE123",
  seed: 12345,
  map: {
    kind: "custom-map:smoke",
    name: "Smoke Map",
    index: 0,
    isCustom: true,
    difficulty: "Easy",
    description: "Utility-process smoke test.",
    rewardMultiplier: 1,
    mapScale: 1,
    paths: [{ id: "smoke-main", path: [{ x: 0, y: 350 }, { x: 1600, y: 350 }], width: 100, pathType: "round", pathSurface: "solid", core: { x: 1540, y: 350 }, entryLabel: { x: 30, y: 320 }, pathLabel: { x: 800, y: 320 } }],
    path: [{ x: 0, y: 350 }, { x: 1600, y: 350 }],
    core: { x: 1540, y: 350 },
    entryLabel: { x: 30, y: 320 },
    pathLabel: { x: 800, y: 320 },
    blockedZones: [],
    pathBlockers: [],
    palette: { field: "#101414", glow: "#173333", path: "#343b3b", accent: "#66d9ff" },
  },
  mode: {
    kind: "custom:smoke",
    name: "Smoke Mode",
    index: 0,
    isCustom: true,
    description: "Utility-process smoke test.",
    startingCash: 500_000,
    coreIntegrity: 20,
    multiplayerHitCashMultiplier: 0.75,
    reward: { coins: 0, tokens: 0 },
    waves: [{ groups: [{ kind: "dummy", count: 20, gap: 1 }], referenceHealth: 100, waveTimeSeconds: null }],
  },
  customEnemies: [],
  allowedTowers: ["bandit", "mecha"],
  players,
};

app.whenReady().then(async () => {
  // Load the client decoder without changing the compiled utility-process entry.
  const modules = await createServer({ root, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const { ReplicationDecoder } = await modules.ssrLoadModule("/src/game/replication.ts");
  const decoder = new ReplicationDecoder();
  const child = utilityProcess.fork(path.join(root, "dist-server", "simulation-server.mjs"), [], {
    serviceName: "Monochromium Simulation Smoke Test", stdio: "pipe",
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  let latest = null;
  let stateCount = 0;
  let commandSequence = 0;
  let waitingFor = "initial state";
  let finished = false;
  const commands = new Map();
  const listeners = new Set();
  const seenEvents = new Map();
  const timeout = setTimeout(() => fail(new Error(`Timed out waiting for ${waitingFor}.`)), 30_000);
  const fail = (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    console.error(`Simulation server smoke failed // ${error.message}`);
    child.kill();
    void modules.close().finally(() => process.exit(1));
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const waitState = (label, predicate) => {
    waitingFor = label;
    if (latest && predicate(latest)) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => { if (latest && predicate(latest)) { listeners.delete(check); resolve(); } };
      listeners.add(check);
    });
  };
  const send = (owner, command, accepted = true) => {
    const sequence = ++commandSequence;
    const commandId = `smoke:${sequence}`;
    waitingFor = `${command.type} acknowledgement`;
    return new Promise((resolve, reject) => {
      commands.set(commandId, (result) => result.accepted === accepted ? resolve() : reject(new Error(`${command.type}: expected accepted=${accepted}, received ${JSON.stringify(result)}`)));
      child.postMessage({ type: "command", envelope: { commandId, clientSequence: sequence, playerId: players[owner].id, command } });
    });
  };
  const tower = (frame, id = 2) => frame.snapshot.towers.find((candidate) => candidate.id === id);
  child.on("exit", (code) => { if (!finished) fail(new Error(`Utility exited unexpectedly (${code}).`)); });
  child.on("message", (message) => {
    try {
      if (message?.type === "fatal") throw new Error(message.message);
      if (message?.type === "command-result") { commands.get(message.result.commandId)?.(message.result); commands.delete(message.result.commandId); }
      if (message?.type !== "state") return;
      latest = decoder.decode(config.sessionId, message.frame);
      stateCount += 1;
      latest.events.forEach((event) => seenEvents.set(event.id, event));
      listeners.forEach((check) => check());
    } catch (error) { fail(error); }
  });
  try {
    child.postMessage({ type: "start", config });
    await waitState("initial keyframe", (frame) => frame.keyframe);
    for (const owner of [0, 1]) {
      await send(owner, { type: "deploy", kind: "mecha", position: { x: 400 + owner * 400, y: 350 } });
      for (let level = 1; level <= 7; level += 1) await send(owner, { type: "upgrade", towerId: owner + 1 });
      await send(owner, { type: "mecha-control", towerId: owner + 1, active: true });
    }
    await waitState("both upgraded pilots", (frame) => frame.snapshot.towers.length === 2 && frame.snapshot.towers.every((entry) => entry.level === 7 && entry.mechaControlled));
    await send(0, { type: "mecha-control", towerId: 2, active: false }, false);
    await send(1, { type: "mecha-input", towerId: 2, moveX: 1, moveY: 0, aim: { x: 1100, y: 350 }, firing: true });
    await waitState("guest movement and cannon", (frame) => tower(frame).position.x > 810 && [...seenEvents.values()].some((event) => event.label === "mecha-cannon"));
    await waitState("stale-input safety brake", (frame) => tower(frame).mechaSpeed === 0 && !tower(frame).mechaFiring);
    await send(1, { type: "ability", towerId: 2, slot: "f" });
    await waitState("all eight replicated missile launches", () => [...seenEvents.values()].filter((event) => event.label === "mecha-missile" && event.phase === "trigger").length === 8);
    assert([...seenEvents.values()].filter((event) => event.label === "mecha-missile" && event.phase === "trigger").map((event) => event.count).join(",") === "0,1,2,3,4,5,6,7", "Missile rack indices were coalesced.");
    await waitState("all eight authoritative impacts", (frame) => frame.snapshot.timedBombs.length === 0 && [...seenEvents.values()].filter((event) => event.label === "mecha-missile" && event.kind === "explosion").length === 8);
    await send(1, { type: "ability", towerId: 2, slot: "g" });
    await waitState("beam channel and cooldown", (frame) => tower(frame).mechaActiveAbility === "g" && tower(frame).abilityCooldowns.g > 27);
    await send(1, { type: "ability", towerId: 2, slot: "h" }, false);
    await send(1, { type: "mecha-control", towerId: 2, active: false });
    await waitState("beam cancelled on exit", (frame) => !tower(frame).mechaControlled && tower(frame).mechaActiveAbility === null);
    await send(1, { type: "mecha-control", towerId: 2, active: true });
    await send(1, { type: "ability", towerId: 2, slot: "h" });
    await waitState("flame channel and cooldown", (frame) => tower(frame).mechaActiveAbility === "h" && tower(frame).abilityCooldowns.h > 23);
    for (const owner of [0, 1]) await send(owner, { type: "mecha-input", towerId: owner + 1, moveX: 1, moveY: 0, aim: { x: 1100, y: 350 }, firing: true });
    await send(0, { type: "pause" });
    await waitState("pause brakes both pilots", (frame) => frame.snapshot.paused && frame.snapshot.towers.every((entry) => entry.mechaSpeed === 0 && !entry.mechaFiring));
    decoder.reset(); latest = null; seenEvents.clear();
    child.postMessage({ type: "restart", config });
    await waitState("clean restart", (frame) => frame.keyframe && frame.snapshot.towers.length === 0 && !frame.snapshot.paused);
    finished = true;
    clearTimeout(timeout);
    child.kill();
    await modules.close();
    console.log(`Simulation utility smoke passed // two Tank owners, upgrades, authority, movement/fire, input timeout, 8 missile launches/impacts, beam/flame cooldowns, pause, restart (${stateCount} decoded frames).`);
    process.exit(0);
  } catch (error) { fail(error); }
}).catch((error) => { console.error(error); process.exit(1); });
