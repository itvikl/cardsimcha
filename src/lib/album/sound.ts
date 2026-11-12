/**
 * The album's paper sounds, made here rather than loaded: filtered noise for the rustle, a low thud for the landing.
 * Off until the visitor turns it on; browsers only allow sound after a gesture anyway.
 */
export class PaperSound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  private ready() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const length = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private rustle(at: number, dur: number, gain: number, from: number, to: number) {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.7;
    band.frequency.setValueAtTime(from, at);
    band.frequency.exponentialRampToValueAtTime(to, at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + dur * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    source.connect(band).connect(env).connect(ctx.destination);
    source.start(at, Math.random());
    source.stop(at + dur);
  }

  private thud(at: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, at);
    osc.frequency.exponentialRampToValueAtTime(52, at + 0.16);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(env).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.22);
  }

  /** `dur` is how long the page takes, so the landing lands with it */
  play(kind: 'turn' | 'cover', dur: number) {
    const now = this.ready().currentTime;
    if (kind === 'turn') {
      this.rustle(now, Math.max(0.3, dur * 0.85), 0.13, 2600, 900);
      this.thud(now + dur * 0.92, 0.05);
    } else {
      this.rustle(now, Math.max(0.3, dur * 0.7), 0.06, 900, 400);
      this.thud(now + dur * 0.95, 0.16);
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
