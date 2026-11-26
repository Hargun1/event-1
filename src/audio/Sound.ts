import type { SpeciesId, ZoneId } from '../game/data/species.ts';

export type CallKind = 'call' | 'roar' | 'snarl' | 'baby';

/** One synthesised vocalisation: a pitched source shaped by vocal-tract formants. */
interface Voice {
  /** Pitch keyframes (Hz) spread evenly across the duration. */
  pitch: number[];
  dur: number;
  wave: OscillatorType;
  /** Formants: [start Hz, end Hz, Q, gain]. */
  formants: [number, number, number, number][];
  /** Growl: amplitude-modulation rate (Hz) and depth 0..1. */
  growl?: [number, number];
  /** Breath noise mix 0..1 and its centre frequency. */
  breath?: [number, number];
  vibrato?: [number, number];
  /** Random pitch wobble (fraction of pitch). */
  jitter?: number;
  /** Sub-harmonic rumble (gain) for big animals. */
  sub?: number;
  drive?: number;
  attack?: number;
  release?: number;
  peak?: number;
}

/**
 * All sound is synthesised live with the Web Audio API (no audio files):
 * formant-based animal voices with reverb, combat SFX, per-zone ambience
 * and a spoken narrator (speechSynthesis).
 */
export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverbIn!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private ambient: AudioNode[] = [];
  private ambientTimer = 0;
  private zone: ZoneId = 'land';
  private lastCall = new Map<string, number>();
  private curves = new Map<number, Float32Array>();

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 0.85 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.reverb = ctx.createConvolver();
      this.reverbIn = ctx.createGain();
      const wet = ctx.createGain(); wet.gain.value = 0.32;
      this.reverbIn.connect(this.reverb).connect(wet).connect(this.master);
      this.buildReverb();
      this.startAmbient();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
    if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  setZone(zone: ZoneId): void {
    this.zone = zone;
    if (this.ctx) { this.buildReverb(); this.startAmbient(); }
  }

  /** Open plains = short airy tail, jungle valley = longer, underwater = long and muffled. */
  private buildReverb(): void {
    const ctx = this.ctx!;
    const secs = this.zone === 'water' ? 3.2 : this.zone === 'dino' ? 2.4 : 1.6;
    const len = Math.floor(ctx.sampleRate * secs);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * (this.zone === 'water' ? 0.08 : 0.5); // darker tail underwater
        d[i] = lp * Math.pow(1 - t, this.zone === 'land' ? 3.5 : 2.4);
      }
    }
    this.reverb.buffer = ir;
  }

  private shaper(amount: number): WaveShaperNode {
    const ctx = this.ctx!;
    const ws = ctx.createWaveShaper();
    const key = Math.round(amount * 10);
    let curve = this.curves.get(key);
    if (!curve) {
      curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
      this.curves.set(key, curve);
    }
    ws.curve = curve as Float32Array<ArrayBuffer>;
    ws.oversample = '2x';
    return ws;
  }

  // ------------------------------------------------------------------ routing
  private out(vol: number, pan: number, wet = 1): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || vol <= 0.01) return null;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master);
    if (wet > 0) {
      const send = ctx.createGain(); send.gain.value = wet * (0.6 + (1 - vol) * 0.8); // distant = wetter
      g.connect(send).connect(this.reverbIn);
    }
    if (this.zone === 'water') {
      // everything sounds muffled underwater
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.disconnect(); g.connect(lp).connect(p);
      if (wet > 0) { const send = ctx.createGain(); send.gain.value = wet; lp.connect(send).connect(this.reverbIn); }
    }
    return g;
  }

  private env(g: AudioParam, t: number, attack: number, hold: number, release: number, peak = 1): void {
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  /** Synthesise one voiced sound. */
  private voice(dest: AudioNode, v: Voice, delay = 0, pitchMul = 1, durMul = 1): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay, dur = v.dur * durMul;
    const attack = (v.attack ?? 0.12) * durMul, release = (v.release ?? 0.45) * durMul;
    const hold = Math.max(0.01, dur - attack - release);
    const src = ctx.createGain(); src.gain.value = 1;

    // pitched source
    const o = ctx.createOscillator();
    o.type = v.wave;
    const n = v.pitch.length;
    o.frequency.setValueAtTime(v.pitch[0] * pitchMul, t);
    for (let i = 1; i < n; i++) o.frequency.exponentialRampToValueAtTime(v.pitch[i] * pitchMul, t + (dur * i) / (n - 1));
    if (v.vibrato) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = v.vibrato[0]; lg.gain.value = v.pitch[0] * pitchMul * v.vibrato[1];
      lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    if (v.jitter) {
      // two detuned slow LFOs make an irregular, organic wobble
      for (const rate of [5.3, 8.9]) {
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = rate * (0.8 + Math.random() * 0.4); lg.gain.value = v.pitch[0] * pitchMul * v.jitter;
        lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
      }
    }
    o.connect(src);
    o.start(t); o.stop(t + dur + 0.1);

    if (v.sub) {
      const so = ctx.createOscillator(), sg = ctx.createGain();
      so.type = 'sine';
      so.frequency.setValueAtTime(v.pitch[0] * pitchMul * 0.5, t);
      so.frequency.exponentialRampToValueAtTime(v.pitch[n - 1] * pitchMul * 0.5, t + dur);
      sg.gain.value = v.sub;
      so.connect(sg).connect(src); so.start(t); so.stop(t + dur + 0.1);
    }
    if (v.breath) {
      const ns = ctx.createBufferSource(); ns.buffer = this.noise; ns.loop = true;
      const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = v.breath[1]; bf.Q.value = 0.7;
      const bg = ctx.createGain(); bg.gain.value = v.breath[0];
      ns.connect(bf).connect(bg).connect(src); ns.start(t, Math.random()); ns.stop(t + dur + 0.1);
    }

    // saturation → formant filter bank
    let pre: AudioNode = src;
    if (v.drive) { const ws = this.shaper(v.drive); src.connect(ws); pre = ws; }
    const formantSum = ctx.createGain(); formantSum.gain.value = 1;
    for (const [f0, f1, q, gain] of v.formants) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
      bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      pre.connect(bp).connect(g).connect(formantSum);
    }

    // growl (amplitude modulation) + envelope
    const am = ctx.createGain();
    if (v.growl) {
      am.gain.value = 1 - v.growl[1] / 2;
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.type = 'triangle'; lfo.frequency.value = v.growl[0]; lg.gain.value = v.growl[1] / 2;
      lfo.connect(lg).connect(am.gain); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    const envG = ctx.createGain();
    this.env(envG.gain, t, attack, hold, release, v.peak ?? 0.8);
    formantSum.connect(am).connect(envG).connect(dest);
  }

  private hiss(dest: AudioNode, filter: BiquadFilterType, freq: number, q: number, dur: number, peak: number, delay = 0, sweepTo?: number): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, Math.min(0.03, dur * 0.2), dur * 0.3, dur * 0.6, peak);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g.gain, t, Math.min(0.02, dur * 0.2), dur * 0.3, dur * 0.6, peak);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.1);
  }

  // ------------------------------------------------------------------ species voices
  /** Lion: moaning build-up, a huge rough "aaaOUGH" roar, then a train of fading grunts. */
  private lionRoar(o: AudioNode, r: number): void {
    const main: Voice = {
      pitch: [120, 185, 175, 140, 95], dur: 2.1, wave: 'sawtooth',
      formants: [[600, 380, 5, 1.1], [1150, 800, 6, 0.7], [2500, 2100, 8, 0.25], [180, 140, 2, 0.6]],
      growl: [34, 0.75], breath: [0.35, 900], jitter: 0.035, sub: 0.5, drive: 3.2, attack: 0.35, release: 0.8, peak: 0.95,
    };
    const moan: Voice = { pitch: [95, 120], dur: 0.7, wave: 'sawtooth', formants: [[450, 520, 5, 1], [900, 1000, 6, 0.5]], growl: [26, 0.5], breath: [0.25, 700], jitter: 0.03, drive: 2, attack: 0.25, release: 0.35, peak: 0.45 };
    const grunt: Voice = { pitch: [130, 85], dur: 0.38, wave: 'sawtooth', formants: [[520, 360, 5, 1.1], [1000, 750, 6, 0.5]], growl: [30, 0.7], breath: [0.3, 800], jitter: 0.04, sub: 0.4, drive: 2.6, attack: 0.05, release: 0.22, peak: 0.75 };
    this.voice(o, moan, 0, r);
    this.voice(o, main, 0.55, r);
    let t = 2.85;
    for (let i = 0; i < 5; i++) { this.voice(o, { ...grunt, peak: 0.75 * (1 - i * 0.14) }, t, r * (1 - i * 0.03)); t += 0.62 + i * 0.12; }
  }

  private voiceFor(id: SpeciesId, kind: CallKind): Voice | null {
    switch (id) {
      case 'trex':
        return {
          pitch: kind === 'snarl' ? [70, 55] : [48, 72, 62, 40], dur: kind === 'snarl' ? 0.8 : 2.6, wave: 'sawtooth',
          formants: [[320, 240, 4, 1.2], [700, 520, 5, 0.8], [1500, 1200, 6, 0.3], [110, 90, 2, 0.8]],
          growl: [22, 0.85], breath: [0.5, 500], jitter: 0.05, sub: 0.9, drive: 4, attack: 0.3, release: 1, peak: 1,
        };
      case 'lion': // snarl / baby (the full roar has its own routine)
        return kind === 'baby'
          ? { pitch: [520, 680, 430], dur: 0.45, wave: 'sawtooth', formants: [[900, 1100, 6, 1], [2200, 2400, 8, 0.5]], growl: [40, 0.3], jitter: 0.05, attack: 0.05, release: 0.2, peak: 0.5 }
          : { pitch: [140, 110], dur: 0.6, wave: 'sawtooth', formants: [[550, 420, 5, 1], [1100, 900, 6, 0.6]], growl: [38, 0.85], breath: [0.5, 1200], jitter: 0.05, sub: 0.3, drive: 3, attack: 0.04, release: 0.3, peak: 0.8 };
      case 'cheetah': // chirps, or a hiss-snarl
        return kind === 'snarl'
          ? { pitch: [220, 160], dur: 0.45, wave: 'sawtooth', formants: [[1500, 1200, 3, 0.8], [3000, 2600, 4, 0.5]], growl: [45, 0.6], breath: [0.9, 2500], attack: 0.02, release: 0.25, peak: 0.6 }
          : { pitch: [1650, 2100, 1500], dur: 0.16, wave: 'triangle', formants: [[1900, 1700, 3, 1.2], [3600, 3200, 5, 0.3]], vibrato: [30, 0.02], attack: 0.01, release: 0.08, peak: 0.45 };
      case 'zebra': // "kwa-ha" barking bray
        return { pitch: [480, 620, 380], dur: 0.32, wave: 'sawtooth', formants: [[900, 700, 6, 1], [1800, 1500, 7, 0.6], [2800, 2600, 9, 0.2]], growl: [55, 0.45], breath: [0.2, 1500], jitter: 0.04, drive: 1.6, attack: 0.03, release: 0.14, peak: 0.55 };
      case 'gazelle':
        return { pitch: [700, 880, 600], dur: 0.25, wave: 'sawtooth', formants: [[1200, 1000, 7, 1], [2600, 2300, 9, 0.4]], breath: [0.6, 1800], attack: 0.02, release: 0.12, peak: 0.4 };
      case 'triceratops': case 'stegosaurus':
        return { pitch: [92, 118, 80], dur: 1.6, wave: 'sawtooth', formants: [[420, 360, 5, 1.1], [880, 760, 6, 0.55], [140, 120, 2, 0.6]], growl: [18, 0.4], breath: [0.25, 600], jitter: 0.03, sub: 0.5, drive: 2, attack: 0.3, release: 0.7, peak: 0.75 };
      case 'brachiosaurus': // deep resonant hoot
        return { pitch: [55, 70, 46], dur: 2.8, wave: 'triangle', formants: [[260, 220, 4, 1.4], [520, 460, 5, 0.5]], vibrato: [3, 0.02], sub: 1, attack: 0.6, release: 1.2, peak: 0.9 };
      case 'parasaurolophus': // trombone-like crest resonance
        return { pitch: [196, 233, 220], dur: 1.4, wave: 'sawtooth', formants: [[700, 760, 12, 1.3], [1400, 1500, 14, 0.7], [350, 380, 8, 0.6]], vibrato: [5, 0.015], jitter: 0.01, attack: 0.25, release: 0.5, peak: 0.6 };
      case 'velociraptor': // shriek + hiss
        return { pitch: [780, 1500, 1100, 700], dur: 0.6, wave: 'sawtooth', formants: [[2400, 2000, 4, 1], [4200, 3600, 6, 0.4], [1100, 900, 5, 0.5]], growl: [70, 0.5], breath: [0.6, 3500], jitter: 0.05, drive: 2.5, attack: 0.03, release: 0.25, peak: 0.55 };
      case 'dolphin':
        return { pitch: [4200, 7600, 5200, 6800], dur: 0.7, wave: 'sine', formants: [[6000, 6000, 0.7, 1]], vibrato: [12, 0.03], attack: 0.03, release: 0.2, peak: 0.35 };
      default:
        return null;
    }
  }

  /** A species call. `vol` 0..1 from distance, `pan` -1..1 from screen position. */
  call(id: SpeciesId, vol: number, pan: number, kind: CallKind = 'call', force = false): void {
    const now = performance.now();
    const key = id + kind;
    const gap = kind === 'roar' ? 5000 : kind === 'baby' ? 300 : 1600;
    if (!force && now - (this.lastCall.get(key) ?? 0) < gap) return;
    this.lastCall.set(key, now);
    const o = this.out(vol, pan, kind === 'baby' ? 0.3 : 1);
    if (!o) return;
    const r = 0.92 + Math.random() * 0.16;

    if (id === 'lion' && kind !== 'snarl' && kind !== 'baby') { this.lionRoar(o, r); return; }
    if (id === 'zebra' && kind !== 'baby') { // 3–4 syllable bray
      const v = this.voiceFor(id, kind)!;
      for (let i = 0; i < 4; i++) this.voice(o, v, i * 0.26, r * (1 - i * 0.05));
      return;
    }
    if (id === 'cheetah' && kind === 'call') { for (let i = 0; i < 3; i++) this.voice(o, this.voiceFor(id, kind)!, i * 0.22, r); return; }
    if (id === 'dolphin') {
      this.voice(o, this.voiceFor(id, kind)!, 0, kind === 'baby' ? 1.2 * r : r);
      for (let i = 0; i < 8; i++) this.hiss(o, 'highpass', 2500, 1, 0.012, 0.5, 0.8 + i * 0.045); // click train
      return;
    }
    const v = this.voiceFor(id, kind);
    if (v) {
      if (kind === 'baby') this.voice(o, { ...v, peak: (v.peak ?? 0.8) * 0.6 }, 0, r * 2.3, 0.35); // small, high, short
      else if (kind === 'snarl') this.voice(o, v, 0, r * 1.15, id === 'trex' ? 1 : 0.5);
      else this.voice(o, v, 0, r);
      return;
    }
    // fish, turtles, rays, sharks: water sounds
    if (id === 'shark') { this.hiss(o, 'lowpass', 600, 1, 0.7, 0.45, 0, 180); return; }
    for (let i = 0; i < 4; i++) this.tone(o, 'sine', 260 * r + i * 70, 950 * r, 0.07, 0.2, i * 0.08);
  }

  sfx(kind: 'bite' | 'hurt' | 'birth' | 'swing', vol: number, pan: number): void {
    const o = this.out(vol, pan, kind === 'birth' ? 0.5 : 0.25);
    if (!o) return;
    switch (kind) {
      case 'bite':
        this.hiss(o, 'lowpass', 2600, 1, 0.1, 0.8, 0, 500);
        this.tone(o, 'sine', 150, 48, 0.2, 0.7);
        this.hiss(o, 'bandpass', 3500, 3, 0.04, 0.35, 0.02); // crunch
        break;
      case 'hurt':
        this.tone(o, 'sine', 95, 38, 0.35, 0.9);
        this.hiss(o, 'lowpass', 900, 1, 0.22, 0.6);
        break;
      case 'swing':
        this.hiss(o, 'bandpass', 500, 1.2, 0.22, 0.4, 0, 2200);
        break;
      case 'birth': // gentle three-note chime
        this.tone(o, 'sine', 784, 784, 0.35, 0.22);
        this.tone(o, 'sine', 988, 988, 0.35, 0.2, 0.12);
        this.tone(o, 'sine', 1319, 1319, 0.5, 0.18, 0.24);
        break;
    }
  }

  // ------------------------------------------------------------------ ambience
  private startAmbient(): void {
    const ctx = this.ctx!;
    for (const n of this.ambient) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* already stopped */ } n.disconnect(); }
    this.ambient = [];
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = this.zone === 'water' ? 240 : this.zone === 'dino' ? 520 : 430;
    const g = ctx.createGain(); g.gain.value = this.zone === 'water' ? 0.16 : 0.06;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = g.gain.value * 0.6;
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(this.master);
    s.start(); lfo.start();
    this.ambient.push(s, lfo, g);
  }

  /** Random birdsong / insects / bubbles. Call every frame. */
  tickAmbient(dt: number): void {
    if (!this.ctx || !this.enabled) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 2 + Math.random() * 4;
    const o = this.out(0.22, Math.random() * 1.6 - 0.8, 0.6);
    if (!o) return;
    if (this.zone === 'water') {
      for (let i = 0; i < 5; i++) this.tone(o, 'sine', 240 + Math.random() * 200, 700 + Math.random() * 500, 0.07, 0.15, i * 0.07);
    } else if (this.zone === 'dino') {
      this.hiss(o, 'bandpass', 4600, 14, 1.6, 0.1);
      if (Math.random() < 0.4) this.tone(o, 'triangle', 900, 1500, 0.25, 0.12, 0.5);
    } else {
      const base = 2400 + Math.random() * 1400;
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) this.tone(o, 'sine', base, base * (1.2 + Math.random() * 0.3), 0.08, 0.1, i * 0.12);
    }
  }

  // ------------------------------------------------------------------ narrator
  say(text: string): void {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    if (speechSynthesis.pending) return; // keep the queue short
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02; u.pitch = 0.95; u.volume = 0.9;
    const voices = speechSynthesis.getVoices();
    const v = voices.find(x => /en(-|_)(GB|US)/i.test(x.lang) && /natural|google|daniel|aria|guy/i.test(x.name)) ?? voices.find(x => x.lang.startsWith('en'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
}
