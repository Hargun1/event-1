export type ZoneId = 'land' | 'dino' | 'water';
export type SpeciesId =
  | 'gazelle' | 'zebra' | 'lion' | 'cheetah'
  | 'triceratops' | 'parasaurolophus' | 'stegosaurus' | 'brachiosaurus' | 'trex' | 'velociraptor'
  | 'reeffish' | 'turtle' | 'manta' | 'shark' | 'dolphin';
export type Trophic = 'herbivore' | 'predator';

export interface SpeciesDef {
  id: SpeciesId;
  zone: ZoneId;
  name: string;
  plural: string;
  trophic: Trophic;
  color: string;

  /** GLB file in /models, its rendered body length (sim units) and clip names. */
  model: string;
  modelLength: number;
  anims: { idle: string; walk: string; run: string; attack?: string };
  /** Swims in open water (rendered at depth). */
  swims: boolean;

  radius: number;
  maxEnergy: number;
  maxHealth: number;
  basalBurn: number;
  moveCost: number;
  walkSpeed: number;
  runSpeed: number;
  stalkSpeed: number;
  turnRate: number;
  sight: number;
  stealth: number;

  grazeRate: number;
  grassEnergy: number;
  grazeMin: number;
  meatValue: number;

  hungerThreshold: number;
  breedThreshold: number;
  breedCost: number;
  breedCooldown: number;
  matureDays: number;
  lifespanDays: number;

  stamina: number;
  restAfterChase: number;
  sprintRange: number;
  attackRange: number;
  attackCooldown: number;
  crowdLimit: number;
  crowdRadius: number;
  herd: number;

  /** Combat: damage per hit (0 = cannot fight back) and fraction of damage absorbed. */
  attack: number;
  armor: number;
}

type Base = Omit<SpeciesDef, 'id' | 'zone' | 'name' | 'plural' | 'trophic' | 'color' | 'model' | 'modelLength' | 'anims' | 'swims'>;

const HERB_DEFAULTS = { stalkSpeed: 0, stealth: 1, stamina: 0, restAfterChase: 0, sprintRange: 0, attackRange: 6, attackCooldown: 1.1 };
const PRED_DEFAULTS = { grazeRate: 0, grassEnergy: 0, grazeMin: 1 };

function herb(b: Omit<Base, keyof typeof HERB_DEFAULTS>): Base { return { ...HERB_DEFAULTS, ...b }; }
function pred(b: Omit<Base, keyof typeof PRED_DEFAULTS>): Base { return { ...PRED_DEFAULTS, ...b }; }

