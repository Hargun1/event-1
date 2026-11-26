import * as THREE from 'three';

type Kind = 'dust' | 'bubble' | 'puff';

interface P {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  kind: Kind;
  t: number;
  life: number;
  vel: THREE.Vector3;
  size0: number;
  size1: number;
  alpha: number;
  phase: number;
}

function softDot(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bubbleTex(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(230,250,255,.95)'; g.lineWidth = 5;
  g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(24, 22, 6, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Small pooled sprite particle system: running dust, bubble trails and death puffs. */
export class Particles {
  private pool: P[] = [];
  private active: P[] = [];
  private group = new THREE.Group();
  private dotTex = softDot();
  private bubTex = bubbleTex();

  constructor(scene: THREE.Scene, size = 260) {
    scene.add(this.group);
    for (let i = 0; i < size; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.dotTex, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.pool.push({ sprite, mat, kind: 'dust', t: 0, life: 1, vel: new THREE.Vector3(), size0: 1, size1: 1, alpha: 1, phase: 0 });
    }
  }

  emit(kind: Kind, pos: THREE.Vector3, count: number, scale = 1, color = 0xd8c39a): void {
    for (let i = 0; i < count; i++) {
      const p = this.pool.pop();
      if (!p) return;
      p.kind = kind; p.t = 0; p.phase = Math.random() * 6.28;
      const r = () => (Math.random() - 0.5) * 2;
      if (kind === 'bubble') {
        p.mat.map = this.bubTex; p.mat.color.setHex(0xffffff);
        p.life = 1.4 + Math.random() * 1.2; p.size0 = 0.12 * scale; p.size1 = 0.22 * scale; p.alpha = 0.85;
        p.vel.set(r() * 0.3, 1.2 + Math.random() * 1.2, r() * 0.3);
      } else if (kind === 'puff') {
        p.mat.map = this.dotTex; p.mat.color.setHex(color);
        p.life = 1.0 + Math.random() * 0.6; p.size0 = 0.6 * scale; p.size1 = 2.4 * scale; p.alpha = 0.55;
        p.vel.set(r() * 1.6 * scale, 0.4 + Math.random() * 0.8, r() * 1.6 * scale);
      } else {
        p.mat.map = this.dotTex; p.mat.color.setHex(color);
        p.life = 0.7 + Math.random() * 0.5; p.size0 = 0.25 * scale; p.size1 = 1.1 * scale; p.alpha = 0.45;
        p.vel.set(r() * 0.6, 0.35 + Math.random() * 0.4, r() * 0.6);
      }
      p.sprite.position.set(pos.x + r() * 0.3 * scale, pos.y + 0.1, pos.z + r() * 0.3 * scale);
      p.sprite.visible = true;
      p.mat.needsUpdate = true;
      this.active.push(p);
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.sprite.visible = false; p.mat.opacity = 0; this.active.splice(i, 1); this.pool.push(p); continue; }
      if (p.kind === 'bubble') p.sprite.position.x += Math.sin(p.t * 6 + p.phase) * 0.01;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(p.kind === 'bubble' ? 1 : 1 - dt * 1.8);
      const s = p.size0 + (p.size1 - p.size0) * Math.sqrt(k);
      p.sprite.scale.set(s, s, 1);
      p.mat.opacity = p.alpha * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
    }
  }

  clear(): void {
    for (const p of this.active) { p.sprite.visible = false; this.pool.push(p); }
    this.active.length = 0;
  }
}
