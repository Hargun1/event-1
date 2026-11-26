import type { Sample } from '../game/systems/PopulationSystem.ts';
import { SPECIES } from '../game/data/species.ts';
import type { SpeciesId } from '../game/data/species.ts';

/** Lightweight canvas line chart of real population history (+ vegetation cover as a shaded band). */
export class PopulationChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private legend: HTMLElement;
  private species: SpeciesId[] = [];

  constructor(canvas: HTMLCanvasElement, legend: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.legend = legend;
  }

  setSpecies(ids: SpeciesId[], foodName: string): void {
    this.species = ids;
    this.legend.innerHTML = ids.map(id => `<span><i style="background:${SPECIES[id].color}"></i>${SPECIES[id].plural}</span>`).join('') +
      `<span><i style="background:#9bc77c"></i>${foodName[0].toUpperCase() + foodName.slice(1)}</span>`;
  }

  draw(history: Sample[]): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const L = 30, R = 8, T = 8, B = 20, pw = w - L - R, ph = h - T - B;
    c.font = '11px system-ui, sans-serif';
    let max = 10;
    for (const s of history) for (const id of this.species) max = Math.max(max, s.counts[id] ?? 0);
    max = Math.ceil(max / 10) * 10;
    const t0 = history.length ? history[0].day : 0;
    const t1 = Math.max(t0 + 1, history.length ? history[history.length - 1].day : 1);
    const X = (t: number) => L + ((t - t0) / (t1 - t0)) * pw;
    const Y = (v: number) => T + ph - (v / max) * ph;
    c.strokeStyle = '#ebe3cf'; c.lineWidth = 1; c.fillStyle = '#7d8a77'; c.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = (max * i) / 4, y = Math.round(Y(v)) + 0.5;
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke();
      c.fillText(String(Math.round(v)), L - 5, y + 4);
    }
    const span = t1 - t0, step = span > 160 ? 40 : span > 80 ? 20 : span > 30 ? 10 : 5;
    for (let d = Math.ceil(t0 / step) * step; d <= t1; d += step) {
      const x = X(d);
      c.textAlign = x > L + pw - 22 ? 'right' : x < L + 22 ? 'left' : 'center';
      c.fillText(`Day ${d}`, x, h - 5);
    }
    if (history.length < 2) { c.textAlign = 'center'; c.fillText('Collecting data…', L + pw / 2, T + ph / 2); return; }
    c.beginPath(); c.moveTo(X(history[0].day), T + ph);
    for (const s of history) c.lineTo(X(s.day), T + ph - s.grass * ph);
    c.lineTo(X(history[history.length - 1].day), T + ph); c.closePath();
    c.fillStyle = 'rgba(111,174,75,.16)'; c.fill();
    c.lineJoin = 'round'; c.lineCap = 'round';
    for (const id of this.species) {
      c.strokeStyle = SPECIES[id].color; c.lineWidth = 2;
      c.beginPath();
      history.forEach((s, i) => { const x = X(s.day), y = Y(s.counts[id] ?? 0); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke();
    }
  }
}
