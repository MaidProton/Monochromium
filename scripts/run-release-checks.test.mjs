import { describe, expect, it, vi } from "vitest";
import { runReleaseChecks } from "./run-release-checks.mjs";

describe("release check scheduling", () => {
  it("waits for every parallel check before starting UI smoke", async () => {
    const pending = new Map();
    const execute = vi.fn(([label]) => new Promise((resolve) => pending.set(label, resolve)));
    const run = runReleaseChecks({ execute, log: () => undefined });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(pending.has("UI smoke")).toBe(false);
    for (const [label, resolve] of pending) if (label !== "app tests") resolve({ label, code: 0 });
    await Promise.resolve();
    expect(pending.has("UI smoke")).toBe(false);
    pending.get("app tests")({ label: "app tests", code: 0 });
    await vi.waitFor(() => expect(pending.has("UI smoke")).toBe(true));
    pending.get("UI smoke")({ label: "UI smoke", code: 0 });
    expect(await run).toHaveLength(5);
  });

  it("keeps failures blocking and does not launch UI after a failed prerequisite", async () => {
    const execute = vi.fn(async ([label]) => ({ label, code: label === "deployed relay protocol" ? 1 : 0 }));
    const results = await runReleaseChecks({ execute, log: () => undefined });
    expect(results.some((result) => result.code === 1)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("reports UI failures without retries or bypasses", async () => {
    const results = await runReleaseChecks({ execute: async ([label]) => ({ label, code: label === "UI smoke" ? 1 : 0 }), log: () => undefined });
    expect(results.at(-1)).toEqual({ label: "UI smoke", code: 1 });
  });

  it("preserves the explicit app-only mode", async () => {
    const execute = vi.fn(async ([label]) => ({ label, code: 0 }));
    expect(await runReleaseChecks({ appOnly: true, execute, log: () => undefined })).toHaveLength(2);
    expect(execute.mock.calls.map(([check]) => check[0])).toEqual(["typecheck", "app tests"]);
  });
});
