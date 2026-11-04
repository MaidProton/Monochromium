import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appOnly = process.argv.includes("--app-only");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env.npm_execpath;
const checksFor = (appOnly) => appOnly
  ? [
      ["typecheck", ["run", "typecheck"]],
      ["app tests", ["test"]],
    ]
  : [
      ["typecheck", ["run", "typecheck"]],
      ["app tests", ["test"]],
      ["relay tests", ["run", "test:relay"]],
      ["deployed relay protocol", ["run", "relay:check"]],
    ];

function pipeLines(stream, write) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => write(line));
  return lines;
}

function runCheck([label, args]) {
  return new Promise((resolve) => {
    const child = spawn(npmExecPath ? process.execPath : npmCommand, npmExecPath ? [npmExecPath, ...args] : args, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: process.platform === "win32" && !npmExecPath,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const prefix = `[${label}]`;
    pipeLines(child.stdout, (line) => console.log(`${prefix} ${line}`));
    pipeLines(child.stderr, (line) => console.error(`${prefix} ${line}`));
    child.once("error", (error) => resolve({ label, code: 1, error }));
    child.once("close", (code, signal) => resolve({ label, code: code ?? 1, signal }));
  });
}

export async function runReleaseChecks({ appOnly = false, execute = runCheck, log = console.log } = {}) {
  const checks = checksFor(appOnly);
  log(`Running ${checks.length} release checks in parallel${appOnly ? " (application checks only)" : "; UI smoke runs afterward in isolation"}.`);
  const results = await Promise.all(checks.map(execute));
  if (!appOnly && results.every((result) => result.code === 0)) {
    log("Running UI smoke after the other checks have finished.");
    results.push(await execute(["UI smoke", ["run", "test:ui"]]));
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = (await runReleaseChecks({ appOnly })).filter((result) => result.code !== 0);
  if (failures.length > 0) {
    console.error(`Release checks failed: ${failures.map((result) => `${result.label} (${result.code})`).join(", ")}.`);
    process.exitCode = 1;
  } else console.log("All release checks passed.");
}
