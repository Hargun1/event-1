import * as THREE from 'three';
import { SIM, WORLD } from '../game/config.ts';
import type { Animal } from '../game/entities/Animal.ts';
import { isMature } from '../game/entities/Animal.ts';
import { SPECIES } from '../game/data/species.ts';
import type { SpeciesId } from '../game/data/species.ts';
import type { Ecosystem, FxEvent } from '../game/systems/Ecosystem.ts';
import type { ModelInstance, ModelLibrary, ModelTemplate } from './ModelLibrary.ts';
import { disposeInstance } from './ModelLibrary.ts';
import type { World3D } from './World3D.ts';
import { angleDiff } from '../game/utils/math.ts';

type Clip = 'idle' | 'walk' | 'run' | 'attack';

interface View {
  inst: ModelInstance;
  animal: Animal;
  clip: Clip | null;
  yaw: number;
  depth: number;
  flash: number;
  dying: number; // <0 alive, else seconds since death
  sink: boolean;
  ring: THREE.Mesh | null;
}

const S = WORLD.scale;
const tmp = new THREE.Vector3();

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
  /** Hits this frame (for floating damage numbers): world position + amount. */
  readonly hits: { pos: THREE.Vector3; amount: number; onPlayer: boolean }[] = [];

  constructor(world: World3D, lib: ModelLibrary) {
    this.world = world; this.lib = lib;
    world.scene.add(this.group);
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
  }

  private create(a: Animal): View | null {
    const t = this.templates.get(a.species.id);
    if (!t) return null;
    const s = a.species;
    const inst = this.lib.instance(t, s.modelLength * S, s.swims);
    this.group.add(inst.root);
    // swimmers cruise at their own depth band
    const depth = s.swims ? (a.isPlayer ? 3.2 : 1.6 + ((a.id * 7919) % 100) / 100 * (s.id === 'reeffish' ? 3 : 6)) : 0;
    const v: View = { inst, animal: a, clip: null, yaw: Math.atan2(Math.cos(a.heading), Math.sin(a.heading)), depth, flash: 0, dying: -1, sink: false, ring: null };
    this.views.set(a.id, v);
    this.place(v, 1);
    return v;
  }

  private play(v: View, clip: Clip, timeScale: number): void {
    const names = v.animal.species.anims;
    const name = clip === 'attack' ? names.attack ?? names.run : names[clip];
    const action = v.inst.actions.get(name) ?? v.inst.actions.get(names.walk);
    if (!action) return;
    if (v.clip !== clip) {
      for (const [n, a] of v.inst.actions) if (n !== name && a.isRunning()) a.fadeOut(0.2);
      action.reset().fadeIn(0.2).play();
      if (clip === 'attack') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = false; }
      else action.setLoop(THREE.LoopRepeat, Infinity);
      v.clip = clip;
    }
    action.timeScale = timeScale;
  }

  private place(v: View, k: number): void {
    const a = v.animal, s = a.species;
    this.world.toWorld(a.x, a.y, tmp);
    if (s.swims) tmp.y += v.depth + Math.sin(a.stride * 0.6 + a.id) * 0.15;
    const p = v.inst.root.position;
    p.lerp(tmp, k);
    const target = Math.atan2(Math.cos(a.heading), Math.sin(a.heading));
    v.yaw += angleDiff(v.yaw, target) * Math.min(1, k * 1.2);
    v.inst.root.rotation.y = v.yaw;
    // juveniles are smaller
    const grow = isMature(a) ? 1 : 0.5 + 0.5 * Math.min(1, a.age / (s.matureDays * SIM.daySeconds));
    v.inst.root.scale.setScalar(grow);
  }

  sync(eco: Ecosystem, dt: number, selectedId: number | null): void {
    this.seen.clear();
    const k = Math.min(1, dt * 14);
    for (const a of eco.animals) {
      if (!a.alive) continue;
      this.seen.add(a.id);
      const v = this.views.get(a.id) ?? this.create(a);
      if (!v) continue;
      const s = a.species;
      this.place(v, k);
      // animation state from simulation
      if (a.strikeTimer < 0.25 && (s.anims.attack || a.isPlayer)) this.play(v, s.anims.attack ? 'attack' : 'run', 1.6);
      else if (v.clip === 'attack' && a.strikeTimer < 0.9 && s.anims.attack) { /* let the strike finish */ }
      else if (a.speed < 2 && !s.swims) this.play(v, 'idle', 1);
      else if (a.speed < s.walkSpeed * 1.5) this.play(v, 'walk', Math.max(0.6, a.speed / s.walkSpeed));
      else this.play(v, 'run', Math.max(0.7, (a.speed / s.runSpeed) * 1.15));
      // lunge for models without an attack clip
      const lunge = a.strikeTimer < 0.25 && !s.anims.attack ? Math.sin((a.strikeTimer / 0.25) * Math.PI) * s.radius * S * 0.9 : 0;
      if (lunge) v.inst.root.position.add(tmp.set(Math.sin(v.yaw) * lunge, 0, Math.cos(v.yaw) * lunge));
      // hit flash
      if (a.hurtTimer < 0.05 && v.flash <= 0) v.flash = 0.18;
      if (v.flash > 0) {
        v.flash -= dt;
        const on = v.flash > 0;
        for (const m of v.inst.materials) { m.emissive.setHex(on ? 0xff3b2b : 0x000000); m.emissiveIntensity = on ? 0.6 : 0; }
      }
      v.inst.mixer.update(dt);
    }
    // anything no longer simulated without a death fx (e.g. reset) is removed
    for (const [id, v] of this.views) if (!this.seen.has(id)) { this.views.delete(id); this.startDeath(v, false); }

    for (let i = this.dying.length - 1; i >= 0; i--) {
      const v = this.dying[i];
      v.dying += dt;
      const t = v.dying, swim = v.animal.species.swims;
      if (swim) { v.inst.root.rotation.z = Math.min(Math.PI, t * 3); v.inst.root.position.y += (t < 1.2 ? 0.6 : -1.5) * dt; }
      else { v.inst.root.rotation.z = Math.min(Math.PI / 2, t * 5) * (v.animal.id % 2 ? 1 : -1); if (t > 1.2) v.inst.root.position.y -= dt * 0.8; }
      v.inst.mixer.update(dt * 0.3);
      if (t > 2.6) { disposeInstance(v.inst); this.dying.splice(i, 1); }
    }

    // selection + player rings
    this.ring(this.selRing, selectedId !== null ? this.views.get(selectedId) : undefined, 1);
    this.ring(this.playerRing, eco.player && eco.player.alive ? this.views.get(eco.player.id) : undefined, 0.8);
  }

  private ring(mesh: THREE.Mesh, v: View | undefined, alpha: number): void {
    if (!v) { mesh.visible = false; return; }
    const a = v.animal, r = Math.max(1.2, a.species.radius * S * 2.2);
    mesh.visible = true;
    mesh.position.set(v.inst.root.position.x, this.world.heightAt(a.x, a.y) + 0.08, v.inst.root.position.z);
    mesh.scale.setScalar(r * (1 + Math.sin(performance.now() / 250) * 0.05));
    (mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
  }

  private startDeath(v: View, _violent: boolean): void {
    v.dying = 0;
    this.dying.push(v);
  }

  handleFx(fx: FxEvent[]): void {
    for (const f of fx) {
      if (f.type === 'kill') {
        const v = this.views.get(f.preyId);
        if (v) { this.views.delete(f.preyId); this.startDeath(v, true); }
        const pred = this.views.get(f.predatorId);
        if (pred && pred.animal.species.anims.attack) this.play(pred, 'attack', 1.4);
      } else if (f.type === 'death') {
        const v = this.views.get(f.id);
        if (v) { this.views.delete(f.id); this.startDeath(v, false); }
      } else if (f.type === 'hit') {
        const v = this.views.get(f.id);
        const pos = v ? v.inst.root.position.clone() : this.world.toWorld(f.x, f.y);
        pos.y += (SPECIES[v?.animal.species.id ?? 'lion'].modelLength * S) * 0.45 + 0.6;
        this.hits.push({ pos, amount: f.amount, onPlayer: f.onPlayer });
      }
    }
  }

  /** Screen-space anchor (top of the model) for overlays. */
  anchor(id: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v) return false;
    out.copy(v.inst.root.position);
    const s = v.animal.species;
    out.y += (s.swims ? s.modelLength * S * 0.25 : s.modelLength * S * (s.id === 'brachiosaurus' ? 0.9 : 0.5)) * v.inst.root.scale.x + 0.4;
    return true;
  }

  /** Raycast pick: returns the simulated animal whose model is under the pointer. */
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
