import * as THREE from 'three';
import { HW, LEN, NET_H } from '../sim/constants';
import { outline, toon } from './toon';

function netTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(40,40,60,0.85)'; g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildCourt() {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshLambertMaterial({ color: 0xf2f3f8 }));
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, LEN * 2), new THREE.MeshLambertMaterial({ color: 0xe7eaf4 }));
  court.rotation.x = -Math.PI / 2; court.position.y = 0.002;
  g.add(court);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x8a92b8 }), soft = new THREE.MeshBasicMaterial({ color: 0xbcc2da });
  const line = (w: number, d: number, x: number, z: number, m = lineMat) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    l.rotation.x = -Math.PI / 2; l.position.set(x, 0.004, z); g.add(l);
  };
  const t = 0.05;
  line(HW * 2 + t, t, 0, LEN); line(HW * 2 + t, t, 0, -LEN);
  line(t, LEN * 2, HW, 0); line(t, LEN * 2, -HW, 0);
  line(HW * 2, t, 0, 0);
  line(HW * 2, t * 0.7, 0, 1.7, soft); line(HW * 2, t * 0.7, 0, -1.7, soft);
  // net
  const span = HW * 2 + 0.8, top = NET_H, bottom = 0.6;
  const tex = netTexture(); tex.repeat.set(span / 0.12, (top - bottom) / 0.12);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(span, top - bottom), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, (top + bottom) / 2, 0);
  g.add(net);
  const band = (y: number, h: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(span, h, 0.03), toon(0xffffff)); b.position.set(0, y, 0); g.add(b); };
  band(top - 0.04, 0.08); band(bottom + 0.02, 0.04);
  for (const sx of [-1, 1]) {
    const post = outline(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top + 0.15, 10), toon(0xd5d9e6)), 1.25);
    post.position.set(sx * (span / 2 + 0.02), (top + 0.15) / 2, 0);
    g.add(post);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.12, 10), toon(0xe2566f));
      s.position.set(sx * (span / 2 + 0.02), top - 0.1 - i * 0.3, 0); g.add(s);
    }
  }
  // soft pastel blocks far away for depth, like the reference's empty arena
  const cols = [0xdfe3f2, 0xe9e1f0, 0xe2eee8, 0xf1e9df];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.3, r = 18 + (i % 3) * 5, h = 1 + ((i * 7) % 5) * 0.8;
    const b = new THREE.Mesh(new THREE.BoxGeometry(2 + (i % 4), h, 2 + ((i * 3) % 4)), toon(cols[i % 4]));
    b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); b.rotation.y = a * 2;
    g.add(b);
  }
  return g;
}
