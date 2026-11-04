import { describe, expect, it, vi } from "vitest";
import { AudioSystem } from "./audio.ts";
import { TOWER_ORDER } from "./config.ts";

// Exercise routing/envelopes without instantiating a browser audio graph.
vi.mock("tone", () => ({ now: () => 10 }));

describe("Tank weapon audio and silent ability activation", () => {
  it("never schedules an activation jingle for any tower", () => {
    const playThrottled = vi.fn();
    const audio = Object.assign(Object.create(AudioSystem.prototype), { playThrottled }) as AudioSystem;
    for (const kind of TOWER_ORDER) audio.towerAbility(kind);
    audio.towerAbility();
    expect(playThrottled).not.toHaveBeenCalled();
  });

  it("uses a descending motor/body and noise for missile propulsion", () => {
    const body = { triggerAttackRelease: vi.fn(), frequency: { exponentialRampTo: vi.fn() } };
    const noise = { triggerAttackRelease: vi.fn() };
    const throttle = vi.fn((_key: string, _gap: number, play: () => void) => play());
    const audio = Object.assign(Object.create(AudioSystem.prototype), { playThrottled: throttle, playCachedBuffer: vi.fn(), rocketBody: body, rocketNoise: noise }) as AudioSystem;
    audio.tankMissileLaunch();
    expect(throttle).toHaveBeenCalledWith("tank-missile-launch", 55, expect.any(Function));
    expect(body.triggerAttackRelease).toHaveBeenCalledWith(88, 0.18, 10, 0.24);
    expect(body.frequency.exponentialRampTo).toHaveBeenCalledWith(46, 0.2, 10);
    expect(noise.triggerAttackRelease).toHaveBeenCalled();
  });

  it("holds one flame bed across frames and fades it out on cancellation", () => {
    const noise = { start: vi.fn() };
    const hiss = { start: vi.fn() };
    const gain = { gain: { rampTo: vi.fn() } };
    const hissGain = { gain: { rampTo: vi.fn() } };
    const audio = Object.assign(Object.create(AudioSystem.prototype), {
      started: true, tankFlameLevel: -1, tankFlameStarted: false,
      tankFlameNoise: noise, tankFlameHiss: hiss, tankFlameGain: gain, tankFlameHissGain: hissGain,
      tankFlameFilter: { frequency: { rampTo: vi.fn() } },
    }) as AudioSystem;
    audio.tankFlameStream(true, 7);
    audio.tankFlameStream(true, 7);
    expect(noise.start).toHaveBeenCalledTimes(1);
    expect(hiss.start).toHaveBeenCalledTimes(1);
    expect(gain.gain.rampTo).toHaveBeenCalledTimes(1);
    audio.tankFlameStream(false);
    expect(gain.gain.rampTo).toHaveBeenLastCalledWith(0, 0.08);
    expect(hissGain.gain.rampTo).toHaveBeenLastCalledWith(0, 0.08);
    audio.tankFlameStream(true, 6);
    expect(noise.start).toHaveBeenCalledTimes(1);
  });
});

describe("AudioSystem settings and volume controls", () => {
  it("clamps volume between 0 and 1", () => {
    const audio = Object.assign(Object.create(AudioSystem.prototype), {
      preferences: { enabled: true, master: 0.8, towers: 0.7, enemies: 0.9, ui: 0.7, ambience: 0 },
      applyGains: vi.fn(),
      getSettings: function () { return this.preferences; },
    }) as AudioSystem;

    audio.setVolume("master", 1.5);
    expect(audio.getSettings().master).toBe(1);

    audio.setVolume("master", -0.5);
    expect(audio.getSettings().master).toBe(0);

    audio.setVolume("towers", 0.45);
    expect(audio.getSettings().towers).toBe(0.45);
  });

  it("toggles enabled state on and off", () => {
    const audio = Object.assign(Object.create(AudioSystem.prototype), {
      preferences: { enabled: true, master: 0.8, towers: 0.7, enemies: 0.9, ui: 0.7, ambience: 0 },
      applyGains: vi.fn(),
      getSettings: function () { return this.preferences; },
    }) as AudioSystem;

    expect(audio.toggle()).toBe(false);
    expect(audio.getSettings().enabled).toBe(false);

    expect(audio.toggle()).toBe(true);
    expect(audio.getSettings().enabled).toBe(true);
  });

  it("sanitizes invalid and NaN settings values", () => {
    const audio = Object.assign(Object.create(AudioSystem.prototype), {
      preferences: { enabled: true, master: 0.88, towers: 0.72, enemies: 0.95, ui: 0.72, ambience: 0 },
      applyGains: vi.fn(),
      getSettings: function () { return this.preferences; },
    }) as AudioSystem;

    audio.setSettings({ master: "invalid" as any, towers: Number.NaN, enemies: 0.5 });
    expect(audio.getSettings().master).toBe(0.88);
    expect(audio.getSettings().towers).toBe(0.72);
    expect(audio.getSettings().enemies).toBe(0.5);
    expect(audio.getSettings().ambience).toBe(0);
  });
});

