/** Presentation-only sound effect interface. */
export interface IAudioAdapter {
  enabled: boolean;
  effect(kind: string, intensity?: number): void;
}

/** Browser WebAudio implementation. Never consumes simulation RNG. */
export class WebAudioAdapter implements IAudioAdapter {
  enabled = true;
  #context: AudioContext | null = null;

  /** Plays a short non-speech feedback cue. */
  effect(kind: string, intensity = 0.5): void {
    if (!this.enabled) return;
    const AudioContextCtor = globalThis.AudioContext;
    if (!AudioContextCtor) return;
    this.#context ??= new AudioContextCtor();
    const audio = this.#context;
    const now = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const frequencies: Record<string, number> = { hit:120, critical:72, miss:260, sign:420, bomb:55, move:190, surrender:310, defeat:58 };
    const frequency = frequencies[kind] ?? 180;
    oscillator.type = kind === 'critical' || kind === 'defeat' ? 'sawtooth' : 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * 0.45), now + 0.08 + 0.12 * intensity);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.025 + 0.06 * intensity, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10 + 0.14 * intensity);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.28);
  }
}
