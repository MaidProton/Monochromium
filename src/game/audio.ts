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

const STORAGE_KEY = "monochromium.audio.v1";
const MAX_VOICE_RATE = 36;

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  enabled: true,
  master: 1,
  towers: 1,
  enemies: 1,
  ui: 1,
  ambience: 0.35,
};

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

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
    ambience: safeNumber(stored.ambience, DEFAULT_AUDIO_SETTINGS.ambience),
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
  if (kind === "samurai" || kind === "warrior" || kind === "mercenary") return "blade";
  if (kind === "cyborg" || kind === "gunner" || kind === "recon") return "machine";
  return "pulse";
};

export class AudioSystem {
  private preferences = loadSettings();
  private started = false;
  private ambienceStarted = false;
  private ambiencePresence = 0;
  private readonly lastPlayed = new Map<string, number>();
  private readonly pendingKeys = new Set<string>();
  private pendingVoices: Array<{ key: string; minimumGapMs: number; play: () => void }> = [];
  private unlockPromise: Promise<void> | null = null;

  private readonly limiter = new Tone.Limiter(-1).toDestination();
  private readonly masterBus = new Tone.Gain(1).connect(this.limiter);
  private readonly buses: Record<AudioBus, Tone.Gain> = {
    towers: new Tone.Gain(1).connect(this.masterBus),
    enemies: new Tone.Gain(1).connect(this.masterBus),
    ui: new Tone.Gain(1).connect(this.masterBus),
    ambience: new Tone.Gain(0).connect(this.masterBus),
  };

