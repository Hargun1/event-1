import { RANGES, defaultSettings } from './config.ts';
import type { SimSettings } from './config.ts';
import { Ecosystem } from './systems/Ecosystem.ts';
import type { Animal } from './entities/Animal.ts';
import type { SpeciesId, ZoneId } from './data/species.ts';
import { safeNumber } from './utils/math.ts';

export type Speed = 1 | 2 | 4;
export type Mode = 'menu' | 'play' | 'watch';
type Listener = () => void;

/** Shared state between the 3D view and the HTML UI. */
export class GameController {
  eco: Ecosystem;
  mode: Mode = 'menu';
  running = true;
  speed: Speed = 1;
  selectedId: number | null = null;
  /** Settings edited in the UI per zone (populations apply on reset). */
  private settings = new Map<ZoneId, SimSettings>();
  private listeners = new Set<Listener>();
  private resetListeners = new Set<Listener>();
  private zoneListeners = new Set<Listener>();

  constructor() {
    this.eco = new Ecosystem(this.pendingFor('land'));
  }

  get zone(): ZoneId { return this.eco.settings.zone; }
  get pending(): SimSettings { return this.pendingFor(this.zone); }

  private pendingFor(zone: ZoneId): SimSettings {
    let s = this.settings.get(zone);
    if (!s) { s = defaultSettings(zone); this.settings.set(zone, s); }
    return s;
  }

  onChange(fn: Listener): void { this.listeners.add(fn); }
  onReset(fn: Listener): void { this.resetListeners.add(fn); }
  onZone(fn: Listener): void { this.zoneListeners.add(fn); }
  notify(): void { for (const fn of this.listeners) fn(); }

  /** Start a zone in play or watch mode (fresh ecosystem). */
  enterZone(zone: ZoneId, mode: Exclude<Mode, 'menu'>): void {
    this.mode = mode;
    this.selectedId = null;
    this.speed = 1;
    this.running = true;
    this.eco = new Ecosystem(this.pendingFor(zone));
    this.eco.reset(undefined, true);
    this.pendingFor(zone).seed = this.eco.settings.seed;
    if (mode === 'play') this.eco.spawnPlayer();
    for (const fn of this.zoneListeners) fn();
    for (const fn of this.resetListeners) fn();
    this.notify();
  }

  toMenu(): void { this.mode = 'menu'; this.selectedId = null; this.notify(); }

  setMode(mode: Exclude<Mode, 'menu'>): void {
    this.mode = mode;
    if (mode === 'play') { this.speed = 1; if (!this.eco.player || !this.eco.player.alive) this.eco.spawnPlayer(); }
    else this.eco.removePlayer();
    this.selectedId = null;
    this.notify();
  }

  respawn(): void {
    this.eco.spawnPlayer();
    this.running = true;
    this.notify();
  }

  setRunning(r: boolean): void { this.running = r; this.notify(); }
  setSpeed(s: Speed): void { this.speed = this.mode === 'play' ? 1 : s; this.notify(); }

  setPopulation(id: SpeciesId, raw: unknown): void {
    const r = RANGES.population;
    this.pending.populations[id] = Math.round(safeNumber(raw, this.pending.populations[id] ?? 0, r.min, r.max));
  }

  setSetting(key: 'grassGrowth' | 'reproduction' | 'initialGrass' | 'seed', raw: unknown): void {
    const r = RANGES[key];
    let v = safeNumber(raw, this.pending[key], r.min, r.max);
    if (r.step >= 1) v = Math.round(v);
    this.pending[key] = v;
    if (key === 'grassGrowth' || key === 'reproduction') this.eco.updateLive({ [key]: v });
  }

  setRandomSeed(on: boolean): void { this.pending.randomizeSeed = on; }

  reset(): void {
    this.selectedId = null;
    this.eco.reset({ ...this.pending, populations: { ...this.pending.populations } }, true);
    this.pending.seed = this.eco.settings.seed;
    if (this.mode === 'play') this.eco.spawnPlayer();
    for (const fn of this.resetListeners) fn();
    this.notify();
  }

  select(id: number | null): void { this.selectedId = id; this.notify(); }

  selected(): Animal | null {
    if (this.selectedId === null) return null;
    return this.eco.animals.find(a => a.id === this.selectedId) ?? null;
  }
}
