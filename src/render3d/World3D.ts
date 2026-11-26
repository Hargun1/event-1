import * as THREE from 'three';
import { WORLD } from '../game/config.ts';
import type { ZoneId } from '../game/data/species.ts';
import type { GrassField } from '../game/entities/GrassPatch.ts';
import type { Terrain } from '../game/world/terrain.ts';
import { createRng } from '../game/utils/random.ts';
import type { ModelInstance, ModelLibrary } from './ModelLibrary.ts';

const S = WORLD.scale;
const P = WORLD.play;
const WW = WORLD.width * S, WH = WORLD.height * S;

interface Palette {
  skyTop: string; skyBottom: string; fog: number; fogNear: number; fogFar: number;
  soil: string; outer: number; dry: number[]; mid: number[]; lush: number[];
  blade: number; bladeTip: number; sun: number; sunI: number; hemiSky: number; hemiGround: number; hemiI: number; rim: number;
}

const PALETTES: Record<ZoneId, Palette> = {
  land: {
    skyTop: '#7fb6df', skyBottom: '#efe6c9', fog: 0xe6e2cb, fogNear: 70, fogFar: 260,
    soil: '#b39463', outer: 0x7c8f4a, dry: [196, 168, 104], mid: [142, 170, 70], lush: [78, 140, 52],
    blade: 0x5d9636, bladeTip: 0xb9cf6a, sun: 0xfff1d6, sunI: 2.4, hemiSky: 0xcfe6ff, hemiGround: 0x8a7a50, hemiI: 1.1, rim: 2.6,
  },
  dino: {
    skyTop: '#c79a6a', skyBottom: '#f0d9a8', fog: 0xdcc49a, fogNear: 60, fogFar: 230,
    soil: '#8c6f4c', outer: 0x4f6a35, dry: [150, 124, 84], mid: [104, 140, 62], lush: [52, 108, 46],
    blade: 0x3c7a30, bladeTip: 0x8fbf4a, sun: 0xffe0b0, sunI: 2.3, hemiSky: 0xf2d8b0, hemiGround: 0x5a4a30, hemiI: 1.0, rim: 3.2,
  },
  water: {
    skyTop: '#0a3d5c', skyBottom: '#2a8fb0', fog: 0x1e6f8e, fogNear: 25, fogFar: 120,
    soil: '#cdbb8a', outer: 0xa89a6c, dry: [214, 198, 150], mid: [160, 176, 116], lush: [66, 132, 92],
    blade: 0x2f8a5a, bladeTip: 0x8fd08a, sun: 0xc8f0ff, sunI: 2.0, hemiSky: 0x9fe0ff, hemiGround: 0x2a5a5a, hemiI: 1.3, rim: 6,
  },
};

