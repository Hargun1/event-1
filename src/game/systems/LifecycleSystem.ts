import { PLAYER, SIM } from '../config.ts';
import type { Animal } from '../entities/Animal.ts';

/** Energy drain (metabolism + movement), health from hunger, ageing and natural death. */
export function updateLifecycle(a: Animal, dt: number): void {
  const s = a.species, h = SIM.health;
  a.age += dt;
  a.breedCooldown -= dt;
  a.hurtTimer += dt;
  if (!a.isPlayer) a.strikeTimer += dt;

  const sf = a.speed / s.runSpeed;
  const burn = (s.basalBurn + s.moveCost * sf * sf * 2) * (a.isPlayer ? PLAYER.energyBurnMult : 1);
  a.energy = Math.max(0, a.energy - burn * dt);

  const ef = a.energy / s.maxEnergy;
  if (a.energy <= 0) a.health -= h.starvingLoss * dt;
  else if (ef < h.hungryBelow) a.health -= h.hungryLoss * dt;
  else if (ef > h.regenAbove && a.hurtTimer > 3) a.health = Math.min(a.maxHealth, a.health + (a.isPlayer ? PLAYER.regen : h.regen) * dt);

  if (a.health <= 0) {
    a.alive = false;
    a.deathCause = 'starvation';
  } else if (!a.isPlayer && a.age > a.lifespan) {
    a.alive = false;
    a.deathCause = 'old age';
  }
}
