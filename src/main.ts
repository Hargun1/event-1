import * as THREE from 'three';
import './ui/styles.css';
import { SIM } from './game/config.ts';
import { GameController } from './game/GameController.ts';
import { SPECIES } from './game/data/species.ts';
import type { SpeciesId, ZoneId } from './game/data/species.ts';
import { ZONES, ZONE_ORDER } from './game/data/zones.ts';
import { ModelLibrary } from './render3d/ModelLibrary.ts';
import { World3D } from './render3d/World3D.ts';
import { AnimalViews } from './render3d/AnimalViews.ts';
import { CameraRig } from './render3d/CameraRig.ts';
import { InputController } from './render3d/Input.ts';
import { Overlay } from './render3d/Overlay.ts';
import { Thumbnails } from './render3d/Thumbnails.ts';
import { initControls } from './ui/controls.ts';
import { Dashboard } from './ui/dashboard.ts';
import { PopulationChart } from './ui/charts.ts';
import { Hud, buildMenu } from './ui/hud.ts';
import { Sound } from './audio/Sound.ts';
import { Minimap } from './ui/minimap.ts';
import type { Ecosystem } from './game/systems/Ecosystem.ts';
import { isMature as isMatureAnimal } from './game/entities/Animal.ts';

// ---- player roar (F / touch): your animal roars, rivals of the same species may answer
let roarCooldown = 0;
function playerRoar(): void {
  const eco = ctl.eco, p = eco.player;
  if (ctl.mode !== 'play' || !p || !p.alive || roarCooldown > 0 || !zoneReady) return;
  roarCooldown = 3.5;
  sound.unlock();
  sound.call(p.species.id, 1, 0, 'roar', true);
  views.roar(p.id);
  rig.shake(0.35);
  let rival = null as null | typeof p, bd = 320;
  for (const a of eco.animals) if (a.alive && !a.isPlayer && !a.kin && a.species === p.species) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; rival = a; } }
  if (rival) {
    const r = rival;
    setTimeout(() => { if (!r.alive) return; const s = spatial(r.x, r.y); sound.call(r.species.id, Math.max(0.3, s.vol), s.pan, 'roar', true); views.roar(r.id); }, 2600);
  }
}
window.addEventListener('keydown', e => { if (e.code === 'KeyF' && !e.repeat && (e.target as HTMLElement).tagName !== 'INPUT') playerRoar(); });

const $ = (id: string) => document.getElementById(id)!;

const ctl = new GameController();
if (import.meta.env.DEV) (window as unknown as { wildscape: unknown }).wildscape = ctl; // test hook (dev only)
const lib = new ModelLibrary();
const world = new World3D($('viewport'));
const views = new AnimalViews(world, lib);
const rig = new CameraRig(world.camera, world.renderer.domElement);
const input = new InputController(world.renderer.domElement, rig);
input.bindTouch($('stick'), $('knob'), $('tAttack'), $('tSprint'), $('tBreed'));
$('tRoar').addEventListener('pointerdown', e => { e.preventDefault(); playerRoar(); });
const overlay = new Overlay($('overlay'));
const thumbs = new Thumbnails(lib);
const sound = new Sound();
const minimap = new Minimap($('minimap') as HTMLCanvasElement);

