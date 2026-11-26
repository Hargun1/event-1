import { PLAYER, SIM, WORLD, defaultSettings } from '../config.ts';
import type { SimSettings } from '../config.ts';
import type { Animal } from '../entities/Animal.ts';
import { createAnimal } from '../entities/Animal.ts';
import { GrassField } from '../entities/GrassPatch.ts';
import { updateHerbivore } from '../entities/Herbivore.ts';
import { updatePredator } from '../entities/Predator.ts';
import { createInput, updatePlayer } from '../entities/Player.ts';
import type { PlayerInput } from '../entities/Player.ts';
import { BABY_NAME, SPECIES } from '../data/species.ts';
import type { SpeciesId, ZoneId } from '../data/species.ts';
import { ZONES } from '../data/zones.ts';
import type { ZoneDef } from '../data/zones.ts';
import { createRng, randomSeed } from '../utils/random.ts';
import type { Rng } from '../utils/random.ts';
import { buildCovers, getTerrain, isWater } from '../world/terrain.ts';
import type { Cover, Terrain } from '../world/terrain.ts';
import { moveAnimal } from './MovementSystem.ts';
import { updateLifecycle } from './LifecycleSystem.ts';
import { breedCriteria, giveBirth, tryReproduce } from './ReproductionSystem.ts';
import type { Criterion } from './ReproductionSystem.ts';
import { SpatialGrid } from './SpatialGrid.ts';
import { Progress } from './Progression.ts';
import { emptyDay, evaluateStatus, extinctionReason, get, inc } from './PopulationSystem.ts';
import type { Counts, DayRecord, EcoStatus, Sample } from './PopulationSystem.ts';

export type EventKind = 'birth' | 'hunt' | 'death' | 'grass' | 'extinct' | 'info' | 'warn' | 'player';
export interface EcoEvent { id: number; day: number; kind: EventKind; text: string }
export type FxEvent =
  | { type: 'kill'; preyId: number; predatorId: number; x: number; y: number }
  | { type: 'death'; id: number; cause: 'starvation' | 'old age' }
  | { type: 'birth'; id: number; parentId: number; x: number; y: number }
  | { type: 'hit'; id: number; x: number; y: number; amount: number; onPlayer: boolean }
  | { type: 'levelup'; level: number }
  | { type: 'hearts'; id: number }
  | { type: 'mission'; title: string };

export interface PlayerStats { kills: number; cubs: number; damage: number; spawnTime: number; deathTime: number | null; killedBy: string | null }

const P = WORLD.play;

/** The whole simulation for one zone. No rendering / DOM code in here. */
export class Ecosystem {
  settings: SimSettings;
  zone: ZoneDef;
  terrain: Terrain;
  grass: GrassField;
  covers: Cover[];
  readonly grid = new SpatialGrid<Animal>(WORLD.width, WORLD.height, 64);
  animals: Animal[] = [];
  rng: Rng = createRng(1);
  time = 0;
  day = 0;
  events: EcoEvent[] = [];
  fx: FxEvent[] = [];
  history: Sample[] = [];
  status: EcoStatus = 'Thriving';
  statusReason = '';
  extinct = new Set<SpeciesId>();
  preyShare: Record<string, number> = {};

  /** Player-controlled animal (null in watch mode or after death). */
  player: Animal | null = null;
  input: PlayerInput = createInput();
  playerStats: PlayerStats = { kills: 0, cubs: 0, damage: 0, spawnTime: 0, deathTime: null, killedBy: null };
  playerInvuln = 0;
  private familyGiven = false;
  private breedLock = 0;
  readonly progress = new Progress();
  /** Length of a full day/night cycle in sim days. */
  static readonly CYCLE_DAYS = 5;

  private newborns: Animal[] = [];
  private today: DayRecord = emptyDay();
  private records: DayRecord[] = [];
  private throttle = new Map<string, number>();
  private flagDay = new Map<string, number>();
  private eventId = 0;
  private lastSample = -1;
  private living = 0;

  constructor(settings: SimSettings) {
    this.settings = { ...settings, populations: { ...settings.populations } };
    this.zone = ZONES[settings.zone];
    this.terrain = getTerrain(settings.zone);
    this.grass = new GrassField(this.terrain);
    this.covers = buildCovers(this.terrain);
    this.reset();
  }

  static forZone(zone: ZoneId): Ecosystem {
    return new Ecosystem(defaultSettings(zone));
  }

  get species(): SpeciesId[] { return this.zone.species; }

