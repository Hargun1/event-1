import { SIM } from '../config.ts';
import type { Animal } from '../entities/Animal.ts';
import { createAnimal, isMature } from '../entities/Animal.ts';
import { clamp } from '../utils/math.ts';
import { WORLD } from '../config.ts';
import type { Ecosystem } from './Ecosystem.ts';

const P = WORLD.play;

/**
 * Healthy, mature, well-fed animals give birth after a cooldown. Costs energy.
 * Density-dependent: crowded herds and overlapping predator territories suppress breeding.
 */
export function tryReproduce(a: Animal, eco: Ecosystem): Animal | null {
  const s = a.species;
  if (a.breedCooldown > 0 || !isMature(a)) return null;
  if (a.energy < s.breedThreshold * s.maxEnergy || a.health < a.maxHealth * 0.7) return null;
  if (a.behaviour === 'fleeing' || a.behaviour === 'hunting') return null;
  // herbivores only breed where food is plentiful (density-dependent birth rate)
  if (s.trophic === 'herbivore' && eco.grass.at(a.x, a.y) < 0.4) return null;
  if (eco.livingCount() >= SIM.maxAnimals) { a.breedCooldown = 4; return null; }

  let crowd = 0;
  const r = s.crowdRadius;
  eco.grid.query(a.x, a.y, r, o => {
    if (o === a || !o.alive) return;
    const same = o.species === s;
    if (same && Math.hypot(o.x - a.x, o.y - a.y) < r) crowd++;
  });
  if (crowd >= s.crowdLimit) { a.breedCooldown = 4; return null; }

  a.energy -= s.breedCost * s.maxEnergy;
  a.breedCooldown = (s.breedCooldown * eco.rng.range(0.8, 1.2)) / eco.settings.reproduction;
  a.behaviour = 'reproducing';
  a.behaviourHold = 1.2;
  a.desiredSpeed = 0;
  const bx = clamp(a.x + eco.rng.range(-10, 10), P.left + 6, P.right - 6);
  const by = clamp(a.y + eco.rng.range(4, 10), P.top + 6, P.bottom - 6);
  return createAnimal(s, bx, by, eco.rng, false);
}
