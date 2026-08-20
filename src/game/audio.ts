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
  | "burst";

const STORAGE_KEY = "monochromium.audio.v1";
const MAX_VOICE_RATE = 42;

// Keep ambience in the saved settings shape for compatibility, but leave it
// silent. The old always-on drone made the whole game feel like one loop.
export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  enabled: true,
  master: 0.88,
  towers: 0.9,
  enemies: 0.95,
  ui: 0.72,
  ambience: 0,
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
  if (kind === "samurai" || kind === "warrior" || kind === "mercenary") return "blade";
  if (kind === "cyborg" || kind === "gunner" || kind === "recon") return "machine";
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
    default: return "machine";
  }
};

export class AudioSystem {
  private preferences = loadSettings();
  private started = false;
  private readonly lastPlayed = new Map<string, number>();
  private readonly pendingKeys = new Set<string>();
  private pendingVoices: Array<{ key: string; minimumGapMs: number; play: () => void }> = [];
  private unlockPromise: Promise<void> | null = null;

  private readonly limiter = new Tone.Limiter(-2).toDestination();
  private readonly masterBus = new Tone.Gain(1).connect(this.limiter);
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

  private readonly towerFilter = new Tone.Filter({ type: "lowpass", frequency: 2600, rolloff: -12 }).connect(this.buses.towers);
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
  private readonly flameBody = new Tone.MembraneSynth({
    pitchDecay: 0.07,
    octaves: 2.2,
    envelope: { attack: 0.003, decay: 0.15, sustain: 0, release: 0.07 },
  }).connect(this.towerFilter);
  private readonly flameNoise = new Tone.NoiseSynth({
    noise: { type: "brown" },
    envelope: { attack: 0.004, decay: 0.16, sustain: 0, release: 0.06 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 900, rolloff: -24 }).connect(this.buses.towers));
  private readonly bombBody = new Tone.MembraneSynth({
    pitchDecay: 0.08,
    octaves: 3.5,
    envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 },
  }).connect(this.towerFilter);
  private readonly bombNoise = new Tone.NoiseSynth({
    noise: { type: "brown" },
    envelope: { attack: 0.002, decay: 0.28, sustain: 0, release: 0.1 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 1050, rolloff: -24 }).connect(this.buses.towers));
  private readonly rocketNoise = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.004, decay: 0.18, sustain: 0, release: 0.07 },
  }).connect(new Tone.Filter({ type: "lowpass", frequency: 1400, rolloff: -24 }).connect(this.buses.towers));
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
        this.started = true;
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
    const synth = variant === "blade" ? this.towerBlade : variant === "machine" ? this.towerMachine : this.towerPulse;
    const frequency = kind === "tempest" ? 180 : kind === "infernus" ? 105 : 145;
    this.playThrottled("tower-deploy", 55, () => {
      synth.triggerAttackRelease(frequency, 0.14, undefined, 0.32);
      this.uiSynth.triggerAttackRelease(frequency * 1.45, 0.06, "+0.06", 0.12);
    });
  }

  shoot(pitch = 350, kind?: TowerKind, sound = towerAttackSound(kind)): void {
    const key = `tower-shoot-${sound}`;
    this.playThrottled(key, Math.round(1000 / MAX_VOICE_RATE), () => {
      if (sound === "lightning") {
        const frequency = clamp(pitch * 0.45, 220, 340);
        this.electricSynth.triggerAttackRelease(frequency, 0.065, undefined, 0.2);
        this.electricMetal.triggerAttackRelease(frequency * 1.5, 0.06, "+0.018", 0.13);
      } else if (sound === "flame") {
        this.flameBody.triggerAttackRelease(72 + Math.random() * 10, 0.14, undefined, 0.2);
        this.flameNoise.triggerAttackRelease(0.14, undefined, 0.22);
      } else if (sound === "bomb" || sound === "critical-bomb") {
        this.bombBody.triggerAttackRelease(sound === "critical-bomb" ? 58 : 76, sound === "critical-bomb" ? 0.2 : 0.13, undefined, sound === "critical-bomb" ? 0.3 : 0.22);
        this.bombNoise.triggerAttackRelease(sound === "critical-bomb" ? 0.2 : 0.12, undefined, sound === "critical-bomb" ? 0.2 : 0.13);
      } else if (sound === "howitzer") {
        this.bombBody.triggerAttackRelease(48, 0.34, undefined, 0.38);
        this.bombNoise.triggerAttackRelease(0.32, undefined, 0.25);
        this.towerMachine.triggerAttackRelease(110, 0.08, "+0.015", 0.15);
      } else if (sound === "rocket") {
        this.towerMachine.triggerAttackRelease(112, 0.09, undefined, 0.14);
        this.rocketNoise.triggerAttackRelease(0.18, undefined, 0.2);
      } else if (sound === "shotgun") {
        this.towerMachine.triggerAttackRelease(160, 0.07, undefined, 0.24);
        this.machineNoise.triggerAttackRelease(0.09, undefined, 0.24);
      } else if (sound === "burst") {
        this.towerMachine.triggerAttackRelease(135, 0.035, undefined, 0.18);
        this.machineNoise.triggerAttackRelease(0.045, undefined, 0.13);
      } else if (sound === "samurai-blade") {
        this.towerBlade.triggerAttackRelease(clamp(pitch * 0.6, 135, 240), 0.13, undefined, 0.27);
        this.bladeNoise.triggerAttackRelease(0.15, undefined, 0.22);
        this.metalSynth.triggerAttackRelease(170, 0.09, "+0.025", 0.12);
      } else if (sound === "blade") {
        const frequency = clamp(pitch * 0.44, 100, 270);
        this.towerBlade.triggerAttackRelease(frequency, 0.1, undefined, 0.25);
        this.bladeNoise.triggerAttackRelease(0.12, undefined, 0.18);
      } else if (sound === "machine") {
        const frequency = clamp(pitch * 0.34, 90, 220);
        this.towerMachine.triggerAttackRelease(frequency, 0.035, undefined, 0.2);
        this.machineNoise.triggerAttackRelease(0.045, undefined, 0.17);
      } else {
        const frequency = clamp(pitch * (sound === "rifle" ? 0.38 : 0.52), 105, sound === "rifle" ? 260 : 330);
        this.towerPulse.triggerAttackRelease(frequency, 0.075, undefined, 0.22);
      }
    });
  }

  towerEffect(effect: "tempest-field" | "tempest-arc"): void {
    const isField = effect === "tempest-field";
    this.playThrottled(effect, isField ? 180 : 85, () => {
      if (isField) {
        this.electricSynth.triggerAttackRelease("C3", 0.16, undefined, 0.18);
        this.electricSynth.triggerAttackRelease("G3", 0.2, "+0.055", 0.16);
        this.electricMetal.triggerAttackRelease(250, 0.11, "+0.08", 0.12);
      } else {
        this.electricSynth.triggerAttackRelease(280 + Math.random() * 45, 0.05, undefined, 0.14);
        this.electricMetal.triggerAttackRelease(420, 0.045, "+0.012", 0.1);
      }
    });
  }

  towerReload(kind?: TowerKind): void {
    const pitch = kind === "recon" ? 105 : kind === "cyborg" ? 82 : 130;
    this.playThrottled("tower-reload", 85, () => {
      this.metalSynth.triggerAttackRelease(pitch, 0.1, undefined, 0.16);
      this.towerImpactSynth.triggerAttackRelease(pitch * 0.8, 0.08, "+0.08", 0.12);
    });
  }

  towerUpgrade(): void {
    this.playThrottled("tower-upgrade", 65, () => {
      const now = Tone.now();
      this.towerBlade.triggerAttackRelease("C3", 0.12, now, 0.24);
      this.towerBlade.triggerAttackRelease("G3", 0.13, now + 0.08, 0.22);
      this.towerBlade.triggerAttackRelease("C4", 0.18, now + 0.16, 0.2);
    });
  }

  towerAbility(kind?: TowerKind): void {
    const pitch = kind === "bomber" ? 82 : kind === "samurai" ? 210 : 145;
    this.playThrottled("tower-ability", 75, () => {
      this.bladeNoise.triggerAttackRelease(0.18, undefined, 0.2);
      this.towerBlade.triggerAttackRelease(pitch, 0.2, undefined, 0.28);
      this.towerPulse.triggerAttackRelease(Math.min(300, pitch * 1.45), 0.14, "+0.08", 0.18);
    });
  }

  counter(): void {
    this.playThrottled("tower-counter", 70, () => {
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

  enemyHit(shield = false): void {
    this.playThrottled(shield ? "enemy-shield-hit" : "enemy-hit", shield ? 32 : 24, () => {
      if (shield) {
        this.metalSynth.triggerAttackRelease(240, 0.07, undefined, 0.16);
        this.enemySynth.triggerAttackRelease(180, 0.05, "+0.02", 0.1);
      } else {
        this.enemyImpactSynth.triggerAttackRelease(105 + Math.random() * 20, 0.07, undefined, 0.16);
        this.enemyNoise.triggerAttackRelease(0.045, undefined, 0.11);
      }
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
    this.buses.ambience.gain.value = 0;
    this.limiter.threshold.value = -2;
  }
}
