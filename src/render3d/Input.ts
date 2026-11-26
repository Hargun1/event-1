import type { PlayerInput } from '../game/entities/Player.ts';
import type { CameraRig } from './CameraRig.ts';

/** Keyboard, mouse and touch input mapped to camera-relative movement. */
export class InputController {
  private keys = new Set<string>();
  private attackPulse = 0;
  private joy = { x: 0, y: 0, active: false };
  private touchSprint = false;
  private touchAttack = false;
  private breedReq = false;
  private rig: CameraRig;
  enabled = false;

  constructor(canvas: HTMLElement, rig: CameraRig) {
    this.rig = rig;
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (this.enabled && e.code === 'KeyB' && !e.repeat) this.breedReq = true;
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // mouse: left click attacks, right-drag turns the camera, wheel zooms
    let dragging = false, lastX = 0;
    canvas.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled || e.pointerType === 'touch') return;
      if (e.button === 0) this.attackPulse = 0.12;
      if (e.button === 2) { dragging = true; lastX = e.clientX; }
    });
    window.addEventListener('pointermove', e => { if (dragging) { this.rig.rotate(-(e.clientX - lastX) * 0.005); lastX = e.clientX; } });
    window.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('wheel', e => { if (this.enabled) { e.preventDefault(); this.rig.zoom(e.deltaY > 0 ? 1.1 : 0.9); } }, { passive: false });
  }

  /** Wires the on-screen joystick and buttons (touch devices). */
  bindTouch(stick: HTMLElement, knob: HTMLElement, attackBtn: HTMLElement, sprintBtn: HTMLElement, breedBtn: HTMLElement): void {
    breedBtn.addEventListener('pointerdown', e => { e.preventDefault(); this.breedReq = true; });
    let id = -1, cx = 0, cy = 0;
    const R = 46;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.joy.x = (dx * k) / R; this.joy.y = (dy * k) / R;
    };
    stick.addEventListener('pointerdown', e => {
      id = e.pointerId; stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      this.joy.active = true; move(e);
    });
    stick.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; this.joy = { x: 0, y: 0, active: false }; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (el: HTMLElement, set: (v: boolean) => void) => {
      el.addEventListener('pointerdown', e => { e.preventDefault(); set(true); el.classList.add('down'); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => { set(false); el.classList.remove('down'); });
    };
    hold(attackBtn, v => { this.touchAttack = v; if (v) this.attackPulse = 0.12; });
    hold(sprintBtn, v => { this.touchSprint = v; });
  }

  read(dt: number, out: PlayerInput): void {
    if (!this.enabled) { out.mx = out.my = 0; out.sprint = out.attack = false; return; }
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    if (this.joy.active) { r += this.joy.x; f -= this.joy.y; }
    if (k.has('KeyQ')) this.rig.rotate(dt * 1.8);
    if (k.has('KeyE')) this.rig.rotate(-dt * 1.8);
    const b = this.rig.basis();
    out.mx = b.fx * f + b.rx * r;
    out.my = b.fy * f + b.ry * r;
    const m = Math.hypot(out.mx, out.my);
    if (m > 1) { out.mx /= m; out.my /= m; }
    out.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint;
    this.attackPulse -= dt;
    out.attack = k.has('Space') || k.has('KeyJ') || this.touchAttack || this.attackPulse > 0;
    if (this.breedReq) { out.breed = true; this.breedReq = false; }
  }
}
