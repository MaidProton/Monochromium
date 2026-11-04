import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSimulationReplay, serializeSimulationReplay } from "../src/game/replay.ts";
import { makeTestSimulationConfig } from "../src/game/testSupport.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliPath = join(projectRoot, "scripts", "run-replay.mjs");

describe("replay CLI", () => {
  it("executes an exported replay and supports digest assertions", async () => {
    const config = makeTestSimulationConfig({ mode: { ...makeTestSimulationConfig().mode, startingCash: 2_000 } });
    const bundle = createSimulationReplay(config, [{
      tick: 0,
      envelope: {
        commandId: "test-host:cli-deploy",
        playerId: "test-host",
        clientSequence: 1,
        command: { type: "deploy", kind: "bandit", position: { x: 400, y: 300 } },
      },
    }]);
    const directory = await mkdtemp(join(tmpdir(), "monochromium-replay-"));
    const replayPath = join(directory, "smoke.json");
    try {
      await writeFile(replayPath, serializeSimulationReplay(bundle), "utf8");
      const first = JSON.parse(execFileSync(process.execPath, [cliPath, replayPath, "--ticks", "30", "--json"], {
        cwd: projectRoot,
        encoding: "utf8",
      }));
      expect(first.acceptedCommands).toBe(1);
      expect(first.rejectedCommands).toBe(0);
      expect(first.ticks).toBe(30);
      expect(first.finalDigest).toEqual(expect.any(String));

      const checked = JSON.parse(execFileSync(process.execPath, [cliPath, replayPath, "--ticks=30", `--expect-digest=${first.finalDigest}`, "--json"], {
        cwd: projectRoot,
        encoding: "utf8",
      }));
      expect(checked.digestMatches).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
