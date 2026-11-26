import { WORLD } from '../config.ts';
import type { Animal } from '../entities/Animal.ts';
import { isMature } from '../entities/Animal.ts';
import { inEllipse } from '../world/terrain.ts';
import type { Terrain } from '../world/terrain.ts';
import { angleDiff, clamp } from '../utils/math.ts';
import type { SpatialGrid } from './SpatialGrid.ts';

const P = WORLD.play;
const EDGE = 26;

/** Turns toward desired heading, accelerates, avoids walls/water and separates from neighbours. */
export function moveAnimal(a: Animal, dt: number, grid: SpatialGrid<Animal>, terrain: Terrain): void {
  const s = a.species;

  // boundary steering: gently turn back inside before hitting the fence
  let wx = 0, wy = 0;
  if (a.x < P.left + EDGE) wx = 1; else if (a.x > P.right - EDGE) wx = -1;
  if (a.y < P.top + EDGE) wy = 1; else if (a.y > P.bottom - EDGE) wy = -1;
  if (wx || wy) {
    const inward = Math.atan2(wy, wx);
    const urgent = a.isPlayer || a.behaviour === 'fleeing' || a.behaviour === 'hunting' || a.behaviour === 'hiding' || a.behaviour === 'fighting';
    if (!a.isPlayer) a.desiredHeading = urgent ? a.desiredHeading + angleDiff(a.desiredHeading, inward) * 0.55 : inward;
    if (!urgent) a.wanderAngle = inward;
  }

  // water avoidance: steer around the pond rim
  const pond = terrain.lake;
  if (pond && !a.isPlayer && inEllipse(pond, a.x + Math.cos(a.desiredHeading) * 22, a.y + Math.sin(a.desiredHeading) * 22, 4)) {
    const away = Math.atan2((a.y - pond.y) / pond.ry, (a.x - pond.x) / pond.rx);
    const tangent = away + (angleDiff(away, a.desiredHeading) > 0 ? Math.PI / 2 : -Math.PI / 2);
    a.desiredHeading = tangent;
  }

  const turn = s.turnRate * dt;
  a.heading += clamp(angleDiff(a.heading, a.desiredHeading), -turn, turn);
  const maxSpeed = a.desiredSpeed * (isMature(a) ? 1 : s.trophic === 'predator' ? 0.92 : 0.75);
  const accel = (a.desiredSpeed > a.speed ? 220 : 260) * dt;
  a.speed += clamp(maxSpeed - a.speed, -accel, accel);

  let nx = a.x + Math.cos(a.heading) * a.speed * dt;
  let ny = a.y + Math.sin(a.heading) * a.speed * dt;

  // separation (soft push) — avoids animals stacking on the same spot
  const r = s.radius;
  grid.query(nx, ny, r * 2 + 10, o => {
    if (o === a || !o.alive) return;
    const dx = nx - o.x, dy = ny - o.y, min = r + o.species.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0.01 && d2 < min * min) {
      const d = Math.sqrt(d2), push = (min - d) * 0.35;
      nx += (dx / d) * push; ny += (dy / d) * push;
    }
  });

  // never enter the pond
  if (pond && inEllipse(pond, nx, ny, 2)) {
    const ang = Math.atan2((ny - pond.y) / pond.ry, (nx - pond.x) / pond.rx);
    nx = pond.x + Math.cos(ang) * (pond.rx + 3);
    ny = pond.y + Math.sin(ang) * (pond.ry + 3);
  }

  a.x = clamp(nx, P.left + 4, P.right - 4);
  a.y = clamp(ny, P.top + 4, P.bottom - 4);
  a.stride += a.speed * dt * 0.09;
}
