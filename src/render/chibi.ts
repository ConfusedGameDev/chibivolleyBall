import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MOVE } from '../sim/constants';
import type { Avatar } from '../sim/types';
import { outline, TEAM, toon } from './toon';

export interface AvatarView { root: THREE.Object3D; update(a: Avatar, dt: number): void; clips?: string[] }

const HAIR = [0x3b2a20, 0x6b4a2f, 0x2a2840, 0xd9a35a, 0xb5523b];
const SKIN = 0xffdcc0;
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/** Squash-and-stretch spring shared by both avatar kinds. */
class Squash {
  s = 1; v = 0; private g = true;
  step(a: Avatar, dt: number) {
    if (!this.g && a.ground) this.v -= 3.2;
    if (this.g && !a.ground) this.v += 2.4;
    this.g = a.ground;
    this.v += ((1 - this.s) * 180 - this.v * 12) * dt;
    this.s += this.v * dt;
    return this.s;
  }
}

/** Big-head chibi with floating hands, built from primitives and animated procedurally (no rig). */
export class PrimitiveChibi implements AvatarView {
  root = new THREE.Group();
  private inner = new THREE.Group();
  private hands: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  private phase = 0;
  private sq = new Squash();

  constructor(a: Avatar) {
    this.root.add(this.inner);
    const body = outline(new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.16, 4, 14), toon(TEAM[a.side])));
    body.position.y = 0.36;
    const head = outline(new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), toon(SKIN)), 1.05);
    head.position.y = 0.8;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.318, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), toon(HAIR[a.id % HAIR.length]));
    hair.rotation.x = -0.35; hair.position.set(0, 0.02, -0.02);
    head.add(hair);
    const eyeG = new THREE.SphereGeometry(0.035, 10, 8), eyeM = new THREE.MeshBasicMaterial({ color: 0x1d1a26 });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(eyeG, eyeM); e.scale.y = 1.5; e.position.set(sx * 0.1, -0.02, 0.28); head.add(e);
      const h = outline(new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), toon(SKIN)), 1.12);
      this.hands.push(h);
      const f = outline(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), toon(0x3a3550)), 1.12);
      f.scale.set(1, 0.6, 1.4); this.feet.push(f);
    }
    this.inner.add(body, head, ...this.hands, ...this.feet);
  }

  update(a: Avatar, dt: number) {
    this.root.position.set(a.p.x, a.p.y, a.p.z);
    this.root.rotation.y = a.yaw;
    const sp = Math.hypot(a.v.x, a.v.z), run = a.ground ? Math.min(1, sp / MOVE) : 0;
    this.phase += sp * dt * 3.4;
    const s = this.sq.step(a, dt), bob = Math.abs(Math.sin(this.phase)) * 0.05 * run;
    this.inner.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    this.inner.position.y = bob;
    this.inner.rotation.x = 0.14 * run - 0.22 * (a.charging ? a.charge : 0);
    const c = a.charging ? a.charge : 0, k = damp(25, dt);
    this.hands.forEach((h, i) => {
      const sx = i ? 1 : -1, t = new THREE.Vector3();
      if (a.swing > 0) t.set(sx * 0.15, 0.95, 0.38);
      else if (a.charging) t.set(sx * 0.28, i ? 0.55 + 0.35 * c : 0.62, i ? -0.3 * c : 0.12);
      else if (!a.ground) t.set(sx * 0.22, 1.08, 0.12);
      else t.set(sx * 0.31, 0.42, 0.05 + Math.sin(this.phase + i * Math.PI) * 0.16 * run);
      h.position.lerp(t, k);
    });
    this.feet.forEach((f, i) => {
      const ph = this.phase + i * Math.PI;
      f.position.set((i ? 1 : -1) * 0.11, 0.05 + Math.max(0, Math.sin(ph)) * 0.08 * run, Math.cos(ph) * 0.12 * run);
    });
  }
}

/** Rigged GLB (Kenney Mini Characters) driven by clip names matched loosely, so any pack with similar names works. */
export class GlbChibi implements AvatarView {
  root = new THREE.Group();
  clips: string[];
  private mixer: THREE.AnimationMixer;
  private act: Record<string, THREE.AnimationAction | undefined>;
  private cur = '';
  private curAct?: THREE.AnimationAction;
  private sq = new Squash();
  private model: THREE.Object3D;
  private base: number;

  constructor(gltf: GLTF, a: Avatar) {
    const model = this.model = SkeletonUtils.clone(gltf.scene);
    const box = new THREE.Box3().setFromObject(model), h = box.max.y - box.min.y || 1;
    this.base = 1.1 / h;
    model.scale.setScalar(this.base);
    model.position.y = -box.min.y * this.base;
    model.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const old = m.material as THREE.MeshStandardMaterial;
      m.material = toon(old.color ?? 0xffffff, old.map);
      m.frustumCulled = false;
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 24), new THREE.MeshBasicMaterial({ color: TEAM[a.side] }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
    this.root.add(model, ring);
    this.mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations;
    this.clips = clips.map(c => c.name);
    const pick = (...res: RegExp[]) => {
      for (const re of res) { const c = clips.find(c => re.test(c.name)); if (c) return this.mixer.clipAction(c); }
    };
    this.act = {
      idle: pick(/idle/i),
      run: pick(/sprint|run/i, /walk/i),
      jump: pick(/jump/i, /fall/i),
      hit: pick(/attack|punch|swing|slash|hit|throw/i, /interact|pick/i),
    };
    const hit = this.act.hit;
    if (hit) { hit.setLoop(THREE.LoopOnce, 1); hit.clampWhenFinished = true; }
    this.set('idle');
  }

  private fadeTo(next: THREE.AnimationAction, speed = 1) {
    const prev = this.curAct;
    next.reset(); next.paused = false; next.timeScale = speed; next.play();
    if (prev && prev !== next) next.crossFadeFrom(prev, 0.12, false);
    this.curAct = next;
  }

  private set(name: string) {
    if (name === this.cur) return;
    this.cur = name;
    const a = this.act[name] ?? this.act.idle;
    if (a && a !== this.curAct) this.fadeTo(a);
  }

  update(a: Avatar, dt: number) {
    this.root.position.set(a.p.x, a.p.y, a.p.z);
    this.root.rotation.y = a.yaw;
    const sp = Math.hypot(a.v.x, a.v.z), s = this.sq.step(a, dt), b = this.base;
    this.model.scale.set(b / Math.sqrt(s), b * s, b / Math.sqrt(s));
    const hit = this.act.hit;
    if (a.charging && hit) {
      if (this.cur !== 'charge') { this.fadeTo(hit); this.cur = 'charge'; }
      hit.paused = true; hit.time = hit.getClip().duration * 0.25 * a.charge;
    } else if (a.swing > 0 && hit) {
      if (this.cur === 'charge') { hit.paused = false; hit.timeScale = 1.8; this.cur = 'hit'; }
      else if (this.cur !== 'hit') { this.fadeTo(hit, 1.8); this.cur = 'hit'; }
    } else this.set(!a.ground ? 'jump' : sp > 0.6 ? 'run' : 'idle');
    const run = this.act.run;
    if (this.cur === 'run' && run) run.timeScale = Math.max(0.6, sp / MOVE) * 1.2;
    this.mixer.update(dt);
  }
}
