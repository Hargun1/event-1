import { SIM } from '../config.ts';
import type { Ecosystem } from './Ecosystem.ts';

export interface Mission {
  id: string;
  title: string;
  goal: number;
  xp: number;
  /** Current progress value from the ecosystem's player stats. */
  progress: (eco: Ecosystem) => number;
}

const daysAlive = (eco: Ecosystem) => (eco.time - eco.playerStats.spawnTime) / SIM.daySeconds;

/** The mission chain (same goals in every zone, worded for the zone's food). */
export const MISSIONS: Mission[] = [
  { id: 'hunt1', title: 'First hunt — take down any prey', goal: 1, xp: 60, progress: e => e.progress.herbKills },
  { id: 'survive2', title: 'Survive 2 days', goal: 2, xp: 60, progress: e => Math.floor(daysAlive(e)) },
  { id: 'hunt5', title: 'Feed well — make 5 kills', goal: 5, xp: 120, progress: e => e.progress.herbKills + e.progress.predKills },
  { id: 'family', title: 'Start a family — breed once (B)', goal: 1, xp: 150, progress: e => e.progress.cubs },
  { id: 'rival', title: 'Defeat a rival predator', goal: 1, xp: 200, progress: e => e.progress.predKills },
  { id: 'survive8', title: 'Survive 8 days', goal: 8, xp: 200, progress: e => Math.floor(daysAlive(e)) },
  { id: 'dynasty', title: 'Raise a dynasty — 3 offspring', goal: 3, xp: 260, progress: e => e.progress.cubs },
  { id: 'apex', title: 'Apex predator — 20 kills', goal: 20, xp: 400, progress: e => e.progress.herbKills + e.progress.predKills },
  { id: 'legend', title: 'Legend — survive 20 days', goal: 20, xp: 600, progress: e => Math.floor(daysAlive(e)) },
];

/** Player level / XP / mission state. Kept across respawns in the same zone; cleared on reset. */
export class Progress {
  level = 1;
  xp = 0;
  mission = 0;
  herbKills = 0;
  predKills = 0;
  cubs = 0;
  /** Bonus multipliers granted by levels. */
  get attackMult(): number { return 1 + (this.level - 1) * 0.1; }
  get healthMult(): number { return 1 + (this.level - 1) * 0.08; }
  get xpNext(): number { return Math.round(100 * Math.pow(this.level, 1.45)); }

  reset(): void {
    this.level = 1; this.xp = 0; this.mission = 0; this.herbKills = 0; this.predKills = 0; this.cubs = 0;
  }

  current(): Mission | null { return MISSIONS[this.mission] ?? null; }

  /** Adds XP and handles level-ups. Returns the number of levels gained. */
  addXp(eco: Ecosystem, amount: number): number {
    this.xp += Math.round(amount);
    let gained = 0;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      gained++;
    }
    if (gained) {
      const p = eco.player;
      if (p) {
        const s = p.species;
        p.maxHealth = s.maxHealth * 2.2 * this.healthMult;
        p.health = p.maxHealth;
        p.energy = Math.max(p.energy, s.maxEnergy * 0.6);
      }
      eco.emit('player', `Level up! You are now level ${this.level} — stronger bite and tougher hide.`);
      eco.fx.push({ type: 'levelup', level: this.level });
    }
    return gained;
  }

  /** Checks the active mission; completes it and moves on. */
  update(eco: Ecosystem): void {
    const m = this.current();
    if (!m || !eco.player || !eco.player.alive) return;
    if (m.progress(eco) >= m.goal) {
      this.mission++;
      eco.emit('player', `Mission complete: ${m.title.split(' — ')[0]}! (+${m.xp} XP)`);
      eco.fx.push({ type: 'mission', title: m.title.split(' — ')[0] });
      this.addXp(eco, m.xp);
    }
  }
}
