import type { Animal } from '../entities/Animal.ts';
import type { GrassField } from '../entities/GrassPatch.ts';
import type { Rng } from '../utils/random.ts';

/** Herbivore feeding: graze the current patch or walk toward the best nearby one. Returns false if no food found. */
export function seekAndGraze(a: Animal, dt: number, grass: GrassField, rng: Rng): boolean {
  const s = a.species;
  if (grass.at(a.x, a.y) > s.grazeMin) {
    const eaten = grass.eat(a.x, a.y, s.grazeRate * dt);
    a.energy = Math.min(s.maxEnergy, a.energy + eaten * s.grassEnergy);
    a.behaviour = 'grazing';
    a.desiredSpeed = 0;
    a.hasGoal = false;
    return true;
  }
  a.thinkTimer -= dt;
  const reached = Math.hypot(a.goalX - a.x, a.goalY - a.y) < 6;
  if (!a.hasGoal || reached || a.thinkTimer <= 0) {
    const near = grass.findNear(a.x, a.y, 5, s.grazeMin + 0.1, rng) ?? grass.findFar(a.x, a.y, rng);
    a.thinkTimer = near ? 0.8 + Math.hypot(near.x - a.x, near.y - a.y) / 60 : 0.8;
    a.hasGoal = !!near;
    if (near) { a.goalX = near.x; a.goalY = near.y; }
  }
  a.behaviour = 'searching';
  if (a.hasGoal) {
    a.desiredHeading = Math.atan2(a.goalY - a.y, a.goalX - a.x);
    a.desiredSpeed = s.walkSpeed * 1.35;
    return true;
  }
  a.wanderAngle += rng.range(-1.5, 1.5) * dt;
  a.desiredHeading = a.wanderAngle;
  a.desiredSpeed = s.walkSpeed * 1.2;
  return false;
}
