import { PLAYER } from '../config.ts';
import type { Animal } from './Animal.ts';
import { playerAttack } from '../systems/CombatSystem.ts';
import type { Ecosystem } from '../systems/Ecosystem.ts';

/** Input in world space: (mx, my) is the desired move direction, length 0..1. */
export interface PlayerInput {
  mx: number;
  my: number;
  sprint: boolean;
  attack: boolean;
}

export function createInput(): PlayerInput {
  return { mx: 0, my: 0, sprint: false, attack: false };
}

export function updatePlayer(p: Animal, dt: number, input: PlayerInput, eco: Ecosystem): void {
  const s = p.species;
  p.attackCooldown -= dt;
  const mag = Math.min(1, Math.hypot(input.mx, input.my));
  const sprinting = input.sprint && mag > 0.1 && p.stamina > 0.02;
  if (sprinting) p.stamina = Math.max(0, p.stamina - PLAYER.sprintDrain * dt);
  else p.stamina = Math.min(1, p.stamina + PLAYER.sprintRegen * dt);

  if (mag > 0.1) {
    p.desiredHeading = Math.atan2(input.my, input.mx);
    p.desiredSpeed = mag * (sprinting ? s.runSpeed : s.walkSpeed * 1.7);
  } else {
    p.desiredSpeed = 0;
  }

  if (input.attack && p.attackCooldown <= 0) playerAttack(p, eco);

  if (p.strikeTimer < 0.5) p.behaviour = 'fighting';
  else if (sprinting) p.behaviour = 'hunting';
  else if (mag > 0.1) p.behaviour = 'wandering';
  else p.behaviour = 'resting';
  p.strikeTimer += dt;
}
