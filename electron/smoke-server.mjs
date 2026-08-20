import { app, utilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.commandLine.appendSwitch("disable-gpu");
app.disableHardwareAcceleration();
const players = [
  { id: "smoke-host", username: "HOST", color: "#66d9ff", loadout: ["bandit"] },
  { id: "smoke-guest", username: "GUEST", color: "#ff806f", loadout: ["bandit"] },
];
const config = {
  protocol: 5,
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
    path: [{ x: 0, y: 350 }, { x: 1600, y: 350 }],
    core: { x: 1540, y: 350 },
    entryLabel: { x: 30, y: 320 },
    pathLabel: { x: 800, y: 320 },
    blockedZones: [],
    palette: { field: "#101414", glow: "#173333", path: "#343b3b", accent: "#66d9ff" },
  },
  mode: {
    kind: "custom:smoke",
    name: "Smoke Mode",
    index: 0,
    isCustom: true,
    description: "Utility-process smoke test.",
    startingCash: 500,
    coreIntegrity: 20,
    multiplayerHitCashMultiplier: 0.75,
    reward: { coins: 0, tokens: 0 },
    waves: [{ groups: [{ kind: "dummy", count: 1, gap: 0 }], referenceHealth: 100, waveTimeSeconds: null }],
  },
  customEnemies: [],
  players,
};

app.whenReady().then(() => {
const child = utilityProcess.fork(path.join(root, "dist-server", "simulation-server.mjs"), [], {
  serviceName: "Monochromium Simulation Smoke Test",
  stdio: "pipe",
});
child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
let ready = false;
const timeout = setTimeout(() => {
  console.error("Simulation server smoke test timed out.");
  child.kill();
  process.exit(1);
}, 8_000);
child.on("spawn", () => console.log("Simulation utility process spawned."));
child.on("exit", (code) => {
  if (!ready) console.error(`Simulation utility process exited before ready (code ${code}).`);
});
child.on("message", (message) => {
  if (message?.type === "fatal") {
    clearTimeout(timeout);
    console.error(message.message);
    child.kill();
    process.exit(1);
  }
  if (message?.type === "ready") ready = true;
  if (ready && message?.type === "state" && message.frame instanceof ArrayBuffer && message.frame.byteLength > 28) {
    clearTimeout(timeout);
    child.kill();
    console.log("Simulation utility process produced encoded authoritative state.");
    process.exit(0);
  }
});
child.postMessage({ type: "start", config });
});
