import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const usage = `Usage: npm run replay -- <repro.json> [options]

Options:
  --ticks <n>                 Run exactly n fixed simulation ticks.
  --checkpoint-interval <n>   Record a digest every n ticks (default: 30).
  --expect-digest <digest>    Exit with status 1 when the final digest differs.
  --json                      Print machine-readable JSON instead of a summary.
  --help                      Show this help.
`;

const parsePositiveInteger = (value, flag) => {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} is outside the safe integer range.`);
  return parsed;
};

const parseArguments = (argv) => {
  const positional = [];
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    const [flag, inlineValue] = argument.split("=", 2);
    if (flag === "--ticks" || flag === "--checkpoint-interval") {
      const value = inlineValue ?? argv[++index];
      if (!value) throw new Error(`${flag} requires a value.`);
      options[flag === "--ticks" ? "ticks" : "checkpointInterval"] = parsePositiveInteger(value, flag);
      continue;
    }
    if (flag === "--expect-digest") {
      const value = inlineValue ?? argv[++index];
      if (!value) throw new Error("--expect-digest requires a value.");
      options.expectedDigest = value;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    positional.push(argument);
  }
  if (positional.length !== 1) throw new Error("Provide exactly one replay JSON path.");
  return { path: positional[0], ...options };
};

const loadReplayModule = async () => {
  const server = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    return { module: await server.ssrLoadModule("/src/game/replay.ts"), server };
  } catch (error) {
    await server.close();
    throw error;
  }
};

const main = async () => {
  let argumentsValue;
  try {
    argumentsValue = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`REPLAY FAILED // ${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
    process.exitCode = 2;
    return;
  }
  if (argumentsValue.help) {
    console.log(usage);
    return;
  }

  let server;
  try {
    const raw = await readFile(resolve(process.cwd(), argumentsValue.path), "utf8");
    const loaded = await loadReplayModule();
    server = loaded.server;
    const bundle = loaded.module.parseSimulationReplay(raw);
    const result = loaded.module.runSimulationReplay(bundle, {
      ...(argumentsValue.ticks === undefined ? {} : { ticks: argumentsValue.ticks }),
      ...(argumentsValue.checkpointInterval === undefined ? {} : { checkpointInterval: argumentsValue.checkpointInterval }),
    });
    const summary = {
      version: bundle.version,
      sessionId: bundle.config.sessionId,
      seed: bundle.config.seed,
      commands: bundle.commands.length,
      acceptedCommands: result.commandResults.filter((command) => command.accepted).length,
      rejectedCommands: result.commandResults.filter((command) => !command.accepted).length,
      ticks: result.checkpoints.at(-1)?.tick ?? argumentsValue.ticks ?? 0,
      checkpoints: result.checkpoints.length,
      events: result.events.length,
      finalDigest: result.finalDigest,
      result: result.result,
      ...(argumentsValue.expectedDigest === undefined ? {} : { digestMatches: result.finalDigest === argumentsValue.expectedDigest }),
    };
    if (argumentsValue.json) console.log(JSON.stringify(summary));
    else {
      console.log("REPLAY OK");
      console.log(`SESSION // ${summary.sessionId} // SEED ${summary.seed}`);
      console.log(`COMMANDS // ${summary.commands} total // ${summary.acceptedCommands} accepted // ${summary.rejectedCommands} rejected`);
      console.log(`SIMULATION // ${summary.ticks} ticks // ${summary.checkpoints} checkpoints // ${summary.events} events`);
      console.log(`FINAL DIGEST // ${summary.finalDigest}`);
      if (summary.result) console.log(`RESULT // ${summary.result.victory ? "VICTORY" : "DEFEAT"} // WAVE ${summary.result.wave}`);
    }
    if (argumentsValue.expectedDigest !== undefined && summary.finalDigest !== argumentsValue.expectedDigest) {
      console.error(`REPLAY FAILED // expected digest ${argumentsValue.expectedDigest}, received ${summary.finalDigest}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`REPLAY FAILED // ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await server?.close();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
