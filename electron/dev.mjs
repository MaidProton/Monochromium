import { spawn } from "node:child_process";
import electronPath from "electron";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const host = "127.0.0.1";
const port = 5173;
const rootPath = fileURLToPath(new URL("..", import.meta.url));
const developmentUrl = `http://${host}:${port}`;
const pidPath = resolve(rootPath, ".monochromium-dev.pid");

const removePidMarker = () => {
  try {
    if (readFileSync(pidPath, "utf8").trim() === String(process.pid)) {
      unlinkSync(pidPath);
    }
  } catch {
    // The marker may already have been removed by the launcher cleanup.
  }
};

const server = await createServer({
  root: rootPath,
  server: { host, port, strictPort: true },
});

await server.listen();
writeFileSync(pidPath, String(process.pid), "utf8");
process.once("exit", removePidMarker);
server.printUrls();

const desktop = spawn(electronPath, [rootPath], {
  stdio: "inherit",
  env: { ...process.env, MONOCHROMIUM_DEV_URL: developmentUrl },
  windowsHide: false,
});

let closing = false;
const close = async (exitCode = 0) => {
  if (closing) return;
  closing = true;
  if (!desktop.killed) desktop.kill();
  await server.close();
  removePidMarker();
  process.exitCode = exitCode;
};

desktop.once("exit", (code) => void close(code ?? 0));
desktop.once("error", (error) => {
  console.error(`Could not start Electron: ${error.message}`);
  void close(1);
});
process.once("SIGINT", () => void close(0));
process.once("SIGTERM", () => void close(0));
