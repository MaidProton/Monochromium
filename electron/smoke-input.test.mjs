import { describe, expect, it, vi } from "vitest";
import { withHeldInput } from "./smoke-input.mjs";

describe("observable smoke input", () => {
  it("keeps input held until the renderer reports the result", async () => {
    let completed;
    const release = vi.fn();
    const observe = vi.fn(() => new Promise((resolve) => { completed = resolve; }));
    const run = withHeldInput(async () => undefined, release, observe);
    await Promise.resolve();
    expect(observe).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    completed();
    await run;
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases input when the movement or weapon assertion times out", async () => {
    const release = vi.fn();
    await expect(withHeldInput(async () => undefined, release, async () => { throw new Error("movement timed out"); })).rejects.toThrow("movement timed out");
    expect(release).toHaveBeenCalledOnce();
  });
});
