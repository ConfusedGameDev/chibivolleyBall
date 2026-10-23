import * as C from './constants';
import { landingPoint, pointAtHeight } from './physics';
import type { Input, Vec } from './types';
import { home, type World } from './world';

/** miss = chance per incoming ball of misreading where it comes down by `err` units. */
export interface BotLevel { react: number; minCharge: number; maxCharge: number; lane: number; miss: number; err: number }
export const LEVELS: Record<'easy' | 'normal' | 'hard', BotLevel> = {
  easy: { react: 0.35, minCharge: 0.25, maxCharge: 0.6, lane: 0.4, miss: 0.3, err: 2 },
  normal: { react: 0.2, minCharge: 0.35, maxCharge: 0.85, lane: 0.7, miss: 0.15, err: 1.8 },
  hard: { react: 0.1, minCharge: 0.5, maxCharge: 1, lane: 1, miss: 0.06, err: 1.6 },
};

/** Produces the same Input a human would: move to where the ball comes down, charge early, release in reach. */
export class Bot {
  private think = 0;
  private target: Vec;
  private want = 0.6;
  private aim = 0;
  private seen = -1; // w.contacts when the current error was rolled
  private off = { x: 0, z: 0 };

  constructor(public id: number, private w: World, public level: BotLevel = LEVELS.normal) {
    this.target = home(w.avatars[id].side);
  }

  input(): Input {
    const w = this.w, a = w.avatars[this.id], b = w.ball, out: Input = { mx: 0, mz: 0, jump: false, hit: false };
    const live = b.live && !b.held && w.phase === 'rally';
    if ((this.think -= C.DT) <= 0) {
      this.think = this.level.react;
      if (live) {
        const L = landingPoint(b.p, b.v);
        if (L.z * a.side > 0) {
          if (this.seen !== w.contacts) {
            this.seen = w.contacts;
            const r = b.lastToucher !== -1 && w.rand() < this.level.miss ? this.level.err : 0, ang = w.rand() * Math.PI * 2;
            this.off = { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
          }
          const P = pointAtHeight(b.p, b.v, C.HAND_Y + 0.15) ?? L;
          this.target = { x: P.x + this.off.x, y: 0, z: P.z + a.side * 0.12 + this.off.z };
        } else this.target = home(a.side);
      } else if (!(w.phase === 'serve' && w.server === a.id)) this.target = home(a.side);
      else this.target = { ...a.p };
    }
    const dx = this.target.x - a.p.x, dz = this.target.z - a.p.z, d = Math.hypot(dx, dz);
    if (d > 0.08) { const k = Math.min(1, d / 0.35) / d; out.mx = dx * k; out.mz = dz * k; }
    if (a.charging && !(live && b.p.z * a.side > -0.1)) out.hit = true; // ball went over: keep holding, swing at the next one
    else if (live && b.p.z * a.side > -0.1) {
      const h = w.hand(a), hd = Math.hypot(b.p.x - h.x, b.p.y - h.y, b.p.z - h.z);
      if (!a.charging) {
        if (hd < 2.2 && b.v.y < 1 && a.cool <= 0 && (b.v.z * a.side > -0.5 || b.lastSide !== a.side)) {
          out.hit = true;
          this.want = this.level.minCharge + w.rand() * (this.level.maxCharge - this.level.minCharge);
          this.aim = (w.rand() * 2 - 1) * this.level.lane;
        }
      } else {
        const ready = hd <= C.REACH_HIT + C.BALL_R - 0.05 && (a.charge >= this.want || b.p.y < C.HAND_Y);
        out.hit = !ready && hd < 2.8;
        if (!out.hit) { out.mx = this.aim; out.mz = 0; }
      }
    }
    return out;
  }
}
