import type { Input } from '../sim/types';

/**
 * Keyboard, mouse, touch and gamepad merged into one Input per tick.
 * Screen up = toward the net = -z for the local player (side +1).
 */
export class Controls {
  private keys = new Set<string>();
  private mouseHit = false;
  private joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private tJump = false;
  private tHit = false;
  private padPrev: boolean[] = [];
  touchUsed = false;
  onCamera = () => {};
  onAssist = () => {};
  onAny = () => {};

  constructor(canvas: HTMLCanvasElement, ui: { zone: HTMLElement; knob: HTMLElement; base: HTMLElement; jump: HTMLElement; hit: HTMLElement }) {
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code); this.onAny();
      if (e.code === 'KeyC') this.onCamera();
      if (e.code === 'KeyP') this.onAssist();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseHit = false; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) { this.mouseHit = true; this.onAny(); } });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseHit = false; });
    const { zone, knob, base, jump, hit } = ui;
    zone.addEventListener('pointerdown', e => {
      if (this.joy.id !== -1) return;
      this.touchUsed = true; this.onAny();
      zone.setPointerCapture(e.pointerId);
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      base.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px`;
      knob.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px`;
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== this.joy.id) return;
      const R = 56; let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
      this.joy.x = dx / R; this.joy.y = dy / R;
      knob.style.left = this.joy.ox + dx + 'px'; knob.style.top = this.joy.oy + dy + 'px';
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 }; base.style.display = knob.style.display = 'none';
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    const btn = (el: HTMLElement, set: (v: boolean) => void) => {
      el.addEventListener('pointerdown', e => { this.touchUsed = true; this.onAny(); el.setPointerCapture(e.pointerId); set(true); el.classList.add('down'); });
      const up = () => { set(false); el.classList.remove('down'); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    btn(jump, v => (this.tJump = v));
    btn(hit, v => (this.tHit = v));
  }

  read(): Input {
    const k = (c: string) => this.keys.has(c);
    let mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let mz = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
    let jump = k('Space'), hit = k('KeyJ') || k('KeyK') || this.mouseHit;
    if (this.joy.id !== -1) { mx += this.joy.x; mz += this.joy.y; }
    jump ||= this.tJump; hit ||= this.tHit;
    const pad = navigator.getGamepads?.().find(p => p?.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
      mx += dz(pad.axes[0] ?? 0); mz += dz(pad.axes[1] ?? 0);
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      jump ||= b(0); hit ||= b(2) || b(7) || b(5);
      if (b(3) && !this.padPrev[3]) this.onCamera();
      if (pad.buttons.some(x => x.pressed)) this.onAny();
      this.padPrev = pad.buttons.map(x => x.pressed);
    }
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }
    return { mx, mz, jump, hit };
  }
}
