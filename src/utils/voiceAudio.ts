/**
 * Unified clinical voice & audio helper:
 * - Subtle ringtone/chime/alert synth via Web Audio API (no jarring sounds)
 * - Web Speech synthesis fallback when Live API audio isn't streaming
 * - 16kHz PCM mic capture & 24kHz PCM gapless playback for gemini-3.8-live WebSocket
 */

class VoiceAudioController {
  private sfxCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private nextPlaybackTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private muted = false;

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopSpeech();
      this.stopLivePlayback();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private ensureSfxContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.sfxCtx) {
      this.sfxCtx = new AudioCtx();
    }
    if (this.sfxCtx.state === 'suspended') {
      void this.sfxCtx.resume();
    }
    return this.sfxCtx;
  }

  public playDialTone(): void {
    const ctx = this.ensureSfxContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [425, 425].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.24);
      gain.gain.setValueAtTime(0.0005, now + i * 0.24);
      gain.gain.linearRampToValueAtTime(0.03, now + i * 0.24 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.24 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.24);
      osc.stop(now + i * 0.24 + 0.19);
    });
  }

  public playOutcomeTone(type: 'confirmed' | 'escalated' | 'urgent'): void {
    const ctx = this.ensureSfxContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes =
      type === 'confirmed'
        ? [523.25, 659.25, 783.99]
        : type === 'urgent'
          ? [587.33, 440, 587.33]
          : [440, 523.25];

    notes.forEach((freq, idx) => {
      const t0 = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === 'urgent' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0005, t0);
      gain.gain.linearRampToValueAtTime(0.035, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.28);
    });
  }

  public speakText(text: string, voice: 'male' | 'female' = 'male'): Promise<void> {
    if (this.muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.0;
        utter.pitch = voice === 'male' ? 0.9 : 1.05;
        const voices = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
        const malePattern = /(male|david|daniel|mark|george|james|guy|ryan|christopher|eric|thomas|arthur|fred|alex|google uk english male)/i;
        const femalePattern = /(female|zira|samantha|susan|hazel|jenny|aria|libby|sonia|karen|victoria|google uk english female)/i;
        const preferred =
          voice === 'male'
            ? voices.find((v) => malePattern.test(v.name) && !femalePattern.test(v.name)) ?? voices.find((v) => !femalePattern.test(v.name))
            : voices.find((v) => femalePattern.test(v.name)) ?? voices[0];
        if (preferred) utter.voice = preferred;
        const timer = window.setTimeout(resolve, Math.max(4000, text.length * 90));
        utter.onend = () => { window.clearTimeout(timer); resolve(); };
        utter.onerror = () => { window.clearTimeout(timer); resolve(); };
        window.speechSynthesis.speak(utter);
      } catch {
        resolve();
      }
    });
  }

  private agentAudio: HTMLAudioElement | null = null;
  private agentAudioUrl: string | null = null;
  private agentResolve: (() => void) | null = null;

  /**
   * Speaks an agent line with server TTS (/api/tts: ElevenLabs, then Gemini TTS).
   * Falls back to browser speechSynthesis. Resolves when playback ends.
   */
  public async speakAgent(text: string, voice: 'male' | 'female' = 'male'): Promise<'server' | 'browser' | 'muted'> {
    if (this.muted || typeof window === 'undefined') return 'muted';
    this.stopAgentAudio();
    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) throw new Error('tts ' + resp.status);
      const blob = await resp.blob();
      if (!blob.size) throw new Error('empty tts');
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.agentAudio = audio;
      this.agentAudioUrl = url;
      await new Promise<void>((resolve) => {
        this.agentResolve = resolve;
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      this.stopAgentAudio();
      return 'server';
    } catch {
      this.stopAgentAudio();
      await this.speakText(text, voice);
      return 'browser';
    }
  }

  public stopAgentAudio(): void {
    if (this.agentAudio) {
      try { this.agentAudio.pause(); } catch { /* noop */ }
      this.agentAudio = null;
    }
    if (this.agentAudioUrl) {
      URL.revokeObjectURL(this.agentAudioUrl);
      this.agentAudioUrl = null;
    }
    if (this.agentResolve) {
      const r = this.agentResolve;
      this.agentResolve = null;
      r();
    }
  }

  public stopSpeech(): void {
    this.stopAgentAudio();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // noop
      }
    }
  }

  /**
   * Gapless 24kHz 16-bit signed LE PCM playback for Gemini Live API audio chunks.
   */
  public enqueuePcm24k(base64Audio: string): void {
    if (this.muted || typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
      this.playbackCtx = new AudioCtx({ sampleRate: 24000 });
      this.nextPlaybackTime = this.playbackCtx.currentTime;
    }
    if (this.playbackCtx.state === 'suspended') {
      void this.playbackCtx.resume();
    }

    const binary = window.atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (sampleCount === 0) return;

    const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
    const audioBuffer = this.playbackCtx.createBuffer(1, sampleCount, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      channelData[i] = pcm16[i] / 32768;
    }

    const source = this.playbackCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.playbackCtx.destination);

    const startTime = Math.max(this.nextPlaybackTime, this.playbackCtx.currentTime + 0.02);
    source.start(startTime);
    this.nextPlaybackTime = startTime + audioBuffer.duration;
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };
  }

  public stopLivePlayback(): void {
    this.activeSources.forEach((src) => {
      try {
        src.stop();
      } catch {
        // noop
      }
    });
    this.activeSources.clear();
    if (this.playbackCtx) {
      this.nextPlaybackTime = this.playbackCtx.currentTime;
    }
  }

  public async waitForLivePlayback(): Promise<void> {
    const sources = [...this.activeSources];
    if (sources.length === 0) return;
    // A suspended audio device must not leave a completed call stuck indefinitely.
    await new Promise<void>((resolve) => {
      const remaining = new Set(sources);
      const finish = () => {
        window.clearTimeout(timeout);
        for (const source of sources) source.removeEventListener('ended', ended);
        resolve();
      };
      const ended = (event: Event) => {
        remaining.delete(event.target as AudioBufferSourceNode);
        if (remaining.size === 0) finish();
      };
      const timeout = window.setTimeout(finish, 15000);
      for (const source of sources) source.addEventListener('ended', ended);
    });
  }
}

export function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

export const voiceAudio = new VoiceAudioController();
