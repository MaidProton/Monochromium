import * as Tone from "tone";
import type { EnemyKind, TowerKind } from "./types.ts";

export type AudioBus = "towers" | "enemies" | "ui" | "ambience";

export interface AudioSettings {
  enabled: boolean;
  master: number;
  towers: number;
  enemies: number;
  ui: number;
  ambience: number;
}

export type TowerAttackSound =
  | "pistol"
  | "bandit-blade"
  | "rifle"
  | "blade"
  | "samurai-blade"
  | "lightning"
  | "machine"
  | "flame"
  | "bomb"
  | "critical-bomb"
  | "howitzer"
  | "rocket"
  | "shotgun"
  | "burst"
  | "rail";

const STORAGE_KEY = "monochromium.audio.v1";
const MAX_VOICE_RATE = 42;
const TOWER_MIX_TRIM = 0.46;
const ZENITH_CHARGE_START_PITCH = 60;
const ZENITH_CHARGE_END_PITCH = 112;
const ZENITH_CHARGE_PITCH_SCALE = 0.5;
const ZENITH_CHARGE_LEVEL_PITCH_DROP = 0.06;
const ZENITH_CHARGE_VOLUME_SCALE = 0.65;

type ProceduralBufferName = "snap" | "puff" | "crackle";

interface ZenithChargeVoice {
  readonly body: Tone.FMSynth;
  readonly whine: Tone.Oscillator;
  readonly whineGain: Tone.Gain;
  readonly staticNoise: Tone.Noise;
  readonly staticFilter: Tone.Filter;
  readonly staticGain: Tone.Gain;
}

// Keep ambience in the saved settings shape for compatibility, but leave it
// silent. The old always-on drone made the whole game feel like one loop.
export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  enabled: true,
  master: 0.88,
  towers: 0.72,
  enemies: 0.95,
  ui: 0.72,
  ambience: 0,
};

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const dbGain = (decibels: number): number => 10 ** (decibels / 20);

const safeNumber = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : fallback;
};

const sanitizeSettings = (value: unknown): AudioSettings => {
  const stored = value && typeof value === "object" ? value as Partial<AudioSettings> : {};
  return {
    enabled: stored.enabled !== false,
    master: safeNumber(stored.master, DEFAULT_AUDIO_SETTINGS.master),
    towers: safeNumber(stored.towers, DEFAULT_AUDIO_SETTINGS.towers),
    enemies: safeNumber(stored.enemies, DEFAULT_AUDIO_SETTINGS.enemies),
    ui: safeNumber(stored.ui, DEFAULT_AUDIO_SETTINGS.ui),
    ambience: 0,
  };
};

const loadSettings = (): AudioSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_AUDIO_SETTINGS };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
};

const saveSettings = (settings: AudioSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Audio remains usable for the current session when storage is blocked.
  }
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
};

const towerVariant = (kind?: TowerKind): "pulse" | "blade" | "machine" => {
  if (kind === "samurai" || kind === "warrior" || kind === "mercenary" || kind === "wraith") return "blade";
  if (kind === "cyborg" || kind === "gunner" || kind === "recon" || kind === "latch") return "machine";
  return "pulse";
};

const towerAttackSound = (kind?: TowerKind): TowerAttackSound => {
  switch (kind) {
    case "samurai": return "samurai-blade";
    case "warrior": return "blade";
    case "bandit": return "pistol";
    case "tempest": return "lightning";
    case "infernus": return "flame";
    case "bomber": return "bomb";
    case "recon": return "shotgun";
    case "gunner": return "burst";
    case "mercenary": return "rifle";
    case "wraith": return "blade";
    case "latch": return "pistol";
    case "prism": return "lightning";
    case "zenith": return "rail";
    default: return "machine";
  }
};

export class AudioSystem {
  private preferences = loadSettings();
  private started = false;
  private prewarmed = false;
  private readonly lastPlayed = new Map<string, number>();
  private readonly pendingKeys = new Set<string>();
  private pendingVoices: Array<{ key: string; minimumGapMs: number; play: () => void }> = [];
  private unlockPromise: Promise<void> | null = null;
  // Short procedural textures are generated once inside Tone's AudioContext,
  // then reused through the existing tower bus. They add detail without
  // introducing realistic recordings or an unmanaged second audio graph.
  private readonly proceduralBuffers = new Map<ProceduralBufferName, AudioBuffer>();

  // This catches stacked procedural layers and keeps sudden combinations from
  // jumping out of the mix. Per-sound calibration below still handles sounds
  // that are consistently louder; compression alone cannot equalize those.
  private readonly limiter = new Tone.Limiter(-2).toDestination();
  private readonly masterCompressor = new Tone.Compressor({
    threshold: -18,
    ratio: 3,
    attack: 0.004,
    release: 0.16,
    knee: 8,
  }).connect(this.limiter);
  private readonly masterBus = new Tone.Gain(1).connect(this.masterCompressor);
  private readonly buses: Record<AudioBus, Tone.Gain> = {
    towers: new Tone.Gain(1).connect(this.masterBus),
    enemies: new Tone.Gain(1).connect(this.masterBus),
    ui: new Tone.Gain(1).connect(this.masterBus),
    ambience: new Tone.Gain(0).connect(this.masterBus),
  };