const DINO_ANIMS = { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Roar' };
const MAMMAL_ANIMS = { idle: 'Idle', walk: 'Walk', run: 'Run' };

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  // ------------------------------------------------------------------ SAVANNA (current-gen)
  gazelle: {
    id: 'gazelle', zone: 'land', name: 'Gazelle', plural: 'Gazelles', trophic: 'herbivore', color: '#d39a4a',
    model: 'thomsons-gazelle.glb', modelLength: 15, anims: MAMMAL_ANIMS, swims: false,
    ...herb({
      radius: 7, maxEnergy: 100, maxHealth: 70, basalBurn: 1.25, moveCost: 1.4,
      walkSpeed: 26, runSpeed: 96, turnRate: 6, sight: 115,
      grazeRate: 0.45, grassEnergy: 42, grazeMin: 0.3, meatValue: 95,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.42, breedCooldown: 46, matureDays: 4, lifespanDays: 38,
      crowdLimit: 7, crowdRadius: 46, herd: 0.25, attack: 0, armor: 0,
    }),
  },
  zebra: {
    id: 'zebra', zone: 'land', name: 'Zebra', plural: 'Zebras', trophic: 'herbivore', color: '#5b6b78',
    model: 'zebra.glb', modelLength: 26, anims: MAMMAL_ANIMS, swims: false,
    ...herb({
      radius: 9, maxEnergy: 150, maxHealth: 130, basalBurn: 1.5, moveCost: 1.8,
      walkSpeed: 22, runSpeed: 80, turnRate: 4.5, sight: 150,
      grazeRate: 0.6, grassEnergy: 44, grazeMin: 0.07, meatValue: 150,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.4, breedCooldown: 26, matureDays: 5, lifespanDays: 48,
      crowdLimit: 8, crowdRadius: 50, herd: 0.7, attack: 6, armor: 0.05,
    }),
  },
  lion: {
    id: 'lion', zone: 'land', name: 'Lion', plural: 'Lions', trophic: 'predator', color: '#c9822b',
    model: 'lion.glb', modelLength: 30, anims: MAMMAL_ANIMS, swims: false,
    ...pred({
      radius: 10, maxEnergy: 260, maxHealth: 160, basalBurn: 2.7, moveCost: 2.4,
      walkSpeed: 24, runSpeed: 92, stalkSpeed: 28, turnRate: 4.2, sight: 230, stealth: 0.5,
      meatValue: 120, hungerThreshold: 0.55, breedThreshold: 0.7, breedCost: 0.4, breedCooldown: 110, matureDays: 6, lifespanDays: 50,
      stamina: 6, restAfterChase: 5, sprintRange: 70, attackRange: 6, attackCooldown: 0.9,
      crowdLimit: 1, crowdRadius: 380, herd: 0, attack: 24, armor: 0.15,
    }),
  },
  cheetah: {
    id: 'cheetah', zone: 'land', name: 'Cheetah', plural: 'Cheetahs', trophic: 'predator', color: '#d8b04a',
    model: 'cheetah.glb', modelLength: 26, anims: { ...MAMMAL_ANIMS, attack: 'Roar' }, swims: false,
    ...pred({
      radius: 8, maxEnergy: 170, maxHealth: 110, basalBurn: 2.2, moveCost: 2.8,
      walkSpeed: 28, runSpeed: 128, stalkSpeed: 26, turnRate: 6.5, sight: 210, stealth: 0.55,
      meatValue: 90, hungerThreshold: 0.55, breedThreshold: 0.7, breedCost: 0.4, breedCooldown: 75, matureDays: 5, lifespanDays: 40,
      stamina: 2.8, restAfterChase: 7, sprintRange: 80, attackRange: 6, attackCooldown: 0.8,
      crowdLimit: 1, crowdRadius: 280, herd: 0, attack: 13, armor: 0.05,
    }),
  },

  // ------------------------------------------------------------------ DINO VALLEY
  parasaurolophus: {
    id: 'parasaurolophus', zone: 'dino', name: 'Parasaurolophus', plural: 'Parasaurolophus', trophic: 'herbivore', color: '#6aa86a',
    model: 'parasaurolophus.glb', modelLength: 40, anims: DINO_ANIMS, swims: false,
    ...herb({
      radius: 11, maxEnergy: 140, maxHealth: 130, basalBurn: 1.6, moveCost: 1.6,
      walkSpeed: 26, runSpeed: 100, turnRate: 5, sight: 160,
      grazeRate: 0.55, grassEnergy: 42, grazeMin: 0.3, meatValue: 150,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.42, breedCooldown: 44, matureDays: 4, lifespanDays: 40,
      crowdLimit: 7, crowdRadius: 60, herd: 0.5, attack: 0, armor: 0,
    }),
  },
  triceratops: {
    id: 'triceratops', zone: 'dino', name: 'Triceratops', plural: 'Triceratops', trophic: 'herbivore', color: '#7d8f5a',
    model: 'triceratops.glb', modelLength: 46, anims: DINO_ANIMS, swims: false,
    ...herb({
      radius: 14, maxEnergy: 220, maxHealth: 260, basalBurn: 2.1, moveCost: 2.4,
      walkSpeed: 20, runSpeed: 74, turnRate: 3.8, sight: 160,
      grazeRate: 0.8, grassEnergy: 44, grazeMin: 0.07, meatValue: 240,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.4, breedCooldown: 30, matureDays: 5, lifespanDays: 50,
      crowdLimit: 8, crowdRadius: 75, herd: 0.7, attack: 26, armor: 0.35,
    }),
  },
  stegosaurus: {
    id: 'stegosaurus', zone: 'dino', name: 'Stegosaurus', plural: 'Stegosaurus', trophic: 'herbivore', color: '#b07a4a',
    model: 'stegosaurus.glb', modelLength: 44, anims: DINO_ANIMS, swims: false,
    ...herb({
      radius: 13, maxEnergy: 200, maxHealth: 240, basalBurn: 1.9, moveCost: 2.2,
      walkSpeed: 18, runSpeed: 58, turnRate: 3.5, sight: 130,
      grazeRate: 0.7, grassEnergy: 44, grazeMin: 0.2, meatValue: 220,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.4, breedCooldown: 60, matureDays: 5, lifespanDays: 50,
      crowdLimit: 7, crowdRadius: 70, herd: 0.3, attack: 30, armor: 0.3,
    }),
  },
  brachiosaurus: {
    id: 'brachiosaurus', zone: 'dino', name: 'Brachiosaurus', plural: 'Brachiosaurus', trophic: 'herbivore', color: '#8aa0a8',
    model: 'brachiosaurus.glb', modelLength: 80, anims: DINO_ANIMS, swims: false,
    ...herb({
      radius: 20, maxEnergy: 400, maxHealth: 520, basalBurn: 3.2, moveCost: 3,
      walkSpeed: 16, runSpeed: 46, turnRate: 2.6, sight: 190,
      grazeRate: 1.3, grassEnergy: 44, grazeMin: 0.1, meatValue: 380,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.4, breedCooldown: 50, matureDays: 6, lifespanDays: 80,
      crowdLimit: 4, crowdRadius: 130, herd: 0.6, attack: 22, armor: 0.3,
    }),
  },
  trex: {
    id: 'trex', zone: 'dino', name: 'T. rex', plural: 'T. rexes', trophic: 'predator', color: '#b5562f',
    model: 'tyrannosaurus-rex.glb', modelLength: 62, anims: DINO_ANIMS, swims: false,
    ...pred({
      radius: 16, maxEnergy: 420, maxHealth: 320, basalBurn: 3.8, moveCost: 3.2,
      walkSpeed: 26, runSpeed: 88, stalkSpeed: 30, turnRate: 3.2, sight: 260, stealth: 0.55,
      meatValue: 260, hungerThreshold: 0.55, breedThreshold: 0.7, breedCost: 0.4, breedCooldown: 160, matureDays: 6, lifespanDays: 60,
      stamina: 6, restAfterChase: 5, sprintRange: 75, attackRange: 8, attackCooldown: 1,
      crowdLimit: 1, crowdRadius: 420, herd: 0, attack: 36, armor: 0.2,
    }),
  },
  velociraptor: {
    id: 'velociraptor', zone: 'dino', name: 'Velociraptor', plural: 'Velociraptors', trophic: 'predator', color: '#c9a03a',
    model: 'velociraptor.glb', modelLength: 20, anims: DINO_ANIMS, swims: false,
    ...pred({
      radius: 6, maxEnergy: 120, maxHealth: 80, basalBurn: 1.9, moveCost: 2.6,
      walkSpeed: 30, runSpeed: 130, stalkSpeed: 28, turnRate: 7, sight: 220, stealth: 0.5,
      meatValue: 70, hungerThreshold: 0.55, breedThreshold: 0.7, breedCost: 0.4, breedCooldown: 70, matureDays: 5, lifespanDays: 38,
      stamina: 3.4, restAfterChase: 6, sprintRange: 85, attackRange: 6, attackCooldown: 0.7,
      crowdLimit: 2, crowdRadius: 260, herd: 0.4, attack: 10, armor: 0,
    }),
  },

  // ------------------------------------------------------------------ OCEAN REEF
  reeffish: {
    id: 'reeffish', zone: 'water', name: 'Reef fish', plural: 'Reef fish', trophic: 'herbivore', color: '#f08a3c',
    model: 'reef-fish.glb', modelLength: 10, anims: { idle: 'Swim', walk: 'Swim', run: 'Dart' }, swims: true,
    ...herb({
      radius: 4, maxEnergy: 70, maxHealth: 40, basalBurn: 0.95, moveCost: 1.2,
      walkSpeed: 24, runSpeed: 100, turnRate: 7, sight: 95,
      grazeRate: 0.32, grassEnergy: 42, grazeMin: 0.15, meatValue: 55,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.42, breedCooldown: 24, matureDays: 3, lifespanDays: 30,
      crowdLimit: 10, crowdRadius: 40, herd: 0.6, attack: 0, armor: 0,
    }),
  },
  turtle: {
    id: 'turtle', zone: 'water', name: 'Sea turtle', plural: 'Sea turtles', trophic: 'herbivore', color: '#5c9b6e',
    model: 'sea-turtle.glb', modelLength: 20, anims: { idle: 'Swim', walk: 'Swim', run: 'Swim' }, swims: true,
    ...herb({
      radius: 7, maxEnergy: 150, maxHealth: 160, basalBurn: 1.3, moveCost: 1.6,
      walkSpeed: 18, runSpeed: 62, turnRate: 4, sight: 140,
      grazeRate: 0.55, grassEnergy: 44, grazeMin: 0.07, meatValue: 140,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.4, breedCooldown: 45, matureDays: 5, lifespanDays: 60,
      crowdLimit: 8, crowdRadius: 50, herd: 0.2, attack: 0, armor: 0.5,
    }),
  },
  manta: {
    id: 'manta', zone: 'water', name: 'Manta ray', plural: 'Manta rays', trophic: 'herbivore', color: '#3f5f86',
    model: 'manta-ray.glb', modelLength: 34, anims: { idle: 'Swim', walk: 'Swim', run: 'Swim' }, swims: true,
    ...herb({
      radius: 10, maxEnergy: 170, maxHealth: 150, basalBurn: 1.6, moveCost: 1.8,
      walkSpeed: 22, runSpeed: 82, turnRate: 3.5, sight: 150,
      grazeRate: 0.65, grassEnergy: 44, grazeMin: 0.1, meatValue: 150,
      hungerThreshold: 0.82, breedThreshold: 0.72, breedCost: 0.4, breedCooldown: 55, matureDays: 5, lifespanDays: 55,
      crowdLimit: 6, crowdRadius: 70, herd: 0.3, attack: 0, armor: 0.1,
    }),
  },
  shark: {
    id: 'shark', zone: 'water', name: 'Shark', plural: 'Sharks', trophic: 'predator', color: '#6d7f8f',
    model: 'shark.glb', modelLength: 42, anims: { idle: 'Swim', walk: 'Swim', run: 'Fast' }, swims: true,
    ...pred({
      radius: 10, maxEnergy: 260, maxHealth: 200, basalBurn: 2.6, moveCost: 2.4,
      walkSpeed: 26, runSpeed: 96, stalkSpeed: 30, turnRate: 4, sight: 240, stealth: 0.5,
      meatValue: 160, hungerThreshold: 0.55, breedThreshold: 0.7, breedCost: 0.4, breedCooldown: 110, matureDays: 6, lifespanDays: 50,
      stamina: 6, restAfterChase: 5, sprintRange: 75, attackRange: 6, attackCooldown: 0.9,
      crowdLimit: 1, crowdRadius: 380, herd: 0, attack: 28, armor: 0.15,
    }),
  },
  dolphin: {
    id: 'dolphin', zone: 'water', name: 'Dolphin', plural: 'Dolphins', trophic: 'predator', color: '#7fa6c4',
    model: 'dolphin.glb', modelLength: 30, anims: { idle: 'Swim', walk: 'Swim', run: 'Swim', attack: 'Leap' }, swims: true,
    ...pred({
      radius: 8, maxEnergy: 200, maxHealth: 130, basalBurn: 2.1, moveCost: 2.6,
      walkSpeed: 30, runSpeed: 126, stalkSpeed: 28, turnRate: 6, sight: 220, stealth: 0.55,
      meatValue: 120, hungerThreshold: 0.62, breedThreshold: 0.7, breedCost: 0.4, breedCooldown: 95, matureDays: 5, lifespanDays: 40,
      stamina: 4.2, restAfterChase: 7, sprintRange: 80, attackRange: 6, attackCooldown: 0.8,
      crowdLimit: 2, crowdRadius: 280, herd: 0.3, attack: 12, armor: 0.1,
    }),
  },
};

/** What a newborn of each species is called. */
export const BABY_NAME: Record<SpeciesId, string> = {
  gazelle: 'fawn', zebra: 'foal', lion: 'cub', cheetah: 'cub',
  triceratops: 'hatchling', parasaurolophus: 'hatchling', stegosaurus: 'hatchling', brachiosaurus: 'hatchling', trex: 'hatchling', velociraptor: 'hatchling',
  reeffish: 'fry', turtle: 'hatchling', manta: 'pup', shark: 'pup', dolphin: 'calf',
};

export const ALL_SPECIES: SpeciesId[] = Object.keys(SPECIES) as SpeciesId[];
