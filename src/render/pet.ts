import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BALL_R } from '../sim/constants';
import type { Ball } from '../sim/types';
import { outline, toon } from './toon';

/** The ball is a cube pet. Physics stays a sphere of BALL_R; this is only the look. */
export class PetBall {
  root = new THREE.Group();
  clips: string[] = [];
  private spinG = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private s = 1;
  private sv = 0;
  private dq = new THREE.Quaternion();
  private axis = new THREE.Vector3();

  constructor(gltf?: GLTF) {
    this.root.add(this.spinG);
    if (gltf) {
      const m = gltf.scene.clone(true), box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
      const k = (BALL_R * 2.1) / Math.max(size.x, size.y, size.z), c = box.getCenter(new THREE.Vector3());
      m.scale.setScalar(k); m.position.copy(c).multiplyScalar(-k);
      m.traverse(o => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) { const old = mm.material as THREE.MeshStandardMaterial; mm.material = toon(old.color ?? 0xffffff, old.map); }
      });
      this.spinG.add(m);
      this.clips = gltf.animations.map(a => a.name);
      if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(m);
        const idle = gltf.animations.find(a => /idle/i.test(a.name)) ?? gltf.animations[0];
        this.mixer.clipAction(idle).play();
      }
    } else this.spinG.add(primitivePet());
  }

  /** Contact squash. */
  pop(k = 1) { this.sv -= 5 * k; }

  update(b: Ball, dt: number) {
    this.root.position.set(b.p.x, b.p.y, b.p.z);
    const w = Math.hypot(b.spin.x, b.spin.y, b.spin.z);
    if (w > 1e-3 && !b.held) {
      this.axis.set(b.spin.x / w, b.spin.y / w, b.spin.z / w);
      this.dq.setFromAxisAngle(this.axis, w * dt);
      this.spinG.quaternion.premultiply(this.dq);
    } else if (b.held) this.spinG.quaternion.slerp(new THREE.Quaternion(), 1 - Math.exp(-dt * 10));
    this.sv += ((1 - this.s) * 260 - this.sv * 14) * dt;
    this.s += this.sv * dt;
    const s = Math.max(0.5, this.s);
    this.root.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    this.mixer?.update(dt);
  }
}

/** Stand-in until the Cube Pets GLBs are in public/models: a round-cornered cube with ears and a face. */
function primitivePet() {
  const g = new THREE.Group(), d = BALL_R * 1.9;
  const body = outline(new THREE.Mesh(new RoundedBoxGeometry(d, d, d, 3, d * 0.22), toon(0xffcf5c)), 1.06);
  g.add(body);
  const ear = new RoundedBoxGeometry(d * 0.26, d * 0.3, d * 0.16, 2, 0.02), earM = toon(0xf2a93b);
  const eye = new THREE.SphereGeometry(d * 0.07, 10, 8), eyeM = new THREE.MeshBasicMaterial({ color: 0x1d1a26 });
  const cheek = new THREE.CircleGeometry(d * 0.08, 12), cheekM = new THREE.MeshBasicMaterial({ color: 0xff9aa8 });
  for (const sx of [-1, 1]) {
    const e = outline(new THREE.Mesh(ear, earM), 1.1); e.position.set(sx * d * 0.3, d * 0.6, 0); e.rotation.z = -sx * 0.2; g.add(e);
    const ey = new THREE.Mesh(eye, eyeM); ey.position.set(sx * d * 0.2, d * 0.08, d * 0.5); g.add(ey);
    const ch = new THREE.Mesh(cheek, cheekM); ch.position.set(sx * d * 0.32, -d * 0.08, d * 0.502); g.add(ch);
  }
  return g;
}
