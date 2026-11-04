export const UI_PREFERENCES_STORAGE_KEY = "monochromium.ui.v1";
export const GRAPHICS_PRESET_PROMPT_STORAGE_KEY = "monochromium.graphics-preset-prompt.v1";

export type UiScale = 0.9 | 1 | 1.1 | 1.25;
export type DisplayMode = "windowed" | "fullscreen";
export const GRAPHICS_PRESET_VALUES = ["high", "medium", "low", "extra-low", "custom"] as const;
export type EffectsQuality = typeof GRAPHICS_PRESET_VALUES[number];
export type MotionPreference = "system" | "reduced" | "full";

export interface UiPreferences {
  readonly uiScale: UiScale;
  readonly displayMode: DisplayMode;
  readonly effectsQuality: EffectsQuality;
  readonly canvasResolution: number;
  readonly particleDensity: number;
  readonly projectileDensity: number;
  readonly interfaceBlur: boolean;
  readonly ambientEffects: boolean;
  readonly menuAtmosphere: boolean;
  readonly interfaceShadows: boolean;
  readonly interfaceAnimations: boolean;
  readonly canvasGlow: boolean;
  readonly motion: MotionPreference;
  readonly screenShake: number;
  readonly scanlineIntensity: number;
}

type GraphicsManualSettings = Pick<
  UiPreferences,
  | "canvasResolution"
  | "particleDensity"
  | "projectileDensity"
  | "interfaceBlur"
  | "ambientEffects"
  | "menuAtmosphere"
  | "interfaceShadows"
  | "interfaceAnimations"
  | "canvasGlow"
  | "motion"
>;

const GRAPHICS_PRESET_SETTINGS: Readonly<Record<Exclude<EffectsQuality, "custom">, GraphicsManualSettings>> = {
  high: {
    canvasResolution: 2,
    particleDensity: 1,
    projectileDensity: 1,
    interfaceBlur: true,
    ambientEffects: true,
    menuAtmosphere: true,
    interfaceShadows: true,
    interfaceAnimations: true,
    canvasGlow: true,
    motion: "system",
  },
  medium: {
    canvasResolution: 1.5,
    particleDensity: 0.733,
    projectileDensity: 0.75,
    interfaceBlur: true,
    ambientEffects: true,
    menuAtmosphere: true,
    interfaceShadows: true,
    interfaceAnimations: true,
    canvasGlow: true,
    motion: "system",
  },
  low: {
    canvasResolution: 1,
    particleDensity: 0.467,
    projectileDensity: 0.5,
    interfaceBlur: false,
    ambientEffects: false,
    menuAtmosphere: true,
    interfaceShadows: true,
    interfaceAnimations: true,
    canvasGlow: true,
    motion: "system",
  },
  "extra-low": {
    canvasResolution: 0.75,
    particleDensity: 0.2,
    projectileDensity: 0.25,
    interfaceBlur: false,
    ambientEffects: false,
    menuAtmosphere: false,
    interfaceShadows: false,
    interfaceAnimations: false,
    canvasGlow: false,
    motion: "reduced",
  },
};

export const DEFAULT_UI_PREFERENCES: Readonly<UiPreferences> = Object.freeze({
  uiScale: 1,
  displayMode: "windowed",
  effectsQuality: "high",
  ...GRAPHICS_PRESET_SETTINGS.high,
  motion: "system",
  screenShake: 1,
  scanlineIntensity: 0.3,
});

const UI_SCALES: readonly UiScale[] = [0.9, 1, 1.1, 1.25];

const finiteRange = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;

const finiteUnit = (value: unknown, fallback: number): number => finiteRange(value, fallback, 0, 1);
const booleanValue = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;

const isGraphicsPreset = (value: unknown): value is EffectsQuality => GRAPHICS_PRESET_VALUES.includes(value as EffectsQuality);

