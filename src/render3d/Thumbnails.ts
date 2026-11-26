import * as THREE from 'three';
import type { ModelLibrary } from './ModelLibrary.ts';
import { SPECIES } from '../game/data/species.ts';
import type { SpeciesId } from '../game/data/species.ts';

/** Renders each species model once into a small transparent PNG for cards and menus. */
export class Thumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private cache = new Map<SpeciesId, string>();
  private lib: ModelLibrary;

  constructor(lib: ModelLibrary) { this.lib = lib; }

  get(id: SpeciesId): string { return this.cache.get(id) ?? ''; }

  async make(ids: SpeciesId[]): Promise<void> {
    const todo = ids.filter(id => !this.cache.has(id));
    if (!todo.length) return;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(200, 150, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667755, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 5, 4); scene.add(key);
    const cam = new THREE.PerspectiveCamera(30, 200 / 150, 0.1, 100);
    for (const id of todo) {
      const t = await this.lib.load(SPECIES[id].model);
      const inst = this.lib.instance(t, 2, true, false);
      const idle = inst.actions.get(SPECIES[id].anims.idle) ?? inst.actions.values().next().value;
      if (idle) { idle.play(); inst.mixer.update(0.3); }
      inst.root.rotation.y = -Math.PI / 2.6; // three-quarter view, facing right
      scene.add(inst.root);
      const box = new THREE.Box3().setFromObject(inst.root), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const d = Math.max(size.x, size.y * 1.3, size.z) * 1.9;
      cam.position.set(c.x + d * 0.15, c.y + d * 0.28, c.z + d);
      cam.lookAt(c);
      this.renderer.render(scene, cam);
      this.cache.set(id, this.renderer.domElement.toDataURL('image/png'));
      scene.remove(inst.root);
      inst.mixer.stopAllAction();
    }
  }
}