  /** Restart the zone. `patch` may change populations / environment; the zone itself is fixed per instance. */
  reset(patch?: Partial<SimSettings>, newSeed = false): void {
    if (patch) this.settings = { ...this.settings, ...patch, zone: this.settings.zone, populations: { ...(patch.populations ?? this.settings.populations) } };
    if (newSeed && this.settings.randomizeSeed) this.settings.seed = randomSeed();
    this.rng = createRng(this.settings.seed);
    this.time = 0; this.day = 0; this.animals = []; this.newborns = [];
    this.events = []; this.fx = []; this.history = []; this.records = [];
    this.today = emptyDay(); this.throttle.clear(); this.flagDay.clear(); this.extinct.clear();
    this.lastSample = -1; this.player = null;
    this.progress.reset();
    this.familyGiven = false;
    this.breedLock = 0;
    this.playerStats = { kills: 0, cubs: 0, damage: 0, spawnTime: 0, deathTime: null, killedBy: null };
    this.grass.reset(this.rng, this.settings.initialGrass);
    for (const id of this.species) {
      const n = Math.max(0, Math.round(this.settings.populations[id] ?? 0));
      const s = SPECIES[id];
      const groups = s.herd > 0.5 ? 3 : s.trophic === 'predator' ? n : 5;
      const centres = Array.from({ length: Math.max(1, groups) }, () => this.randomLand());
      for (let i = 0; i < n; i++) {
        const c = centres[i % centres.length];
        const spread = s.trophic === 'predator' ? 0 : 60;
        let x = c.x + this.rng.range(-spread, spread), y = c.y + this.rng.range(-spread * 0.6, spread * 0.6);
        if (isWater(this.terrain, x, y) || x < P.left + 10 || x > P.right - 10 || y < P.top + 10 || y > P.bottom - 10) ({ x, y } = this.randomLand());
        this.animals.push(createAnimal(s, x, y, this.rng, true));
      }
    }
    this.living = this.animals.length;
    const c = this.counts();
    for (const id of this.species) if (get(c, id) === 0) this.extinct.add(id);
    this.status = 'Thriving';
    this.statusReason = `A fresh ${this.zone.name}. Watch how it unfolds.`;
    this.emit('info', `Day 0 — ${this.species.map(id => `${get(c, id)} ${SPECIES[id].plural.toLowerCase()}`).join(', ')} (seed ${this.settings.seed}).`);
    this.sample();
  }

  randomLand(): { x: number; y: number } {
    for (let i = 0; i < 50; i++) {
      const x = this.rng.range(P.left + 40, P.right - 40), y = this.rng.range(P.top + 40, P.bottom - 40);
      if (!isWater(this.terrain, x, y)) return { x, y };
    }
    return { x: P.left + 80, y: P.bottom - 80 };
  }

  /** Spawn (or respawn) the player-controlled animal. */
  spawnPlayer(): Animal {
    if (this.player && this.player.alive) return this.player;
    const s = SPECIES[this.zone.player];
    const { x, y } = this.randomLand();
    const p = createAnimal(s, x, y, this.rng, true);
    p.isPlayer = true;
    p.age = s.matureDays * SIM.daySeconds + 1;
    p.lifespan = Infinity;
    p.maxHealth = s.maxHealth * PLAYER.healthMult * this.progress.healthMult;
    p.health = p.maxHealth;
    p.energy = s.maxEnergy * 0.85;
    p.breedCooldown = s.breedCooldown * 0.5;
    this.player = p;
    this.animals.push(p);
    // your family: a mate that follows you, plus two young on your first spawn in this zone
    const old = this.animals.find(a => a.alive && a.kin && a.mate && !a.mate.alive && a.species === s);
    if (old) { old.mate = p; p.mate = old; old.x = p.x + 14; old.y = p.y + 8; }
    else {
      const m = createAnimal(s, Math.min(WORLD.play.right - 8, p.x + 16), p.y + 8, this.rng, true);
      m.kin = true; m.mate = p; p.mate = m;
      m.energy = s.maxEnergy * 0.8; m.maxHealth = s.maxHealth * 1.4; m.health = m.maxHealth;
      m.breedCooldown = Infinity; // only breeds with you
      this.animals.push(m);
    }
    if (!this.familyGiven) {
      this.familyGiven = true;
      for (let i = 0; i < 2; i++) {
        const y = createAnimal(s, p.x - 10 + i * 20, p.y - 14, this.rng, false);
        y.kin = true; y.parent = p; y.age = s.matureDays * SIM.daySeconds * 0.35; y.energy = s.maxEnergy * 0.7;
        this.animals.push(y);
      }
    }
    this.living = this.animals.length;
    this.playerInvuln = PLAYER.respawnInvuln;
    this.playerStats = { kills: 0, cubs: 0, damage: 0, spawnTime: this.time, deathTime: null, killedBy: null };
    this.emit('player', `You enter ${this.zone.name} as a ${s.name} with your family. Hunt to feed them, and breed with your mate (B)!`);
    return p;
  }

