import type { GameController } from '../game/GameController.ts';
import type { Animal } from '../game/entities/Animal.ts';
import { SPECIES } from '../game/data/species.ts';
import type { SpeciesId, ZoneId } from '../game/data/species.ts';
import { ZONES, ZONE_ORDER, MODEL_CREDITS } from '../game/data/zones.ts';
import { SIM, PLAYER } from '../game/config.ts';
import { angleDiff } from '../game/utils/math.ts';

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id}`);
  return e;
}

export function creditsHtml(): string {
  return `3D models: ${MODEL_CREDITS.map(n => `“${n}”`).join(', ')} by <a href="https://vinish.dev/free-3d-models/" target="_blank" rel="noopener">vinish.dev</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.`;
}

/** Zone-select screen. */
export function buildMenu(ctl: GameController, icon: (id: SpeciesId) => string, start: (zone: ZoneId, mode: 'play' | 'watch') => void): () => void {
  const host = el('zones');
  host.innerHTML = '';
  for (const id of ZONE_ORDER) {
    const z = ZONES[id];
    const card = document.createElement('article');
    card.className = 'zone';
    card.dataset.zone = id;
    const others = z.species.filter(s => s !== z.player).slice(0, 3);
    card.innerHTML = `
      <div class="zone-art">${others.slice(0, 1).map(s => `<img data-sp="${s}" alt="">`).join('')}<img class="hero" data-sp="${z.player}" alt="">${others.slice(1).map(s => `<img data-sp="${s}" alt="">`).join('')}</div>
      <div class="zone-body">
        <h2>${z.name}</h2>
        <p>${z.tagline}</p>
        <div class="zone-species">${z.species.map(s => SPECIES[s].plural).join(' · ')}</div>
        <div class="zone-btns">
          <button class="btn primary" data-go="play">Play as ${SPECIES[z.player].name}</button>
          <button class="btn" data-go="watch">Watch</button>
        </div>
      </div>`;
    card.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(b => b.addEventListener('click', () => start(id, b.dataset.go as 'play' | 'watch')));
    host.appendChild(card);
  }
  el('menuCredits').innerHTML = creditsHtml();
  el('credits').innerHTML = creditsHtml();
  const refresh = () => host.querySelectorAll<HTMLImageElement>('img[data-sp]').forEach(img => { const s = icon(img.dataset.sp as SpeciesId); if (s) img.src = s; });
  refresh();
  void ctl;
  return refresh;
}

/** Player HUD, target card and game-over dialog. */
export class Hud {
  private ctl: GameController;
  private icon: (id: SpeciesId) => string;
  private shownDeath = false;

  constructor(ctl: GameController, icon: (id: SpeciesId) => string) {
    this.ctl = ctl;
    this.icon = icon;
    el('respawnBtn').addEventListener('click', () => { el('gameover').hidden = true; this.shownDeath = false; ctl.respawn(); });
    el('goWatchBtn').addEventListener('click', () => { el('gameover').hidden = true; this.shownDeath = false; ctl.setMode('watch'); });
    ctl.onReset(() => { el('gameover').hidden = true; this.shownDeath = false; });
  }

  private nearestTarget(p: Animal): Animal | null {
    let best: Animal | null = null, bd = Infinity;
    const reach = p.species.radius + p.species.attackRange + PLAYER.reachBonus;
    for (const a of this.ctl.eco.animals) {
      if (a === p || !a.alive) continue;
      const d = Math.hypot(a.x - p.x, a.y - p.y) - a.species.radius;
      if (a.aggro > 0 && d < 200) { if (d - 1000 < bd) { bd = d - 1000; best = a; } continue; }
      if (d > reach * 3) continue;
      const off = Math.abs(angleDiff(p.heading, Math.atan2(a.y - p.y, a.x - p.x)));
      const score = d + off * 25;
      if (score < bd) { bd = score; best = a; }
    }
    return best;
  }

  /** The animal currently shown in the target card (overlay also highlights it). */
  targetId: number | null = null;

  update(): void {
    const ctl = this.ctl, eco = ctl.eco, play = ctl.mode === 'play';
    el('hud').hidden = !play;
    el('hint').hidden = !play;
    el('touch').hidden = !play || !matchMedia('(pointer: coarse)').matches;
    const p = eco.player;
    if (!play) { this.targetId = null; return; }
    const sp = SPECIES[eco.zone.player];
    (el('meIcon') as HTMLImageElement).src = this.icon(sp.id);
    el('meName').textContent = `You — ${sp.name}`;
    if (p) {
      const alive = (p.deathCause === null || p.alive) ? (eco.time - eco.playerStats.spawnTime) : 0;
      el('meStats').textContent = `${eco.playerStats.kills} kills · ${(alive / SIM.daySeconds).toFixed(1)} days`;
      el('meHealth').style.width = `${Math.max(0, p.health / p.maxHealth) * 100}%`;
      el('meHealthTxt').textContent = String(Math.max(0, Math.round(p.health)));
      el('meEnergy').style.width = `${(p.energy / sp.maxEnergy) * 100}%`;
      el('meEnergyTxt').textContent = `${Math.round((p.energy / sp.maxEnergy) * 100)}%`;
      el('meStamina').style.width = `${p.stamina * 100}%`;
      const crit = p.alive ? eco.criteria(p) : [];
      const missing = crit.filter(c => !c.ok);
      const ready = p.alive && missing.length === 0;
      const br = el('meBreed');
      br.className = 'breed' + (ready ? ' ready' : '');
      br.innerHTML = ready ? '<b>Ready to breed</b> — press B' : `Breed: <b>${missing.map(c => c.label).slice(0, 2).join(', ') || '—'}</b>${eco.playerStats.cubs ? ` · ${eco.playerStats.cubs} offspring` : ''}`;
      el('tBreed').classList.toggle('ready', ready);
    }
    const t = p && p.alive ? this.nearestTarget(p) : null;
    this.targetId = t ? t.id : null;
    const tc = el('target');
    tc.hidden = !t;
    if (t) {
      const hostile = t.aggro > 0;
      tc.innerHTML = `<b>${t.species.name}</b> ${hostile ? '<span class="pill bad">Hostile</span>' : t.species.attack > 0 ? '<span class="pill warn">Fights back</span>' : '<span class="pill">Prey</span>'}
        <div class="stat-bar health"><i><b style="width:${Math.max(0, t.health / t.maxHealth) * 100}%"></b></i><em>${Math.round(t.health)}</em></div>
        <small>${t.species.attack ? `${t.species.attack} dmg · ` : ''}${Math.round(t.species.armor * 100)}% armour · +${t.species.meatValue} food</small>`;
    }
    // death
    if (p && !p.alive && !this.shownDeath) {
      this.shownDeath = true;
      const st = eco.playerStats;
      const lived = ((st.deathTime ?? eco.time) - st.spawnTime) / SIM.daySeconds;
      el('goTitle').textContent = st.killedBy === 'starvation' ? 'You starved' : 'You were defeated';
      el('goText').textContent = st.killedBy === 'starvation'
        ? `Your ${sp.name} ran out of food. Hunt more often — every kill restores energy.`
        : `Your ${sp.name} was killed by a ${st.killedBy?.toLowerCase()}. Wounded rivals flee — and armoured prey hits back.`;
      el('goStats').innerHTML = `<div><b>${st.kills}</b><span>Kills</span></div><div><b>${lived.toFixed(1)}</b><span>Days</span></div><div><b>${Math.round(st.kills * 100 + lived * 20)}</b><span>Score</span></div>`;
      setTimeout(() => { if (this.shownDeath) el('gameover').hidden = false; }, 1400);
    }
  }
}
