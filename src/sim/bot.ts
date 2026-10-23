import * as C from './constants';
import { landingPoint, pointAtHeight } from './physics';
import type { Avatar, Input, Vec } from './types';
import type { World } from './world';

/** miss = chance per incoming ball of misreading where it comes down by `err` units; spike = chance to jump-attack a set ball. */
export interface BotLevel { react: number; minCharge: number; maxCharge: number; lane: number; miss: number; err: number; spike: number }
export const LEVELS: Record<'easy' | 'normal' | 'hard', BotLevel> = {
  easy: { react: 0.35, minCharge: 0.25, maxCharge: 0.6, lane: 0.4, miss: 0.3, err: 2, spike: 0.1 },
  normal: { react: 0.2, minCharge: 0.35, maxCharge: 0.85, lane: 0.7, miss: 0.15, err: 1.8, spike: 0.45 },
  hard: { react: 0.1, minCharge: 0.5, maxCharge: 1, lane: 1, miss: 0.06, err: 1.6, spike: 0.8 },
};

const PUSH_H = 1.9; // contact height for a jump-push of a high (set) ball
const DIG_H = 1.3; // first touch of an incoming ball: meet it low, early in the jump
const SPIKE_H = 2.2; // contact height for a jump hit
const flat = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Produces the same Input a human would. With teammates: the one closest to where the ball comes down plays it,
 * early touches are pushes toward the teammate nearest the net, the last touch is a charged hit (a jump spike when
 * the ball is high and close to the net); everyone else holds formation or moves up to attack.
 */
export class Bot {
  private think = 0;
  private target: Vec;
  private want = 0.6;
  private aim = 0;
  private seen = -1; // w.contacts when the current read was made
  private off = { x: 0, z: 0 };
  private action: 'push' | 'hit' | 'spike' = 'hit';
  private chase = false;

  constructor(public id: number, private w: World, public level: BotLevel = LEVELS.normal) {
    this.target = w.home(w.avatars[id].side);
  }

  private spot(a: Avatar, attack: boolean): Vec {
    const w = this.w, team = w.avatars.filter(o => o.side === a.side), n = team.length, k = team.indexOf(a), c = w.court;
    if (n === 1) return w.home(a.side);
    const x = (k - (n - 1) / 2) * c.hw * (n === 2 ? 0.9 : 0.6);
    const z = attack ? 1.3 : c.len * (n === 3 && k === 1 ? 0.68 : 0.5);
    return { x, y: 0, z: a.side * z };
  }

  input(): Input {
    const w = this.w, a = w.avatars[this.id], b = w.ball, side = a.side, out: Input = { mx: 0, mz: 0, jump: false, hit: false };
    const team = w.avatars.filter(o => o.side === side), live = b.live && !b.held && w.phase === 'rally';
    const ours = b.touchSide === side ? b.touches : 0;
    if ((this.think -= C.DT) <= 0) {
      this.think = this.level.react;
      this.chase = false;
      if (live) {
        const L = landingPoint(b.p, b.v);
        if (L.z * side > 0) {
          if (b.lastToucher === -1) { this.off = { x: 0, z: 0 }; this.action = 'hit'; this.seen = -1; } // own serve toss: always read it right
          else if (this.seen !== w.contacts) {
            this.seen = w.contacts;
            const r = w.rand() < this.level.miss ? this.level.err : 0, ang = w.rand() * Math.PI * 2;
            this.off = { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
            const nearNet = Math.abs(L.z) < 2.4, high = b.p.y > 2.6 || b.v.y > 2;
            this.action = team.length > 1 && ours < 2 && b.lastSide === side ? 'push'
              : team.length > 1 && ours === 0 ? 'push'
              : nearNet && high && ours > 0 && w.rand() < this.level.spike ? 'spike' : 'hit';
          }
          const h = this.action === 'push' ? (ours === 0 ? DIG_H : PUSH_H) : this.action === 'spike' ? SPIKE_H : C.HAND_Y + 0.15;
          const P = pointAtHeight(b.p, b.v, h) ?? L;
          const chaser = team.reduce((m, o) => (flat(o.p, P) < flat(m.p, P) ? o : m));
          if (chaser === a) { this.chase = true; this.target = { x: P.x + this.off.x, y: 0, z: P.z + side * 0.12 + this.off.z }; }
          else this.target = this.spot(a, b.lastSide === side && ours > 0);
        } else this.target = this.spot(a, false);
      } else if (!(w.phase === 'serve' && w.server === a.id)) this.target = this.spot(a, false);
      else this.target = { ...a.p };
    }
    const dx = this.target.x - a.p.x, dz = this.target.z - a.p.z, d = Math.hypot(dx, dz);
    if (d > 0.08) { const k = Math.min(1, d / 0.35) / d; out.mx = dx * k; out.mz = dz * k; }

    const serving = w.phase === 'rally' && b.lastToucher === -1;
    if (a.charging && !(live && b.p.z * side > -0.1)) { out.hit = true; return out; } // ball went over: keep holding
    if (!live || b.p.z * side <= -0.1 || (!this.chase && !serving && !a.charging)) return out;
    const h = w.hand(a), hd = Math.hypot(b.p.x - h.x, b.p.y - h.y, b.p.z - h.z), fd = flat(a.p, b.p);
    if (this.action === 'push' && !serving) {
      const mate = team.filter(o => o !== a).sort((p, q) => Math.abs(p.p.z) - Math.abs(q.p.z))[0];
      const ph = ours === 0 ? DIG_H : PUSH_H;
      if (a.ground && fd < 0.7 && b.v.y < 0 && b.p.y < ph + 0.15 + Math.abs(b.v.y) * 0.22 && b.p.y > 0.9) out.jump = true;
      if (!a.ground && a.pushArmed && mate) {
        const mx = mate.p.x - b.p.x, mz = mate.p.z - b.p.z, m = Math.hypot(mx, mz) || 1;
        out.mx = mx / m; out.mz = mz / m;
      }
      return out;
    }
    if (this.action === 'spike' && !serving && a.ground && fd < 0.75 && b.v.y < 0 && b.p.y < SPIKE_H + 0.2 + Math.abs(b.v.y) * 0.22) out.jump = true;
    if (!a.charging) {
      if ((hd < 2.4 || (this.action === 'spike' && hd < 4.5)) && b.v.y < 1 && a.cool <= 0 && (serving || landingPoint(b.p, b.v).z * side > 0)) {
        out.hit = true;
        this.want = this.action === 'spike' ? 0.9 : this.level.minCharge + w.rand() * (this.level.maxCharge - this.level.minCharge);
        this.aim = (w.rand() * 2 - 1) * this.level.lane;
      }
    } else {
      const ready = hd <= C.REACH_HIT + C.BALL_R - 0.05 && (a.charge >= this.want || b.p.y < C.HAND_Y || (!a.ground && a.v.y < 0));
      out.hit = !ready && hd < (this.action === 'spike' ? 5 : 2.8);
      if (!out.hit) { out.mx = this.aim; out.mz = 0; }
    }
    return out;
  }
}
