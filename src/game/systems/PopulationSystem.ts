import type { SpeciesId } from '../data/species.ts';
import { SPECIES } from '../data/species.ts';

export type Counts = Partial<Record<SpeciesId, number>>;
export type EcoStatus = 'Thriving' | 'Unstable' | 'Famine' | 'Collapse';

export interface DayRecord {
  births: Counts;
  hunted: Counts;
  starved: Counts;
  old: Counts;
  counts?: Counts;
  grass?: number;
}

export interface Sample { day: number; grass: number; counts: Counts }

export function emptyDay(): DayRecord {
  return { births: {}, hunted: {}, starved: {}, old: {} };
}

export function inc(c: Counts, id: SpeciesId): void { c[id] = (c[id] ?? 0) + 1; }
export function get(c: Counts | undefined, id: SpeciesId): number { return c?.[id] ?? 0; }

function sumTrophic(c: Counts, species: SpeciesId[], trophic: 'herbivore' | 'predator'): number {
  return species.reduce((s, id) => s + (SPECIES[id].trophic === trophic ? get(c, id) : 0), 0);
}

function sumDays(recs: DayRecord[], key: 'hunted' | 'starved' | 'old', id: SpeciesId): number {
  return recs.reduce((s, r) => s + get(r[key], id), 0);
}

/** Explains an extinction from the last few days of death records. */
export function extinctionReason(recs: DayRecord[], id: SpeciesId): string {
  const last = recs.slice(-6);
  const hunted = sumDays(last, 'hunted', id), starved = sumDays(last, 'starved', id), old = sumDays(last, 'old', id);
  const name = SPECIES[id].plural;
  if (SPECIES[id].trophic === 'predator') {
    if (hunted > starved) return `${name} extinct — killed in fights.`;
    return starved >= old ? `${name} extinct — prey became too scarce and they starved.` : `${name} extinct — too few young to replace the old.`;
  }
  if (hunted >= starved && hunted >= old) return `${name} extinct — hunted out by predators.`;
  if (starved >= old) return `${name} extinct — food ran out and they starved.`;
  return `${name} extinct — too few births to replace the old.`;
}

export function evaluateStatus(species: SpeciesId[], foodName: string, c: Counts, prev: Counts | undefined, grass: number, rec: DayRecord): { status: EcoStatus; reason: string } {
  const herb = sumTrophic(c, species, 'herbivore'), pred = sumTrophic(c, species, 'predator');
  const starvedHerb = sumTrophic(rec.starved, species, 'herbivore');
  if (herb + pred === 0) return { status: 'Collapse', reason: 'Every animal has died. The zone is silent.' };
  if (herb === 0) return { status: 'Collapse', reason: 'No herbivores remain — the predators are doomed to starve.' };
  if (grass < 0.18) return { status: 'Famine', reason: `The ${foodName} is exhausted (${Math.round(grass * 100)}%) — herbivores are starving.` };
  if (starvedHerb >= Math.max(3, herb * 0.12)) return { status: 'Famine', reason: `${starvedHerb} herbivores starved yesterday — too many mouths for the ${foodName}.` };
  const extinct = species.filter(id => get(c, id) === 0).map(id => SPECIES[id].plural);
  if (extinct.length) return { status: 'Unstable', reason: `${extinct.join(' & ')} extinct — the food web is broken.` };
  if (pred > herb * 0.3) return { status: 'Unstable', reason: 'Predator pressure is high — herbivores are being hunted fast.' };
  if (prev) {
    const before = sumTrophic(prev, species, 'herbivore') + sumTrophic(prev, species, 'predator');
    if (before > 10 && Math.abs(herb + pred - before) / before > 0.25) return { status: 'Unstable', reason: 'Populations are swinging sharply.' };
  }
  return { status: 'Thriving', reason: `${foodName[0].toUpperCase() + foodName.slice(1)}, grazers and predators are in balance.` };
}
