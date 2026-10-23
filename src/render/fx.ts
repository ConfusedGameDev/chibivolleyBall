import * as THREE from 'three';
import type { Vec } from '../sim/types';

const N = 96;

/** Contact particles (one instanced mesh) and floating comic words projected from world space onto the DOM. */
export class Fx {
  mesh: THREE.InstancedMesh;
  private p = new Float32Array(N * 3);
  private v = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private size = new Float32Array(N);
  private next = 0;
  private words: { el: HTMLElement; p: THREE.Vector3; t: number }[] = [];
  private m = new THREE.Matrix4();
  private tmp = new THREE.Vector3();

  constructor(private layer: HTMLElement) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial(), N);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < N; i++) { this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); this.mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }
  }

  burst(at: Vec, n: number, color: THREE.ColorRepresentation = 0xffffff, speed = 3, size = 1) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next = (this.next + 1) % N;
      this.p.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), s = speed * (0.5 + Math.random() * 0.7);
      this.v.set([Math.cos(a) * r * s, Math.abs(u) * s + 1, Math.sin(a) * r * s], i * 3);
      this.life[i] = 0.35 + Math.random() * 0.25; this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  word(text: string, at: Vec, cls = '') {
    const el = document.createElement('div');
    el.className = 'word ' + cls; el.textContent = text;
    this.layer.appendChild(el);
    this.words.push({ el, p: new THREE.Vector3(at.x, at.y + 0.5, at.z), t: 0 });
    if (this.words.length > 5) this.words.shift()!.el.remove();
  }

  update(dt: number, cam: THREE.Camera, w: number, h: number) {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.v[j + 1] -= 9 * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const s = Math.max(0, this.life[i] * 2.4) * this.size[i];
      this.m.makeScale(s, s, s).setPosition(this.p[j], Math.max(0.03, this.p[j + 1]), this.p[j + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.words = this.words.filter(o => {
      o.t += dt;
      if (o.t > 1.1) { o.el.remove(); return false; }
      this.tmp.copy(o.p).project(cam);
      o.el.style.transform = `translate(${(this.tmp.x * 0.5 + 0.5) * w}px, ${(-this.tmp.y * 0.5 + 0.5) * h - o.t * 40}px) translate(-50%, -50%)`;
      return true;
    });
  }
}
