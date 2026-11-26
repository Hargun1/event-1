import type { SpeciesId } from './species.ts';

export interface PreyLink {
  /** Higher = preferred target. */
  priority: number;
  /** Probability that an attack on contact succeeds. */
  success: number;
}

/**
 * THE food web. An AI predator may only detect, chase and eat species listed here.
 * Herbivores eat vegetation (grass / ferns / sea-grass) and appear only as prey.
 * The player can attack anything, but only gains energy from animals with meat.
 */
export const FOOD_WEB: Partial<Record<SpeciesId, Partial<Record<SpeciesId, PreyLink>>>> = {
  lion: { zebra: { priority: 1.0, success: 0.4 }, gazelle: { priority: 0.8, success: 0.6 } },
  cheetah: { gazelle: { priority: 1.0, success: 0.55 } },

  trex: {
    triceratops: { priority: 0.8, success: 0.4 },
    parasaurolophus: { priority: 0.9, success: 0.6 },
    stegosaurus: { priority: 0.9, success: 0.35 },
    brachiosaurus: { priority: 0.1, success: 0.15 },
  },
  velociraptor: { parasaurolophus: { priority: 1.0, success: 0.45 } },

  shark: {
    turtle: { priority: 1.0, success: 0.45 },
    manta: { priority: 0.8, success: 0.4 },
    reeffish: { priority: 0.5, success: 0.55 },
    dolphin: { priority: 0.3, success: 0.25 },
  },
  dolphin: { reeffish: { priority: 1.0, success: 0.4 } },
};

export function preyLink(predator: SpeciesId, prey: SpeciesId): PreyLink | undefined {
  return FOOD_WEB[predator]?.[prey];
}

export function canEat(predator: SpeciesId, prey: SpeciesId): boolean {
  return preyLink(predator, prey) !== undefined;
}
