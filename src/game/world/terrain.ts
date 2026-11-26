import { SIM, WORLD } from '../config.ts';
import { createRng } from '../utils/random.ts';
import { clamp } from '../utils/math.ts';
import type { ZoneId } from '../data/species.ts';
import { ZONES } from '../data/zones.ts';
import type { PropKind } from '../data/zones.ts';

export interface Ellipse { x: number; y: number; rx: number; ry: number }
export interface Hill extends Ellipse { height: number }
export interface Prop { kind: PropKind; x: number; y: number; scale: number; rot: number }
export interface Point { x: number; y: number }
export interface Cover { x: number; y: number; r: number; occ: number }

export interface Terrain {
  zone: ZoneId;
  lake: Ellipse | null;
  stream: Point[];
  hills: Hill[];
  props: Prop[];
  fertility(x: number, y: number): number;
  /** Ground height in metres at a sim position (visual only). */
  height(x: number, y: number): number;
}

const P = WORLD.play;
const COVER_RADIUS: Partial<Record<PropKind, number>> = { bush: 18, tree: 22, cycad: 24, fern: 18, coral: 26, kelp: 16 };

export function inEllipse(e: Ellipse, x: number, y: number, pad = 0): boolean {
  const dx = (x - e.x) / (e.rx + pad), dy = (y - e.y) / (e.ry + pad);
  return dx * dx + dy * dy < 1;
}

function distToPolyline(pts: Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b.x - a.x, vy = b.y - a.y;
    const t = clamp(((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy), 0, 1);
    best = Math.min(best, Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t)));
  }
  return best;
}

const cache = new Map<ZoneId, Terrain>();

/** Terrain is fixed per zone (seeded) so scenery is stable between resets. */
export function getTerrain(zone: ZoneId): Terrain {
  const hit = cache.get(zone);
  if (hit) return hit;
  const z = ZONES[zone];
  const rng = createRng(z.terrainSeed);
  const lake: Ellipse | null = z.lake ? (zone === 'dino' ? { x: 380, y: 420, rx: 150, ry: 80 } : { x: 880, y: 300, rx: 118, ry: 62 }) : null;

  const stream: Point[] = [];
  if (z.stream && lake) {
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      stream.push({ x: lake.x - 40 + Math.sin(t * 5.2) * 46 - t * 120, y: lake.y + lake.ry - 6 + t * (P.bottom + 20 - lake.y - lake.ry) });
    }
  }

  const hills: Hill[] = [];
  for (let i = 0; i < 5; i++) {
    hills.push({ x: rng.range(P.left + 120, P.right - 120), y: rng.range(P.top + 90, P.bottom - 90), rx: rng.range(110, 190), ry: rng.range(70, 120), height: rng.range(0.5, 1) });
  }

  const fertility = (x: number, y: number): number => {
    let f = 0.8 + Math.sin(x * 0.011 + z.terrainSeed) * Math.cos(y * 0.013 + 0.4) * 0.18;
    if (lake) f += clamp(1 - Math.hypot((x - lake.x) / 1.6, y - lake.y) / 260, 0, 1) * 0.45;
    if (stream.length) f += clamp(1 - distToPolyline(stream, x, y) / 90, 0, 1) * 0.3;
    for (const h of hills) {
      const dx = (x - h.x) / h.rx, dy = (y - h.y) / h.ry, d = dx * dx + dy * dy;
      if (d < 1) f -= (1 - d) * 0.25 * h.height;
    }
    return clamp(f, 0.3, 1.4);
  };

  const hillAmp = zone === 'water' ? 1.6 : 2.4;
  const height = (x: number, y: number): number => {
    let h = 0;
    for (const hl of hills) {
      const dx = (x - hl.x) / hl.rx, dy = (y - hl.y) / hl.ry;
      h += Math.exp(-(dx * dx + dy * dy) * 2.2) * hl.height * hillAmp;
    }
    if (lake) {
      const dx = (x - lake.x) / (lake.rx + 30), dy = (y - lake.y) / (lake.ry + 24), d = dx * dx + dy * dy;
      if (d < 1) h *= d; // flatten toward the shore
    }
    return h;
  };

  const props: Prop[] = [];
  const free = (x: number, y: number, r: number): boolean =>
    !(lake && inEllipse(lake, x, y, r + 18)) && (!stream.length || distToPolyline(stream, x, y) > r + 14) &&
    props.every(p => Math.hypot(p.x - x, p.y - y) > r + 24 * p.scale);
  const SIZE: Record<PropKind, number> = { acacia: 34, tree: 26, bush: 16, rock: 12, cycad: 24, fern: 14, coral: 30, kelp: 10 };
  for (const [kind, n] of Object.entries(z.props) as [PropKind, number][]) {
    let left = n, tries = 0;
    while (left > 0 && tries++ < 800) {
      const x = rng.range(P.left + 30, P.right - 30), y = rng.range(P.top + 30, P.bottom - 24);
      if (!free(x, y, SIZE[kind])) continue;
      props.push({ kind, x, y, scale: rng.range(0.8, 1.2), rot: rng.range(0, Math.PI * 2) });
      left--;
    }
  }

  const t: Terrain = { zone, lake, stream, hills, props, fertility, height };
  cache.set(zone, t);
  return t;
}

export function buildCovers(t: Terrain): Cover[] {
  const kinds = ZONES[t.zone].cover;
  return t.props.filter(p => kinds.includes(p.kind)).map(p => ({ x: p.x, y: p.y, r: (COVER_RADIUS[p.kind] ?? 18) * p.scale, occ: 0 }));
}

export function isWater(t: Terrain, x: number, y: number): boolean {
  return !!t.lake && inEllipse(t.lake, x, y);
}

export const COVER_CAPACITY = SIM.coverCapacity;