export const sanitizeUiPreferences = (value: unknown): UiPreferences => {
  const stored = value && typeof value === "object" ? value as Partial<UiPreferences> : {};
  const effectsQuality = isGraphicsPreset(stored.effectsQuality) ? stored.effectsQuality : DEFAULT_UI_PREFERENCES.effectsQuality;
  const presetSettings = effectsQuality === "custom"
    ? DEFAULT_UI_PREFERENCES
    : GRAPHICS_PRESET_SETTINGS[effectsQuality];
  const hasManualGraphicsValues = [
    "canvasResolution",
    "particleDensity",
    "projectileDensity",
    "interfaceBlur",
    "ambientEffects",
    "menuAtmosphere",
    "interfaceShadows",
    "interfaceAnimations",
    "canvasGlow",
  ].some((key) => Object.hasOwn(stored, key));
  const storedMotion = stored.motion === "reduced" || stored.motion === "full" ? stored.motion : null;
  return {
    uiScale: UI_SCALES.includes(stored.uiScale as UiScale) ? stored.uiScale as UiScale : DEFAULT_UI_PREFERENCES.uiScale,
    displayMode: stored.displayMode === "fullscreen" ? "fullscreen" : "windowed",
    effectsQuality,
    canvasResolution: finiteRange(stored.canvasResolution, presetSettings.canvasResolution, 0.5, 2),
    particleDensity: finiteRange(stored.particleDensity, presetSettings.particleDensity, 0.2, 1),
    projectileDensity: finiteRange(stored.projectileDensity, presetSettings.projectileDensity, 0.25, 1),
    interfaceBlur: booleanValue(stored.interfaceBlur, presetSettings.interfaceBlur),
    ambientEffects: booleanValue(stored.ambientEffects, presetSettings.ambientEffects),
    menuAtmosphere: booleanValue(stored.menuAtmosphere, presetSettings.menuAtmosphere),
    interfaceShadows: booleanValue(stored.interfaceShadows, presetSettings.interfaceShadows),
    interfaceAnimations: booleanValue(stored.interfaceAnimations, presetSettings.interfaceAnimations),
    canvasGlow: booleanValue(stored.canvasGlow, presetSettings.canvasGlow),
    motion: !hasManualGraphicsValues && effectsQuality === "extra-low" ? "reduced" : storedMotion ?? presetSettings.motion,
    screenShake: finiteUnit(stored.screenShake, DEFAULT_UI_PREFERENCES.screenShake),
    scanlineIntensity: finiteUnit(stored.scanlineIntensity, DEFAULT_UI_PREFERENCES.scanlineIntensity),
  };
};

export const applyGraphicsPreset = (preferences: UiPreferences, preset: EffectsQuality): UiPreferences => ({
  ...preferences,
  effectsQuality: preset,
  ...(preset === "custom" ? {} : GRAPHICS_PRESET_SETTINGS[preset]),
});

export const loadUiPreferences = (storage: Pick<Storage, "getItem"> = window.localStorage): UiPreferences => {
  try {
    const raw = storage.getItem(UI_PREFERENCES_STORAGE_KEY);
    return raw ? sanitizeUiPreferences(JSON.parse(raw)) : { ...DEFAULT_UI_PREFERENCES };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
};

export const saveUiPreferences = (
  preferences: UiPreferences,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void => {
  try {
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(sanitizeUiPreferences(preferences)));
  } catch {
    // Device preferences remain active for the current session when storage is blocked.
  }
};

export const prefersReducedMotion = (preference: MotionPreference, systemReduced: boolean): boolean =>
  preference === "reduced" || (preference === "system" && systemReduced);

type PromptStorage = Pick<Storage, "getItem"> & Partial<Pick<Storage, "setItem">>;

export const shouldPromptForGraphicsPreset = (
  version: string,
  storage: PromptStorage = window.localStorage,
): boolean => {
  if (!version) return false;
  try {
    if (storage.getItem(GRAPHICS_PRESET_PROMPT_STORAGE_KEY) !== null) return false;
    if (storage.getItem(UI_PREFERENCES_STORAGE_KEY) !== null) return false;
    return true;
  } catch {
    return false;
  }
};

export const markGraphicsPresetPromptSeen = (
  version: string,
  storage: PromptStorage = window.localStorage,
): void => {
  if (!version || !storage.setItem) return;
  try {
    storage.setItem(GRAPHICS_PRESET_PROMPT_STORAGE_KEY, version);
  } catch {
    // The prompt can safely return on the next launch when storage is blocked.
  }
};
