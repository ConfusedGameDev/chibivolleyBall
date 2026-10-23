import * as THREE from 'three';
import type { Avatar, Vec } from '../sim/types';

/** Follow camera behind the local player (side +1, looking toward -z), plus a wide broadcast preset. */
export class CamRig {
  cam = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  mode: 0 | 1 = 0;
  private pos = new THREE.Vector3(0, 6, 10);
  private look = new THREE.Vector3(0, 1, 0);
  private kickV = new THREE.Vector3();
  private shakeA = 0;

  kick(x: number, y: number, z: number) { this.kickV.add(new THREE.Vector3(x, y, z)); }
  shake(a: number) { this.shakeA = Math.max(this.shakeA, a); }
  toggle() { this.mode = this.mode ? 0 : 1; }

  update(me: Avatar, ball: Vec, dt: number, aspect: number) {
    const far = aspect < 1 ? 1.75 : aspect < 1.4 ? 1.25 : 1;
    const dp = new THREE.Vector3(), dl = new THREE.Vector3();
    if (this.mode === 0) {
      const z = THREE.MathUtils.clamp(me.p.z, 0.5, 6.5), tx = me.p.x * 0.55 + THREE.MathUtils.clamp(ball.x, -3, 3) * 0.2;
      dp.set(tx, 4.4 * far, z + 5.6 * far);
      dl.set(tx * 0.7, 0.9, z - 3.4);
    } else {
      dp.set(0, 11 * far, 9.5 * far);
      dl.set(0, 0, -0.6);
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
