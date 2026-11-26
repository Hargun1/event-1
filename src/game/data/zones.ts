import type { SpeciesId, ZoneId } from './species.ts';

export type PropKind = 'acacia' | 'tree' | 'bush' | 'rock' | 'cycad' | 'fern' | 'coral' | 'kelp';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  tagline: string;
  /** What herbivores eat here. */
  food: string;
  species: SpeciesId[];
  player: SpeciesId;
  defaults: Partial<Record<SpeciesId, number>>;
  /** Props placed in the arena and which of them give prey cover. */
  props: Partial<Record<PropKind, number>>;
  cover: PropKind[];
  /** Impassable lake / pond (land and dino zones). */
  lake: boolean;
  stream: boolean;
  underwater: boolean;
  terrainSeed: number;
  /** Vegetation growth multiplier for this biome. */
  growth: number;
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  dino: {
    id: 'dino', name: 'Dino Valley', tagline: 'Late Cretaceous floodplain. Rule it as the T. rex.',
    food: 'ferns',
    species: ['parasaurolophus', 'triceratops', 'stegosaurus', 'brachiosaurus', 'trex', 'velociraptor'],
    player: 'trex',
    defaults: { parasaurolophus: 18, triceratops: 14, stegosaurus: 8, brachiosaurus: 4, trex: 2, velociraptor: 4 },
    props: { cycad: 16, fern: 18, rock: 12, tree: 5 },
    cover: ['cycad'],
    lake: true, stream: false, underwater: false, terrainSeed: 911, growth: 1.45,
  },
  water: {
    id: 'water', name: 'Ocean Reef', tagline: 'A sunlit coral reef. Hunt as the shark.',
    food: 'sea-grass',
    species: ['reeffish', 'turtle', 'manta', 'shark', 'dolphin'],
    player: 'shark',
    defaults: { reeffish: 40, turtle: 12, manta: 6, shark: 2, dolphin: 3 },
    props: { coral: 12, kelp: 22, rock: 10 },
    cover: ['coral'],
    lake: false, stream: false, underwater: true, terrainSeed: 3131, growth: 1.35,
  },
  land: {
    id: 'land', name: 'Savanna', tagline: 'Today’s African plains. Lead the pride as the lion.',
    food: 'grass',
    species: ['gazelle', 'zebra', 'lion', 'cheetah'],
    player: 'lion',
    defaults: { gazelle: 25, zebra: 18, lion: 3, cheetah: 2 },
    props: { acacia: 7, tree: 6, bush: 14, rock: 10 },
    cover: ['bush', 'tree'],
    lake: true, stream: true, underwater: false, terrainSeed: 4242, growth: 1,
  },
};

export const ZONE_ORDER: ZoneId[] = ['dino', 'water', 'land'];

/** CC BY 4.0 credits for every model used (shown in the game). */
export const MODEL_CREDITS: string[] = [
  'Tyrannosaurus Rex', 'Velociraptor', 'Triceratops', 'Parasaurolophus', 'Stegosaurus', 'Brachiosaurus', 'Cycad',
  'Shark', 'Dolphin', 'Reef Fish', 'Sea Turtle', 'Manta Ray', 'Coral Reef', 'Jellyfish',
  'Lion', 'Cheetah', 'Zebra', 'Thomson’s Gazelle',
];
