import { SIM } from '../config.ts';
import type { SpeciesDef } from '../data/species.ts';
import type { Rng } from '../utils/random.ts';

export type Behaviour =
  | 'wandering' | 'searching' | 'grazing' | 'fleeing'
  | 'stalking' | 'hunting' | 'feeding' | 'resting' | 'reproducing' | 'hiding' | 'fighting';

export type DeathCause = 'hunted' | 'starvation' | 'old age' | 'fight';

export interface Animal {
  id: number;
  species: SpeciesDef;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Desired heading/speed set by behaviour, applied by MovementSystem. */
  desiredHeading: number;
  desiredSpeed: number;

  energy: number;
  health: number;
  /** Seconds lived. */
  age: number;
  lifespan: number;
  breedCooldown: number;

  behaviour: Behaviour;
  /** Seconds to keep a transient behaviour label (e.g. reproducing). */
  behaviourHold: number;
  target: Animal | null;
  goalX: number;
  goalY: number;
  hasGoal: boolean;
  thinkTimer: number;
  wanderAngle: number;

  // predator state
  chaseTime: number;
  restTime: number;
  attackCooldown: number;
  /** Id of predator currently chasing this prey (for UI / fleeing). */
  pursuedBy: number;
  /** Herbivore sheltering in a thicket — invisible to predators. */
  hidden: boolean;

  // combat
  isPlayer: boolean;
  /** Seconds this animal stays aggressive toward the player. */
  aggro: number;
  /** Seconds since last damage (renderer flashes / shows health bar). */
  hurtTimer: number;
  /** Seconds since this animal last attacked (renderer plays the strike). */
  strikeTimer: number;
  /** Sprint stamina 0..1 (player). */
  stamina: number;
  maxHealth: number;

  alive: boolean;
  deathCause: DeathCause | null;
  killedBy: string | null;
  /** Animation phase advanced by movement (renderer reads it). */
  stride: number;
}

let nextId = 1;

export function createAnimal(species: SpeciesDef, x: number, y: number, rng: Rng, adult: boolean): Animal {
  const day = SIM.daySeconds;
  return {
    id: nextId++,
    species, x, y,
    heading: rng.range(0, Math.PI * 2),
    speed: 0,
    desiredHeading: 0,
    desiredSpeed: 0,
    // predator cubs are fed by the parent, so they start fuller
    energy: species.maxEnergy * (adult ? rng.range(0.6, 0.85) : species.trophic === 'predator' ? 0.75 : 0.35),
    health: species.maxHealth,
    maxHealth: species.maxHealth,
    age: adult ? rng.range(species.matureDays, species.lifespanDays * 0.45) * day : 0,
    lifespan: species.lifespanDays * day * rng.range(0.85, 1.15),
    breedCooldown: species.breedCooldown * (adult ? rng.range(0.3, 1) : 1),
    behaviour: 'wandering',
    behaviourHold: 0,
    target: null,
    goalX: x, goalY: y, hasGoal: false,
    thinkTimer: rng.range(0, 0.5),
    wanderAngle: rng.range(0, Math.PI * 2),
    chaseTime: 0, restTime: 0, attackCooldown: 0, pursuedBy: 0, hidden: false,
    isPlayer: false, aggro: 0, hurtTimer: 99, strikeTimer: 99, stamina: 1,
    alive: true, deathCause: null, killedBy: null,
    stride: rng.range(0, 2),
  };
}

export function isMature(a: Animal): boolean {
  return a.age >= a.species.matureDays * SIM.daySeconds;
}

export function energyFrac(a: Animal): number {
  return a.energy / a.species.maxEnergy;
}
