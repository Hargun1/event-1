import * as THREE from 'three';
import { SIM, WORLD } from '../game/config.ts';
import type { Animal } from '../game/entities/Animal.ts';
import { isMature } from '../game/entities/Animal.ts';
import { BABY_NAME, SPECIES } from '../game/data/species.ts';
import type { SpeciesId } from '../game/data/species.ts';
import type { Ecosystem, FxEvent } from '../game/systems/Ecosystem.ts';
import type { ModelInstance, ModelLibrary, ModelTemplate } from './ModelLibrary.ts';
import { disposeInstance } from './ModelLibrary.ts';
import type { World3D } from './World3D.ts';
import { Particles } from './Particles.ts';
import { angleDiff, clamp } from '../game/utils/math.ts';

interface View {
  inst: ModelInstance;
  animal: Animal;
  /** Smoothed blend weight per locomotion clip name. */
  weights: Map<string, number>;
  attackW: number;
  attackLeft: number;
  prevStrike: number;
  yaw: number;
  bank: number;
  pitch: number;
  baseDepth: number;
  depth: number;
  flash: number;
  hit: number;
  dying: number; // <0 alive, else seconds since death
  violent: boolean;
  faded: boolean;
  puffed: boolean;
  pop: number;
  roar: number;
  dustT: number;
  lodAcc: number;
  lodFrame: number;
}

interface Heart { sprite: THREE.Sprite; t: number; vx: number; vz: number }

function heartTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ff6f91'; g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(32, 54);
  g.bezierCurveTo(4, 36, 6, 10, 22, 10); g.bezierCurveTo(28, 10, 32, 16, 32, 20);
  g.bezierCurveTo(32, 16, 36, 10, 42, 10); g.bezierCurveTo(58, 10, 60, 36, 32, 54);
  g.closePath(); g.fill(); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const S = WORLD.scale;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

/** Keeps one animated 3D model per simulated animal. */
export class AnimalViews {
  private views = new Map<number, View>();
  private dying: View[] = [];
  private templates = new Map<SpeciesId, ModelTemplate>();
  private group = new THREE.Group();
  private world: World3D;
  private lib: ModelLibrary;
  private seen = new Set<number>();
  private selRing: THREE.Mesh;
  private playerRing: THREE.Mesh;
  private particles: Particles;
  private clock = 0;
  readonly hits: { pos: THREE.Vector3; amount: number; onPlayer: boolean }[] = [];
  readonly births: { pos: THREE.Vector3; text: string; mine: boolean }[] = [];
  private hearts: Heart[] = [];
  private heartMat = new THREE.SpriteMaterial({ map: heartTexture(), transparent: true, depthWrite: false });

