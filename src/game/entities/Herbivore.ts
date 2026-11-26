import type { Animal } from './Animal.ts';
import { energyFrac, followParent } from './Animal.ts';
import { canEat } from '../data/foodWeb.ts';
import { seekAndGraze } from '../systems/FeedingSystem.ts';
import { angleDiff } from '../utils/math.ts';
import type { Ecosystem } from '../systems/Ecosystem.ts';
import { aiFight } from '../systems/CombatSystem.ts';

/** Direction to the centre of nearby same-species animals, or null if alone / already close. */
function herdPull(a: Animal, eco: Ecosystem, radius: number): { angle: number; dist: number } | null {
  let sx = 0, sy = 0, n = 0;
  eco.grid.query(a.x, a.y, radius, o => {
    if (o === a || !o.alive || o.species !== a.species) return;
    if (Math.abs(o.x - a.x) > radius || Math.abs(o.y - a.y) > radius) return;
    sx += o.x; sy += o.y; n++;
  });
  if (!n) return null;
  const cx = sx / n, cy = sy / n;
  return { angle: Math.atan2(cy - a.y, cx - a.x), dist: Math.hypot(cx - a.x, cy - a.y) };
}

/**
 * Herbivore priorities:
 * 1. escape predators that eat this species  2. find/eat grass when hungry
 * 3. reproduce (LifecycleSystem)  4. wander / stay with herd
 */
export function updateHerbivore(a: Animal, dt: number, eco: Ecosystem): void {
  const s = a.species;

  // 0. an armed herbivore that was attacked turns and fights
  if (aiFight(a, dt, eco)) return;

  // 1. danger
  let fx = 0, fy = 0, threats = 0;
  // at night prey notice danger later — predators' best hunting time
  const nightVision = 1 - eco.darkness() * 0.3;
  eco.grid.query(a.x, a.y, s.sight, o => {
    if (!o.alive || o.species.trophic !== 'predator' || !(o.isPlayer || canEat(o.species.id, s.id))) return;
    const dx = a.x - o.x, dy = a.y - o.y, d = Math.hypot(dx, dy) || 1;
    // a stalking predator is noticed later than one sprinting or walking openly
    const detect = s.sight * (o.behaviour === 'stalking' ? o.species.stealth : o.behaviour === 'hunting' ? 1 : 0.8) * nightVision;
    if (d > detect) return;
    fx += dx / (d * d); fy += dy / (d * d); threats++;
  });
  if (threats > 0) {
    if (a.hidden) {
      a.behaviour = 'hiding';
      a.desiredSpeed = 0;
      a.hasGoal = false;
      return;
    }
    let flee = Math.atan2(fy, fx);
    // dash for the nearest free thicket if it isn't toward the danger
    const cover = eco.nearestCover(a, 150);
    if (cover) {
      const ca = Math.atan2(cover.y - a.y, cover.x - a.x);
      if (Math.abs(angleDiff(flee, ca)) < 1.7) flee = ca;
    }
    if (s.herd > 0) {
      const h = herdPull(a, eco, 90);
      if (h && h.dist > 25) flee += angleDiff(flee, h.angle) * 0.2 * s.herd;
    }
    a.behaviour = 'fleeing';
    a.desiredHeading = flee;
    a.desiredSpeed = s.runSpeed;
    a.hasGoal = false;
    a.behaviourHold = 0;
    return;
  }
  a.pursuedBy = 0;

  // short "reproducing" pause after giving birth
  if (a.behaviourHold > 0) {
    a.behaviourHold -= dt;
    a.desiredSpeed = 0;
    return;
  }

  // 3. young stay close to their mother (they graze beside her)
  if (followParent(a, a.behaviour === 'following' ? 18 : 34)) return;
  if (a.mate && a.mate.alive && a.mate.isPlayer && Math.hypot(a.mate.x - a.x, a.mate.y - a.y) > 55) {
    a.behaviour = 'following';
    a.desiredHeading = Math.atan2(a.mate.y - a.y, a.mate.x - a.x);
    a.desiredSpeed = s.walkSpeed * 1.6;
    return;
  }

  // 2. food
  if (energyFrac(a) < s.hungerThreshold) {
    // zebras won't stray far from the herd while looking for food
    if (s.herd > 0.5 && a.behaviour !== 'grazing' && energyFrac(a) > 0.5) {
      const h = herdPull(a, eco, 150);
      if (h && h.dist > 70) {
        a.behaviour = 'wandering';
        a.desiredHeading = h.angle;
        a.desiredSpeed = s.walkSpeed * 1.3;
        return;
      }
    }
    seekAndGraze(a, dt, eco.grass, eco.rng);
    return;
  }

  // 4. wander, loosely following the herd
  a.behaviour = 'wandering';
  a.wanderAngle += eco.rng.range(-1.6, 1.6) * dt;
  let heading = a.wanderAngle;
  if (s.herd > 0) {
    const h = herdPull(a, eco, 140);
    if (h && h.dist > 45) heading += angleDiff(heading, h.angle) * s.herd;
  }
  a.desiredHeading = heading;
  // amble with occasional stops so herds look alive
  a.thinkTimer -= dt;
  if (a.thinkTimer <= 0) { a.thinkTimer = eco.rng.range(1.5, 4); a.goalX = eco.rng.chance(0.35) ? 0 : 1; }
  a.desiredSpeed = a.goalX === 0 ? 0 : s.walkSpeed * 0.7;
}
