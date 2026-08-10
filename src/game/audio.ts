export class AudioSystem {
  private context: AudioContext | null = null;
  enabled = true;

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  tone(frequency: number, duration: number, volume = 0.035, slide = 0): void {
    const context = this.getContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  deploy(): void {
    this.tone(190, 0.11, 0.025, 140);
    window.setTimeout(() => this.tone(390, 0.08, 0.02, 80), 60);
  }

  shoot(pitch = 350): void {
    this.tone(pitch, 0.05, 0.012, -110);
  }

  hit(): void {
    this.tone(95, 0.09, 0.026, -40);
  }

  counter(): void {
    this.tone(180, 0.22, 0.04, 520);
    window.setTimeout(() => this.tone(620, 0.16, 0.035, -180), 70);
  }

  fail(): void {
    this.tone(120, 0.15, 0.022, -55);
  }

  breach(): void {
    this.tone(78, 0.3, 0.035, -30);
  }
}