function gradientTexture(top: string, bottom: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d')!, gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Owns the renderer, camera, lights and the static + living environment of the current zone. */
export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 600);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private zoneGroup = new THREE.Group();
  private terrain!: Terrain;
  private zone: ZoneId = 'land';
  private pal: Palette = PALETTES.land;
  private groundCanvas = document.createElement('canvas');
  private groundTex: THREE.CanvasTexture | null = null;
  private baseCanvas = document.createElement('canvas');
  private overlayCanvas = document.createElement('canvas');
  private lowres = document.createElement('canvas');
  private blades: THREE.InstancedMesh | null = null;
  private bladeCells: Int32Array = new Int32Array(0);
  private bladeBase: Float32Array = new Float32Array(0);
  private swayUniform = { value: 0 };
  private mixers: THREE.AnimationMixer[] = [];
  private drifters: { obj: THREE.Object3D; cx: number; cz: number; r: number; speed: number; phase: number; y: number }[] = [];
  private snow: THREE.Points | null = null;
  private time = 0;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.zoneGroup);
    this.groundCanvas.width = this.baseCanvas.width = this.overlayCanvas.width = WORLD.width;
    this.groundCanvas.height = this.baseCanvas.height = this.overlayCanvas.height = WORLD.height;
    const resize = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(host);
    resize();
  }

  get underwater(): boolean { return this.zone === 'water'; }

  toWorld(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set((x - WORLD.width / 2) * S, this.heightAt(x, y), (y - WORLD.height / 2) * S);
  }

  heightAt(x: number, y: number): number {
    const t = this.terrain;
    let h = t.height(x, y);
    const dOut = Math.max(P.left - x, x - P.right, P.top - y, y - P.bottom, 0);
    h += smoothstep(0, 46, dOut) * this.pal.rim;
    if (t.lake) {
      const dx = (x - t.lake.x) / t.lake.rx, dy = (y - t.lake.y) / t.lake.ry, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1.15) h -= (1 - smoothstep(0.75, 1.15, d)) * 1.6;
    }
    return h;
  }

  /** Builds the full environment for a zone. */
  async setZone(zone: ZoneId, terrain: Terrain, grass: GrassField, lib: ModelLibrary): Promise<void> {
    this.zone = zone; this.terrain = terrain; this.pal = PALETTES[zone];
    for (const m of this.mixers) m.stopAllAction();
    this.mixers = []; this.drifters = []; this.snow = null;
    this.zoneGroup.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.owned) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    this.zoneGroup.clear();

    const pal = this.pal;
    this.scene.background = gradientTexture(pal.skyTop, pal.skyBottom);
    this.scene.fog = new THREE.Fog(pal.fog, pal.fogNear, pal.fogFar);
    this.sun.color.setHex(pal.sun); this.sun.intensity = pal.sunI;
    this.hemi.color.setHex(pal.hemiSky); this.hemi.groundColor.setHex(pal.hemiGround); this.hemi.intensity = pal.hemiI;

    this.paintBase();
    this.buildGround();
    this.buildOuter();
    if (terrain.lake) this.buildLake();
    this.buildVegetation(grass);
    this.updateVegetation(grass);
    await this.buildProps(lib);
    if (zone === 'water') await this.buildUnderwater(lib);
    if (zone === 'dino') this.buildVolcano();
  }

  private own<T extends THREE.Mesh>(m: T): T { m.userData.owned = true; return m; }

  // ------------------------------------------------------------------ ground
  private paintBase(): void {
    const g = this.baseCanvas.getContext('2d')!, rng = createRng(7);
    g.fillStyle = this.pal.soil; g.fillRect(0, 0, WORLD.width, WORLD.height);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rng.chance(0.5) ? 'rgba(90,70,40,.18)' : 'rgba(255,240,200,.16)';
      const r = rng.range(1, 4);
      g.fillRect(rng.range(0, WORLD.width), rng.range(0, WORLD.height), r, r);
    }
    const o = this.overlayCanvas.getContext('2d')!;
    o.clearRect(0, 0, WORLD.width, WORLD.height);
    const t = this.terrain;
    if (t.stream.length) {
      const s = t.stream;
      const stroke = (w: number, col: string) => {
        o.strokeStyle = col; o.lineWidth = w; o.lineCap = 'round'; o.lineJoin = 'round';
        o.beginPath(); o.moveTo(s[0].x, s[0].y);
        for (let i = 1; i < s.length - 1; i++) o.quadraticCurveTo(s[i].x, s[i].y, (s[i].x + s[i + 1].x) / 2, (s[i].y + s[i + 1].y) / 2);
        o.lineTo(s[s.length - 1].x, s[s.length - 1].y); o.stroke();
      };
      stroke(24, 'rgba(150,120,70,.6)'); stroke(15, '#4f9cc0'); stroke(6, 'rgba(170,220,240,.6)');
    }
    if (t.lake) {
      o.fillStyle = 'rgba(214,192,140,.95)';
      o.beginPath(); o.ellipse(t.lake.x, t.lake.y, t.lake.rx + 14, t.lake.ry + 11, 0, 0, Math.PI * 2); o.fill();
    }
    // darker rim outside the play area
    o.fillStyle = 'rgba(40,50,25,.35)';
    o.fillRect(0, 0, WORLD.width, P.top); o.fillRect(0, P.bottom, WORLD.width, WORLD.height - P.bottom);
    o.fillRect(0, 0, P.left, WORLD.height); o.fillRect(P.right, 0, WORLD.width - P.right, WORLD.height);
    this.lowres.width = WORLD.width / WORLD.cell; this.lowres.height = WORLD.height / WORLD.cell;
  }

  private buildGround(): void {
    const geo = new THREE.PlaneGeometry(WW, WH, 160, 96);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / S + WORLD.width / 2, y = pos.getZ(i) / S + WORLD.height / 2;
      pos.setY(i, this.heightAt(x, y));
    }
    geo.computeVertexNormals();
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = 8;
    const ground = this.own(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95 })));
    ground.receiveShadow = true;
    this.zoneGroup.add(ground);
  }

  private buildOuter(): void {
    const pal = this.pal;
    // surrounding ground is a ring: a big square with the arena cut out, at rim height
    const shape = new THREE.Shape();
    shape.moveTo(-350, -350); shape.lineTo(350, -350); shape.lineTo(350, 350); shape.lineTo(-350, 350); shape.closePath();
    const hole = new THREE.Path();
    const hx = WW / 2 - 0.5, hz = WH / 2 - 0.5;
    hole.moveTo(-hx, -hz); hole.lineTo(-hx, hz); hole.lineTo(hx, hz); hole.lineTo(hx, -hz); hole.closePath();
    shape.holes.push(hole);
    const outerGeo = new THREE.ShapeGeometry(shape);
    outerGeo.rotateX(-Math.PI / 2);
    const outer = this.own(new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({ color: pal.outer, roughness: 1 })));
    outer.position.y = pal.rim - 0.05;
    outer.receiveShadow = true;
    this.zoneGroup.add(outer);

    // ring of scenery around the arena
    const rng = createRng(31);
    const ringGeo = this.zone === 'water' ? new THREE.DodecahedronGeometry(1, 0) : this.zone === 'dino' ? new THREE.ConeGeometry(1, 3.2, 7) : new THREE.IcosahedronGeometry(1, 0);
    const ringMat = new THREE.MeshStandardMaterial({ color: this.zone === 'water' ? 0x6b7f74 : this.zone === 'dino' ? 0x2f5a2a : 0x4a7a34, roughness: 0.9, flatShading: true });
    const n = 260;
    const ring = this.own(new THREE.InstancedMesh(ringGeo, ringMat, n) as unknown as THREE.Mesh) as unknown as THREE.InstancedMesh;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      let x: number, z: number;
      do { x = rng.range(-WW / 2 - 60, WW / 2 + 60); z = rng.range(-WH / 2 - 50, WH / 2 + 50); }
      while (Math.abs(x) < WW / 2 - 1 && Math.abs(z) < WH / 2 - 1);
      const s = this.zone === 'water' ? rng.range(1.5, 5) : rng.range(2, 4.5);
      v.set(x, pal.rim + (this.zone === 'dino' ? s * 1.4 : s * 0.6), z);
      q.setFromEuler(new THREE.Euler(0, rng.range(0, 6.28), 0));
      sc.set(s, s * (this.zone === 'land' ? 0.8 : 1), s);
      ring.setMatrixAt(i, m.compose(v, q, sc));
    }
    ring.castShadow = true;
    this.zoneGroup.add(ring);
  }

  private buildLake(): void {
    const l = this.terrain.lake!;
    const geo = new THREE.CircleGeometry(1, 48); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3c8fb8, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.88 });
    const water = this.own(new THREE.Mesh(geo, mat));
    const c = this.toWorld(l.x, l.y);
    water.position.set(c.x, -0.35, c.z);
    water.scale.set((l.rx + 6) * S, 1, (l.ry + 6) * S);
    water.receiveShadow = true;
    this.zoneGroup.add(water);
  }

  // ------------------------------------------------------------------ living vegetation (grass / ferns / sea-grass)
  private buildVegetation(grass: GrassField): void {
    const zone = this.zone;
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [], cols: number[] = [];
    const blades = zone === 'dino' ? 7 : zone === 'water' ? 3 : 5;
    const H = zone === 'dino' ? 1.0 : zone === 'water' ? 1.5 : 0.55;
    const base = new THREE.Color(this.pal.blade), tip = new THREE.Color(this.pal.bladeTip);
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * Math.PI * 2, lean = zone === 'dino' ? 0.6 : zone === 'water' ? 0.12 : 0.3;
      const w = zone === 'dino' ? 0.16 : zone === 'water' ? 0.1 : 0.05;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz * w, pz = dx * w;
      const tx = dx * H * lean, tz = dz * H * lean, ty = H * (zone === 'dino' ? 0.7 : 1);
      verts.push(px, 0, pz, -px, 0, -pz, tx, ty, tz);
      cols.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const sway = this.swayUniform, amp = zone === 'water' ? 0.35 : zone === 'dino' ? 0.12 : 0.1;
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = sway;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
          transformed.x += sin(uTime * 1.6 + ph) * position.y * ${amp.toFixed(2)};
          transformed.z += cos(uTime * 1.2 + ph) * position.y * ${(amp * 0.6).toFixed(2)};`);
    };
    const perCell = zone === 'land' ? 4 : 3;
    const cells: number[] = [];
    for (let i = 0; i < grass.density.length; i++) if (grass.usable[i]) for (let k = 0; k < perCell; k++) cells.push(i);
    const inst = new THREE.InstancedMesh(geo, mat, cells.length);
    inst.userData.owned = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    this.bladeCells = Int32Array.from(cells);
    this.bladeBase = new Float32Array(cells.length * 4);
    const rng = createRng(11), c = WORLD.cell;
    for (let j = 0; j < cells.length; j++) {
      const i = cells[j];
      const x = (i % grass.gw) * c + rng.range(2, c - 2), y = Math.floor(i / grass.gw) * c + rng.range(2, c - 2);
      const w = this.toWorld(x, y);
      this.bladeBase.set([w.x, w.y, w.z, rng.range(0, 6.28)], j * 4);
    }
    this.blades = inst;
    this.zoneGroup.add(inst);
  }

  /** Repaints ground colour and rescales vegetation from the live grass densities. */
  updateVegetation(grass: GrassField): void {
    if (!this.groundTex) return; // zone not built yet
    const pal = this.pal;
    const lc = this.lowres.getContext('2d')!;
    const img = lc.createImageData(grass.gw, grass.gh), d = img.data;
    for (let i = 0; i < grass.density.length; i++) {
      const g = grass.density[i];
      let a: number[], b: number[], t: number;
      if (g < 0.5) { a = pal.dry; b = pal.mid; t = g / 0.5; } else { a = pal.mid; b = pal.lush; t = (g - 0.5) / 0.5; }
      d[i * 4] = a[0] + (b[0] - a[0]) * t; d[i * 4 + 1] = a[1] + (b[1] - a[1]) * t; d[i * 4 + 2] = a[2] + (b[2] - a[2]) * t;
      d[i * 4 + 3] = grass.usable[i] ? Math.round(70 + 185 * Math.min(1, g * 1.6)) : 0;
    }
    lc.putImageData(img, 0, 0);
    const gc = this.groundCanvas.getContext('2d')!;
    gc.drawImage(this.baseCanvas, 0, 0);
    gc.imageSmoothingEnabled = true;
    gc.drawImage(this.lowres, 0, 0, WORLD.width, WORLD.height);
    gc.drawImage(this.overlayCanvas, 0, 0);
    this.groundTex.needsUpdate = true;

    const inst = this.blades;
    if (!inst) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    for (let j = 0; j < this.bladeCells.length; j++) {
      const g = grass.density[this.bladeCells[j]];
      const k = j * 4;
      const sc = g < 0.12 ? 0.001 : 0.25 + g * 0.95;
      v.set(this.bladeBase[k], this.bladeBase[k + 1], this.bladeBase[k + 2]);
      e.set(0, this.bladeBase[k + 3], 0); q.setFromEuler(e);
      s.set(sc, sc, sc);
      inst.setMatrixAt(j, m.compose(v, q, s));
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ props
  private async buildProps(lib: ModelLibrary): Promise<void> {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x4f8a34, roughness: 0.85, flatShading: true });
    const leafDark = new THREE.MeshStandardMaterial({ color: 0x2f6127, roughness: 0.85, flatShading: true });
    const stone = new THREE.MeshStandardMaterial({ color: this.zone === 'water' ? 0x7d8a80 : 0x8d877c, roughness: 0.95, flatShading: true });
    const coralMats = [0xf27a7a, 0xf2b14c, 0xb07ad8, 0x6fd0c0].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true }));
    const cycad = this.zone === 'dino' ? await lib.load('cycad.glb') : null;
    const coral = this.zone === 'water' ? await lib.load('coral-reef.glb') : null;

    for (const p of this.terrain.props) {
      const pos = this.toWorld(p.x, p.y);
      const g = new THREE.Group();
      g.position.copy(pos);
      g.rotation.y = p.rot;
      g.scale.setScalar(p.scale);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; m.userData.owned = true;
        g.add(m);
      };
      switch (p.kind) {
        case 'acacia':
          add(new THREE.CylinderGeometry(0.18, 0.3, 4, 6), wood, 0, 2, 0);
          add(new THREE.CylinderGeometry(0.1, 0.16, 2, 5), wood, 0.7, 3.6, 0, 1, 1, 1);
          add(new THREE.SphereGeometry(3.4, 10, 6), leaf, 0, 4.6, 0, 1, 0.28, 1);
          add(new THREE.SphereGeometry(2.4, 9, 6), leafDark, 0.8, 4.3, 0.4, 1, 0.25, 1);
          break;
        case 'tree':
          if (this.zone === 'dino') {
            add(new THREE.CylinderGeometry(0.25, 0.4, 3, 6), wood, 0, 1.5, 0);
            for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(2.4 - i * 0.45, 2.4, 8), leafDark, 0, 3 + i * 1.5, 0);
          } else {
            add(new THREE.CylinderGeometry(0.22, 0.35, 2.6, 6), wood, 0, 1.3, 0);
            add(new THREE.IcosahedronGeometry(2.2, 1), leaf, 0, 3.6, 0);
            add(new THREE.IcosahedronGeometry(1.5, 1), leafDark, 1.1, 3.0, 0.5);
          }
          break;
        case 'bush':
          for (let i = 0; i < 4; i++) add(new THREE.IcosahedronGeometry(0.9, 1), i % 2 ? leaf : leafDark, Math.cos(i * 1.7) * 0.7, 0.6 + (i % 2) * 0.3, Math.sin(i * 1.7) * 0.6);
          break;
        case 'rock':
          add(new THREE.DodecahedronGeometry(0.9, 0), stone, 0, 0.45, 0, 1.3, 0.8, 1);
          add(new THREE.DodecahedronGeometry(0.5, 0), stone, 0.9, 0.25, 0.4);
          break;
        case 'fern':
          for (let i = 0; i < 6; i++) {
            const m = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.8, 4), leaf);
            m.position.set(Math.cos(i) * 0.4, 0.7, Math.sin(i) * 0.4);
            m.rotation.set(Math.sin(i) * 0.8, 0, -Math.cos(i) * 0.8);
            m.castShadow = true; g.add(m);
          }
          break;
        case 'cycad':
          if (cycad) { const inst = lib.instance(cycad, 4.4, false, false); g.add(inst.root); }
          break;
        case 'coral':
          if (coral) {
            const inst: ModelInstance = lib.instance(coral, 5.5, false, false);
            g.add(inst.root);
            const a = inst.actions.get('Sway'); if (a) { a.play(); a.time = Math.random() * 3; }
            this.mixers.push(inst.mixer);
          } else add(new THREE.IcosahedronGeometry(1.2, 0), coralMats[0], 0, 0.8, 0);
          break;
        case 'kelp': {
          const h = 5 + (p.x % 3);
          for (let i = 0; i < 3; i++) {
            const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, h, 4, 6), new THREE.MeshStandardMaterial({ color: 0x3f7f3a, roughness: 0.8 }));
            m.position.set(i * 0.4 - 0.4, h / 2, (i % 2) * 0.3);
            m.userData.kelp = i + p.x;
            g.add(m);
          }
          if (Math.abs(p.x) % 2 < 1) add(new THREE.IcosahedronGeometry(0.6, 0), coralMats[(Math.floor(p.y) % 4)], 0.8, 0.4, 0.6);
          break;
        }
      }
      this.zoneGroup.add(g);
    }
  }

  // ------------------------------------------------------------------ zone extras
  private async buildUnderwater(lib: ModelLibrary): Promise<void> {
    // surface seen from below
    const surf = this.own(new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false })));
    surf.rotation.x = Math.PI / 2; surf.position.y = 18;
    this.zoneGroup.add(surf);
    // light shafts
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0xc8f4ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rng = createRng(3);
    for (let i = 0; i < 9; i++) {
      const shaft = this.own(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 4, 22, 12, 1, true), shaftMat.clone()));
      shaft.position.set(rng.range(-55, 55), 8, rng.range(-32, 32));
      shaft.rotation.z = 0.25;
      this.zoneGroup.add(shaft);
    }
    // marine snow
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([rng.range(-70, 70), rng.range(0, 17), rng.range(-45, 45)], i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8fbff, size: 0.12, transparent: true, opacity: 0.7, depthWrite: false }));
    this.zoneGroup.add(this.snow);
    // drifting jellyfish
    const jelly = await lib.load('jellyfish.glb');
    for (let i = 0; i < 8; i++) {
      const inst = lib.instance(jelly, 1.6, true, false);
      const a = inst.actions.get('Pulse'); if (a) { a.play(); a.time = rng.range(0, 2); }
      this.mixers.push(inst.mixer);
      this.zoneGroup.add(inst.root);
      this.drifters.push({ obj: inst.root, cx: rng.range(-50, 50), cz: rng.range(-28, 28), r: rng.range(3, 10), speed: rng.range(0.04, 0.1), phase: rng.range(0, 6.28), y: rng.range(7, 14) });
    }
  }

  private buildVolcano(): void {
    const g = new THREE.Group();
    const rock = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1, flatShading: true });
    const cone = this.own(new THREE.Mesh(new THREE.ConeGeometry(55, 48, 14, 3, true), rock));
    cone.position.y = 24;
    const lava = this.own(new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: 0xff7a2a, fog: false })));
    lava.rotation.x = -Math.PI / 2; lava.position.y = 41;
    g.add(cone, lava);
    g.position.set(40, this.pal.rim - 2, -140);
    this.zoneGroup.add(g);
    const smoke = new THREE.MeshStandardMaterial({ color: 0x8a7f78, transparent: true, opacity: 0.5, roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const puff = this.own(new THREE.Mesh(new THREE.IcosahedronGeometry(6 + i * 1.5, 1), smoke));
      puff.position.set(40 + i * 3, this.pal.rim + 48 + i * 7, -140 - i * 2);
      puff.userData.smoke = i;
      this.zoneGroup.add(puff);
    }
  }

  /** Per-frame environment animation + shadow camera follow. */
  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    this.swayUniform.value = this.time;
    for (const m of this.mixers) m.update(dt);
    for (const d of this.drifters) {
      const t = this.time * d.speed + d.phase;
      d.obj.position.set(d.cx + Math.cos(t) * d.r, d.y + Math.sin(this.time * 0.5 + d.phase) * 0.8, d.cz + Math.sin(t) * d.r);
    }
    if (this.snow) {
      const p = this.snow.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - dt * 0.15;
        if (y < 0) y += 17;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    this.zoneGroup.traverse(o => {
      if (o.userData.kelp !== undefined) o.rotation.z = Math.sin(this.time * 0.9 + o.userData.kelp) * 0.12;
      else if (o.userData.smoke !== undefined) o.position.y += Math.sin(this.time * 0.3 + o.userData.smoke) * dt * 0.5;
    });
    // sun follows the action so shadows stay crisp
    this.sun.position.set(focus.x + 30, focus.y + 60, focus.z + 22);
    this.sun.target.position.copy(focus);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
