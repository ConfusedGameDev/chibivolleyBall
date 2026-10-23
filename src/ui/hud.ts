import * as THREE from 'three';
import type { World } from '../sim/world';
import { TEAM_CSS } from '../render/toon';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM HUD: scoreboard, touch dots, rally bubble near the ball, best rally. */
export class Hud {
  private s0 = $('s0');
  private s1 = $('s1');
  private dots = [...document.querySelectorAll<HTMLElement>('#dots i')];
  private bubble = $('bubble');
  private rally = $('rally');
  private last = '';
  private tmp = new THREE.Vector3();

  update(w: World, cam: THREE.Camera, width: number, height: number) {
    const b = w.ball, key = `${w.score}|${b.touches}|${b.touchSide}|${w.rally}|${w.best}|${w.phase}`;
    if (key !== this.last) {
      this.last = key;
      this.s0.textContent = String(w.score[0]); this.s1.textContent = String(w.score[1]);
      this.dots.forEach((d, i) => { d.style.background = i < b.touches && w.phase !== 'serve' ? TEAM_CSS[b.touchSide] : ''; });
      this.rally.textContent = `rally ${w.rally} · best ${w.best}`;
      this.bubble.textContent = 'x' + b.touches;
    }
    const show = w.phase === 'rally' && b.touches >= 2 && b.live;
    this.bubble.style.opacity = show ? '1' : '0';
    if (show) {
      this.tmp.set(b.p.x - 0.55, b.p.y + 0.25, b.p.z).project(cam);
      this.bubble.style.transform = `translate(${(this.tmp.x * 0.5 + 0.5) * width}px, ${(-this.tmp.y * 0.5 + 0.5) * height}px) translate(-50%, -50%)`;
      this.bubble.style.borderColor = TEAM_CSS[b.touchSide];
    }
  }
}
