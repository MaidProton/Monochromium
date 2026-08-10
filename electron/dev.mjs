import { spawn } from "node:child_process";
import electronPath from "electron";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const host = "127.0.0.1";
const port = 5173;
const root = new URL("..", import.meta.url);
const rootPath = fileURLToPath(root);
const developmentUrl = `http://${host}:${port}`;

const server = await createServer({
  root,
  server: { host, port, strictPort: true },
});

await server.listen();
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
  process.exitCode = exitCode;
};

desktop.once("exit", (code) => void close(code ?? 0));
desktop.once("error", (error) => {
  console.error(`Could not start Electron: ${error.message}`);
  void close(1);
});
process.once("SIGINT", () => void close(0));
process.once("SIGTERM", () => void close(0));
