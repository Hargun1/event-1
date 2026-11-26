import type { Animal } from './Animal.ts';
import { energyFrac, followParent } from './Animal.ts';
import { selectPrey, tryAttack } from '../systems/HuntingSystem.ts';
import type { Ecosystem } from '../systems/Ecosystem.ts';
import { aiFight, maybeChallenge } from '../systems/CombatSystem.ts';

function release(a: Animal): void {
  if (a.target && a.target.pursuedBy === a.id) a.target.pursuedBy = 0;
  a.target = null;
  a.chaseTime = 0;
}

function prowl(a: Animal, dt: number, eco: Ecosystem, speedFactor: number): void {
  a.wanderAngle += eco.rng.range(-1.2, 1.2) * dt;
  a.desiredHeading = a.wanderAngle;
  a.desiredSpeed = a.species.walkSpeed * speedFactor;
}

/**
 * Predator priorities:
 * 1. rest / feed after a hunt or a failed sprint  2. find eligible prey when hungry
 * 3. stalk → sprint → attack  4. wander when no food  (reproduction handled by LifecycleSystem)
 */
export function updatePredator(a: Animal, dt: number, eco: Ecosystem): void {
  const s = a.species;

  maybeChallenge(a, eco);
  if (aiFight(a, dt, eco)) { release(a); return; }

  if (a.restTime > 0) {
    a.restTime -= dt;
    a.desiredSpeed = 0;
    if (a.behaviour !== 'feeding' && a.behaviour !== 'reproducing') a.behaviour = 'resting';
    release(a);
    return;
  }
  if (a.behaviourHold > 0) { a.behaviourHold -= dt; a.desiredSpeed = 0; return; }

  // your mate stays by your side; when hungry it may hunt, but never strays far
  const mate = a.mate;
  if (mate && mate.alive && mate.isPlayer) {
    const d = Math.hypot(mate.x - a.x, mate.y - a.y);
    const hungry = energyFrac(a) < s.hungerThreshold;
    if (d > (hungry && a.behaviour === 'hunting' ? 240 : hungry ? 130 : 55)) {
      release(a);
      a.behaviour = 'following';
      a.desiredHeading = Math.atan2(mate.y - a.y, mate.x - a.x);
      a.desiredSpeed = Math.min(s.runSpeed * 0.85, Math.max(s.walkSpeed * 1.4, mate.speed * 1.1));
      return;
    }
  }

  // cubs tag along with their parent and are fed from its kills
  if (followParent(a, a.behaviour === 'following' ? 22 : 40)) { release(a); return; }

  // satisfied: lounge and patrol
  if (energyFrac(a) >= s.hungerThreshold) {
    release(a);
    a.thinkTimer -= dt;
    if (a.thinkTimer <= 0) { a.thinkTimer = eco.rng.range(2, 6); a.goalX = eco.rng.chance(0.5) ? 0 : 1; }
    a.behaviour = a.goalX === 0 ? 'resting' : 'wandering';
    if (a.goalX === 0) a.desiredSpeed = 0; else prowl(a, dt, eco, 0.6);
    return;
  }

  // choose / refresh a target (never switch mid-sprint)
  a.thinkTimer -= dt;
  if (!a.target || !a.target.alive || (a.behaviour !== 'hunting' && a.thinkTimer <= 0)) {
    a.thinkTimer = 0.5;
    const t = selectPrey(a, eco.grid, eco.preyShare);
    if (t !== a.target) { release(a); a.target = t; }
  }
  const t = a.target;
  if (!t) {
    a.behaviour = 'wandering';
    prowl(a, dt, eco, 1);
    return;
  }

  const d = Math.hypot(t.x - a.x, t.y - a.y);
  if (d > s.sight * 1.25 || t.hidden) {
    // lost sight of it (out of range or vanished into a thicket)
    if (t.hidden && a.behaviour === 'hunting') { a.restTime = s.restAfterChase * 0.5; a.behaviour = 'resting'; }
    release(a);
    if (a.restTime <= 0) a.behaviour = 'wandering';
    return;
  }

  // aim slightly ahead of moving prey
  const lead = Math.min(0.35, d / Math.max(1, s.runSpeed));
  a.desiredHeading = Math.atan2(t.y + Math.sin(t.heading) * t.speed * lead - a.y, t.x + Math.cos(t.heading) * t.speed * lead - a.x);

  if (a.behaviour !== 'hunting' && d > s.sprintRange && t.behaviour !== 'fleeing') {
    a.behaviour = 'stalking';
    a.desiredSpeed = s.stalkSpeed;
    return;
  }

  if (a.behaviour !== 'hunting') {
    a.behaviour = 'hunting';
    a.chaseTime = 0;
    eco.emit('hunt', `A ${s.name.toLowerCase()} is hunting a ${t.species.name.toLowerCase()}.`, 'chase', 2);
  }
  t.pursuedBy = a.id;
  a.desiredSpeed = s.runSpeed;
  a.chaseTime += dt;

  const res = tryAttack(a, t, eco.rng);
  if (res.killed) {
    eco.onKill(a, t);
    a.target = null;
    a.chaseTime = 0;
    a.behaviour = 'feeding';
    a.restTime = 10; // eating + digesting
    return;
  }
  if (a.chaseTime > s.stamina) {
    // out of breath — prey escaped
    release(a);
    a.behaviour = 'resting';
    a.restTime = s.restAfterChase;
    eco.emit('info', `A ${t.species.name.toLowerCase()} outran a ${s.name.toLowerCase()}.`, 'escape', 2);
  }
}