  private readonly uiFilter = new Tone.Filter({ type: "lowpass", frequency: 1700, rolloff: -12 }).connect(this.buses.ui);
  private readonly uiSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.004, decay: 0.08, sustain: 0.04, release: 0.06 },
  }).connect(this.uiFilter);
  private readonly uiHoverSynth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.004, decay: 0.055, sustain: 0, release: 0.035 },
  }).connect(this.uiFilter);

  private readonly towerFilter = new Tone.Filter({ type: "lowpass", frequency: 3600, rolloff: -12 }).connect(this.buses.towers);
  // Tower attacks need a little high-frequency definition to read as weapons
  // instead of disappearing into the low-mid game mix. UI remains on its own
  // filtered bus and is not affected by this detail path.
  private readonly towerDetailFilter = new Tone.Filter({ type: "highpass", frequency: 520, rolloff: -12 }).connect(this.buses.towers);
  private readonly towerSubFilter = new Tone.Filter({ type: "lowpass", frequency: 420, rolloff: -24 }).connect(this.buses.towers);
  private readonly towerPulse = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.002, decay: 0.11, sustain: 0.03, release: 0.07 },
  }).connect(this.towerFilter);
  private readonly towerBlade = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.002, decay: 0.14, sustain: 0.02, release: 0.1 },
  }).connect(this.towerFilter);
  private readonly towerMachine = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0.015, release: 0.035 },
  }).connect(this.towerFilter);
  private readonly towerSidearmSnap = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.034, sustain: 0, release: 0.014 },
  }).connect(this.towerDetailFilter);
  private readonly towerRifleBody = new Tone.MembraneSynth({
    pitchDecay: 0.032,
    octaves: 2.3,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.055 },
  }).connect(this.towerSubFilter);
  private readonly towerRifleSnap = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.052, sustain: 0, release: 0.018 },
  }).connect(this.towerDetailFilter);
  private readonly towerShotgunBody = new Tone.MembraneSynth({
    pitchDecay: 0.012,
    octaves: 3.8,
    envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.04 },
  }).connect(this.towerSubFilter);
  private readonly towerShotgunSnap = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.085, sustain: 0, release: 0.024 },
  }).connect(this.towerDetailFilter);
  private readonly towerBladeBody = new Tone.MonoSynth({
    oscillator: { type: "sawtooth2" },
    envelope: { attack: 0.002, decay: 0.16, sustain: 0.02, release: 0.09 },
    filter: { type: "lowpass", frequency: 1450, rolloff: -24, Q: 1.2 },
    filterEnvelope: { attack: 0.001, decay: 0.075, sustain: 0.15, release: 0.08, baseFrequency: 180, octaves: 3.2 },
  }).connect(this.towerFilter);
  private readonly towerBladeWhoosh = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.003, decay: 0.13, sustain: 0, release: 0.055 },
  }).connect(this.towerDetailFilter);
  // A short pitched down-sweep gives the blade a readable "shing" on top of
  // the noise whoosh. It stays non-metallic so the attack does not become a
  // clamp or cymbal hit in the mix.
  private readonly towerBladeShing = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.035 },
  }).connect(this.towerDetailFilter);
  private readonly towerBladeEdge = new Tone.MetalSynth({
    harmonicity: 4.2,
    modulationIndex: 10,
    resonance: 1800,
    octaves: 0.45,
    envelope: { attack: 0.001, decay: 0.075, release: 0.035 },
  }).connect(this.towerDetailFilter);
  private readonly machineNoise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.055, sustain: 0, release: 0.018 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 2300, rolloff: -24 }).connect(this.buses.towers));
  private readonly bladeNoise = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.005, decay: 0.14, sustain: 0, release: 0.06 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 1900, rolloff: -24 }).connect(this.buses.towers));
  private readonly electricSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.075, sustain: 0.02, release: 0.055 },
  }).connect(this.towerFilter);
  private readonly electricMetal = new Tone.MetalSynth({
    harmonicity: 2.4,
    modulationIndex: 7,
    resonance: 920,
    octaves: 0.65,
    envelope: { attack: 0.001, decay: 0.08, release: 0.035 },
  }).connect(this.towerFilter);
  private readonly towerArcBody = new Tone.FMSynth({
    harmonicity: 2.7,
    modulationIndex: 8,
    oscillator: { type: "sine" },
    modulation: { type: "square" },
    envelope: { attack: 0.001, decay: 0.09, sustain: 0.015, release: 0.06 },
    modulationEnvelope: { attack: 0.001, decay: 0.055, sustain: 0.02, release: 0.04 },
  }).connect(this.towerFilter);
  private readonly towerArcCrackle = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.018 },
  }).connect(this.towerDetailFilter);
  private readonly flameBody = new Tone.MembraneSynth({
    pitchDecay: 0.07,
    octaves: 2.2,
    envelope: { attack: 0.003, decay: 0.15, sustain: 0, release: 0.07 },
  }).connect(this.towerFilter);
  private readonly flameNoise = new Tone.NoiseSynth({
    noise: { type: "brown" },
    envelope: { attack: 0.004, decay: 0.16, sustain: 0, release: 0.06 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 900, rolloff: -24 }).connect(this.buses.towers));
  private readonly flameCrackle = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.004, decay: 0.19, sustain: 0, release: 0.06 },
  }).connect(this.towerDetailFilter);
  private readonly flameHumFilter = new Tone.Filter({ type: "lowpass", frequency: 1250, rolloff: -24 }).connect(this.buses.towers);
  private readonly flameHumOscGain = new Tone.Gain(0).connect(this.flameHumFilter);
  private readonly flameHumNoiseGain = new Tone.Gain(0).connect(this.flameHumFilter);
  private readonly flameHumOsc = new Tone.Oscillator({ type: "sine", frequency: 76 }).connect(this.flameHumOscGain);
  private readonly flameHumNoise = new Tone.Noise({ type: "brown" }).connect(this.flameHumNoiseGain);
  private readonly flameHumSources = new Map<number, number>();
  private flameHumStarted = false;
  private readonly tankFlameFilter = new Tone.Filter({ type: "lowpass", frequency: 1500, rolloff: -24 }).connect(this.buses.towers);
  private readonly tankFlameGain = new Tone.Gain(0).connect(this.tankFlameFilter);
  private readonly tankFlameNoise = new Tone.Noise({ type: "brown" }).connect(this.tankFlameGain);
  private readonly tankFlameHissGain = new Tone.Gain(0).connect(new Tone.Filter({ type: "bandpass", frequency: 1700, Q: 0.7 }).connect(this.buses.towers));
  private readonly tankFlameHiss = new Tone.Noise({ type: "pink" }).connect(this.tankFlameHissGain);
  private tankFlameStarted = false;
  private tankFlameLevel = -1;
  private readonly zenithChargeSources = new Map<number, ZenithChargeVoice>();
  private readonly bombBody = new Tone.MembraneSynth({
    pitchDecay: 0.08,
    octaves: 3.5,
    envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 },
  }).connect(this.towerFilter);
  private readonly bombNoise = new Tone.NoiseSynth({
    noise: { type: "brown" },
    envelope: { attack: 0.002, decay: 0.28, sustain: 0, release: 0.1 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 1050, rolloff: -24 }).connect(this.buses.towers));
  private readonly bombCrackle = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.04 },
  }).connect(this.towerDetailFilter);
  private readonly rocketNoise = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.004, decay: 0.18, sustain: 0, release: 0.07 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 1400, rolloff: -24 }).connect(this.buses.towers));
  private readonly rocketBody = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0.02, release: 0.08 },
    filter: { type: "lowpass", frequency: 1200, rolloff: -24, Q: 1.4 },
    filterEnvelope: { attack: 0.002, decay: 0.12, sustain: 0.08, release: 0.08, baseFrequency: 90, octaves: 3.4 },
  }).connect(this.towerFilter);
  private readonly rocketIgnition = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.025 },
  }).connect(this.towerDetailFilter);
  private readonly railBeam = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.001, decay: 0.24, sustain: 0.12, release: 0.18 },
    filter: { type: "lowpass", frequency: 2_400, rolloff: -24, Q: 2.4 },
    filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0.06, release: 0.15, baseFrequency: 130, octaves: 4.1 },
  }).connect(this.towerFilter);
  private readonly railBlast = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.075, sustain: 0, release: 0.035 },
  }).connect(this.towerDetailFilter);
  private readonly railTail = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.002, decay: 0.34, sustain: 0, release: 0.12 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 1_050, rolloff: -24 }).connect(this.buses.towers));
  private readonly railSub = new Tone.MembraneSynth({
    pitchDecay: 0.13,
    octaves: 5.2,
    envelope: { attack: 0.001, decay: 0.48, sustain: 0, release: 0.16 },
  }).connect(this.towerSubFilter);
  private readonly metalSynth = new Tone.MetalSynth({
    harmonicity: 3.1,
    modulationIndex: 8,
    resonance: 760,
    octaves: 0.8,
    envelope: { attack: 0.001, decay: 0.1, release: 0.045 },
  }).connect(this.towerFilter);
  private readonly towerImpactSynth = new Tone.MembraneSynth({
    pitchDecay: 0.035,
    octaves: 2.4,
    envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.06 },
  }).connect(this.towerFilter);

  private readonly enemyFilter = new Tone.Filter({ type: "lowpass", frequency: 1900, rolloff: -12 }).connect(this.buses.enemies);
  private readonly enemySynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.004, decay: 0.16, sustain: 0.035, release: 0.1 },
  }).connect(this.enemyFilter);
  private readonly enemyImpactSynth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3.2,
    envelope: { attack: 0.001, decay: 0.19, sustain: 0, release: 0.07 },
  }).connect(this.enemyFilter);
  // A short, low-level noise burst adds the dry granular/crunchy edge without
  // bringing back the sharp metallic tone used by the old shield cue.
  private readonly enemyHitCrunch = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.018 },
  }).connect(new Tone.Filter({ type: "bandpass", frequency: 1250, Q: 0.55 }).connect(this.enemyFilter));
  private readonly enemyNoise = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.03 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 2100, rolloff: -24 }).connect(this.buses.enemies));
  private readonly explosionNoise = new Tone.NoiseSynth({
    noise: { type: "brown" },
    envelope: { attack: 0.002, decay: 0.36, sustain: 0, release: 0.12 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 1200, rolloff: -24 }).connect(this.buses.enemies));
  private readonly explosionBody = new Tone.MembraneSynth({
    pitchDecay: 0.09,
    octaves: 4.2,
    envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.12 },
  }).connect(this.enemyFilter);

  constructor() {
    [this.uiSynth, this.towerPulse, this.towerBlade, this.towerMachine, this.enemySynth].forEach((synth) => {
      synth.maxPolyphony = 12;
    });
    this.applyGains();
  }

  get enabled(): boolean {
    return this.preferences.enabled;
  }

  getSettings(): AudioSettings {
    return { ...this.preferences };
  }

  async unlock(): Promise<void> {
    if (this.started) return;
    if (this.unlockPromise) return this.unlockPromise;
    this.unlockPromise = (async () => {
      try {
        await Tone.start();
        this.initializeProceduralBuffers();
        this.started = true;
        this.prewarm();
        this.applyGains();
        this.syncFlameHum();
        this.syncTankFlame();
        const pending = this.pendingVoices;
        this.pendingVoices = [];
        pending.forEach(({ key, minimumGapMs, play }) => {
          this.pendingKeys.delete(key);
          this.playThrottled(key, minimumGapMs, play);
        });
      } catch {
        // Browsers may reject audio before a valid user gesture; retry later.
      } finally {
        this.unlockPromise = null;
      }
    })();
    return this.unlockPromise;
  }

  /**
   * Pre-warm all procedural synths and buffer sources silently to force V8 JIT
   * and Chromium WebAudio graph compilation at initialization, avoiding lag spikes
   * when towers or actions are first selected, placed, or fired.
   */
  prewarm(): void {
    if (this.prewarmed || !this.started) return;
    this.prewarmed = true;

    const previousMaster = this.masterBus?.gain?.value ?? 0;
    if (this.masterBus?.gain) this.masterBus.gain.value = 0;

    try {
      this.playCachedBuffer("snap", 0);
      this.playCachedBuffer("puff", 0);
      this.playCachedBuffer("crackle", 0);

      const polySynths = [
        this.uiSynth,
        this.towerPulse,
        this.towerBlade,
        this.towerMachine,
        this.electricSynth,
        this.enemySynth,
      ];
      for (const synth of polySynths) {
        try {
          synth?.triggerAttackRelease?.(220, 0.002, undefined, 0);
        } catch {
          // Keep prewarm non-blocking if a voice rejects in mocked/headless environments.
        }
      }

      const pitchedSynths = [
        this.uiHoverSynth,
        this.towerBladeBody,
        this.towerBladeShing,
        this.towerBladeEdge,
        this.electricMetal,
        this.towerArcBody,
        this.rocketBody,
        this.railBeam,
        this.metalSynth,
        this.towerRifleBody,
        this.towerShotgunBody,
        this.flameBody,
        this.bombBody,
        this.railSub,
        this.towerImpactSynth,
        this.enemyImpactSynth,
        this.explosionBody,
      ];
      for (const synth of pitchedSynths) {
        try {
          (synth as unknown as { triggerAttackRelease?: (note: number, duration: number, time?: unknown, velocity?: number) => void })?.triggerAttackRelease?.(220, 0.002, undefined, 0);
        } catch {
          // Keep prewarm non-blocking if a voice rejects in mocked/headless environments.
        }
      }

      const noiseSynths = [
        this.towerSidearmSnap,
        this.towerRifleSnap,
        this.towerShotgunSnap,
        this.towerBladeWhoosh,
        this.machineNoise,
        this.bladeNoise,
        this.towerArcCrackle,
        this.flameNoise,
        this.flameCrackle,
        this.bombNoise,
        this.bombCrackle,
        this.rocketNoise,
        this.rocketIgnition,
        this.railBlast,
        this.railTail,
        this.enemyHitCrunch,
        this.enemyNoise,
        this.explosionNoise,
      ];
      for (const synth of noiseSynths) {
        try {
          synth?.triggerAttackRelease?.(0.002, undefined, 0);
        } catch {
          // Keep prewarm non-blocking if a voice rejects in mocked/headless environments.
        }
      }
    } catch {
      // Audio engine remains usable even if prewarm encounters an error.
    } finally {
      if (this.masterBus?.gain) this.masterBus.gain.value = previousMaster;
    }
  }

  setSettings(next: Partial<AudioSettings>): AudioSettings {
    this.preferences = sanitizeSettings({ ...this.preferences, ...next });
    saveSettings(this.preferences);
    this.applyGains();
    return this.getSettings();
  }

  setVolume(bus: AudioBus | "master", value: number): AudioSettings {
    return this.setSettings({ [bus]: clamp(value, 0, 1) });
  }

  resetSettings(): AudioSettings {
    this.preferences = { ...DEFAULT_AUDIO_SETTINGS };
    saveSettings(this.preferences);
    this.applyGains();
    return this.getSettings();
  }

  toggle(): boolean {
    return this.setSettings({ enabled: !this.preferences.enabled }).enabled;
  }

  uiHover(): void {
    this.playThrottled("ui-hover", 38, () => {
      this.uiHoverSynth.triggerAttackRelease(330 + Math.random() * 35, 0.035, undefined, 0.12);
    });
  }

  uiClick(): void {
    this.playThrottled("ui-click", 28, () => {
      this.uiSynth.triggerAttackRelease(220 + Math.random() * 18, 0.055, undefined, 0.2);
    });
  }

  uiOpen(): void {
    this.playThrottled("ui-open", 50, () => {
      const now = Tone.now();
      this.uiSynth.triggerAttackRelease("C3", 0.08, now, 0.2);
      this.uiSynth.triggerAttackRelease("G3", 0.1, now + 0.045, 0.18);
    });
  }

  uiConfirm(): void {
    this.playThrottled("ui-confirm", 55, () => {
      const now = Tone.now();
      this.uiSynth.triggerAttackRelease("C4", 0.08, now, 0.24);
      this.uiSynth.triggerAttackRelease("G4", 0.1, now + 0.055, 0.2);
    });
  }

  uiError(): void {
    this.playThrottled("ui-error", 70, () => {
      this.uiSynth.triggerAttackRelease("D3", 0.13, undefined, 0.26);
      this.uiSynth.triggerAttackRelease("C3", 0.16, "+0.07", 0.22);
    });
  }

  uiPause(paused: boolean): void {
    this.playThrottled(`ui-pause-${paused ? "on" : "off"}`, 90, () => {
      const now = Tone.now();
      this.uiSynth.triggerAttackRelease(paused ? "G3" : "C4", 0.1, now, 0.22);
      this.uiSynth.triggerAttackRelease(paused ? "C3" : "G4", 0.12, now + 0.065, 0.2);
    });
  }

  uiSpeed(speed: number): void {
    const pitch = 260 + Math.round(speed * 45);
    this.playThrottled("ui-speed", 65, () => this.uiSynth.triggerAttackRelease(pitch, 0.07, undefined, 0.2));
  }

  fail(): void {
    this.uiError();
  }

  tone(frequency: number, duration: number, volume = 0.14, slide = 0, bus: AudioBus = "towers"): void {
    const adjustedFrequency = clamp(frequency + slide * 0.2, 70, 520);
    const synth = bus === "ui" ? this.uiSynth : bus === "enemies" ? this.enemySynth : this.towerPulse;
    this.playThrottled(`tone-${bus}`, 30, () => synth.triggerAttackRelease(adjustedFrequency, duration, undefined, clamp(volume * 2.2, 0.02, 0.5)));
  }

  deploy(kind?: TowerKind): void {
    const variant = towerVariant(kind);
    const synth = variant === "blade" ? this.towerBladeBody : variant === "machine" ? this.towerMachine : this.towerPulse;
    const frequency = kind === "tempest" ? 180 : kind === "infernus" ? 105 : 145;
    this.playThrottled("tower-deploy", 55, () => {
      const now = Tone.now();
      this.playCachedBuffer(kind === "tempest" ? "crackle" : "snap", 0.08, kind === "tempest" ? 0.9 : 1.2);
      synth.triggerAttackRelease(frequency, 0.14, now, 0.32);
      // Deployment is a tower event, so its confirmation stays on the tower
      // bus instead of borrowing the UI voice.
      this.towerPulse.triggerAttackRelease(frequency * 1.45, 0.06, now + 0.06, 0.14);
    });
  }

  shoot(pitch = 350, kind?: TowerKind, sound = towerAttackSound(kind), chargeDuration = 2, level = 0): void {
    // Admiral's artillery cycle has no separate reload/fire cue. Its impact
    // audio is emitted when the shell lands, so do not play the old bonk here.
    if (kind === "admiral") return;
    // Dispatch by tower identity first. The same gameplay sound label can
    // represent very different fantasy devices: Prism is not Tempest, Latch
    // is not Bandit, and Vanguard is not a sword user.
    const key = `tower-shoot-${kind ?? sound}-${sound}`;
    this.playThrottled(key, Math.round(1000 / MAX_VOICE_RATE), () => {
      if (kind === "bandit" && sound === "bandit-blade") return this.playBanditSlash(pitch);
      if (kind === "bandit") return this.playBanditShot(pitch);
      if (kind === "samurai") return this.playSamuraiSlash(pitch);
      if (kind === "tempest") return this.playTempestArc(pitch);
      if (kind === "cyborg") {
        if (sound === "howitzer") return this.playCyborgHowitzer(pitch);
        if (sound === "rocket") return this.playCyborgRocket(pitch);
        return this.playCyborgMachine(pitch);
      }
      if (kind === "mercenary") return this.playMercenaryRifle(pitch);
      if (kind === "infernus") return this.playInfernusFlame(pitch);
      if (kind === "bomber") return sound === "critical-bomb" ? this.playCriticalBomb(pitch) : this.playBomberBomb(pitch);
      if (kind === "recon") return this.playReconShotgun(pitch);
      if (kind === "gunner") return this.playGunnerBurst(pitch);
      if (kind === "warrior") return this.playWarriorBlade(pitch);
      if (kind === "wraith") return this.playWraithPhase(pitch);
      if (kind === "vanguard") return this.playVanguardSmash(pitch);
      if (kind === "latch") return this.playLatchTether(pitch);
      if (kind === "prism") return this.playPrismRefract(pitch);
      if (kind === "zenith") return this.playZenithLance(pitch, chargeDuration, level);
      this.playAttackSoundFallback(sound, pitch);
    });
  }

  /** Zenith: a sustained low laser charge that rises to a fixed endpoint pitch. */
  zenithCharge(towerId: number, active: boolean, progress = 0, level = 0): void {
    if (!active) {
      this.stopZenithCharge(towerId, progress >= 1);
      return;
    }
    if (!this.preferences.enabled || this.preferences.master <= 0 || !this.started) {
      if (!this.preferences.enabled || this.preferences.master <= 0) this.stopZenithCharge(towerId);
      return;
    }
    let voice = this.zenithChargeSources.get(towerId);
    const now = Tone.now();
    const normalizedProgress = clamp(progress, 0, 1);
    const levelPitchScale = ZENITH_CHARGE_PITCH_SCALE * (1 - clamp(level, 0, 5) * ZENITH_CHARGE_LEVEL_PITCH_DROP);
    const startPitch = ZENITH_CHARGE_START_PITCH * levelPitchScale;
    const endPitch = ZENITH_CHARGE_END_PITCH * levelPitchScale;
    const pitch = startPitch + (endPitch - startPitch) * normalizedProgress;
    if (!voice) {
      const body = new Tone.FMSynth({
        harmonicity: 2.2,
        modulationIndex: 14,
        oscillator: { type: "sine" },
        modulation: { type: "triangle" },
        envelope: { attack: 0.08, decay: 0.12, sustain: 0.72, release: 0.2 },
        modulationEnvelope: { attack: 0.05, decay: 0.16, sustain: 0.35, release: 0.12 },
      }).connect(this.towerFilter);
      body.volume.value = -9.7;
      const whineGain = new Tone.Gain(0.014 * ZENITH_CHARGE_VOLUME_SCALE).connect(this.towerDetailFilter);
      const whine = new Tone.Oscillator({ type: "sawtooth", frequency: startPitch * 3.4 }).connect(whineGain);
      const staticGain = new Tone.Gain(0.006 * ZENITH_CHARGE_VOLUME_SCALE).connect(this.towerDetailFilter);
      const staticFilter = new Tone.Filter({ type: "bandpass", frequency: 760, Q: 5 }).connect(staticGain);
      const staticNoise = new Tone.Noise({ type: "pink" }).connect(staticFilter);
      voice = { body, whine, whineGain, staticNoise, staticFilter, staticGain };
      this.zenithChargeSources.set(towerId, voice);
      body.triggerAttack(startPitch, now, 0.21);
      whine.start(now);
      staticNoise.start(now);
    }
    voice.body.frequency.rampTo(pitch, 0.12, now);
    voice.body.modulationIndex.rampTo(14 + normalizedProgress * 12, 0.12, now);
    voice.whine.frequency.rampTo(pitch * (3.4 + normalizedProgress * 0.5), 0.12, now);
    voice.whineGain.gain.rampTo((0.014 + normalizedProgress * 0.027) * ZENITH_CHARGE_VOLUME_SCALE, 0.12, now);
    voice.staticFilter.frequency.rampTo(680 + normalizedProgress * 1_650, 0.12, now);
    voice.staticGain.gain.rampTo((0.006 + normalizedProgress * 0.019) * ZENITH_CHARGE_VOLUME_SCALE, 0.12, now);
  }

  /** Stop sustained charge voices when presentation is hidden or a run ends. */
  stopZenithCharges(): void {
    [...this.zenithChargeSources.keys()].forEach((towerId) => this.stopZenithCharge(towerId));
  }

  /** Bandit: low, compact gunshot with a rounded report and brief muzzle crack. */
  private playBanditShot(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.2, 48, 82), 0.018);
    this.playCachedBuffer("snap", 0.14, 0.72);
    this.towerRifleBody.triggerAttackRelease(pitch, 0.17, now, 0.27);
    this.towerRifleSnap.triggerAttackRelease(0.082, now, 0.22);
    this.towerSidearmSnap.triggerAttackRelease(0.032, now + 0.018, 0.12);
  }

  /** Bandit: broad physical slash with air and a soft hit, without a metallic ring. */
  private playBanditSlash(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.42, 95, 180), 0.025);
    this.playCachedBuffer("puff", 0.1, 0.8);
    this.towerBladeWhoosh.triggerAttackRelease(0.2, now, 0.17);
    this.bladeNoise.triggerAttackRelease(0.16, now + 0.012, 0.09);
    this.towerImpactSynth.triggerAttackRelease(pitch, 0.11, now + 0.035, 0.13);
  }

  /** Samurai: broad physical slash like Bandit's, with a slightly heavier spectral hit. */
  private playSamuraiSlash(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.46, 105, 205), 0.025);
    const shingTime = now + 0.012;
    const shingStart = clamp(pitch * 5.2, 650, 1200);
    const shingEnd = clamp(pitch * 1.45, 190, 340);
    this.playCachedBuffer("puff", 0.11, 1.05);
    this.towerBladeWhoosh.triggerAttackRelease(0.22, now, 0.18);
    this.bladeNoise.triggerAttackRelease(0.18, now + 0.01, 0.11);
    this.towerImpactSynth.triggerAttackRelease(pitch, 0.12, now + 0.035, 0.16);
    this.towerBladeShing.triggerAttackRelease(shingStart, 0.08, shingTime, 0.16);
    this.towerBladeShing.frequency.setValueAtTime(shingStart, shingTime);
    this.towerBladeShing.frequency.exponentialRampTo(shingEnd, 0.065, shingTime);
  }

  /** Tempest: short electric arc with softened crackle and metallic spark. */
  private playTempestArc(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.45, 220, 350), 0.035);
    this.playCachedBuffer("crackle", 0.11, 1.05);
    this.towerArcBody.set({ harmonicity: 2.7, modulationIndex: 7 });
    this.towerArcBody.triggerAttackRelease(pitch, 0.08, now, 0.16);
    this.electricSynth.triggerAttackRelease(pitch * 1.3, 0.06, now + 0.012, 0.1);
    this.towerArcCrackle.triggerAttackRelease(0.045, now, 0.12);
    this.electricMetal.triggerAttackRelease(pitch * 1.9, 0.045, now + 0.02, 0.06);
  }

  /** Cyborg normal fire: tight mechanical pulse for rapid magazines. */
  private playCyborgMachine(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.34, 90, 220), 0.035);
    this.playCachedBuffer("snap", 0.07, 1.18);
    this.towerMachine.triggerAttackRelease(pitch, 0.038, now, 0.12);
    this.machineNoise.triggerAttackRelease(0.042, now, 0.08);
    this.towerSidearmSnap.triggerAttackRelease(0.02, now + 0.016, 0.06);
  }

  /** Cyborg Howitzer: deep pneumatic punch with restrained low-end tail. */
  private playCyborgHowitzer(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.25, 42, 64), 0.02);
    this.playCachedBuffer("puff", 0.14, 0.72);
    this.bombBody.triggerAttackRelease(pitch, 0.3, now, 0.25);
    this.bombNoise.triggerAttackRelease(0.25, now, 0.15);
    this.towerMachine.triggerAttackRelease(105, 0.07, now + 0.02, 0.08);
    this.towerImpactSynth.triggerAttackRelease(68, 0.13, now + 0.055, 0.12);
  }

  /** Cyborg rocket: short stylized ignition and ascending propulsion body. */
  private playCyborgRocket(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.58, 78, 125), 0.03);
    this.playCachedBuffer("puff", 0.1, 1.12);
    this.rocketBody.triggerAttackRelease(pitch, 0.18, now, 0.13);
    this.rocketNoise.triggerAttackRelease(0.16, now, 0.12);
    this.rocketIgnition.triggerAttackRelease(0.05, now, 0.11);
    this.towerMachine.triggerAttackRelease(132, 0.05, now + 0.025, 0.06);
  }

  /** Mercenary: a compact rifle report with a dry bullet crack. */
  private playMercenaryRifle(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.25, 72, 132), 0.025);
    this.playCachedBuffer("snap", 0.16, 0.78);
    this.towerRifleBody.triggerAttackRelease(pitch, 0.085, now, 0.24);
    this.towerRifleSnap.triggerAttackRelease(0.078, now, 0.2);
    this.towerSidearmSnap.triggerAttackRelease(0.026, now + 0.014, 0.08);
  }

  /** Infernus: low-fatigue warm combustion texture for continuous fire. */
  private playInfernusFlame(basePitch: number): void {
    const now = Tone.now();
    // Infernus fires frequently, but the old -13 dB trim pushed it far below
    // the other tower profiles. Keep the layers soft individually while
    // bringing the combined flame read into the same mix neighborhood.
    const gain = dbGain(-6);
    const pitch = this.jitter(clamp(basePitch * 0.43, 70, 100), 0.05);
    this.playCachedBuffer("puff", 0.08, 0.78);
    this.flameBody.triggerAttackRelease(pitch, 0.14, now, 0.16 * gain);
    this.flameNoise.triggerAttackRelease(0.13, now, 0.14 * gain);
    this.flameCrackle.triggerAttackRelease(0.1, now + 0.01, 0.11 * gain);
  }

  /** Bomber: compact abstract implosion/thump, not a realistic explosion. */
  private playBomberBomb(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.37, 62, 84), 0.025);
    this.playCachedBuffer("puff", 0.1, 0.7);
    this.bombBody.triggerAttackRelease(pitch, 0.18, now, 0.22);
    this.bombNoise.triggerAttackRelease(0.16, now, 0.12);
    this.bombCrackle.triggerAttackRelease(0.09, now + 0.01, 0.1);
    this.towerImpactSynth.triggerAttackRelease(170, 0.05, now + 0.025, 0.06);
  }

  /** Bomber critical: deeper and wider than a normal bomb, not merely louder. */
  private playCriticalBomb(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.28, 48, 62), 0.015);
    this.playCachedBuffer("puff", 0.13, 0.55);
    this.bombBody.triggerAttackRelease(pitch, 0.26, now, 0.29);
    this.bombNoise.triggerAttackRelease(0.23, now, 0.16);
    this.bombCrackle.triggerAttackRelease(0.14, now + 0.01, 0.12);
    this.towerImpactSynth.triggerAttackRelease(142, 0.07, now + 0.03, 0.08);
    this.metalSynth.triggerAttackRelease(330, 0.06, now + 0.07, 0.045);
  }

  /** Recon: one coherent five-pellet shotgun event with staggered body tones. */
  private playReconShotgun(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.34, 86, 120), 0.03);
    this.playCachedBuffer("snap", 0.13, 0.9);
    this.towerShotgunBody.triggerAttackRelease(pitch, 0.11, now, 0.2);
    this.towerShotgunBody.triggerAttackRelease(pitch * 1.38, 0.085, now + 0.012, 0.13);
    this.towerShotgunBody.triggerAttackRelease(pitch * 1.82, 0.065, now + 0.024, 0.08);
    this.towerShotgunSnap.triggerAttackRelease(0.075, now, 0.14);
  }

  /** Gunner: compact repeated gunshot for each round of the burst. */
  private playGunnerBurst(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.23, 78, 122), 0.025);
    this.playCachedBuffer("snap", 0.11, 0.86);
    this.towerRifleBody.triggerAttackRelease(pitch, 0.115, now, 0.23);
    this.towerRifleSnap.triggerAttackRelease(0.064, now, 0.18);
    this.machineNoise.triggerAttackRelease(0.035, now + 0.014, 0.07);
  }

  /** Warrior: grounded physical blade strike, heavier and simpler than Samurai. */
  private playWarriorBlade(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.44, 100, 250), 0.02);
    this.playCachedBuffer("snap", 0.07, 0.82);
    this.towerBladeBody.triggerAttackRelease(pitch, 0.11, now, 0.16);
    this.towerBladeWhoosh.triggerAttackRelease(0.1, now, 0.1);
    this.towerBladeEdge.triggerAttackRelease(pitch * 1.5, 0.05, now + 0.02, 0.05);
  }

  /** Wraith: spectral phase snap with a thin crimson energy edge. */
  private playWraithPhase(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.75, 180, 300), 0.035);
    this.playCachedBuffer("puff", 0.07, 1.75);
    this.towerArcBody.set({ harmonicity: 3.8, modulationIndex: 9 });
    this.towerArcBody.triggerAttackRelease(pitch, 0.075, now, 0.15);
    this.electricSynth.triggerAttackRelease(pitch * 2.1, 0.055, now + 0.012, 0.09);
    this.towerBladeEdge.triggerAttackRelease(pitch * 2.8, 0.05, now + 0.028, 0.05);
  }

  /** Vanguard: blunt mace/ground impact, deliberately separate from sword audio. */
  private playVanguardSmash(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.43, 68, 92), 0.02);
    this.playCachedBuffer("puff", 0.11, 0.62);
    this.towerImpactSynth.triggerAttackRelease(pitch, 0.2, now, 0.23);
    this.towerImpactSynth.triggerAttackRelease(pitch * 1.42, 0.13, now + 0.035, 0.1);
    this.metalSynth.triggerAttackRelease(pitch * 2.1, 0.07, now + 0.02, 0.08);
  }

  /** Latch: kinetic bolt followed by an elastic tether/clamp gesture. */
  private playLatchTether(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.78, 300, 500), 0.025);
    this.playCachedBuffer("snap", 0.08, 1.45);
    this.towerPulse.triggerAttackRelease(pitch, 0.045, now, 0.12);
    this.towerPulse.triggerAttackRelease(pitch * 0.72, 0.08, now + 0.025, 0.08);
    this.towerArcBody.set({ harmonicity: 0.8, modulationIndex: 4 });
    this.towerArcBody.triggerAttackRelease(pitch * 0.9, 0.06, now + 0.018, 0.08);
    this.metalSynth.triggerAttackRelease(pitch * 1.7, 0.04, now + 0.035, 0.04);
  }

  /** Prism: clean crystalline refraction, intentionally unlike Tempest lightning. */
  private playPrismRefract(basePitch: number): void {
    const now = Tone.now();
    const pitch = this.jitter(clamp(basePitch * 0.95, 420, 720), 0.02);
    this.playCachedBuffer("crackle", 0.045, 1.55);
    this.towerPulse.triggerAttackRelease(pitch, 0.06, now, 0.1);
    this.towerPulse.triggerAttackRelease(pitch * 1.25, 0.065, now + 0.014, 0.08);
    this.towerPulse.triggerAttackRelease(pitch * 1.5, 0.075, now + 0.03, 0.06);
    this.towerBladeEdge.triggerAttackRelease(pitch * 1.6, 0.045, now + 0.035, 0.04);
  }

  /** Zenith: a magnetic launch crack, violent bore pulse, and ionized tail. */
  private playZenithLance(basePitch: number, chargeDuration = 2, level = 0): void {
    void basePitch;
    const now = Tone.now();
    const weight = clamp((chargeDuration - 2) / 3, 0, 1);
    const levelPitchScale = level >= 5 ? 0.65 : level >= 4 ? 0.8 : level >= 2 ? 0.9 : 1;
    const beamStartPitch = this.jitter((205 - weight * 30) * levelPitchScale, 0.012);
    const beamEndPitch = (46 - weight * 5) * levelPitchScale;
    const beamDuration = 0.34 + weight * 0.08;
    this.playCachedBuffer("snap", 0.2 + weight * 0.04, 0.64);
    this.railBlast.triggerAttackRelease(0.085 + weight * 0.02, now, 0.58 + weight * 0.08);
    this.railSub.triggerAttackRelease((44 - weight * 5) * levelPitchScale, 0.42 + weight * 0.08, now, 0.62 + weight * 0.08);
    this.railBeam.triggerAttack(beamStartPitch, now + 0.006, 0.46 + weight * 0.06);
    this.railBeam.frequency.exponentialRampTo(beamEndPitch, beamDuration, now + 0.006);
    this.railBeam.triggerRelease(now + beamDuration + 0.055);
    this.railTail.triggerAttackRelease(0.36 + weight * 0.1, now + 0.045, 0.34 + weight * 0.06);
  }

  private playAttackSoundFallback(sound: TowerAttackSound, pitch: number): void {
    switch (sound) {
      case "pistol": this.playBanditShot(pitch); break;
      case "bandit-blade": this.playBanditSlash(pitch); break;
      case "rifle": this.playMercenaryRifle(pitch); break;
      case "samurai-blade": this.playSamuraiSlash(pitch); break;
      case "blade": this.playWarriorBlade(pitch); break;
      case "lightning": this.playTempestArc(pitch); break;
      case "machine": this.playCyborgMachine(pitch); break;
      case "flame": this.playInfernusFlame(pitch); break;
      case "bomb": this.playBomberBomb(pitch); break;
      case "critical-bomb": this.playCriticalBomb(pitch); break;
      case "howitzer": this.playCyborgHowitzer(pitch); break;
      case "rocket": this.playCyborgRocket(pitch); break;
      case "shotgun": this.playReconShotgun(pitch); break;
      case "burst": this.playGunnerBurst(pitch); break;
      case "rail": this.playZenithLance(pitch); break;
    }
  }

  /** Keeps one quiet brown-noise/low-tone flame bed per active Infernus group. */
  flameStream(towerId: number, active: boolean, level = 0): void {
    if (active) this.flameHumSources.set(towerId, clamp(level, 0, 5));
    else this.flameHumSources.delete(towerId);
    this.syncFlameHum();
  }

  towerEffect(effect: "tempest-field" | "tempest-arc"): void {
    const isField = effect === "tempest-field";
    this.playThrottled(effect, isField ? 180 : 85, () => {
      const now = Tone.now();
      if (isField) {
        this.playCachedBuffer("crackle", 0.1, 0.8);
        this.towerArcBody.triggerAttackRelease("C3", 0.18, now, 0.2);
        this.towerArcBody.triggerAttackRelease("G3", 0.22, now + 0.055, 0.16);
        this.towerArcCrackle.triggerAttackRelease(0.11, now + 0.08, 0.16);
        this.electricMetal.triggerAttackRelease(250, 0.11, now + 0.08, 0.12);
      } else {
        this.playCachedBuffer("crackle", 0.075, 1.3);
        this.towerArcBody.triggerAttackRelease(280 + Math.random() * 45, 0.06, now, 0.18);
        this.towerArcCrackle.triggerAttackRelease(0.05, now, 0.22);
        this.electricMetal.triggerAttackRelease(420, 0.045, now + 0.012, 0.1);
      }
    });
  }

  towerReload(kind?: TowerKind): void {
    // Admiral has a deliberate artillery cycle, not a magazine reload. Keep
    // its fire sound as the only audio cue instead of layering a reload click.
    if (kind !== "recon" && kind !== "cyborg") return;
    this.playThrottled(`tower-reload-${kind}`, 150, () => {
      const now = Tone.now();
      if (kind === "recon") {
        // A restrained shell-pump gesture: softer and shorter than the old
        // stacked snap/metal/impact hit, which was spiking on every magazine.
        this.playCachedBuffer("puff", 0.035, 0.34);
        this.towerShotgunSnap.triggerAttackRelease(0.045, now, 0.07);
        this.metalSynth.triggerAttackRelease(150, 0.055, now + 0.045, 0.055);
      } else {
        // Cyborg gets a low, dry magazine latch with no bright transient.
        this.playCachedBuffer("snap", 0.025, 0.28);
        this.towerMachine.triggerAttackRelease(76, 0.06, now, 0.07);
        this.metalSynth.triggerAttackRelease(112, 0.045, now + 0.035, 0.04);
      }
    });
  }

  /** Admiral shell launch: keep the soft propulsion cue separate from impact. */
  admiralLaunch(): void {
    this.playThrottled("admiral-launch", 150, () => {
      const now = Tone.now();
      this.playCachedBuffer("puff", 0.13, 0.48);
      this.bombBody.triggerAttackRelease(48, 0.34, now, 0.27);
      this.bombNoise.triggerAttackRelease(0.3, now, 0.17);
    });
  }

  towerUpgrade(): void {
    this.playThrottled("tower-upgrade", 65, () => {
      const now = Tone.now();
      this.playCachedBuffer("puff", 0.045, 1.5);
      this.towerPulse.triggerAttackRelease("C4", 0.08, now, 0.12);
      this.towerPulse.triggerAttackRelease("G4", 0.09, now + 0.065, 0.14);
      this.towerPulse.triggerAttackRelease("C5", 0.13, now + 0.13, 0.16);
    });
  }

  towerAbility(_kind?: TowerKind): void {
    // No generic activation jingle. Actual weapon launches, channels and
    // impacts supply their own audio, in solo and replicated playback alike.
  }

  tankMissileLaunch(): void {
    this.playThrottled("tank-missile-launch", 55, () => {
      const now = Tone.now();
      this.playCachedBuffer("puff", 0.12, 0.55);
      this.rocketBody.triggerAttackRelease(88, 0.18, now, 0.24);
      this.rocketBody.frequency.exponentialRampTo(46, 0.2, now);
      this.rocketNoise.triggerAttackRelease(0.24, now, 0.23);
    });
  }

  tankFlameStream(active: boolean, level = 0): void {
    const next = active ? clamp(level, 0, 7) : -1;
    if (next === this.tankFlameLevel) return;
    this.tankFlameLevel = next;
    this.syncTankFlame();
  }

  private syncTankFlame(): void {
    if (!this.started) return;
    if (this.tankFlameLevel < 0) {
      this.tankFlameGain.gain.rampTo(0, 0.08);
      this.tankFlameHissGain.gain.rampTo(0, 0.08);
      return;
    }
    if (!this.tankFlameStarted) {
      this.tankFlameNoise.start();
      this.tankFlameHiss.start();
      this.tankFlameStarted = true;
    }
    const level = this.tankFlameLevel;
    this.tankFlameFilter.frequency.rampTo(1100 + level * 80, 0.12);
    this.tankFlameGain.gain.rampTo(0.16 + level * 0.01, 0.08);
    this.tankFlameHissGain.gain.rampTo(0.04 + level * 0.003, 0.08);
  }

  counter(): void {
    this.playThrottled("tower-counter", 70, () => {
      this.playCachedBuffer("crackle", 0.07, 1.15);
      this.towerImpactSynth.triggerAttackRelease(105, 0.16, undefined, 0.3);
      this.towerBlade.triggerAttackRelease(260, 0.11, "+0.05", 0.2);
    });
  }

  hit(): void {
    this.towerDamage();
    this.enemyAttack();
  }

  towerDamage(): void {
    this.playThrottled("tower-damage", 72, () => {
      this.playCachedBuffer("puff", 0.06, 0.7);
      this.towerImpactSynth.triggerAttackRelease(88, 0.16, undefined, 0.3);
      this.machineNoise.triggerAttackRelease(0.07, undefined, 0.12);
    });
  }

  enemyAttack(): void {
    this.playThrottled("enemy-attack", 72, () => {
      this.enemyImpactSynth.triggerAttackRelease(62, 0.2, undefined, 0.36);
      this.enemyNoise.triggerAttackRelease(0.12, undefined, 0.18);
    });
  }

  enemySpawn(kind: EnemyKind, boss = false): void {
    const hash = hashString(kind);
    const pitch = boss ? 58 : 92 + (hash % 5) * 13;
    this.playThrottled(boss ? "enemy-boss-spawn" : "enemy-spawn", boss ? 220 : 40, () => {
      this.enemySynth.triggerAttackRelease(pitch, boss ? 0.5 : 0.11, undefined, boss ? 0.38 : 0.14);
      if (boss) this.enemyNoise.triggerAttackRelease(0.24, undefined, 0.2);
    });
  }

  enemyHit(_shield = false): void {
    // Keep all enemy damage on the existing punchy hit cue. A fixed low pitch
    // is easier to listen to during rapid-fire attacks than the old random
    // impact plus metallic shield layers.
    this.playThrottled("enemy-hit", 24, () => {
      const pitch = 84 + Math.random() * 8;
      this.enemyImpactSynth.triggerAttackRelease(pitch, 0.07, undefined, 0.16);
      this.enemyHitCrunch.triggerAttackRelease(0.035, "+0.008", 0.075);
    });
  }

  enemyDeath(boss = false): void {
    this.playThrottled(boss ? "enemy-boss-death" : "enemy-death", boss ? 220 : 32, () => {
      this.enemyImpactSynth.triggerAttackRelease(boss ? 46 : 78, boss ? 0.52 : 0.16, undefined, boss ? 0.46 : 0.22);
      this.enemyNoise.triggerAttackRelease(boss ? 0.38 : 0.12, undefined, boss ? 0.28 : 0.12);
    });
  }

  enemyShockwave(): void {
    this.playThrottled("enemy-shockwave", 200, () => {
      this.enemyImpactSynth.triggerAttackRelease(54, 0.38, undefined, 0.4);
      this.enemyNoise.triggerAttackRelease(0.28, undefined, 0.22);
    });
  }

  waveStart(): void {
    this.playThrottled("wave-start", 220, () => {
      const now = Tone.now();
      this.enemySynth.triggerAttackRelease("C2", 0.22, now, 0.25);
      this.enemySynth.triggerAttackRelease("G2", 0.25, now + 0.1, 0.2);
    });
  }

  waveClear(): void {
    this.playThrottled("wave-clear", 150, () => {
      const now = Tone.now();
      this.uiSynth.triggerAttackRelease("C3", 0.14, now, 0.2);
      this.uiSynth.triggerAttackRelease("E3", 0.14, now + 0.08, 0.18);
      this.uiSynth.triggerAttackRelease("G3", 0.2, now + 0.16, 0.18);
    });
  }

  victory(): void {
    this.playThrottled("victory", 320, () => {
      const now = Tone.now();
      ["C3", "E3", "G3", "C4"].forEach((note, index) => {
        this.uiSynth.triggerAttackRelease(note, index === 3 ? 0.42 : 0.14, now + index * 0.09, 0.2);
      });
    });
  }

  defeat(): void {
    this.playThrottled("defeat", 320, () => {
      const now = Tone.now();
      this.enemySynth.triggerAttackRelease("C2", 0.32, now, 0.3);
      this.enemySynth.triggerAttackRelease("Ab1", 0.48, now + 0.12, 0.28);
      this.enemyNoise.triggerAttackRelease(0.34, now + 0.1, 0.2);
    });
  }

  breach(kind: "tower" | "core" | "explosion" = "core", source?: TowerKind): void {
    this.playThrottled(`breach-${kind}`, kind === "core" ? 170 : 55, () => {
      if (kind === "tower") {
        this.towerImpactSynth.triggerAttackRelease(70, 0.24, undefined, 0.34);
        this.machineNoise.triggerAttackRelease(0.18, undefined, 0.18);
      } else if (kind === "explosion") {
        const body = source === "bomber" ? this.bombBody : source === "cyborg" ? this.bombBody : this.explosionBody;
        const noise = source === "bomber" ? this.bombNoise : source === "cyborg" ? this.bombNoise : this.explosionNoise;
        this.playCachedBuffer("puff", source ? 0.11 : 0.14, source === "bomber" ? 0.9 : 0.65);
        body.triggerAttackRelease(source === "cyborg" ? 44 : 48, source === "bomber" ? 0.34 : 0.46, undefined, source ? 0.35 : 0.42);
        noise.triggerAttackRelease(source === "bomber" ? 0.32 : 0.42, undefined, source ? 0.28 : 0.34);
      } else {
        this.explosionBody.triggerAttackRelease(40, 0.58, undefined, 0.46);
        this.explosionNoise.triggerAttackRelease(0.5, undefined, 0.34);
      }
    });
  }

  // Kept for the game lifecycle API. No oscillator is started here, so the
  // removed ambient drone cannot come back during a run.
  startAmbience(intensity = 0.2): void {
    void intensity;
    this.applyGains();
  }

  setAmbienceIntensity(intensity: number): void {
    void intensity;
    this.applyGains();
  }

  stopAmbience(): void {
    this.applyGains();
  }

  private initializeProceduralBuffers(): void {
    if (this.proceduralBuffers.size === 3) return;
    const rawContext = Tone.getContext().rawContext as AudioContext;
    if (typeof rawContext.createBuffer !== "function") return;
    const sampleRate = rawContext.sampleRate;

    const createBuffer = (name: ProceduralBufferName, duration: number, render: (index: number, length: number) => number): void => {
      const length = Math.floor(sampleRate * duration);
      const buffer = rawContext.createBuffer(1, length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) channel[index] = render(index, length);
      this.proceduralBuffers.set(name, buffer);
    };

    // A short, rounded transient: noise plus a small high-frequency partial.
    createBuffer("snap", 0.012, (index, length) => {
      const time = index / sampleRate;
      const envelope = Math.min(1, time / 0.0018) * (1 - index / length) ** 2.8;
      return envelope * ((Math.random() * 2 - 1) * 0.34 + Math.sin(time * Math.PI * 2 * 2300) * 0.16);
    });

    // Soft low-passed air used for blades, engines, fire, and phase movement.
    let puffState = 0;
    createBuffer("puff", 0.055, (index, length) => {
      const envelope = Math.sin((index / length) * Math.PI) ** 1.35;
      const white = Math.random() * 2 - 1;
      puffState += (white - puffState) * 0.075;
      return puffState * envelope * 0.52;
    });

    // Sparse electrical texture. The tiny impulses are deliberately softened
    // so repeated Tempest/Prism attacks do not become painful clicks.
    let crackleState = 0;
    createBuffer("crackle", 0.038, (index, length) => {
      if (Math.random() > 0.982) crackleState += (Math.random() * 2 - 1) * 0.42;
      crackleState *= 0.91;
      const envelope = (1 - index / length) ** 1.7;
      return (crackleState + (Math.random() * 2 - 1) * 0.035) * envelope;
    });
  }

  private playCachedBuffer(name: ProceduralBufferName, gainValue = 0.08, playbackRate = 1): void {
    if (!this.started) return;
    this.initializeProceduralBuffers();
    const buffer = this.proceduralBuffers.get(name);
    if (!buffer) return;

    const rawContext = Tone.getContext().rawContext as AudioContext;
    const source = rawContext.createBufferSource();
    const filter = rawContext.createBiquadFilter();
    const gain = rawContext.createGain();
    source.buffer = buffer;
    source.playbackRate.value = clamp(playbackRate, 0.5, 2);

    if (name === "snap") {
      filter.type = "highpass";
      filter.frequency.value = 850;
      filter.Q.value = 0.45;
    } else if (name === "puff") {
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.35;
    } else {
      filter.type = "bandpass";
      filter.frequency.value = 2400;
      filter.Q.value = 0.7;
    }

    gain.gain.value = clamp(gainValue, 0, 0.3);
    source.connect(filter).connect(gain);
    // Route native procedural buffers into the existing Tone tower bus so
    // master volume, tower volume, compression, limiting, and mute all apply.
    gain.connect(this.buses.towers.input as unknown as AudioNode);
    source.start();
  }

  private jitter(base: number, percent = 0.03): number {
    return base * (1 + (Math.random() * 2 - 1) * percent);
  }

  private stopZenithCharge(towerId: number, completed = false): void {
    const voice = this.zenithChargeSources.get(towerId);
    if (!voice) return;
    this.zenithChargeSources.delete(towerId);
    try {
      const now = Tone.now();
      if (completed) {
        voice.whineGain.gain.rampTo(0, 0.08, now);
        voice.staticGain.gain.rampTo(0, 0.08, now);
        voice.body.triggerRelease(now + 0.06);
        voice.whine.stop(now + 0.1);
        voice.staticNoise.stop(now + 0.1);
      } else {
        voice.body.triggerRelease(now);
        voice.whineGain.gain.rampTo(0, 0.06, now);
        voice.staticGain.gain.rampTo(0, 0.06, now);
        voice.whine.stop(now + 0.08);
        voice.staticNoise.stop(now + 0.08);
      }
    } catch {
      // Ignore a release race if the browser has just suspended the context.
    }
    setTimeout(() => {
      voice.body.dispose();
      voice.whine.dispose();
      voice.whineGain.dispose();
      voice.staticNoise.dispose();
      voice.staticFilter.dispose();
      voice.staticGain.dispose();
    }, 450);
  }

  private syncFlameHum(): void {
    if (!this.started) return;
    const levels = [...this.flameHumSources.values()];
    if (levels.length === 0) {
      this.flameHumOscGain.gain.rampTo(0, 0.12);
      this.flameHumNoiseGain.gain.rampTo(0, 0.12);
      return;
    }

    if (!this.flameHumStarted) {
      this.flameHumOsc.start();
      this.flameHumNoise.start();
      this.flameHumStarted = true;
    }
    const level = Math.max(...levels);
    const now = Tone.now();
    this.flameHumOsc.frequency.rampTo(70 + level * 4, 0.08, now);
    this.flameHumOscGain.gain.rampTo(0.045 + level * 0.004, 0.1, now);
    this.flameHumNoiseGain.gain.rampTo(0.022 + level * 0.003, 0.1, now);
  }

  private playThrottled(key: string, minimumGapMs: number, play: () => void): void {
    if (!this.preferences.enabled || this.preferences.master <= 0) return;
    if (!this.started) {
      if (this.pendingKeys.has(key)) return;
      this.pendingKeys.add(key);
      this.pendingVoices.push({ key, minimumGapMs, play });
      return;
    }
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (now - last < minimumGapMs) return;
    this.lastPlayed.set(key, now);
    try {
      play();
    } catch {
      // Keep gameplay usable if an audio backend rejects an individual voice.
    }
  }

  private applyGains(): void {
    const master = this.preferences.enabled ? this.preferences.master : 0;
    this.masterBus.gain.value = master;
    this.buses.towers.gain.value = this.preferences.towers * TOWER_MIX_TRIM;
    this.buses.enemies.gain.value = this.preferences.enemies;
    this.buses.ui.gain.value = this.preferences.ui;
    this.buses.ambience.gain.value = 0;
    this.limiter.threshold.value = -2;
  }
}