/** Big centre-screen banner (level up / mission complete). */
function banner(title: string, sub: string): void {
  const b = $('banner');
  b.innerHTML = `<b>${title}</b><span>${sub}</span>`;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
let hurtFlash = 0;

// ---- sound: unlock on first gesture, mute toggle (button / M)
const SOUND_ON = '<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
const SOUND_OFF = '<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13 7.5l4 5M17 7.5l-4 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
const syncSoundBtn = () => { $('soundIcon').innerHTML = sound.enabled ? SOUND_ON : SOUND_OFF; $('soundBtn').setAttribute('aria-label', sound.enabled ? 'Mute sound' : 'Unmute sound'); };
const toggleSound = () => { sound.unlock(); sound.setEnabled(!sound.enabled); syncSoundBtn(); };
$('soundBtn').addEventListener('click', toggleSound);
window.addEventListener('pointerdown', () => sound.unlock());
window.addEventListener('keydown', e => { sound.unlock(); if (e.code === 'KeyM' && (e.target as HTMLElement).tagName !== 'INPUT') toggleSound(); });
syncSoundBtn();

const sv = new THREE.Vector3();
/** Distance-based volume and screen-side panning for a sim position. */
function spatial(x: number, y: number): { vol: number; pan: number } {
  world.toWorld(x, y, sv);
  const d = sv.distanceTo(world.camera.position);
  sv.applyMatrix4(world.camera.matrixWorldInverse);
  return { vol: Math.max(0, 1 - d / 95) ** 1.4, pan: sv.x / (Math.abs(sv.z) + 12) };
}

let lastEventSpoken = 0, callTimer = 0, lastStrike = 99;
function audioFrame(eco: Ecosystem, dt: number): void {
  for (const f of eco.fx) {
    if (f.type === 'kill') {
      const s = spatial(f.x, f.y);
      sound.sfx('bite', s.vol, s.pan);
      const pred = eco.animals.find(a => a.id === f.predatorId);
      if (pred) sound.call(pred.species.id, pred.isPlayer ? 0.9 : s.vol * 0.9, pred.isPlayer ? 0 : s.pan, 'snarl');
    } else if (f.type === 'hit') {
      const s = spatial(f.x, f.y);
      sound.sfx(f.onPlayer ? 'hurt' : 'bite', f.onPlayer ? 0.9 : s.vol * 0.8, s.pan);
      if (f.onPlayer) { rig.shake(0.6); hurtFlash = 1; }
      else if (eco.player && Math.hypot(f.x - eco.player.x, f.y - eco.player.y) < 60) rig.shake(0.15);
    } else if (f.type === 'levelup') {
      banner(`LEVEL ${f.level}`, 'Stronger bite · tougher hide · fully healed');
      sound.sfx('birth', 1, 0);
      sound.say(`Level ${f.level}!`);
    } else if (f.type === 'mission') {
      banner('MISSION COMPLETE', f.title);
      sound.sfx('birth', 0.9, 0);
    } else if (f.type === 'birth') {
      const s = spatial(f.x, f.y);
      const baby = eco.animals.find(a => a.id === f.id);
      const mine = !!baby?.kin;
      sound.sfx('birth', mine ? 0.8 : s.vol * 0.6, mine ? 0 : s.pan);
      if (baby) sound.call(baby.species.id, mine ? 0.8 : s.vol * 0.8, mine ? 0 : s.pan, 'baby', true);
    }
  }
  // the player's own roar / swing
  const p = eco.player;
  if (p && p.alive) {
    if (p.strikeTimer < lastStrike && p.strikeTimer < 0.05) {
      sound.sfx('swing', 0.6, 0);
      sound.call(p.species.id, 0.75, 0, 'snarl');
    }
    lastStrike = p.strikeTimer;
  }
  // nearby animals call now and then (fighters and fleeing animals more often)
  callTimer -= dt;
  if (callTimer <= 0 && eco.animals.length) {
    callTimer = 0.6 + Math.random() * 0.8;
    for (let k = 0; k < 6; k++) {
      const a = eco.animals[Math.floor(Math.random() * eco.animals.length)];
      if (!a.alive || a.isPlayer) continue;
      const s = spatial(a.x, a.y);
      if (s.vol < 0.15) continue;
      const excited = a.behaviour === 'fighting' || a.behaviour === 'fleeing' || a.behaviour === 'hunting';
      if (a.species.id === 'lion' || a.species.id === 'trex') {
        // big cats and tyrants roar occasionally (long calls carry far)
        if (Math.random() < (excited ? 0.25 : 0.08)) { sound.call(a.species.id, Math.max(s.vol, 0.35), s.pan, 'roar'); break; }
        continue;
      }
      if (!isMatureAnimal(a) && Math.random() < 0.3) { sound.call(a.species.id, s.vol * 0.8, s.pan, 'baby'); break; }
      if (excited || Math.random() < 0.3) { sound.call(a.species.id, s.vol * (excited ? 1 : 0.7), s.pan, a.behaviour === 'fighting' ? 'snarl' : 'call'); break; }
    }
  }
  sound.tickAmbient(dt);
  // narrator: extinctions, your milestones, challenges, collapse
  for (const e of eco.events) {
    if (e.id <= lastEventSpoken) continue;
    lastEventSpoken = e.id;
    const t = e.text;
    if (e.kind === 'extinct') sound.say(t.split('—')[0]);
    else if (e.kind === 'player' && /offspring|killed by|starved|enter/.test(t)) sound.say(t.replace(/\(.*\)/, ''));
    else if (e.kind === 'player' && /took down/.test(t) && (eco.playerStats.kills === 1 || eco.playerStats.kills % 5 === 0)) sound.say(eco.playerStats.kills === 1 ? 'First kill!' : `${eco.playerStats.kills} kills!`);
    else if (e.kind === 'warn' && /challenges you|collapse|famine/i.test(t)) sound.say(t.split(':')[0].split('—')[0]);
  }
}

const placeholder = (id: SpeciesId) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><ellipse cx="20" cy="17" rx="13" ry="8" fill="${SPECIES[id].color}"/></svg>`)}`;
const icon = (id: SpeciesId) => thumbs.get(id) || placeholder(id);

initControls(ctl);
const dashboard = new Dashboard(ctl, icon);
const chart = new PopulationChart($('chart') as HTMLCanvasElement, $('legend'));
const hud = new Hud(ctl, icon);

let zoneReady = false;
let loadedZone: ZoneId | null = null;
let loadToken = 0;

function setLoading(text: string | null): void {
  $('loading').classList.toggle('on', text !== null);
  if (text) $('loadingText').textContent = text;
}

/** Load (if needed) and enter a zone. */
async function startZone(zone: ZoneId, mode: 'play' | 'watch' | 'menu'): Promise<void> {
  const token = ++loadToken;
  const z = ZONES[zone];
  if (mode !== 'menu') setLoading(`Loading ${z.name}…`);
  zoneReady = false;
  ctl.enterZone(zone, mode === 'menu' ? 'watch' : mode);
  if (mode === 'menu') ctl.toMenu();
  try {
    await views.loadSpecies(z.species, (d, t) => { if (mode !== 'menu') setLoading(`Loading ${z.name}… ${d}/${t} animals`); });
    if (token !== loadToken) return;
    views.clear(); overlay.clear();
    if (loadedZone !== zone) { await world.setZone(zone, ctl.eco.terrain, ctl.eco.grass, lib); loadedZone = zone; }
    else world.updateVegetation(ctl.eco.grass);
    if (token !== loadToken) return;
    $('zoneName').textContent = z.name;
    sound.setZone(zone);
    lastEventSpoken = ctl.eco.events.length ? ctl.eco.events[ctl.eco.events.length - 1].id - (mode === 'menu' ? 0 : 1) : 0;
    chart.setSpecies(z.species, z.food);
    rig.setZone(zone);
    applyMode();
    zoneReady = true;
    setLoading(null);
    if (mode !== 'menu') $('menu').hidden = true;
    await thumbs.make(z.species);
    dashboard.refreshIcons();
  } catch (err) {
    console.error(err);
    setLoading(`Could not load ${z.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let lastMode = '';
function applyMode(): void {
  const m = ctl.mode;
  input.enabled = m === 'play';
  const focus = new THREE.Vector3();
  if (m === 'play' && ctl.eco.player) world.toWorld(ctl.eco.player.x, ctl.eco.player.y, focus);
  rig.setMode(m === 'play' ? 'follow' : 'orbit', focus);
  rig.orbit.autoRotate = m === 'menu';
  rig.orbit.autoRotateSpeed = 0.4;
  lastMode = m;
}
ctl.onChange(() => { if (ctl.mode !== lastMode && zoneReady) applyMode(); });
ctl.onReset(() => { if (!zoneReady) return; views.clear(); overlay.clear(); world.updateVegetation(ctl.eco.grass); applyMode(); });

$('homeBtn').addEventListener('click', () => { ctl.toMenu(); $('menu').hidden = false; });
$('goMenuBtn').addEventListener('click', () => { $('gameover').hidden = true; ctl.toMenu(); $('menu').hidden = false; });
const refreshMenu = buildMenu(ctl, icon, (zone, mode) => { void startZone(zone, mode); });

// click-to-inspect (watch mode) — ignore drags
const ray = new THREE.Raycaster();
let downAt: { x: number; y: number; t: number } | null = null;
const canvas = world.renderer.domElement;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', e => {
  if (!downAt || ctl.mode !== 'watch' || e.button !== 0) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6 || performance.now() - downAt.t > 400) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), world.camera);
  const a = views.pick(ray);
  ctl.select(a ? a.id : null);
});

// ------------------------------------------------------------------ main loop
let last = performance.now(), acc = 0, uiTimer = 0, vegTimer = 0;
const focus = new THREE.Vector3(), centre = new THREE.Vector3();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (zoneReady) {
    const eco = ctl.eco;
    input.read(dt, eco.input);
    const simulating = ctl.running;
    if (simulating) {
      acc += dt * ctl.speed;
      let n = 0;
      while (acc >= SIM.fixedDt && n < 16) { eco.step(SIM.fixedDt); acc -= SIM.fixedDt; n++; }
      if (n === 16) acc = 0;
    }
    audioFrame(eco, dt);
    roarCooldown -= dt;
    views.handleFx(eco.fx);
    eco.fx.length = 0;
    const vdt = simulating ? dt * ctl.speed : 0;
    views.sync(eco, vdt, ctl.selectedId);

    let f: THREE.Vector3 | null = null;
    if (ctl.mode === 'play' && eco.player && views.position(eco.player.id, focus)) f = focus;
    else if (ctl.mode === 'watch' && ctl.selectedId !== null && views.position(ctl.selectedId, focus)) f = focus;
    rig.update(dt, f);
    world.update(simulating ? dt : dt * 0.2, f ?? rig.orbit.target ?? centre, eco.darkness(), eco.dayPhase());
    // low-health vignette + hit flash
    hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
    const pl = eco.player;
    const low = ctl.mode === 'play' && pl && pl.alive ? Math.max(0, 1 - (pl.health / pl.maxHealth) / 0.35) : 0;
    $('vignette').style.opacity = String(Math.min(1, low * 0.8 + hurtFlash * 0.7));

    vegTimer += dt;
    if (vegTimer > 0.5) { vegTimer = 0; world.updateVegetation(eco.grass); }
    overlay.update(eco, views, world.camera, ctl.mode === 'play' ? hud.targetId : ctl.selectedId);
  }
  world.render();

  uiTimer += dt;
  if (uiTimer > 0.25) {
    uiTimer = 0;
    if (zoneReady) {
      dashboard.update();
      hud.update();
      if ($('panel').classList.contains('open')) chart.draw(ctl.eco.history);
      if (ctl.mode !== 'menu') minimap.draw(ctl.eco, ctl.mode === 'play' ? rig.yaw : null);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
$('panelBtn').addEventListener('click', () => setTimeout(() => chart.draw(ctl.eco.history), 280));

// boot: a living savanna behind the zone-select menu, then menu art
void (async () => {
  await startZone('land', 'menu');
  await thumbs.make(ZONE_ORDER.map(z => ZONES[z].player));
  refreshMenu();
  await thumbs.make(ZONE_ORDER.flatMap(z => ZONES[z].species));
  refreshMenu();
})();
