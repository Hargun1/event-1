import type { GameController } from '../game/GameController.ts';
import type { Animal, Behaviour } from '../game/entities/Animal.ts';
import { isMature } from '../game/entities/Animal.ts';
import { SPECIES } from '../game/data/species.ts';
import type { SpeciesId } from '../game/data/species.ts';
import { SIM } from '../game/config.ts';
import type { EventKind } from '../game/systems/Ecosystem.ts';

const STATUS_COLORS: Record<string, string> = {
  Thriving: 'var(--thriving)', Unstable: 'var(--unstable)', Famine: 'var(--famine)', Collapse: 'var(--collapse)',
};
const EVENT_COLORS: Record<EventKind, string> = {
  birth: '#6fae4b', hunt: '#c9822b', death: '#8a7f6c', grass: '#9bbf5a', extinct: '#b8433a', info: '#6c9bb3', warn: '#d08a28', player: '#2f5d3a',
};
export const BEHAVIOUR_TEXT: Record<Behaviour, string> = {
  wandering: 'Wandering', searching: 'Searching for food', grazing: 'Grazing', fleeing: 'Fleeing!',
  stalking: 'Stalking prey', hunting: 'Hunting', feeding: 'Feeding', resting: 'Resting', reproducing: 'Reproducing',
  hiding: 'Hiding in cover', fighting: 'Fighting!',
};

