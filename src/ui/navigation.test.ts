import { describe, expect, it } from "vitest";
import { frontScreenBackTarget, resolveEscapeAction } from "./navigation.ts";

describe("UI navigation", () => {
  it("gives overlays and transient controls priority over run navigation", () => {
    expect(resolveEscapeAction({ overlay: "confirm", transientOpen: true, runActive: true, frontScreen: "main" })).toBe("dismiss-confirm");
    expect(resolveEscapeAction({ overlay: "settings", transientOpen: true, runActive: true, frontScreen: "main" })).toBe("close-settings");
    expect(resolveEscapeAction({ overlay: "none", transientOpen: true, runActive: true, frontScreen: "main" })).toBe("close-transient");
    expect(resolveEscapeAction({ overlay: "none", transientOpen: false, runActive: true, frontScreen: "main" })).toBe("toggle-pause");
  });

  it("maps creator screens back through their libraries", () => {
    expect(frontScreenBackTarget("enemy-creator")).toBe("enemies");
    expect(frontScreenBackTarget("map-creator")).toBe("map-library");
    expect(frontScreenBackTarget("creator")).toBe("modes");
    expect(frontScreenBackTarget("setup")).toBe("main");
  });
});
