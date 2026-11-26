import type { Animal } from '../entities/Animal.ts';
import { preyLink } from '../data/foodWeb.ts';
import type { SpatialGrid } from './SpatialGrid.ts';
import type { Rng } from '../utils/random.ts';

/** Picks the best eligible prey (food web only) by distance, priority and catchability. */
/** `abundance` = share of each prey species in the population; predators switch toward common prey. */
export function selectPrey(pred: Animal, grid: SpatialGrid<Animal>, abundance: Record<string, number>): Animal | null {
  const s = pred.species, r = s.sight;
  let best: Animal | null = null, bestScore = Infinity;
  grid.query(pred.x, pred.y, r, o => {
    if (!o.alive || o === pred || o.hidden || o.isPlayer) return;
    const link = preyLink(s.id, o.species.id);
    if (!link) return; // not in this predator's diet
    const d = Math.hypot(o.x - pred.x, o.y - pred.y);
    if (d > r) return;
    // prefer prey that isn't already being chased by another predator
    const contested = o.pursuedBy && o.pursuedBy !== pred.id ? 1.6 : 1;
    const common = 0.4 + (abundance[o.species.id] ?? 0) * 1.6;
    // predators learn which prey they can actually outrun
    const catchable = s.runSpeed > o.species.runSpeed * 1.05 ? 1 : 0.2;
    const score = (d * contested) / (link.priority * (0.4 + link.success) * common * catchable);
    if (score < bestScore) { bestScore = score; best = o; }
  });
  return best;
}

export interface AttackResult { hit: boolean; killed: boolean }

/** Resolves an attack on contact. Only living, eligible prey can be killed, exactly once. */
export function tryAttack(pred: Animal, prey: Animal, rng: Rng): AttackResult {
  const link = preyLink(pred.species.id, prey.species.id);
  if (!link || !prey.alive || pred.attackCooldown > 0) return { hit: false, killed: false };
  const reach = pred.species.radius + prey.species.radius + pred.species.attackRange;
  if (Math.hypot(prey.x - pred.x, prey.y - pred.y) > reach) return { hit: false, killed: false };
  pred.attackCooldown = pred.species.attackCooldown;
  // a fleeing prey at full speed is harder to bring down; juveniles / weak prey easier
  const weak = prey.health < prey.maxHealth * 0.5 ? 0.15 : 0;
  const chance = Math.min(0.95, link.success + weak);
  if (!rng.chance(chance)) return { hit: true, killed: false };
  prey.alive = false;
  prey.deathCause = 'hunted';
  prey.killedBy = pred.species.name;
  pred.energy = Math.min(pred.species.maxEnergy, pred.energy + prey.species.meatValue);
  return { hit: true, killed: true };
}
