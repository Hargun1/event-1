import { SIM, WORLD } from '../config.ts';
import type { Animal } from '../entities/Animal.ts';
import { createAnimal, isMature } from '../entities/Animal.ts';
import { clamp } from '../utils/math.ts';
import type { Ecosystem } from './Ecosystem.ts';

const P = WORLD.play;

export interface Criterion { label: string; ok: boolean }

function crowding(a: Animal, eco: Ecosystem): number {
  let crowd = 0;
  const s = a.species, r = s.crowdRadius;
  eco.grid.query(a.x, a.y, r, o => {
    if (o === a || !o.alive || o.species !== s || o.kin) return;
    if (Math.hypot(o.x - a.x, o.y - a.y) < r) crowd++;
  });
  return crowd;
}

/**
 * The reproduction rules, as an explicit checklist (shown in the inspector and player HUD).
 * An animal can give birth only when every criterion is met.
 */
export function breedCriteria(a: Animal, eco: Ecosystem): Criterion[] {
  const s = a.species;
  const list: Criterion[] = [
    { label: 'Adult', ok: isMature(a) },
    { label: `Energy ≥ ${Math.round(s.breedThreshold * 100)}%`, ok: a.energy >= s.breedThreshold * s.maxEnergy },
    { label: 'Health ≥ 70%', ok: a.health >= a.maxHealth * 0.7 },
    { label: 'Rested since last birth', ok: a.breedCooldown <= 0 },
    { label: 'Calm (not fleeing / fighting)', ok: !['fleeing', 'hunting', 'fighting'].includes(a.behaviour) || (a.isPlayer && a.behaviour === 'hunting' && a.speed < 1) },
  ];
  if (s.trophic === 'herbivore') list.push({ label: `Plenty of ${eco.zone.food} here`, ok: eco.grass.at(a.x, a.y) >= 0.4 });
  if (!a.isPlayer) list.push({ label: s.trophic === 'predator' ? 'Own territory (no rival nearby)' : 'Herd not overcrowded', ok: crowding(a, eco) < s.crowdLimit });
  else {
    const m = a.mate;
    list.push({ label: m && m.alive ? 'Mate close by' : 'Have a mate (B near a calm adult)', ok: !!m && m.alive && Math.hypot(m.x - a.x, m.y - a.y) < 80 });
  }
  list.push({ label: 'Island not at capacity', ok: eco.livingCount() < SIM.maxAnimals });
  return list;
}

/** Creates the offspring and pays the energy cost. */
export function giveBirth(a: Animal, eco: Ecosystem): Animal {
  const s = a.species;
  a.energy -= s.breedCost * s.maxEnergy;
  a.breedCooldown = (s.breedCooldown * eco.rng.range(0.8, 1.2)) / eco.settings.reproduction;
  a.behaviour = 'reproducing';
  a.behaviourHold = 1.2;
  if (!a.isPlayer) a.desiredSpeed = 0;
  const bx = clamp(a.x + eco.rng.range(-10, 10), P.left + 6, P.right - 6);
  const by = clamp(a.y + eco.rng.range(4, 10), P.top + 6, P.bottom - 6);
  const baby = createAnimal(s, bx, by, eco.rng, false);
  baby.kin = a.isPlayer || a.kin;
  baby.parent = a;
  return baby;
}

/** AI animals breed automatically as soon as all criteria are met. */
export function tryReproduce(a: Animal, eco: Ecosystem): Animal | null {
  const s = a.species;
  // cheap early-outs before the full checklist
  if (a.breedCooldown > 0 || !isMature(a) || a.energy < s.breedThreshold * s.maxEnergy) return null;
  if (a.mate && a.mate.isPlayer) return null; // your mate only breeds with you
  const crit = breedCriteria(a, eco);
  if (!crit.every(c => c.ok)) {
    // blocked by crowding or capacity: try again a little later
    if (crit.some(c => !c.ok && (c.label.startsWith('Own territory') || c.label.startsWith('Herd') || c.label.startsWith('Island')))) a.breedCooldown = 4;
    return null;
  }
  return giveBirth(a, eco);
}
