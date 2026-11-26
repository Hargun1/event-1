import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ZoneId } from '../game/data/species.ts';

const FOLLOW_DIST: Record<ZoneId, number> = { land: 20, dino: 34, water: 22 };

/** Third-person follow camera (play) or orbit camera (watch). */
export class CameraRig {
  yaw = 0;
  pitch = 0.6;
  dist = 22;
  private zone: ZoneId = 'land';
  private target = new THREE.Vector3();
  private camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  private mode: 'follow' | 'orbit' = 'orbit';
  private shakeAmt = 0;

  /** Short camera shake (hits, roars). */
  shake(amount: number): void { this.shakeAmt = Math.min(1.2, this.shakeAmt + amount); }

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.46;
    this.orbit.minDistance = 8;
    this.orbit.maxDistance = 150;
    this.orbit.screenSpacePanning = false;
  }

  setZone(zone: ZoneId): void {
    this.zone = zone;
    this.dist = FOLLOW_DIST[zone];
    this.pitch = zone === 'water' ? 0.38 : 0.6;
  }

  setMode(mode: 'follow' | 'orbit', focus?: THREE.Vector3): void {
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      const f = focus ?? new THREE.Vector3();
      this.orbit.target.copy(f);
      const d = this.zone === 'dino' ? 110 : 85;
      this.camera.position.set(f.x + d * 0.35, f.y + d * (this.zone === 'water' ? 0.25 : 0.6), f.z + d * 0.75);
      this.orbit.update();
    } else if (focus) {
      this.target.copy(focus);
    }
  }

  rotate(d: number): void { this.yaw += d; }
  zoom(f: number): void { this.dist = THREE.MathUtils.clamp(this.dist * f, FOLLOW_DIST[this.zone] * 0.45, FOLLOW_DIST[this.zone] * 2.2); }

  /** Forward/right ground vectors (sim x,y) for camera-relative movement. */
  basis(): { fx: number; fy: number; rx: number; ry: number } {
    return { fx: -Math.sin(this.yaw), fy: -Math.cos(this.yaw), rx: Math.cos(this.yaw), ry: -Math.sin(this.yaw) };
  }

  update(dt: number, focus: THREE.Vector3 | null): void {
    if (this.mode === 'orbit') {
      if (focus) this.orbit.target.lerp(focus, Math.min(1, dt * 3));
      this.orbit.update();
      return;
    }
    if (focus) this.target.lerp(focus, Math.min(1, dt * 6));
    const d = this.dist, cp = Math.cos(this.pitch);
    const want = new THREE.Vector3(
      this.target.x + Math.sin(this.yaw) * cp * d,
      this.target.y + Math.sin(this.pitch) * d,
      this.target.z + Math.cos(this.yaw) * cp * d,
    );
    if (this.zone === 'water') want.y = Math.min(want.y, 16.5);
    this.camera.position.lerp(want, Math.min(1, dt * 8));
    this.camera.lookAt(this.target.x, this.target.y + (this.zone === 'dino' ? 3 : 1.2), this.target.z);
    if (this.shakeAmt > 0.01) {
      const a = this.shakeAmt * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.rotation.z += (Math.random() - 0.5) * a * 0.02;
      this.shakeAmt *= Math.pow(0.02, dt);
    }
  }

  /** Point the orbit camera at a position (watch mode focus). */
  focusOrbit(p: THREE.Vector3): void { this.orbit.target.copy(p); }
}
