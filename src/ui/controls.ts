import type { GameController, Speed } from '../game/GameController.ts';
import { RANGES } from '../game/config.ts';
import { SPECIES } from '../game/data/species.ts';

const PLAY_ICON = '<path d="M6 4.2v11.6c0 .8.9 1.3 1.6.8l8.6-5.8c.6-.4.6-1.2 0-1.6L7.6 3.4C6.9 2.9 6 3.4 6 4.2z"/>';
const PAUSE_ICON = '<rect x="5" y="4" width="3.4" height="12" rx="1"/><rect x="11.6" y="4" width="3.4" height="12" rx="1"/>';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

interface SliderSpec { id: string; label: string; color?: string; min: number; max: number; step: number; get: () => number; set: (v: string) => void; fmt: (v: number) => string; changed?: () => boolean }

function slider(host: HTMLElement, s: SliderSpec): () => void {
  const row = document.createElement('div');
  row.className = 'slider';
  row.innerHTML = `<label for="${s.id}">${s.color ? `<i style="background:${s.color}"></i>` : ''}${s.label}</label><output></output>
    <input type="range" id="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}">`;
  host.appendChild(row);
  const input = row.querySelector('input')!, out = row.querySelector('output')!;
  const sync = () => { input.value = String(s.get()); out.textContent = s.fmt(s.get()); row.classList.toggle('changed', !!s.changed?.()); };
  input.addEventListener('input', () => { s.set(input.value); sync(); });
  sync();
  return sync;
}

/** Top-bar playback controls + the settings box, rebuilt per zone. */
export function initControls(ctl: GameController): void {
  let syncers: (() => void)[] = [];
  const buildSettings = () => {
    const pop = $('popSliders'), live = $('liveSliders'), world = $('worldSliders');
    pop.innerHTML = live.innerHTML = world.innerHTML = '';
    syncers = [];
    for (const id of ctl.eco.species) {
      const sp = SPECIES[id];
      syncers.push(slider(pop, {
        id: 's-' + id, label: `Initial ${sp.plural.toLowerCase()}`, color: sp.color, ...RANGES.population,
        get: () => ctl.pending.populations[id] ?? 0, set: v => ctl.setPopulation(id, v), fmt: v => String(v),
        changed: () => (ctl.pending.populations[id] ?? 0) !== (ctl.eco.settings.populations[id] ?? 0),
      }));
    }
    const food = ctl.eco.zone.food;
    syncers.push(slider(live, { id: 's-grassGrowth', label: `${food[0].toUpperCase() + food.slice(1)} growth speed`, ...RANGES.grassGrowth, get: () => ctl.pending.grassGrowth, set: v => ctl.setSetting('grassGrowth', v), fmt: v => v.toFixed(2) + 'x' }));
    syncers.push(slider(live, { id: 's-reproduction', label: 'Reproduction speed', ...RANGES.reproduction, get: () => ctl.pending.reproduction, set: v => ctl.setSetting('reproduction', v), fmt: v => v.toFixed(2) + 'x' }));
    syncers.push(slider(world, {
      id: 's-initialGrass', label: `Initial ${food} density`, ...RANGES.initialGrass, get: () => ctl.pending.initialGrass, set: v => ctl.setSetting('initialGrass', v), fmt: v => Math.round(v * 100) + '%',
      changed: () => ctl.pending.initialGrass !== ctl.eco.settings.initialGrass,
    }));
    syncSeed();
  };
  const seed = $('seed') as HTMLInputElement, rnd = $('randomSeed') as HTMLInputElement;
  const syncSeed = () => { seed.value = String(ctl.pending.seed); rnd.checked = ctl.pending.randomizeSeed; };
  seed.addEventListener('change', () => { ctl.setSetting('seed', seed.value); syncSeed(); });
  rnd.addEventListener('change', () => ctl.setRandomSeed(rnd.checked));
  // live release ("scale up" a species without resetting)
  const relSel = $('releaseSpecies') as HTMLSelectElement, relCount = $('releaseCount') as HTMLInputElement, relV = $('releaseCountV');
  const buildRelease = () => { relSel.innerHTML = ctl.eco.species.map(id => `<option value="${id}">${SPECIES[id].plural}</option>`).join(''); };
  relCount.addEventListener('input', () => { relV.textContent = relCount.value; });
  $('releaseBtn').addEventListener('click', () => {
    const n = ctl.eco.release(relSel.value as keyof typeof SPECIES, Number(relCount.value));
    $('releaseBtn').textContent = n ? `Released ${n}!` : 'Zone is full';
    setTimeout(() => { $('releaseBtn').textContent = 'Release into the zone'; }, 1200);
  });
  ctl.onZone(buildRelease);
  buildRelease();
  ctl.onZone(buildSettings);
  ctl.onReset(() => { for (const s of syncers) s(); syncSeed(); });
  buildSettings();

  const play = $('playBtn'), playIcon = $('playIcon');
  const sync = () => {
    playIcon.innerHTML = ctl.running ? PAUSE_ICON : PLAY_ICON;
    play.setAttribute('aria-label', ctl.running ? 'Pause' : 'Play');
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === ctl.speed));
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === ctl.mode));
    document.body.classList.toggle('mode-play', ctl.mode === 'play');
  };
  play.addEventListener('click', () => ctl.setRunning(!ctl.running));
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => b.addEventListener('click', () => ctl.setSpeed(Number(b.dataset.speed) as Speed)));
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.addEventListener('click', () => ctl.setMode(b.dataset.mode as 'play' | 'watch')));
  $('resetBtn').addEventListener('click', () => ctl.reset());
  $('applyBtn').addEventListener('click', () => ctl.reset());
  ctl.onChange(sync);
  sync();

  const panel = $('panel'), pBtn = $('panelBtn');
  const setPanel = (open: boolean) => { panel.classList.toggle('open', open); document.body.classList.toggle('panel-open', open); pBtn.setAttribute('aria-expanded', String(open)); pBtn.classList.toggle('on', open); };
  pBtn.addEventListener('click', () => setPanel(!panel.classList.contains('open')));

  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || ctl.mode === 'menu') return;
    if (e.code === 'KeyP' || (e.code === 'Space' && ctl.mode === 'watch')) { e.preventDefault(); ctl.setRunning(!ctl.running); }
    else if (e.code === 'Tab') { e.preventDefault(); setPanel(!panel.classList.contains('open')); }
    else if (ctl.mode === 'watch' && (e.key === '1' || e.key === '2' || e.key === '4')) ctl.setSpeed(Number(e.key) as Speed);
    else if (e.code === 'KeyR' && ctl.mode === 'watch') ctl.reset();
  });
}
