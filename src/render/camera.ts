import * as THREE from 'three';
import type { Court, Vec } from '../sim/types';

export type CamMode = 'follow' | 'broadcast' | 'side';

/** follow: behind the local player (side +1, looking toward -z). broadcast: high behind side +1. side: from the sideline, for two-player versus. */
export class CamRig {
  cam = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  mode: CamMode = 'follow';
  /** Which side the local player is on; follow and broadcast views sit behind that side (online, the far team sees it from their end). */
  side: 1 | -1 = 1;
  private pos = new THREE.Vector3(0, 6, 10);
  private look = new THREE.Vector3(0, 1, 0);
  private kickV = new THREE.Vector3();
  private shakeA = 0;
  private r = new THREE.Vector3();
  private f = new THREE.Vector3();

  kick(x: number, y: number, z: number) { this.kickV.add(new THREE.Vector3(x, y, z)); }
  shake(a: number) { this.shakeA = Math.max(this.shakeA, a); }

  /** Screen-space stick (x right, z down) → world xz, using the current view so "up" is always away from the camera. */
  toWorld(sx: number, sz: number): [number, number] {
    this.cam.getWorldDirection(this.f); this.f.y = 0; this.f.normalize();
    this.r.set(-this.f.z, 0, this.f.x);
    return [this.r.x * sx - this.f.x * sz, this.r.z * sx - this.f.z * sz];
  }

  update(focus: Vec, ball: Vec, c: Court, dt: number, aspect: number) {
    const far = aspect < 1 ? 1.75 : aspect < 1.4 ? 1.25 : 1, k5 = c.len / 5;
    const dp = new THREE.Vector3(), dl = new THREE.Vector3();
    const sd = this.side;
    if (this.mode === 'follow') {
      const z = THREE.MathUtils.clamp(focus.z * sd, 0.5, c.len + 1.5), tx = focus.x * 0.55 + THREE.MathUtils.clamp(ball.x, -c.hw - 0.5, c.hw + 0.5) * 0.2;
      dp.set(tx, 4.4 * far * Math.sqrt(k5), (z + 5.6 * far * Math.sqrt(k5)) * sd);
      dl.set(tx * 0.7, 0.9, (z - 3.4 * k5) * sd);
    } else if (this.mode === 'broadcast') {
      dp.set(0, 11 * far * k5, 9.5 * far * k5 * sd);
      dl.set(0, 0, -0.6 * sd);
    } else {
      dp.set(c.len * 1.75 * far + 2, 6.5 * k5, THREE.MathUtils.clamp(ball.z, -c.len, c.len) * 0.15);
      dl.set(0, 0.5, THREE.MathUtils.clamp(ball.z, -c.len, c.len) * 0.15);
    }
    const k = 1 - Math.exp(-dt * 4.5);
    this.pos.lerp(dp, k); this.look.lerp(dl, k);
    this.kickV.multiplyScalar(Math.exp(-dt * 12));
    this.shakeA *= Math.exp(-dt * 9);
    const s = this.shakeA;
    this.cam.position.copy(this.pos).add(this.kickV).add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0));
    this.cam.lookAt(this.look);
    this.cam.aspect = aspect; this.cam.updateProjectionMatrix();
  }
}
