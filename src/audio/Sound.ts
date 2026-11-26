import type { SpeciesId, ZoneId } from '../game/data/species.ts';

/**
 * All sound is synthesised live with the Web Audio API (no audio files):
 * species voices, combat SFX, a per-zone ambience and a spoken narrator (speechSynthesis).
 */
export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private ambient: AudioNode[] = [];
  private ambientTimer = 0;
  private zone: ZoneId = 'land';
  private lastCall = new Map<string, number>();

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbient();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
    if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  setZone(zone: ZoneId): void {
    this.zone = zone;
    if (this.ctx) this.startAmbient();
  }

  // ------------------------------------------------------------------ building blocks
  private out(vol: number, pan: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || vol <= 0.01) return null;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master);
    return g;
  }

  private env(g: AudioParam, t: number, attack: number, hold: number, release: number, peak = 1): void {
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0, vibrato = 0): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = vibrato; lg.gain.value = f0 * 0.06;
      lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    this.env(g.gain, t, Math.min(0.12, dur * 0.2), dur * 0.35, dur * 0.5, peak);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.1);
  }

  private hiss(dest: AudioNode, filter: BiquadFilterType, freq: number, q: number, dur: number, peak: number, delay = 0, sweepTo?: number): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, Math.min(0.08, dur * 0.2), dur * 0.3, dur * 0.5, peak);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }

  // ------------------------------------------------------------------ voices
  /** A species' call. `vol` 0..1 from distance, `pan` -1..1 from screen position. */
  call(id: SpeciesId, vol: number, pan: number, force = false): void {
    const now = performance.now();
    if (!force && now - (this.lastCall.get(id) ?? 0) < 1500) return;
    this.lastCall.set(id, now);
    const o = this.out(vol, pan);
    if (!o) return;
    const r = 0.9 + Math.random() * 0.2; // natural pitch variation
    switch (id) {
      case 'trex':
        this.tone(o, 'sawtooth', 75 * r, 42 * r, 1.8, 0.55, 0, 7);
        this.tone(o, 'square', 52 * r, 34 * r, 1.8, 0.25, 0.05);
        this.hiss(o, 'lowpass', 900, 1, 1.6, 0.5, 0, 250);
        break;
      case 'lion':
        this.tone(o, 'sawtooth', 110 * r, 62 * r, 1.3, 0.45, 0, 9);
        this.hiss(o, 'lowpass', 1200, 1, 1.1, 0.35, 0, 300);
        break;
      case 'velociraptor':
        this.tone(o, 'sawtooth', 900 * r, 1600 * r, 0.25, 0.25);
        this.tone(o, 'sawtooth', 1600 * r, 700 * r, 0.35, 0.22, 0.22);
        break;
      case 'triceratops': case 'stegosaurus':
        this.tone(o, 'triangle', 120 * r, 80 * r, 1.3, 0.5, 0, 5);
        this.tone(o, 'sawtooth', 60 * r, 45 * r, 1.2, 0.15);
        break;
      case 'brachiosaurus':
        this.tone(o, 'triangle', 70 * r, 48 * r, 2.2, 0.6, 0, 3);
        this.tone(o, 'sine', 140 * r, 96 * r, 2.0, 0.2);
        break;
      case 'parasaurolophus': // trumpet-like crest call
        this.tone(o, 'square', 233 * r, 220 * r, 1.1, 0.16, 0, 4);
        this.tone(o, 'sawtooth', 349 * r, 330 * r, 1.1, 0.1, 0.02, 4);
        break;
      case 'zebra': // barking whinny
        for (let i = 0; i < 3; i++) this.tone(o, 'sawtooth', 620 * r, 420 * r, 0.22, 0.14, i * 0.2, 16);
        break;
      case 'gazelle':
        this.hiss(o, 'bandpass', 1400, 2, 0.18, 0.4);
        break;
      case 'cheetah':
        this.tone(o, 'sine', 1900 * r, 1500 * r, 0.12, 0.25);
        this.tone(o, 'sine', 1900 * r, 1450 * r, 0.12, 0.22, 0.18);
        break;
      case 'dolphin':
        this.tone(o, 'sine', 4200 * r, 7200 * r, 0.35, 0.12);
        this.tone(o, 'sine', 7200 * r, 5000 * r, 0.3, 0.1, 0.33);
        for (let i = 0; i < 5; i++) this.hiss(o, 'highpass', 3000, 1, 0.02, 0.3, 0.7 + i * 0.05);
        break;
      case 'shark':
        this.hiss(o, 'lowpass', 500, 1, 0.6, 0.35, 0, 200); // water swoosh
        break;
      default: // fish, turtle, manta: bubbles
        for (let i = 0; i < 3; i++) this.tone(o, 'sine', 300 * r + i * 80, 900 * r, 0.08, 0.18, i * 0.09);
    }
  }

  sfx(kind: 'bite' | 'hurt' | 'birth' | 'swing', vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    switch (kind) {
      case 'bite':
        this.hiss(o, 'lowpass', 2200, 1, 0.12, 0.7, 0, 400);
        this.tone(o, 'sine', 140, 50, 0.18, 0.6);
        break;
      case 'hurt':
        this.tone(o, 'sine', 90, 40, 0.3, 0.8);
        this.hiss(o, 'lowpass', 800, 1, 0.2, 0.5);
        break;
      case 'swing':
        this.hiss(o, 'bandpass', 600, 1.5, 0.18, 0.35, 0, 1800);
        break;
      case 'birth':
        this.tone(o, 'sine', 880, 880, 0.25, 0.2);
        this.tone(o, 'sine', 1320, 1320, 0.35, 0.15, 0.12);
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
    f.frequency.value = this.zone === 'water' ? 260 : this.zone === 'dino' ? 500 : 420;
    const g = ctx.createGain(); g.gain.value = this.zone === 'water' ? 0.16 : 0.07;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.08; lg.gain.value = g.gain.value * 0.6;
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
    const o = this.out(0.25, Math.random() * 1.6 - 0.8);
    if (!o) return;
    if (this.zone === 'water') {
      for (let i = 0; i < 4; i++) this.tone(o, 'sine', 250 + Math.random() * 200, 700 + Math.random() * 400, 0.07, 0.15, i * 0.07);
    } else if (this.zone === 'dino') {
      this.hiss(o, 'bandpass', 4500, 12, 1.4, 0.12); // insect drone
      if (Math.random() < 0.4) this.tone(o, 'sine', 1200, 2400, 0.15, 0.12, 0.4);
    } else {
      const base = 2400 + Math.random() * 1200;
      for (let i = 0; i < 3; i++) this.tone(o, 'sine', base, base * 1.35, 0.09, 0.12, i * 0.13);
    }
  }

  // ------------------------------------------------------------------ narrator
  say(text: string): void {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    if (speechSynthesis.pending || speechSynthesis.speaking) {
      if (speechSynthesis.pending) return; // keep the queue short
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02; u.pitch = 0.95; u.volume = 0.9;
    const v = speechSynthesis.getVoices().find(x => /en(-|_)(GB|US)/i.test(x.lang) && /natural|google|daniel|aria|guy/i.test(x.name))
      ?? speechSynthesis.getVoices().find(x => x.lang.startsWith('en'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
}
