import { GRID_H, GRID_W, SIM, WORLD } from '../config.ts';
import { inEllipse } from '../world/terrain.ts';
import type { Terrain } from '../world/terrain.ts';
import { clamp } from '../utils/math.ts';
import type { Rng } from '../utils/random.ts';

/** Grid of grass patches; each cell has its own vegetation level (0..1) and fertility. */
export class GrassField {
  readonly gw = GRID_W;
  readonly gh = GRID_H;
  readonly density = new Float32Array(GRID_W * GRID_H);
  readonly fertility = new Float32Array(GRID_W * GRID_H);
  readonly usable = new Uint8Array(GRID_W * GRID_H);
  private usableCount = 0;

  constructor(terrain: Terrain) {
    const c = WORLD.cell, P = WORLD.play;
    for (let y = 0; y < this.gh; y++) for (let x = 0; x < this.gw; x++) {
      const i = y * this.gw + x, wx = x * c + c / 2, wy = y * c + c / 2;
      const inside = wx > P.left && wx < P.right && wy > P.top && wy < P.bottom && !(terrain.lake && inEllipse(terrain.lake, wx, wy, 6));
      this.usable[i] = inside ? 1 : 0;
      this.fertility[i] = inside ? terrain.fertility(wx, wy) : 0;
      if (inside) this.usableCount++;
    }
  }

  reset(rng: Rng, initial: number): void {
    for (let i = 0; i < this.density.length; i++) {
      this.density[i] = this.usable[i] ? clamp(initial * (0.55 + 0.45 * this.fertility[i]) + rng.range(-0.12, 0.12), 0.05, 1) : 0;
    }
  }

  grow(dt: number, mult: number): void {
    const k = SIM.grassGrowth * mult * dt, d = this.density, f = this.fertility;
    for (let i = 0; i < d.length; i++) {
      if (!this.usable[i]) continue;
      const g = d[i];
      // logistic regrowth with a seed term so bare cells slowly recover
      d[i] = Math.min(1, g + k * f[i] * (0.12 + g) * (1 - g));
    }
  }

  indexAt(x: number, y: number): number {
    const c = WORLD.cell;
    return clamp(Math.floor(y / c), 0, this.gh - 1) * this.gw + clamp(Math.floor(x / c), 0, this.gw - 1);
  }

  at(x: number, y: number): number {
    return this.density[this.indexAt(x, y)];
  }

  /** Remove up to `amount` vegetation at (x,y); returns how much was eaten. */
  eat(x: number, y: number, amount: number): number {
    const i = this.indexAt(x, y);
    const avail = this.density[i] - SIM.grassFloor;
    if (avail <= 0) return 0;
    const e = Math.min(avail, amount);
    this.density[i] -= e;
    return e;
  }

  /** Best nearby cell centre, scored by density / distance. */
  findNear(x: number, y: number, radiusCells: number, minDensity: number, rng: Rng): { x: number; y: number } | null {
    const c = WORLD.cell, cx = Math.floor(x / c), cy = Math.floor(y / c);
    let best = -1, bestScore = 0;
    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= this.gh) continue;
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= this.gw) continue;
        const i = yy * this.gw + xx, g = this.density[i];
        if (!this.usable[i] || g < minDensity) continue;
        const s = g / (1 + 0.4 * Math.hypot(dx, dy)) + rng.next() * 0.05;
        if (s > bestScore) { bestScore = s; best = i; }
      }
    }
    if (best < 0) return null;
    return { x: (best % this.gw) * c + c / 2 + rng.range(-8, 8), y: Math.floor(best / this.gw) * c + c / 2 + rng.range(-8, 8) };
  }

  /** Sample distant cells — used when nothing is found nearby (migration). */
  findFar(x: number, y: number, rng: Rng): { x: number; y: number } | null {
    const c = WORLD.cell;
    let best = -1, bestScore = 0;
    for (let k = 0; k < 28; k++) {
      const i = rng.int(0, this.density.length), g = this.density[i];
      if (!this.usable[i] || g < 0.35) continue;
      const d = Math.hypot((i % this.gw) * c - x, Math.floor(i / this.gw) * c - y);
      const s = g / (1 + d / 400);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best < 0) return null;
    return { x: (best % this.gw) * c + c / 2, y: Math.floor(best / this.gw) * c + c / 2 };
  }

  mean(): number {
    let s = 0;
    for (let i = 0; i < this.density.length; i++) if (this.usable[i]) s += this.density[i];
    return s / this.usableCount;
  }
}
