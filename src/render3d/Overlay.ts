import * as THREE from 'three';
import type { Ecosystem } from '../game/systems/Ecosystem.ts';
import type { AnimalViews } from './AnimalViews.ts';

interface Bar { el: HTMLElement; fill: HTMLElement; used: boolean }

/** HTML layer over the canvas: health bars above fighting animals and floating damage numbers. */
export class Overlay {
  private host: HTMLElement;
  private bars = new Map<number, Bar>();
  private v = new THREE.Vector3();

  constructor(host: HTMLElement) { this.host = host; }

  clear(): void {
    for (const b of this.bars.values()) b.el.remove();
    this.bars.clear();
    this.host.querySelectorAll('.dmg').forEach(e => e.remove());
  }

  private project(p: THREE.Vector3, camera: THREE.Camera): { x: number; y: number } | null {
    this.v.copy(p).project(camera);
    if (this.v.z > 1 || this.v.z < -1) return null;
    return { x: (this.v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-this.v.y * 0.5 + 0.5) * this.host.clientHeight };
  }

  update(eco: Ecosystem, views: AnimalViews, camera: THREE.Camera, focusId: number | null): void {
    for (const b of this.bars.values()) b.used = false;
    const anchor = new THREE.Vector3();
    let shown = 0;
    for (const a of eco.animals) {
      if (!a.alive || a.isPlayer) continue;
      const fighting = a.aggro > 0 || a.hurtTimer < 4 || a.id === focusId;
      if (!fighting || shown >= 12) continue;
      if (!views.anchor(a.id, anchor)) continue;
      const s = this.project(anchor, camera);
      if (!s) continue;
      shown++;
      let b = this.bars.get(a.id);
      if (!b) {
        const el = document.createElement('div');
        el.className = 'hpbar';
        el.innerHTML = `<span></span><i><b></b></i>`;
        this.host.appendChild(el);
        b = { el, fill: el.querySelector('b') as HTMLElement, used: true };
        this.bars.set(a.id, b);
      }
      b.used = true;
      (b.el.firstElementChild as HTMLElement).textContent = a.species.name + (a.aggro > 0 ? ' ⚔' : '');
      b.el.classList.toggle('hostile', a.aggro > 0);
      b.fill.style.width = `${Math.max(0, a.health / a.maxHealth) * 100}%`;
      b.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    }
    for (const [id, b] of this.bars) if (!b.used) { b.el.remove(); this.bars.delete(id); }

    for (const h of views.hits) {
      const s = this.project(h.pos, camera);
      if (!s) continue;
      const el = document.createElement('div');
      el.className = 'dmg' + (h.onPlayer ? ' me' : '');
      el.textContent = `-${h.amount}`;
      el.style.left = `${s.x + (Math.random() * 20 - 10)}px`;
      el.style.top = `${s.y}px`;
      this.host.appendChild(el);
      setTimeout(() => el.remove(), 900);
    }
    views.hits.length = 0;
  }
}
