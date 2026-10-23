import * as THREE from 'three';
import { BEST_OF, SET_TO } from '../sim/constants';
import type { World } from '../sim/world';
import { TEAM_CSS } from '../render/toon';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pips = (n: number) => '●'.repeat(n) + '○'.repeat(Math.ceil(BEST_OF / 2) - n);

/** DOM HUD: scoreboard with set pips, touch dots, rally bubble near the ball, rally/streak line. */
export class Hud {
  private s0 = $('s0');
  private s1 = $('s1');
  private home = document.querySelector<HTMLElement>('#board .home')!;
  private away = document.querySelector<HTMLElement>('#board .away')!;
  private dots = [...document.querySelectorAll<HTMLElement>('#dots i')];
  private bubble = $('bubble');
  private rally = $('rally');
  private last = '';
  private tmp = new THREE.Vector3();
  private n: [string, string] = ['you', 'cpu'];

  names(a: string, b: string) { this.n = [a, b]; this.last = ''; }

  update(w: World, cam: THREE.Camera, width: number, height: number) {
    const b = w.ball, key = `${w.mode}|${w.score}|${w.sets}|${b.touches}|${b.touchSide}|${w.rally}|${w.best}|${w.phase}|${w.streak}`;
    if (key !== this.last) {
      this.last = key;
      this.s0.textContent = String(w.score[0]); this.s1.textContent = String(w.score[1]);
      this.home.textContent = `${this.n[0]} ${pips(w.sets[0])}`; this.away.textContent = `${pips(w.sets[1])} ${this.n[1]}`;
      this.dots.forEach((d, i) => { d.style.background = i < b.touches && w.phase !== 'serve' ? TEAM_CSS[b.touchSide] : ''; });
      this.rally.textContent = w.mode === 'practice'
        ? `streak ${w.streak} · best ${w.bestStreak}`
        : `set ${w.setNo} · to ${SET_TO} · rally ${w.rally} · best ${w.best}`;
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
