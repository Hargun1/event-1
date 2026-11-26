import { WORLD } from '../game/config.ts';
import type { Ecosystem } from '../game/systems/Ecosystem.ts';

const ZONE_BG: Record<string, string> = { land: '#7f9a4c', dino: '#56703a', water: '#2f7d94' };

/** Small live map: you (arrow), your young, prey, predators and hostile animals. */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(eco: Ecosystem, cameraYaw: number | null): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = WORLD.play;
    const sx = w / (P.right - P.left), sy = h / (P.bottom - P.top);
    const X = (x: number) => (x - P.left) * sx, Y = (y: number) => (y - P.top) * sy;

    c.fillStyle = ZONE_BG[eco.zone.id] ?? '#6a8a4a';
    c.fillRect(0, 0, w, h);
    // vegetation density as soft shading
    const g = eco.grass, cell = WORLD.cell;
    for (let i = 0; i < g.density.length; i++) {
      if (!g.usable[i]) continue;
      const d = g.density[i];
      c.fillStyle = d < 0.3 ? `rgba(200,170,110,${0.55 - d})` : `rgba(40,90,30,${(d - 0.3) * 0.45})`;
      c.fillRect(X((i % g.gw) * cell), Y(Math.floor(i / g.gw) * cell), cell * sx + 0.5, cell * sy + 0.5);
    }
    const t = eco.terrain;
    if (t.lake) { c.fillStyle = '#3f8fb8'; c.beginPath(); c.ellipse(X(t.lake.x), Y(t.lake.y), t.lake.rx * sx, t.lake.ry * sy, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = 'rgba(20,50,25,.55)';
    for (const cv of eco.covers) { c.beginPath(); c.arc(X(cv.x), Y(cv.y), 2, 0, Math.PI * 2); c.fill(); }

    for (const a of eco.animals) {
      if (!a.alive || a.isPlayer) continue;
      const x = X(a.x), y = Y(a.y);
      if (a.kin) c.fillStyle = '#7fd0ff';
      else if (a.aggro > 0) c.fillStyle = '#ff4b3a';
      else c.fillStyle = a.species.trophic === 'predator' ? '#e2843a' : '#f3ecd2';
      const r = a.species.trophic === 'predator' || a.aggro > 0 ? 2.6 : 1.8;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    const p = eco.player;
    if (p && p.alive) {
      c.save();
      c.translate(X(p.x), Y(p.y)); c.rotate(p.heading);
      c.fillStyle = '#fff'; c.strokeStyle = '#1f3d2b'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(7, 0); c.lineTo(-5, 4.5); c.lineTo(-2, 0); c.lineTo(-5, -4.5); c.closePath(); c.fill(); c.stroke();
      c.restore();
      if (cameraYaw !== null) {
        // view cone
        const ang = Math.atan2(-Math.cos(cameraYaw), -Math.sin(cameraYaw));
        c.fillStyle = 'rgba(255,255,255,.12)';
        c.beginPath(); c.moveTo(X(p.x), Y(p.y)); c.arc(X(p.x), Y(p.y), 40, ang - 0.6, ang + 0.6); c.closePath(); c.fill();
      }
    }
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, h - 1);
  }
}