  /** Reproduction checklist for any animal (inspector / HUD). */
  criteria(a: Animal): Criterion[] { return breedCriteria(a, this); }

  /** Player breeds instantly on B; the baby is on the player's side. */
  playerBreed(): boolean {
    const p = this.player;
    if (!p || !p.alive || this.time < this.breedLock) return false;
    if (this.livingCount() >= SIM.maxAnimals) {
      this.emit('player', 'The zone is full — no room for more babies right now.', 'breed-full', 3);
      return false;
    }
    this.breedLock = this.time + 0.8; // stops a held key spawning dozens at once
    // no mate? win over a calm adult of your species standing close by
    if (!p.mate || !p.mate.alive) {
      let best: Animal | null = null, bd = 70;
      for (const a of this.animals) {
        if (!a.alive || a.isPlayer || a.species !== p.species || a.aggro > 0 || a.age < a.species.matureDays * SIM.daySeconds || (a.mate && a.mate.alive)) continue;
        const d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d < bd) { bd = d; best = a; }
      }
      if (best) {
        best.kin = true; best.mate = p; p.mate = best; best.aggro = 0; best.breedCooldown = Infinity; best.target = null;
        this.fx.push({ type: 'hearts', id: best.id }); this.fx.push({ type: 'hearts', id: p.id });
        this.emit('player', `A ${p.species.name.toLowerCase()} has become your mate!`);
      }
    }
    // no requirements and no cost: the baby arrives right away
    const energy = p.energy;
    const baby = giveBirth(p, this);
    p.energy = energy;
    p.breedCooldown = 0;
    p.behaviourHold = 0;
    this.newborns.push(baby);
    inc(this.today.births, p.species.id);
    this.playerStats.cubs++;
    this.progress.cubs++;
    this.progress.addXp(this, 40);
    this.fx.push({ type: 'birth', id: baby.id, parentId: p.id, x: baby.x, y: baby.y });
    if (p.mate && p.mate.alive) this.fx.push({ type: 'hearts', id: p.mate.id });
    this.emit('player', `Your ${p.species.name} ${BABY_NAME[p.species.id]} was born! It follows you and shares your kills.`);
    return true;
  }

  /** Live "release" control: drop extra adults of one species into the running zone. */
  release(id: SpeciesId, n: number): number {
    const s = SPECIES[id];
    if (!this.species.includes(id)) return 0;
    const room = Math.max(0, SIM.maxAnimals - this.livingCount());
    const count = Math.min(Math.max(0, Math.round(n)), room);
    const c = this.randomLand();
    for (let i = 0; i < count; i++) {
      let x = c.x + this.rng.range(-50, 50), y = c.y + this.rng.range(-30, 30);
      if (isWater(this.terrain, x, y) || x < P.left + 10 || x > P.right - 10 || y < P.top + 10 || y > P.bottom - 10) ({ x, y } = this.randomLand());
      const a = createAnimal(s, x, y, this.rng, true);
      a.energy = s.maxEnergy * 0.75;
      this.newborns.push(a);
    }
    if (count) { this.extinct.delete(id); this.emit('info', `Ranger released ${count} ${count === 1 ? s.name.toLowerCase() : s.plural.toLowerCase()}.`); }
    return count;
  }

  removePlayer(): void {
    if (this.player) { this.player.alive = false; this.animals = this.animals.filter(a => a !== this.player); }
    this.player = null;
  }

  /** 0..1 position in the day/night cycle (0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight). */
  dayPhase(): number {
    return (this.time / (SIM.daySeconds * Ecosystem.CYCLE_DAYS) + 0.05) % 1;
  }

  /** 0 at full day … 1 at deep night. */
  darkness(): number {
    const ph = this.dayPhase();
    const sun = Math.sin(ph * Math.PI * 2); // >0 day, <0 night
    return Math.min(1, Math.max(0, (0.15 - sun) / 0.55));
  }

  livingCount(): number { return this.living + this.newborns.length; }

  updateLive(patch: Partial<Pick<SimSettings, 'grassGrowth' | 'reproduction'>>): void {
    Object.assign(this.settings, patch);
  }

  emit(kind: EventKind, text: string, key?: string, perDay = Infinity): void {
    if (key) {
      const k = `${key}@${this.day}`;
      const n = (this.throttle.get(k) ?? 0) + 1;
      this.throttle.set(k, n);
      if (n > perDay) return;
    }
    this.events.push({ id: ++this.eventId, day: this.day, kind, text });
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  onKill(pred: Animal, prey: Animal): void {
    inc(this.today.hunted, prey.species.id);
    this.feedYoung(pred, prey);
    this.fx.push({ type: 'kill', preyId: prey.id, predatorId: pred.id, x: prey.x, y: prey.y });
    this.emit('hunt', `A ${pred.species.name.toLowerCase()} caught a ${prey.species.name.toLowerCase()}.`, 'kill', 4);
  }

  onPlayerKill(p: Animal, prey: Animal): void {
    inc(this.today.hunted, prey.species.id);
    p.energy = Math.min(p.species.maxEnergy, p.energy + prey.species.meatValue);
    this.feedYoung(p, prey);
    this.playerStats.kills++;
    if (prey.species.trophic === 'predator') this.progress.predKills++; else this.progress.herbKills++;
    this.progress.addXp(this, (prey.species.trophic === 'predator' ? 60 : 15) + prey.species.meatValue / 10);
    this.fx.push({ type: 'kill', preyId: prey.id, predatorId: p.id, x: prey.x, y: prey.y });
    this.emit('player', `You took down a ${prey.species.name.toLowerCase()}! (+${Math.round(prey.species.meatValue)} energy)`);
  }

  /** Young that are close to a parent when it kills get a share of the meat. */
  private feedYoung(parent: Animal, prey: Animal): void {
    for (const a of this.animals) {
      if (!a.alive || (a.parent !== parent && a.mate !== parent) || Math.hypot(a.x - parent.x, a.y - parent.y) > 90) continue;
      a.energy = Math.min(a.species.maxEnergy, a.energy + prey.species.meatValue * 0.4);
    }
  }

  onPlayerDeath(killer: Animal | null): void {
    const p = this.player;
    if (!p) return;
    p.alive = false;
    this.playerStats.deathTime = this.time;
    this.playerStats.killedBy = killer ? killer.species.name : 'starvation';
    this.fx.push({ type: 'death', id: p.id, cause: 'starvation' });
    this.emit('player', killer ? `You were killed by a ${killer.species.name.toLowerCase()}.` : 'You starved to death.');
  }

  step(dt: number): void {
    this.time += dt;
    this.playerInvuln -= dt;
    if (this.player) this.progress.update(this);
    this.grass.grow(dt, this.settings.grassGrowth * this.zone.growth);

    this.grid.clear();
    let herb = 0;
    const per: Record<string, number> = {};
    for (const a of this.animals) if (a.alive) {
      this.grid.insert(a);
      if (a.species.trophic === 'herbivore') { herb++; per[a.species.id] = (per[a.species.id] ?? 0) + 1; }
    }
    for (const k in per) per[k] /= herb;
    this.preyShare = per;
    this.assignCover();

    for (const a of this.animals) {
      if (!a.alive) continue;
      if (a.isPlayer) updatePlayer(a, dt, this.input, this);
      else {
        a.attackCooldown -= dt;
        if (a.aggro < 0) a.aggro = Math.min(0, a.aggro + dt);
        if (a.species.trophic === 'herbivore') updateHerbivore(a, dt, this);
        else updatePredator(a, dt, this);
      }
      if (!a.alive) continue;
      moveAnimal(a, dt, this.grid, this.terrain);
      updateLifecycle(a, dt);
      if (!a.alive) {
        if (a.isPlayer) { this.onPlayerDeath(null); continue; }
        const cause = a.deathCause === 'old age' ? 'old age' : 'starvation';
        if (cause === 'starvation') inc(this.today.starved, a.species.id); else inc(this.today.old, a.species.id);
        this.fx.push({ type: 'death', id: a.id, cause });
        this.emit('death', cause === 'starvation'
          ? `A ${a.species.name.toLowerCase()} died from starvation.`
          : `An old ${a.species.name.toLowerCase()} died peacefully.`, 'death-' + cause, 2);
        continue;
      }
      if (a.isPlayer) continue;
      const baby = tryReproduce(a, this);
      if (baby) {
        this.newborns.push(baby);
        inc(this.today.births, a.species.id);
        this.fx.push({ type: 'birth', id: baby.id, parentId: a.id, x: baby.x, y: baby.y });
        this.emit('birth', `A ${a.species.name.toLowerCase()} ${BABY_NAME[a.species.id]} was born.`, 'birth', 3);
      }
    }

    // animals killed in fights (not by the player) are counted as hunted
    let removed = false;
    for (const a of this.animals) if (!a.alive) { removed = true; if (a.deathCause === 'fight' && !a.isPlayer) { inc(this.today.hunted, a.species.id); a.deathCause = 'hunted'; } }
    if (removed) {
      this.animals = this.animals.filter(a => a.alive);
      for (const a of this.animals) if (a.target && !a.target.alive) { a.target = null; a.chaseTime = 0; }
    }
    if (this.newborns.length) { for (const b of this.newborns) this.animals.push(b); this.newborns.length = 0; }
    this.living = this.animals.length;

    if (this.time / SIM.daySeconds - this.lastSample >= SIM.sampleEvery) this.sample();
    const d = Math.floor(this.time / SIM.daySeconds);
    if (d > this.day) { this.day = d; this.endOfDay(); }
  }

  private assignCover(): void {
    for (const c of this.covers) c.occ = 0;
    for (const a of this.animals) {
      a.hidden = false;
      if (!a.alive || a.species.trophic !== 'herbivore') continue;
      for (const c of this.covers) {
        if (c.occ >= SIM.coverCapacity || Math.abs(a.x - c.x) > c.r || Math.abs(a.y - c.y) > c.r) continue;
        if (Math.hypot(a.x - c.x, a.y - c.y) < c.r) { a.hidden = true; c.occ++; break; }
      }
    }
  }

  nearestCover(a: Animal, maxDist: number): Cover | null {
    let best: Cover | null = null, bd = maxDist;
    for (const c of this.covers) {
      if (c.occ >= SIM.coverCapacity) continue;
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Population per species (the player is not counted). */
  counts(): Counts {
    const c: Counts = {};
    for (const id of this.species) c[id] = 0;
    for (const a of this.animals) if (a.alive && !a.isPlayer) inc(c, a.species.id);
    return c;
  }

  private sample(): void {
    this.lastSample = this.time / SIM.daySeconds;
    this.history.push({ day: this.lastSample, grass: this.grass.mean(), counts: this.counts() });
    if (this.history.length > SIM.historyMax) this.history = this.history.filter((_, i) => i % 2 === 0);
  }

  private flag(key: string, everyDays: number, kind: EventKind, text: string): void {
    const last = this.flagDay.get(key);
    if (last !== undefined && this.day - last < everyDays) return;
    this.flagDay.set(key, this.day);
    this.emit(kind, text);
  }

  private endOfDay(): void {
    const rec = this.today;
    const c = this.counts(), g = this.grass.mean();
    rec.counts = c; rec.grass = g;
    const prev = this.records.length ? this.records[this.records.length - 1] : undefined;
    this.records.push(rec);
    if (this.records.length > 20) this.records.shift();
    this.today = emptyDay();
    const food = this.zone.food;

    for (const id of this.species) {
      if (get(c, id) === 0 && !this.extinct.has(id)) {
        this.extinct.add(id);
        let text = extinctionReason(this.records, id);
        if (SPECIES[id].trophic === 'herbivore' && this.species.some(p => SPECIES[p].trophic === 'predator' && get(c, p) > 0)) text += ' Predators lose a food source.';
        this.emit('extinct', text);
      } else if (get(c, id) > 0) this.extinct.delete(id);
    }

    const g3 = this.records.length >= 4 ? this.records[this.records.length - 4].grass ?? g : g;
    if (g < 0.2) this.flag('grass-low', 6, 'warn', `The ${food} is nearly exhausted (${Math.round(g * 100)}%) — famine ahead.`);
    else if (g < 0.55 && g3 - g > 0.06) this.flag('grass-drop', 4, 'grass', `${food[0].toUpperCase() + food.slice(1)} density is decreasing (${Math.round(g * 100)}%).`);
    else if (g3 < 0.4 && g - g3 > 0.08) this.flag('grass-up', 6, 'grass', `The ${food} is recovering (${Math.round(g * 100)}%).`);

    const predStarved = this.species.reduce((s, id) => s + (SPECIES[id].trophic === 'predator' ? get(rec.starved, id) : 0), 0);
    if (predStarved >= 2) this.flag('pred-starve', 4, 'warn', `Prey is scarce — ${predStarved} predators starved today.`);

    const s = evaluateStatus(this.species, food, c, prev?.counts, g, rec);
    if (s.status !== this.status) this.emit(s.status === 'Thriving' ? 'info' : 'warn', `Ecosystem is now ${s.status.toLowerCase()}: ${s.reason}`);
    this.status = s.status;
    this.statusReason = s.reason;
  }
}
