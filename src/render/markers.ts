import * as THREE from 'three';
import { BALL_R } from '../sim/constants';
import { landingPoint } from '../sim/physics';
import type { Avatar } from '../sim/types';
import type { World } from '../sim/world';
import { TEAM } from './toon';

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(40,40,70,0.55)'); r.addColorStop(0.6, 'rgba(40,40,70,0.25)'); r.addColorStop(1, 'rgba(40,40,70,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const flat = (m: THREE.Mesh, y: number) => { m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 1; return m; };

/** Ribbon trail behind the ball, tinted by the team that touched it last. */
class Trail {
  static N = 22;
  mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private pos: Float32Array;
  private col: Float32Array;

  constructor() {
    const N = Trail.N, g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3); this.col = new Float32Array(N * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }

  update(p: THREE.Vector3, on: boolean, color: THREE.Color, cam: THREE.Camera) {
    if (!on) { this.pts.length = 0; this.mesh.visible = false; return; }
    this.pts.push(p.clone());
    if (this.pts.length > Trail.N) this.pts.shift();
    const n = this.pts.length;
    this.mesh.visible = n > 2;
    const view = new THREE.Vector3(), side = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let i = 0; i < Trail.N; i++) {
      const k = Math.min(i, n - 1), q = this.pts[k] ?? p, nx = this.pts[Math.min(k + 1, n - 1)] ?? q, pv = this.pts[Math.max(k - 1, 0)] ?? q;
      dir.subVectors(nx, pv); view.subVectors(cam.position, q);
      side.crossVectors(dir, view).normalize();
      const t = n > 1 ? k / (n - 1) : 0, w = BALL_R * 0.9 * t;
      this.pos.set([q.x + side.x * w, q.y + side.y * w, q.z + side.z * w, q.x - side.x * w, q.y - side.y * w, q.z - side.z * w], i * 6);
      const al = t * 0.55;
      this.col.set([color.r, color.g, color.b, al, color.r, color.g, color.b, al], i * 8);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

/** Everything drawn on the floor (or as a guide) to make 3D depth readable: landing ring, drop line, shadows, charge arc. */
export class Markers {
  group = new THREE.Group();
  private land: THREE.Mesh;
  private landMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  private drop: THREE.Line;
  private ballShadow: THREE.Mesh;
  private shadows: THREE.Mesh[] = [];
  private ring: THREE.Group;
  private arc: THREE.Mesh;
  private arcMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, depthWrite: false });
  private trail = new Trail();
  private t = 0;

  constructor(n: number) {
    const blob = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
    this.land = flat(new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 40), this.landMat), 0.01);
    const inner = flat(new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), this.landMat), 0);
    inner.rotation.x = 0; this.land.add(inner);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.drop = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0x7c86b0, dashSize: 0.1, gapSize: 0.09, transparent: true, opacity: 0.8 }));
    this.drop.frustumCulled = false;
    this.ballShadow = flat(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), blob), 0.006);
    for (let i = 0; i < n; i++) { const s = flat(new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), blob), 0.005); this.shadows.push(s); this.group.add(s); }
    this.ring = new THREE.Group();
    this.ring.add(flat(new THREE.Mesh(new THREE.RingGeometry(0.36, 0.42, 48), new THREE.MeshBasicMaterial({ color: 0x64a9e8, transparent: true, opacity: 0.85, depthWrite: false })), 0.008));
    this.arc = flat(new THREE.Mesh(new THREE.RingGeometry(0.45, 0.54, 48, 1, Math.PI / 2, Math.PI * 2), this.arcMat), 0.009);
    this.arc.scale.x = -1;
    this.ring.add(this.arc);
    this.group.add(this.land, this.drop, this.ballShadow, this.ring, this.trail.mesh);
  }

  update(w: World, me: Avatar, cam: THREE.Camera, dt: number) {
    this.t += dt;
    const b = w.ball, live = b.live && !b.held && w.phase === 'rally';
    w.avatars.forEach((a, i) => {
      const s = this.shadows[i], k = 1 / (1 + a.p.y * 0.6);
      s.position.set(a.p.x, 0.005, a.p.z); s.scale.setScalar(k);
    });
    this.ballShadow.position.set(b.p.x, 0.006, b.p.z);
    this.ballShadow.scale.setScalar(1 / (1 + (b.p.y - BALL_R) * 0.3));
    this.land.visible = live;
    this.drop.visible = !b.held && b.p.y > BALL_R + 0.1;
    if (live) {
      const L = landingPoint(b.p, b.v);
      this.land.position.set(L.x, 0.01, L.z);
      this.land.scale.setScalar(1 + Math.sin(this.t * 10) * 0.08);
      this.landMat.color.setHex(TEAM[b.lastSide]);
    }
    if (this.drop.visible) {
      const pos = this.drop.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, b.p.x, b.p.y - BALL_R, b.p.z); pos.setXYZ(1, b.p.x, 0.01, b.p.z); pos.needsUpdate = true;
      this.drop.computeLineDistances();
    }
    this.ring.position.set(me.p.x, 0, me.p.z);
    const c = me.charging ? me.charge : 0, seg = Math.round(c * 48);
    this.arc.visible = seg > 0;
    this.arc.geometry.setDrawRange(0, seg * 6);
    this.arcMat.color.setHSL(0.08 + c * 0.22, 0.9, c >= 1 ? 0.5 + Math.sin(this.t * 30) * 0.15 : 0.55);
    this.trail.update(new THREE.Vector3(b.p.x, b.p.y, b.p.z), !b.held && Math.hypot(b.v.x, b.v.y, b.v.z) > 2.5, new THREE.Color(TEAM[b.lastSide]), cam);
  }
}
