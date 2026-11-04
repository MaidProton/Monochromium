import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI_PREFERENCES,
  applyGraphicsPreset,
  markGraphicsPresetPromptSeen,
  prefersReducedMotion,
  sanitizeUiPreferences,
  shouldPromptForGraphicsPreset,
} from "./preferences.ts";

describe("UI preferences", () => {
  it("sanitizes invalid device settings without leaking unknown values", () => {
    expect(sanitizeUiPreferences({
      uiScale: 3,
      displayMode: "giant",
      effectsQuality: "potato",
      motion: "fast",
      screenShake: 8,
      scanlineIntensity: -4,
    })).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      screenShake: 1,
      scanlineIntensity: 0,
    });
  });

  it("accepts supported values and clamps visual intensities", () => {
    expect(sanitizeUiPreferences({
      uiScale: 1.25,
      displayMode: "fullscreen",
      effectsQuality: "low",
      motion: "reduced",
      screenShake: 0.35,
      scanlineIntensity: 0.7,
    })).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      uiScale: 1.25,
      displayMode: "fullscreen",
      effectsQuality: "low",
      canvasResolution: 1,
      particleDensity: 0.467,
      projectileDensity: 0.5,
      interfaceBlur: false,
      ambientEffects: false,
      menuAtmosphere: true,
      interfaceShadows: true,
      interfaceAnimations: true,
      canvasGlow: true,
      motion: "reduced",
      screenShake: 0.35,
      scanlineIntensity: 0.7,
    });
  });

  it("resolves system motion preferences deterministically", () => {
    expect(prefersReducedMotion("system", true)).toBe(true);
    expect(prefersReducedMotion("system", false)).toBe(false);
    expect(prefersReducedMotion("reduced", false)).toBe(true);
    expect(prefersReducedMotion("full", true)).toBe(false);
  });

  it("recognizes all graphics presets and persists the first-launch prompt across updates", () => {
    expect(sanitizeUiPreferences({ effectsQuality: "medium" }).effectsQuality).toBe("medium");
    expect(sanitizeUiPreferences({ effectsQuality: "extra-low" }).effectsQuality).toBe("extra-low");

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(shouldPromptForGraphicsPreset("1.0.1", storage)).toBe(true);
    markGraphicsPresetPromptSeen("1.0.1", storage);
    expect(shouldPromptForGraphicsPreset("1.0.1", storage)).toBe(false);
    // Preserves choice across updates instead of re-prompting every version release:
    expect(shouldPromptForGraphicsPreset("1.0.2", storage)).toBe(false);

    // Existing saved preferences also prevent re-prompting on updates
    const existingStorage = {
      getItem: (key: string) => (key === "monochromium.ui.v1" ? "{}" : null),
    };
    expect(shouldPromptForGraphicsPreset("1.0.3", existingStorage)).toBe(false);
  });

  it("keeps manual graphics values and identifies them as custom", () => {
    expect(sanitizeUiPreferences({
      effectsQuality: "custom",
      canvasResolution: 1.35,
      particleDensity: 0.42,
      interfaceBlur: false,
    })).toMatchObject({
      effectsQuality: "custom",
      canvasResolution: 1.35,
      particleDensity: 0.42,
      interfaceBlur: false,
    });
  });

  it("applies a preset bundle across the manual graphics controls", () => {
    const preset = applyGraphicsPreset({
      ...DEFAULT_UI_PREFERENCES,
      effectsQuality: "custom",
      canvasResolution: 1.35,
      particleDensity: 0.42,
      interfaceBlur: true,
    }, "extra-low");
    expect(preset).toMatchObject({
      effectsQuality: "extra-low",
      canvasResolution: 0.75,
      particleDensity: 0.2,
      projectileDensity: 0.25,
      interfaceBlur: false,
      canvasGlow: false,
      motion: "reduced",
    });
  });
});
