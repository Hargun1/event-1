import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface ModelTemplate {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  box: THREE.Box3;
}

export interface ModelInstance {
  /** Positioned / rotated by the caller. */
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  /** Per-instance materials (cloned) so hits can flash one animal. */
  materials: THREE.MeshStandardMaterial[];
}

const loader = new GLTFLoader();

/** Loads each GLB once; hands out normalised, independently animated clones. */
export class ModelLibrary {
  private cache = new Map<string, Promise<ModelTemplate>>();

  load(file: string): Promise<ModelTemplate> {
    let p = this.cache.get(file);
    if (!p) {
      p = loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`).then(gltf => {
        gltf.scene.traverse(o => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
        });
        gltf.scene.updateMatrixWorld(true);
        return { scene: gltf.scene, clips: gltf.animations, box: new THREE.Box3().setFromObject(gltf.scene) };
      });
      this.cache.set(file, p);
    }
    return p;
  }

  /**
   * Clone scaled so its length along +Z equals `length` (metres). Feet rest on y=0,
   * or the body is centred on y=0 for swimmers.
   */
  instance(t: ModelTemplate, length: number, centreVertically: boolean, cloneMaterials = true): ModelInstance {
    const size = t.box.getSize(new THREE.Vector3()), centre = t.box.getCenter(new THREE.Vector3());
    const s = length / Math.max(size.z, size.x, 1e-3);
    const clone = SkeletonUtils.clone(t.scene);
    const materials: THREE.MeshStandardMaterial[] = [];
    if (cloneMaterials) {
      clone.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
        if (Array.isArray(src)) { m.material = src.map(x => x.clone()); materials.push(...(m.material as THREE.MeshStandardMaterial[])); }
        else { const c = src.clone(); m.material = c; materials.push(c); }
      });
    }
    const inner = new THREE.Group();
    inner.scale.setScalar(s);
    inner.position.set(-centre.x * s, centreVertically ? -centre.y * s : -t.box.min.y * s, -centre.z * s);
    inner.add(clone);
    const root = new THREE.Group();
    root.add(inner);
    const mixer = new THREE.AnimationMixer(clone);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of t.clips) actions.set(clip.name, mixer.clipAction(clip));
    return { root, mixer, actions, materials };
  }
}

export function disposeInstance(inst: ModelInstance): void {
  inst.mixer.stopAllAction();
  inst.root.removeFromParent();
  for (const m of inst.materials) m.dispose();
}