  constructor(world: World3D, lib: ModelLibrary) {
    this.world = world; this.lib = lib;
    world.scene.add(this.group);
    this.particles = new Particles(world.scene);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    this.selRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9, depthWrite: false }));
    this.playerRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x8fe07a, transparent: true, opacity: 0.8, depthWrite: false }));
    this.selRing.visible = this.playerRing.visible = false;
    world.scene.add(this.selRing, this.playerRing);
  }

  async loadSpecies(ids: SpeciesId[], onProgress?: (done: number, total: number) => void): Promise<void> {
    let done = 0;
    await Promise.all(ids.map(async id => {
      this.templates.set(id, await this.lib.load(SPECIES[id].model));
      onProgress?.(++done, ids.length);
    }));
  }

  clear(): void {
    for (const v of this.views.values()) disposeInstance(v.inst);
    for (const v of this.dying) disposeInstance(v.inst);
    this.views.clear(); this.dying = [];
    this.particles.clear();
  }

  private create(a: Animal): View | null {
    const t = this.templates.get(a.species.id);
    if (!t) return null;
    const s = a.species;
    const inst = this.lib.instance(t, s.modelLength * S, s.swims);
    inst.root.rotation.order = 'YXZ'; // yaw, then pitch, then roll (bank)
    this.group.add(inst.root);
    // all locomotion clips run continuously; we only change their weights → seamless blending
    const names = new Set([s.anims.idle, s.anims.walk, s.anims.run]);
    for (const n of names) {
      const act = inst.actions.get(n);
      if (!act) continue;
      act.setLoop(THREE.LoopRepeat, Infinity);
      act.play();
      act.time = Math.random() * act.getClip().duration; // desynchronise herds
      act.setEffectiveWeight(0);
    }
    const atk = s.anims.attack ? inst.actions.get(s.anims.attack) : undefined;
    if (atk) { atk.setLoop(THREE.LoopOnce, 1); atk.clampWhenFinished = false; atk.setEffectiveWeight(0); }
    const baseDepth = s.swims ? (a.isPlayer ? 3.2 : 1.6 + ((a.id * 7919) % 100) / 100 * (s.id === 'reeffish' ? 3 : 6)) : 0;
    const v: View = {
      inst, animal: a, weights: new Map(), attackW: 0, attackLeft: 0, prevStrike: a.strikeTimer,
      yaw: Math.atan2(Math.cos(a.heading), Math.sin(a.heading)), bank: 0, pitch: 0, baseDepth, depth: baseDepth,
      flash: 0, hit: 0, dying: -1, violent: false, faded: false, puffed: false,
      pop: a.age < 1 ? 0 : -1, roar: 0, dustT: Math.random() * 0.2, lodAcc: 0, lodFrame: a.id % 6,
    };
    this.views.set(a.id, v);
    this.place(v, 1, 1 / 60);
    return v;
  }

  /** Starts the one-shot attack / roar clip (if the model has one). */
  private strike(v: View, rate = 1.5): void {
    const n = v.animal.species.anims.attack;
    const act = n ? v.inst.actions.get(n) : undefined;
    if (!act) return;
    act.reset();
    act.timeScale = rate;
    act.play();
    v.attackLeft = act.getClip().duration / rate;
  }

  /** Speed-driven blend between idle / walk / run, with the attack clip layered on top. */
  private animate(v: View, dt: number): void {
    const a = v.animal, s = a.species, n = s.anims;
    const sp = a.speed, ws = s.walkSpeed, rs = s.runSpeed;
    let idleW = s.swims ? 0 : clamp(1 - sp / (ws * 0.45), 0, 1);
    if (!s.swims && (a.behaviour === 'grazing' || (a.behaviour === 'resting' && sp < 2))) idleW = 1;
    const runU = clamp((sp - ws * 1.15) / (ws * 1.3), 0, 1);
    const target = new Map<string, number>();
    const add = (name: string, w: number) => target.set(name, (target.get(name) ?? 0) + w);
    add(n.idle, idleW); add(n.walk, (1 - idleW) * (1 - runU)); add(n.run, (1 - idleW) * runU);

    // a new strike happened in the simulation since last frame
    if (a.strikeTimer < v.prevStrike && n.attack) this.strike(v, a.isPlayer ? 1.8 : 1.5);
    v.prevStrike = a.strikeTimer;
    v.attackLeft -= dt;
    v.attackW += ((v.attackLeft > 0.08 ? 1 : 0) - v.attackW) * Math.min(1, dt * 12);
    const base = 1 - 0.85 * v.attackW;
    const k = Math.min(1, dt * 7);
    for (const [name, act] of v.inst.actions) {
      if (name === n.attack) { act.setEffectiveWeight(v.attackW); continue; }
      const cur = v.weights.get(name) ?? 0;
      const next = cur + ((target.get(name) ?? 0) - cur) * k;
      v.weights.set(name, next);
      act.setEffectiveWeight(next * base);
      // playback speed follows actual ground speed (no foot sliding)
      if (name === n.run && name !== n.walk) act.timeScale = clamp(sp / (rs * 0.7), 0.6, 1.9);
      else if (name === n.walk && name !== n.idle) act.timeScale = clamp(sp / ws, 0.5, 2.2);
      else if (s.swims) act.timeScale = clamp(0.6 + (sp / ws) * 0.55, 0.6, 2.6);
      else act.timeScale = 1;
    }
  }

  /** Position, heading, banking, slope / swim pitch, scale effects. */
  private place(v: View, k: number, dt: number): void {
    const a = v.animal, s = a.species;
    this.world.toWorld(a.x, a.y, tmp);
    const L = s.modelLength;
    // swimmers glide through their own slowly drifting depth band
    if (s.swims) {
      const glide = Math.sin(this.clock * 0.35 + a.id * 1.7) * (s.id === 'reeffish' ? 0.6 : 1.1);
      const want = v.baseDepth + glide + (a.behaviour === 'fleeing' ? -0.6 : 0);
      const prev = v.depth;
      v.depth += (want - v.depth) * Math.min(1, dt * 1.5);
      tmp.y += v.depth;
      const vy = (v.depth - prev) / Math.max(dt, 1e-3);
      v.pitch += (clamp(-vy * 0.35, -0.45, 0.45) - v.pitch) * Math.min(1, dt * 4);
    } else {
      // follow the slope of the ground under the body
      const c = Math.cos(a.heading), sn = Math.sin(a.heading);
      const hA = this.world.heightAt(a.x + c * L * 0.4, a.y + sn * L * 0.4);
      const hB = this.world.heightAt(a.x - c * L * 0.4, a.y - sn * L * 0.4);
      let want = -Math.atan2(hA - hB, L * 0.8 * S);
      if (a.behaviour === 'grazing') want += 0.1 + Math.sin(this.clock * 2 + a.id) * 0.03; // head down, nibbling
      v.pitch += (want - v.pitch) * Math.min(1, dt * 6);
    }
    const p = v.inst.root.position;
    p.lerp(tmp, k);

    // heading + banking into turns (stronger for swimmers)
    const target = Math.atan2(Math.cos(a.heading), Math.sin(a.heading));
    const prevYaw = v.yaw;
    v.yaw += angleDiff(v.yaw, target) * Math.min(1, k * 1.2);
    const yawRate = angleDiff(prevYaw, v.yaw) / Math.max(dt, 1e-3);
    const speedK = clamp(a.speed / s.walkSpeed, 0, 1.5);
    const bankWant = clamp(-yawRate * (s.swims ? 0.22 : 0.06) * speedK, -0.5, 0.5);
    v.bank += (bankWant - v.bank) * Math.min(1, dt * 5);

    // growth, birth pop-in, roar pose, hit squash
    const grow = isMature(a) ? 1 : 0.45 + 0.55 * Math.min(1, a.age / (s.matureDays * SIM.daySeconds));
    let sx = grow, sy = grow;
    if (v.pop >= 0) { const t = Math.min(1, v.pop / 0.7); const pk = t < 1 ? 0.05 + 1.15 * Math.sin(t * Math.PI * 0.62) : 1; sx *= pk; sy *= pk; if (t >= 1) v.pop = -1; }
    let roarPitch = 0;
    if (v.roar > 0) {
      const k2 = Math.sin(Math.min(1, (1.6 - v.roar) / 1.6) * Math.PI);
      roarPitch = -0.18 * k2; sx *= 1 + 0.05 * k2; sy *= 1 + 0.07 * k2;
    }
    let hitPitch = 0;
    if (v.hit > 0) {
      const h = Math.sin((v.hit / 0.3) * Math.PI);
      sy *= 1 - 0.1 * h; sx *= 1 + 0.06 * h;
      hitPitch = -0.12 * h;
      // knock-back away from facing
      p.add(tmp2.set(-Math.sin(v.yaw) * 0.35 * h, 0, -Math.cos(v.yaw) * 0.35 * h));
    }
    // a gentle breathing bob while standing
    if (!s.swims && a.speed < 2) sy *= 1 + Math.sin(this.clock * 2.2 + a.id) * 0.012;
    v.inst.root.scale.set(sx, sy, sx);
    v.inst.root.rotation.set(v.pitch + roarPitch + hitPitch, v.yaw, v.bank);
  }

  sync(eco: Ecosystem, dt: number, selectedId: number | null): void {
    this.seen.clear();
    this.clock += dt;
    const k = Math.min(1, dt * 14);
    const cam = this.world.camera.position;
    const dustCol = this.world.dustColor;
    for (const a of eco.animals) {
      if (!a.alive) continue;
      this.seen.add(a.id);
      const v = this.views.get(a.id) ?? this.create(a);
      if (!v) continue;
      const s = a.species;
      const step = Math.max(dt, 1 / 120);
      if (v.pop >= 0) v.pop += step;
      if (v.roar > 0) v.roar -= step;
      if (a.hurtTimer < 0.05 && v.hit <= 0) v.hit = 0.3;
      if (v.hit > 0) v.hit -= step;
      this.place(v, k, step);
      this.animate(v, dt);

      // mammals without an attack clip lunge forward
      if (a.strikeTimer < 0.25 && !s.anims.attack) {
        const lunge = Math.sin((a.strikeTimer / 0.25) * Math.PI) * s.radius * S * 0.9;
        v.inst.root.position.add(tmp.set(Math.sin(v.yaw) * lunge, 0, Math.cos(v.yaw) * lunge));
      }
      // hit flash
      if (a.hurtTimer < 0.05 && v.flash <= 0) v.flash = 0.18;
      if (v.flash > 0) {
        v.flash -= dt;
        const on = v.flash > 0;
        for (const m of v.inst.materials) { m.emissive.setHex(on ? 0xff3b2b : 0x000000); m.emissiveIntensity = on ? 0.6 : 0; }
      }

      const dist = v.inst.root.position.distanceTo(cam);
      // particles: running dust / bubble trails near the camera
      if (dt > 0 && dist < 75) {
        v.dustT -= dt;
        const fast = a.speed > s.walkSpeed * 1.6;
        if (fast && v.dustT <= 0) {
          v.dustT = s.swims ? 0.12 : 0.09;
          const back = s.modelLength * S * 0.35;
          tmp.copy(v.inst.root.position).add(tmp2.set(-Math.sin(v.yaw) * back, 0, -Math.cos(v.yaw) * back));
          if (s.swims) this.particles.emit('bubble', tmp, 1, clamp(s.modelLength * S * 0.4, 0.6, 2));
          else { tmp.y = this.world.heightAt(a.x, a.y); this.particles.emit('dust', tmp, 1, clamp(s.modelLength * S * 0.18, 0.5, 2.4), dustCol); }
        }
      }
      // animation level-of-detail: far animals update less often
      const every = dist > 140 ? 6 : dist > 80 ? 3 : 1;
      v.lodAcc += dt;
      if (++v.lodFrame % every === 0) { v.inst.mixer.update(v.lodAcc); v.lodAcc = 0; }
    }
    for (const [id, v] of this.views) if (!this.seen.has(id)) { this.views.delete(id); this.startDeath(v, false); }

    this.updateDying(dt);
    this.particles.update(dt > 0 ? dt : 1 / 120);

    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.t += Math.max(dt, 1 / 60);
      h.sprite.position.x += h.vx * 0.016; h.sprite.position.z += h.vz * 0.016;
      h.sprite.position.y += 0.03;
      h.sprite.material.opacity = Math.max(0, 1 - h.t / 1.8);
      if (h.t > 1.8) { h.sprite.removeFromParent(); h.sprite.material.dispose(); this.hearts.splice(i, 1); }
    }

    this.ring(this.selRing, selectedId !== null ? this.views.get(selectedId) : undefined, 1);
    this.ring(this.playerRing, eco.player && eco.player.alive ? this.views.get(eco.player.id) : undefined, 0.8);
  }

  /** Weighted fall (with a little bounce), dust / bubble puff, then fade out. */
  private updateDying(dt: number): void {
    const step = Math.max(dt, 1 / 120);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const v = this.dying[i];
      v.dying += step;
      const t = v.dying, s = v.animal.species, root = v.inst.root;
      const side = v.animal.id % 2 ? 1 : -1;
      if (s.swims) {
        root.rotation.z = Math.min(1, t / 1.1) * Math.PI * side;       // roll belly-up
        root.position.y += (t < 1.5 ? 0.5 : 0.15) * step;               // drift upward
        if (!v.puffed && t > 0.15) { v.puffed = true; this.particles.emit('bubble', root.position, 10, clamp(s.modelLength * S * 0.5, 0.8, 2.5)); }
      } else {
        const fall = Math.min(1, t / 0.55);
        root.rotation.z = easeOutBack(fall) * (Math.PI / 2) * side * 0.96;
        if (!v.puffed && t > 0.45) {
          v.puffed = true;
          tmp.copy(root.position); tmp.y = this.world.heightAt(v.animal.x, v.animal.y);
          this.particles.emit('puff', tmp, v.violent ? 9 : 6, clamp(s.modelLength * S * 0.25, 0.6, 3), this.world.dustColor);
        }
        if (t > 2.2) root.position.y -= step * 0.25;
      }
      // freeze limbs gradually
      v.inst.mixer.update(step * Math.max(0, 1 - t / 0.7));
      if (t > 2.0) {
        if (!v.faded) { v.faded = true; for (const m of v.inst.materials) { m.transparent = true; m.needsUpdate = true; } }
        const o = Math.max(0, 1 - (t - 2.0) / 1.0);
        for (const m of v.inst.materials) m.opacity = o;
      }
      if (t > 3.05) { disposeInstance(v.inst); this.dying.splice(i, 1); }
    }
  }

  private ring(mesh: THREE.Mesh, v: View | undefined, alpha: number): void {
    if (!v) { mesh.visible = false; return; }
    const a = v.animal, r = Math.max(1.2, a.species.radius * S * 2.2);
    mesh.visible = true;
    mesh.position.set(v.inst.root.position.x, this.world.heightAt(a.x, a.y) + 0.08, v.inst.root.position.z);
    mesh.scale.setScalar(r * (1 + Math.sin(performance.now() / 250) * 0.05));
    (mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
  }

  private startDeath(v: View, violent: boolean): void {
    v.dying = 0;
    v.violent = violent;
    for (const act of v.inst.actions.values()) act.fadeOut(0.4);
    this.dying.push(v);
  }

  handleFx(fx: FxEvent[]): void {
    for (const f of fx) {
      if (f.type === 'kill') {
        const v = this.views.get(f.preyId);
        if (v) { this.views.delete(f.preyId); this.startDeath(v, true); }
        const pred = this.views.get(f.predatorId);
        if (pred) this.strike(pred, 1.3);
      } else if (f.type === 'death') {
        const v = this.views.get(f.id);
        if (v) { this.views.delete(f.id); this.startDeath(v, false); }
      } else if (f.type === 'hearts') {
        const v = this.views.get(f.id);
        if (v) this.spawnHearts(v.inst.root.position, v.animal.species.modelLength * S * (v.animal.species.swims ? 0.3 : 0.55), v.animal.species.modelLength * S);
      } else if (f.type === 'birth') {
        const parent = this.views.get(f.parentId);
        const base = parent ? parent.inst.root.position.clone() : this.world.toWorld(f.x, f.y);
        const sp = parent?.animal.species;
        const top = sp ? sp.modelLength * S * (sp.swims ? 0.3 : 0.55) : 1.5;
        this.spawnHearts(base, top, sp ? sp.modelLength * S : 2);
        if (parent) {
          const mine = parent.animal.isPlayer;
          const name = `${parent.animal.species.name} ${BABY_NAME[parent.animal.species.id]}`;
          this.births.push({ pos: base.clone().setY(base.y + top + 1.2), text: mine ? `Your ${name} is born!` : `${name} born!`, mine });
        }
      } else if (f.type === 'hit') {
        const v = this.views.get(f.id);
        const pos = v ? v.inst.root.position.clone() : this.world.toWorld(f.x, f.y);
        pos.y += (SPECIES[v?.animal.species.id ?? 'lion'].modelLength * S) * 0.45 + 0.6;
        this.hits.push({ pos, amount: f.amount, onPlayer: f.onPlayer });
        if (v) this.particles.emit(v.animal.species.swims ? 'bubble' : 'dust', v.inst.root.position, 3, 0.8, this.world.dustColor);
      }
    }
  }

  private spawnHearts(base: THREE.Vector3, top: number, len: number): void {
    for (let i = 0; i < 6; i++) {
      const sprite = new THREE.Sprite(this.heartMat.clone());
      const size = 0.5 + Math.random() * 0.5 + len * 0.04;
      sprite.scale.set(size, size, 1);
      sprite.position.set(base.x + (Math.random() - 0.5) * 1.2, base.y + top + i * 0.25, base.z + (Math.random() - 0.5) * 1.2);
      this.group.add(sprite);
      this.hearts.push({ sprite, t: -i * 0.12, vx: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8 });
    }
  }

  /** Play a roar (clip if the model has one, otherwise a rear-up pose). */
  roar(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.roar = 1.6;
    this.strike(v, 1);
  }

  anchor(id: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v) return false;
    out.copy(v.inst.root.position);
    const s = v.animal.species;
    out.y += (s.swims ? s.modelLength * S * 0.25 : s.modelLength * S * (s.id === 'brachiosaurus' ? 0.9 : 0.5)) * v.inst.root.scale.x + 0.4;
    return true;
  }

  pick(ray: THREE.Raycaster): Animal | null {
    let best: Animal | null = null, bd = Infinity;
    for (const v of this.views.values()) {
      const s = v.animal.species;
      const c = v.inst.root.position.clone();
      c.y += s.swims ? 0 : s.modelLength * S * 0.25;
      const r = Math.max(0.8, s.modelLength * S * 0.45);
      const d = ray.ray.distanceSqToPoint(c);
      if (d < r * r) {
        const along = c.sub(ray.ray.origin).length();
        if (along < bd) { bd = along; best = v.animal; }
      }
    }
    return best;
  }

  position(id: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v) return false;
    out.copy(v.inst.root.position);
    return true;
  }
}
