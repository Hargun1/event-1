import { PLAYER } from '../config.ts';
import type { Animal } from '../entities/Animal.ts';
import { isMature } from '../entities/Animal.ts';
import { angleDiff } from '../utils/math.ts';
import type { Ecosystem } from './Ecosystem.ts';

/** Applies damage (after armour). Returns true if the hit was lethal. */
export function damage(target: Animal, amount: number, eco: Ecosystem, attacker: Animal): boolean {
  const dealt = Math.max(1, amount * (1 - target.species.armor));
  target.health -= dealt;
  target.hurtTimer = 0;
  eco.fx.push({ type: 'hit', id: target.id, x: target.x, y: target.y, amount: Math.round(dealt), onPlayer: target.isPlayer });
  if (target.health > 0) return false;
  target.alive = false;
  target.deathCause = attacker.isPlayer ? 'hunted' : 'fight';
  target.killedBy = attacker.isPlayer ? 'you' : attacker.species.name;
  return true;
}

/** Player swing: hits the best target inside the facing arc and reach. */
export function playerAttack(p: Animal, eco: Ecosystem): void {
  const s = p.species;
  p.strikeTimer = 0;
  p.attackCooldown = s.attackCooldown * 0.85;
  let best: Animal | null = null, bestScore = Infinity;
  const reach = s.radius + s.attackRange + PLAYER.reachBonus;
  eco.grid.query(p.x, p.y, reach + 30, o => {
    if (o === p || !o.alive) return;
    const d = Math.hypot(o.x - p.x, o.y - p.y) - o.species.radius;
    if (d > reach) return;
    const off = Math.abs(angleDiff(p.heading, Math.atan2(o.y - p.y, o.x - p.x)));
    if (off > PLAYER.attackArc && d > 4) return;
    const score = d + off * 20;
    if (score < bestScore) { bestScore = score; best = o; }
  });
  const t = best as Animal | null;
  if (!t) return;
  const sprinting = p.speed > s.walkSpeed * 2.2;
  const amount = s.attack * (sprinting ? 1.35 : 1) * eco.rng.range(0.85, 1.15);
  eco.playerStats.damage += amount;
  if (damage(t, amount, eco, p)) {
    eco.onPlayerKill(p, t);
    return;
  }
  // provoke: fighters strike back, and their herd / pack joins in
  if (t.species.attack > 0) {
    t.aggro = t.species.trophic === 'predator' ? 12 : 7;
    eco.grid.query(t.x, t.y, 160, o => {
      if (o !== t && o.alive && !o.isPlayer && o.species === t.species && o.species.herd >= 0.5 && isMature(o) && eco.rng.chance(0.5)) o.aggro = Math.max(o.aggro, 5);
    });
  }
}

/**
 * AI side of a fight against the player. Returns true if this animal is busy fighting (or fleeing the player).
 * Wounded animals break off and run.
 */
export function aiFight(a: Animal, dt: number, eco: Ecosystem): boolean {
  const p = eco.player;
  if (a.aggro <= 0 || !p || !p.alive) return false;
  a.aggro -= dt;
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  if (d > 320) { a.aggro = 0; return false; }
  const toPlayer = Math.atan2(p.y - a.y, p.x - a.x);
  if (a.health < a.maxHealth * 0.25) {
    a.behaviour = 'fleeing';
    a.desiredHeading = toPlayer + Math.PI;
    a.desiredSpeed = a.species.runSpeed;
    return true;
  }
  a.behaviour = 'fighting';
  a.target = null;
  a.desiredHeading = toPlayer;
  const reach = a.species.radius + p.species.radius + a.species.attackRange + 2;
  a.desiredSpeed = d > reach ? a.species.runSpeed * 0.9 : 0;
  if (d <= reach + 2 && a.attackCooldown <= 0 && eco.playerInvuln <= 0) {
    a.attackCooldown = a.species.attackCooldown * 1.3;
    a.strikeTimer = 0;
    if (damage(p, a.species.attack * eco.rng.range(0.8, 1.2), eco, a)) eco.onPlayerDeath(a);
  }
  return true;
}

/** Rival predators (and bulls of armed herbivores) may challenge a player who wanders into their space. */
export function maybeChallenge(a: Animal, eco: Ecosystem): void {
  const p = eco.player;
  if (!p || !p.alive || a.kin || a.aggro !== 0 || !isMature(a) || a.species.attack <= 0) return;
  if (a.species.trophic !== 'predator') return;
  if (a.energy < a.species.maxEnergy * 0.35 || a.health < a.maxHealth * 0.6) return;
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  const range = a.species === p.species ? 110 : 70;
  if (d > range) return;
  if (!eco.rng.chance(a.species === p.species ? 0.5 : 0.12)) { a.aggro = -8; return; } // decided not to — try again later
  a.aggro = 10;
  eco.emit('warn', `A rival ${a.species.name} challenges you!`, 'challenge', 3);
}