describe("AudioSystem prewarm", () => {
  it("silently triggers procedural synths and buffers with zero volume", () => {
    const triggerAttackRelease = vi.fn();
    const playCachedBuffer = vi.fn();
    const synthMock = { triggerAttackRelease };
    const masterGain = { value: 0.88 };

    const audio = Object.assign(Object.create(AudioSystem.prototype), {
      started: true,
      prewarmed: false,
      masterBus: { gain: masterGain },
      playCachedBuffer,
      uiSynth: synthMock,
      towerPulse: synthMock,
      towerBlade: synthMock,
      towerMachine: synthMock,
      electricSynth: synthMock,
      enemySynth: synthMock,
      uiHoverSynth: synthMock,
      towerBladeBody: synthMock,
      towerBladeShing: synthMock,
      towerBladeEdge: synthMock,
      electricMetal: synthMock,
      towerArcBody: synthMock,
      rocketBody: synthMock,
      railBeam: synthMock,
      metalSynth: synthMock,
      towerRifleBody: synthMock,
      towerShotgunBody: synthMock,
      flameBody: synthMock,
      bombBody: synthMock,
      railSub: synthMock,
      towerImpactSynth: synthMock,
      enemyImpactSynth: synthMock,
      explosionBody: synthMock,
      towerSidearmSnap: synthMock,
      towerRifleSnap: synthMock,
      towerShotgunSnap: synthMock,
      towerBladeWhoosh: synthMock,
      machineNoise: synthMock,
      bladeNoise: synthMock,
      towerArcCrackle: synthMock,
      flameNoise: synthMock,
      flameCrackle: synthMock,
      bombNoise: synthMock,
      bombCrackle: synthMock,
      rocketNoise: synthMock,
      rocketIgnition: synthMock,
      railBlast: synthMock,
      railTail: synthMock,
      enemyHitCrunch: synthMock,
      enemyNoise: synthMock,
      explosionNoise: synthMock,
    }) as AudioSystem;

    audio.prewarm();

    expect(playCachedBuffer).toHaveBeenCalledWith("snap", 0);
    expect(playCachedBuffer).toHaveBeenCalledWith("puff", 0);
    expect(playCachedBuffer).toHaveBeenCalledWith("crackle", 0);
    expect(triggerAttackRelease).toHaveBeenCalled();
    // Verify all triggers used zero velocity for complete silence
    triggerAttackRelease.mock.calls.forEach((args) => {
      const lastArg = args[args.length - 1];
      expect(lastArg).toBe(0);
    });
    expect(masterGain.value).toBe(0.88);

    // Idempotent: second call does nothing
    triggerAttackRelease.mockClear();
    playCachedBuffer.mockClear();
    audio.prewarm();
    expect(playCachedBuffer).not.toHaveBeenCalled();
    expect(triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("does not run if audio has not started", () => {
    const playCachedBuffer = vi.fn();
    const audio = Object.assign(Object.create(AudioSystem.prototype), {
      started: false,
      prewarmed: false,
      playCachedBuffer,
    }) as AudioSystem;

    audio.prewarm();
    expect(playCachedBuffer).not.toHaveBeenCalled();
  });
});