  private readonly towerPulse = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.003, decay: 0.08, sustain: 0.08, release: 0.06 },
  }).connect(this.buses.towers);
  private readonly towerBlade = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.002, decay: 0.12, sustain: 0.05, release: 0.08 },
  }).connect(this.buses.towers);
  private readonly towerMachine = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0.04, release: 0.035 },
  }).connect(this.buses.towers);
  private readonly enemySynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.14, sustain: 0.06, release: 0.08 },
  }).connect(this.buses.enemies);
  private readonly uiSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.05, sustain: 0.04, release: 0.04 },
  }).connect(this.buses.ui);
  private readonly noiseSynth = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
  }).connect(this.buses.enemies);
  private readonly impactSynth = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 },
  }).connect(this.buses.enemies);
  private readonly metalSynth = new Tone.MetalSynth({
    harmonicity: 4.1,
    modulationIndex: 18,
    resonance: 1800,
    octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.12, release: 0.04 },
  }).connect(this.buses.towers);
  private readonly enemyMetalSynth = new Tone.MetalSynth({
    harmonicity: 3.2,
    modulationIndex: 13,
    resonance: 2400,
    octaves: 1.2,
    envelope: { attack: 0.001, decay: 0.08, release: 0.025 },
  }).connect(this.buses.enemies);
  private readonly ambienceLow = new Tone.Oscillator(52, "sine").connect(this.buses.ambience);
  private readonly ambienceHigh = new Tone.Oscillator(78, "triangle").connect(this.buses.ambience);

  constructor() {
    [this.towerPulse, this.towerBlade, this.towerMachine, this.enemySynth, this.uiSynth].forEach((synth) => {
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
        this.started = true;
        this.ambienceLow.start();
        this.ambienceHigh.start();
        this.ambienceStarted = true;
        this.applyGains();
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

  uiClick(): void {
    this.playThrottled("ui-click", 22, () => this.uiSynth.triggerAttackRelease("C6", 0.045, undefined, 0.28));
  }

  uiOpen(): void {
    this.playThrottled("ui-open", 40, () => this.uiSynth.triggerAttackRelease(["C5", "E5"], 0.08, undefined, 0.3));
  }

  uiConfirm(): void {
    this.playThrottled("ui-confirm", 40, () => this.uiSynth.triggerAttackRelease(["E5", "G5"], 0.1, undefined, 0.34));
  }

  uiError(): void {
    this.playThrottled("ui-error", 55, () => this.uiSynth.triggerAttackRelease("A3", 0.12, undefined, 0.36));
  }

  uiPause(paused: boolean): void {
    this.playThrottled(`ui-pause-${paused ? "on" : "off"}`, 80, () => this.uiSynth.triggerAttackRelease(
      paused ? ["C4", "F4"] : ["F4", "C5"],
      0.13,
      undefined,
      0.34,
    ));
  }

  uiSpeed(speed: number): void {
    const pitch = 340 + Math.round(speed * 70);
    this.playThrottled("ui-speed", 60, () => this.uiSynth.triggerAttackRelease(pitch, 0.07, undefined, 0.3));
  }

  fail(): void {
    this.uiError();
  }

  tone(frequency: number, duration: number, volume = 0.14, slide = 0, bus: AudioBus = "towers"): void {
    const adjustedFrequency = Math.max(30, frequency + slide * 0.35);
    const synth = bus === "ui" ? this.uiSynth : bus === "enemies" ? this.enemySynth : this.towerPulse;
    this.playThrottled(`tone-${bus}`, 24, () => synth.triggerAttackRelease(adjustedFrequency, duration, undefined, clamp(volume * 4, 0.02, 0.8)));
  }

  deploy(kind?: TowerKind): void {
    const frequency = kind === "tempest" ? 270 : kind === "infernus" ? 150 : 205;
    const variant = towerVariant(kind);
    const synth = variant === "blade" ? this.towerBlade : variant === "machine" ? this.towerMachine : this.towerPulse;
    this.playThrottled("tower-deploy", 45, () => {
      synth.triggerAttackRelease(frequency, 0.11, undefined, 0.46);
      this.uiSynth.triggerAttackRelease(frequency * 1.8, 0.06, "+0.055", 0.2);
    });
  }

  shoot(pitch = 350, kind?: TowerKind): void {
    const variant = towerVariant(kind);
    const synth = variant === "blade" ? this.towerBlade : variant === "machine" ? this.towerMachine : this.towerPulse;
    const duration = variant === "blade" ? 0.09 : variant === "machine" ? 0.035 : 0.055;
    const velocity = variant === "machine" ? 0.2 : 0.28;
    this.playThrottled("tower-shoot", Math.round(1000 / MAX_VOICE_RATE), () => synth.triggerAttackRelease(pitch, duration, undefined, velocity));
  }

  towerReload(kind?: TowerKind): void {
    const pitch = kind === "recon" ? 120 : kind === "cyborg" ? 95 : 180;
    this.playThrottled("tower-reload", 75, () => this.metalSynth.triggerAttackRelease(pitch, 0.1, undefined, 0.2));
  }

  towerUpgrade(): void {
    this.playThrottled("tower-upgrade", 55, () => this.towerBlade.triggerAttackRelease(["C4", "G4", "C5"], 0.16, undefined, 0.34));
  }

  towerAbility(kind?: TowerKind): void {
    const pitch = kind === "bomber" ? 110 : kind === "samurai" ? 330 : 220;
    this.playThrottled("tower-ability", 65, () => this.towerBlade.triggerAttackRelease([pitch, pitch * 1.5], 0.2, undefined, 0.38));
  }

  counter(): void {
    this.playThrottled("tower-counter", 60, () => {
      this.towerBlade.triggerAttackRelease(180, 0.16, undefined, 0.42);
      this.towerPulse.triggerAttackRelease(620, 0.14, "+0.065", 0.34);
    });
  }

  hit(): void {
    this.towerDamage();
    this.enemyAttack();
  }

  towerDamage(): void {
    this.playThrottled("tower-damage", 65, () => this.metalSynth.triggerAttackRelease(125, 0.12, undefined, 0.38));
  }

  enemyAttack(): void {
    this.playThrottled("enemy-attack", 65, () => this.impactSynth.triggerAttackRelease(88, 0.12, undefined, 0.42));
  }

  enemySpawn(kind: EnemyKind, boss = false): void {
    const hash = hashString(kind);
    const pitch = boss ? 72 : 125 + (hash % 7) * 14;
    this.playThrottled(boss ? "enemy-boss-spawn" : "enemy-spawn", boss ? 180 : 32, () => {
      this.enemySynth.triggerAttackRelease(pitch, boss ? 0.42 : 0.08, undefined, boss ? 0.48 : 0.18);
      if (boss) this.enemyMetalSynth.triggerAttackRelease(110, 0.28, "+0.05", 0.22);
    });
  }

  enemyHit(shield = false): void {
    this.playThrottled(shield ? "enemy-shield-hit" : "enemy-hit", shield ? 28 : 22, () => {
      if (shield) this.enemyMetalSynth.triggerAttackRelease(460, 0.045, undefined, 0.18);
      else this.noiseSynth.triggerAttackRelease(0.045, undefined, 0.16);
    });
  }

  enemyDeath(boss = false): void {
    this.playThrottled(boss ? "enemy-boss-death" : "enemy-death", boss ? 180 : 28, () => {
      this.impactSynth.triggerAttackRelease(boss ? 58 : 105, boss ? 0.38 : 0.12, undefined, boss ? 0.52 : 0.24);
      if (boss) this.noiseSynth.triggerAttackRelease(0.26, undefined, 0.28);
    });
  }

  enemyShockwave(): void {
    this.playThrottled("enemy-shockwave", 180, () => this.impactSynth.triggerAttackRelease(68, 0.32, undefined, 0.46));
  }

  waveStart(): void {
    this.playThrottled("wave-start", 180, () => this.enemySynth.triggerAttackRelease(["C3", "G3"], 0.2, undefined, 0.36));
  }

  waveClear(): void {
    this.playThrottled("wave-clear", 120, () => this.uiSynth.triggerAttackRelease(["C5", "E5", "G5"], 0.22, undefined, 0.42));
  }

  victory(): void {
    this.playThrottled("victory", 300, () => this.uiSynth.triggerAttackRelease(["C5", "E5", "G5", "C6"], 0.55, undefined, 0.48));
  }

  defeat(): void {
    this.playThrottled("defeat", 300, () => this.enemySynth.triggerAttackRelease(["C3", "Ab2"], 0.5, undefined, 0.46));
  }

  breach(kind: "tower" | "core" | "explosion" = "core"): void {
    const pitch = kind === "tower" ? 125 : kind === "explosion" ? 72 : 58;
    this.playThrottled(`breach-${kind}`, kind === "core" ? 150 : 45, () => {
      if (kind === "tower") {
        this.metalSynth.triggerAttackRelease(pitch, 0.2, undefined, 0.42);
        this.towerPulse.triggerAttackRelease(82, 0.22, "+0.04", 0.22);
      } else {
        this.impactSynth.triggerAttackRelease(pitch, kind === "core" ? 0.42 : 0.2, undefined, kind === "core" ? 0.5 : 0.34);
        this.noiseSynth.triggerAttackRelease(kind === "core" ? 0.34 : 0.15, undefined, 0.28);
      }
    });
  }

  startAmbience(intensity = 0.2): void {
    this.ambiencePresence = clamp(intensity, 0, 1);
    this.applyGains();
  }

  setAmbienceIntensity(intensity: number): void {
    this.ambiencePresence = clamp(intensity, 0, 1);
    this.applyGains();
  }

  stopAmbience(): void {
    this.ambiencePresence = 0;
    this.applyGains();
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
    this.buses.towers.gain.value = this.preferences.towers;
    this.buses.enemies.gain.value = this.preferences.enemies;
    this.buses.ui.gain.value = this.preferences.ui;
    this.buses.ambience.gain.value = this.ambienceStarted && this.preferences.enabled
      ? this.preferences.ambience * this.ambiencePresence
      : 0;
    this.limiter.threshold.value = -1;
  }
}