const FOOD_ICON = `<svg class="icon" viewBox="0 0 40 30"><path d="M6 28c2-9 5-14 9-17M14 28c0-8 2-14 6-20M22 28c1-7 4-12 9-15M29 28c1-5 3-8 6-10" stroke="#5c9a3c" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`;
const ALL_ICON = `<svg class="icon" viewBox="0 0 40 30"><circle cx="14" cy="16" r="8" fill="#d39a4a"/><circle cx="26" cy="14" r="8" fill="#c9822b" opacity=".85"/><circle cx="20" cy="21" r="6" fill="#5b6b78" opacity=".8"/></svg>`;

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id}`);
  return e;
}

/** Ecosystem drawer (cards, status, feed) and the animal inspector. */
export class Dashboard {
  private ctl: GameController;
  private icon: (id: SpeciesId) => string;
  private cards = new Map<string, { root: HTMLElement; value: HTMLElement; delta: HTMLElement; bar?: HTMLElement; img?: HTMLImageElement }>();
  private lastEventId = 0;
  private inspected: Animal | null = null;

  constructor(ctl: GameController, icon: (id: SpeciesId) => string) {
    this.ctl = ctl;
    this.icon = icon;
    ctl.onZone(() => this.buildCards());
    ctl.onReset(() => { el('feed').innerHTML = ''; this.lastEventId = 0; this.inspected = null; this.update(); });
    ctl.onChange(() => this.updateInspector());
    this.buildCards();
  }

  buildCards(): void {
    const host = el('cards');
    host.innerHTML = '';
    this.cards.clear();
    const add = (key: string, label: string, icon: string, accent: string, bar = false) => {
      const root = document.createElement('div');
      root.className = 'card';
      root.style.setProperty('--accent', accent);
      root.innerHTML = `${icon}<div class="label">${label}</div><div class="value"><span>0</span><span class="delta"></span></div>${bar ? '<div class="bar"><i></i></div>' : ''}`;
      host.appendChild(root);
      this.cards.set(key, {
        root, value: root.querySelector('.value span') as HTMLElement, delta: root.querySelector('.delta') as HTMLElement,
        bar: root.querySelector('.bar i') as HTMLElement | undefined, img: root.querySelector('img') ?? undefined,
      });
    };
    for (const id of this.ctl.eco.species) add(id, SPECIES[id].plural, `<img src="${this.icon(id)}" alt="">`, SPECIES[id].color);
    add('total', 'Total animals', ALL_ICON, '#2f5d3a');
    const food = this.ctl.eco.zone.food;
    add('grass', `${food} available`, FOOD_ICON, '#6fae4b', true);
  }

  /** Thumbnails may finish after the cards are built. */
  refreshIcons(): void {
    for (const id of this.ctl.eco.species) { const c = this.cards.get(id); if (c?.img && !c.img.src.startsWith('data:image/png')) c.img.src = this.icon(id); }
  }

  update(): void {
    const eco = this.ctl.eco;
    const c = eco.counts();
    el('day').textContent = String(eco.day);
    const status = el('ecoStatus');
    status.textContent = eco.status;
    status.style.background = STATUS_COLORS[eco.status];
    el('statusReason').textContent = eco.statusReason;
    const back = eco.history[Math.max(0, eco.history.length - 5)];
    let total = 0;
    for (const id of eco.species) {
      const card = this.cards.get(id);
      if (!card) continue;
      const n = c[id] ?? 0; total += n;
      card.root.classList.toggle('extinct', n === 0);
      card.value.textContent = n === 0 ? 'EXTINCT' : String(n);
      const diff = back ? n - (back.counts[id] ?? 0) : 0;
      card.delta.textContent = n === 0 || !diff ? '' : (diff > 0 ? '▲' : '▼') + Math.abs(diff);
      card.delta.className = 'delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
    }
    const tc = this.cards.get('total');
    if (tc) tc.value.textContent = String(total);
    const g = eco.grass.mean(), gc = this.cards.get('grass');
    if (gc) { gc.value.textContent = Math.round(g * 100) + '%'; if (gc.bar) gc.bar.style.width = Math.round(g * 100) + '%'; }
    this.updateFeed();
    this.updateInspector();
  }

  private updateFeed(): void {
    const feed = el('feed');
    const fresh = this.ctl.eco.events.filter(e => e.id > this.lastEventId);
    if (!fresh.length) return;
    this.lastEventId = fresh[fresh.length - 1].id;
    for (const e of fresh) {
      const li = document.createElement('li');
      li.className = e.kind;
      li.innerHTML = `<span class="k" style="background:${EVENT_COLORS[e.kind]}"></span><span class="d">Day ${e.day}</span><span></span>`;
      (li.lastElementChild as HTMLElement).textContent = e.text;
      feed.prepend(li);
    }
    while (feed.children.length > 60) feed.lastElementChild!.remove();
  }

  updateInspector(): void {
    const box = el('inspector');
    if (this.ctl.selectedId === null || this.ctl.mode === 'menu') { box.hidden = true; this.inspected = null; return; }
    const live = this.ctl.selected();
    if (live) this.inspected = live;
    const a = this.inspected;
    if (!a) { box.hidden = true; return; }
    box.hidden = false;
    const s = a.species;
    const ef = a.energy / s.maxEnergy, hf = a.health / a.maxHealth;
    let status: string, cls = '';
    if (!a.alive) {
      status = a.deathCause === 'hunted' ? `Died — killed by ${a.killedBy === 'you' ? 'you' : 'a ' + (a.killedBy ?? 'predator').toLowerCase()}` : a.deathCause === 'old age' ? 'Died of old age' : 'Died of starvation';
      cls = 'bad';
    } else if (a.aggro > 0) { status = 'Hostile to you'; cls = 'bad'; }
    else if (a.hidden) status = 'Sheltering';
    else if (a.pursuedBy) { status = 'Being hunted'; cls = 'bad'; }
    else if (a.energy <= 0 || hf < 0.35) { status = 'Starving / hurt'; cls = 'bad'; }
    else if (ef < s.hungerThreshold * 0.6) { status = 'Hungry'; cls = 'warn'; }
    else if (!isMature(a)) status = 'Juvenile';
    else if (a.age > a.lifespan * 0.85) { status = 'Elderly'; cls = 'warn'; }
    else status = 'Healthy';
    const life = !isMature(a) ? 'young' : a.age > a.lifespan * 0.85 ? 'old' : 'adult';
    const meter = (label: string, f: number, col: string, txt: string) =>
      `<div class="meter"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(1, f)) * 100}%;background:${col}"></div></div><span>${txt}</span></div>`;
    box.innerHTML = `
      <div class="insp-head"><img src="${this.icon(s.id)}" alt=""><div><b>${s.name}</b><small>#${a.id} · ${s.trophic}</small></div>
        <button class="insp-close" aria-label="Close">×</button></div>
      ${meter('Energy', ef, ef > 0.5 ? '#6fae4b' : ef > 0.2 ? '#e0a83a' : '#c2493e', String(Math.round(a.energy)))}
      ${meter('Health', hf, hf > 0.5 ? '#4f9a3a' : '#c2493e', String(Math.round(a.health)))}
      <dl class="kv">
        <dt>Age</dt><dd>${(a.age / SIM.daySeconds).toFixed(1)} days (${life})</dd>
        <dt>Behaviour</dt><dd>${a.alive ? BEHAVIOUR_TEXT[a.behaviour] : '—'}</dd>
        <dt>Status</dt><dd><span class="pill ${cls}">${status}</span></dd>
        <dt>Attack</dt><dd>${s.attack ? `${s.attack} dmg · ${Math.round(s.armor * 100)}% armour` : 'Harmless'}</dd>
      </dl>`;
    box.querySelector('.insp-close')!.addEventListener('click', () => this.ctl.select(null));
  }
}
