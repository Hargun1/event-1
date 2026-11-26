/** Central world + simulation configuration. All balancing numbers live here or in data/species.ts. */
import type { SpeciesId, ZoneId } from './data/species.ts';
import { ZONES } from './data/zones.ts';

export const WORLD = {
  width: 1280,
  height: 768,
  /** Playable area inside the arena boundary. */
  play: { left: 46, top: 64, right: 1234, bottom: 714 },
  cell: 32,
  /** Sim units → three.js metres. */
  scale: 0.1,
} as const;

export const GRID_W = WORLD.width / WORLD.cell; // 40
export const GRID_H = WORLD.height / WORLD.cell; // 24

export const SIM = {
  fixedDt: 1 / 30,
  daySeconds: 12,
  maxAnimals: 320,
  grassGrowth: 0.022,
  grassFloor: 0.03,
  sampleEvery: 0.25,
  historyMax: 480,
  coverCapacity: 2,
  health: { starvingLoss: 22, hungryLoss: 4, hungryBelow: 0.18, regen: 3, regenAbove: 0.45 },
} as const;

/** Player-controlled animal tuning. */
export const PLAYER = {
  healthMult: 2.2,
  energyBurnMult: 0.55,
  regen: 6,
  sprintDrain: 0.28,
  sprintRegen: 0.18,
  attackArc: 1.2, // radians either side of facing
  reachBonus: 10,
  respawnInvuln: 3,
} as const;

export interface SimSettings {
  zone: ZoneId;
  populations: Partial<Record<SpeciesId, number>>;
  grassGrowth: number;
  reproduction: number;
  initialGrass: number;
  seed: number;
  randomizeSeed: boolean;
}

export function defaultSettings(zone: ZoneId): SimSettings {
  return {
    zone,
    populations: { ...ZONES[zone].defaults },
    grassGrowth: 1,
    reproduction: 1,
    initialGrass: 0.75,
    seed: 20251,
    randomizeSeed: true,
  };
}

export const RANGES = {
  population: { min: 0, max: 60, step: 1 },
  grassGrowth: { min: 0, max: 3, step: 0.05 },
  reproduction: { min: 0.25, max: 3, step: 0.05 },
  initialGrass: { min: 0.1, max: 1, step: 0.05 },
  seed: { min: 1, max: 999_999, step: 1 },
} as const;
