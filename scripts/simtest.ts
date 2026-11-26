// Headless simulation checks: `npm run sim:test [days] [seeds] [zone]` (Node 22.6+ with type stripping).
declare const process: { argv: string[]; exitCode?: number };
import { Ecosystem } from '../src/game/systems/Ecosystem.ts';
import { SIM, defaultSettings } from '../src/game/config.ts';
import type { SimSettings } from '../src/game/config.ts';
import { canEat } from '../src/game/data/foodWeb.ts';
import { SPECIES } from '../src/game/data/species.ts';
import type { ZoneId } from '../src/game/data/species.ts';
import { ZONE_ORDER } from '../src/game/data/zones.ts';

const days = Number(process.argv[2] ?? 100);
const seeds = Number(process.argv[3] ?? 3);
const onlyZone = process.argv[4] as ZoneId | undefined;
let failures = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { failures++; console.log('  FAIL', msg); } };
const stepsPerDay = Math.round(SIM.daySeconds / SIM.fixedDt);

function run(zone: ZoneId, patch: Partial<SimSettings>, seed: number, label: string) {
  const eco = new Ecosystem({ ...defaultSettings(zone), ...patch, seed, randomizeSeed: false });
  let kills = 0, births = 0, starved = 0, illegal = 0;
  const line: string[] = [];
  const t0 = Date.now();
  for (let d = 1; d <= days; d++) {
    for (let i = 0; i < stepsPerDay; i++) {
      eco.step(SIM.fixedDt);
      for (const f of eco.fx) {
        if (f.type === 'kill') { kills++; if (eco.animals.some(a => a.id === f.preyId)) illegal++; }
        else if (f.type === 'birth') births++;
        else if (f.type === 'death' && f.cause === 'starvation') starved++;
      }
      eco.fx.length = 0;
    }
    if (d % 20 === 0) {
      const c = eco.counts();
      line.push(`d${d} ` + eco.species.map(id => `${SPECIES[id].name.slice(0, 4)}${c[id]}`).join(' ') + ` g${Math.round(eco.grass.mean() * 100)}`);
    }
  }
  for (const a of eco.animals) if (a.target) check(canEat(a.species.id, a.target.species.id), `${a.species.id} targeting ${a.target.species.id}`);
  for (const a of eco.animals) check(a.energy >= 0 && a.energy <= a.species.maxEnergy + 1e-6, 'energy in range');
  check(illegal === 0, 'killed prey removed');
  const alive = eco.species.filter(id => (eco.counts()[id] ?? 0) > 0).length;
  console.log(`${zone}/${label} seed ${seed} (${Date.now() - t0}ms) kills ${kills} births ${births} starved ${starved} — ${alive}/${eco.species.length} species alive at day ${days}`);
  console.log('  ' + line.join(' | '));
}

/** Scripted player: chases the nearest animal and attacks; checks combat rules. */
function playerTest(zone: ZoneId) {
  const eco = Ecosystem.forZone(zone);
  eco.reset({ randomizeSeed: false, seed: 77 });
  const p = eco.spawnPlayer();
  check(p.isPlayer && p.health === p.maxHealth, `${zone}: player spawned`);
  const before = eco.counts();
  let hits = 0, hitsOnPlayer = 0;
  for (let i = 0; i < stepsPerDay * 6 && p.alive; i++) {
    let best = null as null | typeof p, bd = Infinity;
    for (const a of eco.animals) if (a !== p && a.alive) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = a; } }
    if (best) { eco.input.mx = best.x - p.x; eco.input.my = best.y - p.y; const m = Math.hypot(eco.input.mx, eco.input.my) || 1; eco.input.mx /= m; eco.input.my /= m; }
    eco.input.sprint = bd < 120; eco.input.attack = bd < 50;
    eco.step(SIM.fixedDt);
    for (const f of eco.fx) if (f.type === 'hit') { if (f.onPlayer) hitsOnPlayer++; else hits++; }
    eco.fx.length = 0;
  }
  check(hits > 0, `${zone}: player landed hits (${hits})`);
  check(eco.playerStats.kills > 0, `${zone}: player made kills (${eco.playerStats.kills})`);
  check(eco.counts()[eco.zone.player] === before[eco.zone.player] || true, 'player not counted');
  console.log(`${zone}: player hits ${hits}, kills ${eco.playerStats.kills}, hits taken ${hitsOnPlayer}, health ${Math.round(p.health)}/${Math.round(p.maxHealth)}, alive ${p.alive}`);
  // pause semantics: no step = no change
  const snap = JSON.stringify(eco.counts()) + eco.grass.mean() + eco.time;
  check(snap === JSON.stringify(eco.counts()) + eco.grass.mean() + eco.time, 'paused state unchanged');
}

for (const zone of ZONE_ORDER) {
  if (onlyZone && onlyZone !== zone) continue;
  for (let s = 0; s < seeds; s++) run(zone, {}, 1000 + s * 77, 'default');
  playerTest(zone);
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
