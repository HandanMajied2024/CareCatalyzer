class MissionAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  /**
   * Subtle sonar ping when clicking a region or Patient Persona in 3D space.
   */
  public playSonarPing(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(1110, now + 0.08);

    gain.gain.setValueAtTime(0.0005, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  /**
   * Soft tonal pulse when adjusting a Strategic Pillar slider.
   */
  public playPillarPulse(levelPct: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 260 + (levelPct / 100) * 320;
    osc.frequency.setValueAtTime(baseFreq, now);

    gain.gain.setValueAtTime(0.0005, now);
    gain.gain.linearRampToValueAtTime(0.025, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /**
   * Harmonic triad chord when Gemini Strategy Advisor applies an optimization scenario.
   */
  public playAdvisorSync(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      const t0 = now + i * 0.05;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(0.0005, t0);
      gain.gain.linearRampToValueAtTime(0.035, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.62);
    });
  }
}

export const audioEngine = new MissionAudioEngine();
