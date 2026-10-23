import * as C from './constants';
import { clamp, inCourt, landingPoint, planHit, solveLaunch } from './physics';
import { rng } from './rng';
import { NO_INPUT, type Avatar, type Court, type Ball, type Input, type Mode, type Phase, type Side, type SimEvent, type Vec } from './types';

const v3 = (x = 0, y = 0, z = 0): Vec => ({ x, y, z });
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const approach = (v: number, to: number, d: number) => (v < to ? Math.min(v + d, to) : Math.max(v - d, to));
export const sideIdx = (s: Side) => (s === 1 ? 0 : 1);

export interface WorldOpts { seed?: number; assist?: boolean; teams?: [number, number]; humans?: number[]; mode?: Mode }

/** Pure match simulation: no DOM, no Three.js. Same code will run on the client, in bots and on the server. */
export class World {
  t = 0;
  avatars: Avatar[] = [];
  ball: Ball;
  phase: Phase = 'serve';
  phaseT = 0;
  server = 0;
  nextServer = 0;
  serveIdx: [number, number] = [0, 0];
  score: [number, number] = [0, 0]; // [side +1, side -1]
  rally = 0; // contacts this rally
  contacts = 0; // all contacts this match (never resets)
  best = 0; // longest rally
  mode: Mode;
  sets: [number, number] = [0, 0];
  setNo = 1;
  winner: Side | 0 = 0;
  private setBreak = false;
  streak = 0; // practice: clean returns in a row
  bestStreak = 0;
  events: SimEvent[] = [];
  rand: () => number;
  assist: boolean;
  court: Court;

  constructor(o: WorldOpts = {}) {
    this.rand = rng(o.seed ?? 1);
    this.assist = o.assist ?? true;
    this.mode = o.mode ?? 'match';
    const [a, b] = o.teams ?? (this.mode === 'practice' ? [1, 0] : [1, 1]), humans = o.humans ?? [0];
    this.court = C.COURTS[Math.max(a, b)] ?? C.COURTS[3];
    for (let i = 0; i < a; i++) this.addAvatar(1);
    for (let i = 0; i < b; i++) this.addAvatar(-1);
    for (const av of this.avatars) av.bot = !humans.includes(av.id);
    this.ball = { p: v3(), v: v3(), spin: v3(), live: false, held: true, lastSide: 1, touchSide: 1, touches: 0, lastToucher: -1 };
    this.restart();
  }

  /** New match (or a fresh practice run) with the same players. */
  restart() {
    this.score = [0, 0]; this.sets = [0, 0]; this.setNo = 1; this.winner = 0; this.setBreak = false;
    this.best = 0; this.streak = 0; this.serveIdx = [0, 0];
    this.events.length = 0;
    if (this.mode === 'practice') this.startLaunch(); else this.startServe(0);
  }

  private addAvatar(side: Side) {
    this.avatars.push({ id: this.avatars.length, side, bot: true, p: this.home(side), v: v3(), ground: true, yaw: side === 1 ? Math.PI : 0, charging: false, charge: 0, cool: 0, lastTouch: -9, pushArmed: false, prevJump: false, prevHit: false, swing: 0, landed: 0 });
  }

  /** Default spot for a side: mid-court, a bit behind the attack line. */
  home(side: Side): Vec { return v3(0, 0, side * this.court.len * 0.52); }

  hand(a: Avatar): Vec {
    return v3(a.p.x + Math.sin(a.yaw) * 0.15, a.p.y + (a.ground ? C.HAND_Y : C.HAND_Y_AIR), a.p.z + Math.cos(a.yaw) * 0.15);
  }

  private emit(e: SimEvent) { this.events.push(e); }

  private lineUp() {
    const team: Record<number, number> = { 1: 0, [-1]: 0 };
    for (const a of this.avatars) {
      const k = team[a.side]++, n = this.avatars.filter(o => o.side === a.side).length;
      a.p = this.home(a.side); a.p.x = (k - (n - 1) / 2) * this.court.hw * 0.6;
      a.v = v3(); a.ground = true; a.charging = false; a.charge = 0; a.cool = 0; a.yaw = a.side === 1 ? Math.PI : 0;
    }
  }

  startServe(id: number) {
    this.phase = 'serve'; this.phaseT = 0; this.server = id; this.rally = 0;
    this.lineUp();
    const s = this.avatars[id];
    s.p = v3(s.side * 0.4, 0, s.side * (this.court.len + 0.35));
    const b = this.ball;
    Object.assign(b, { held: true, live: true, v: v3(), spin: v3(), touches: 0, touchSide: s.side, lastSide: s.side, lastToucher: -1 });
    b.p = this.hand(s);
  }

  /** Practice: a launcher on the far side lobs balls into the player's court. */
  startLaunch() {
    this.phase = 'serve'; this.phaseT = 0; this.rally = 0; this.server = -1;
    this.lineUp();
    const b = this.ball;
    Object.assign(b, { held: true, live: true, v: v3(), spin: v3(), touches: 0, touchSide: -1, lastSide: -1, lastToucher: -2 });
    b.p = v3((this.rand() * 2 - 1) * (this.court.hw - 0.6), 2, -this.court.len + 0.4);
  }

  step(inputs: Input[]) {
    this.t += C.DT; this.phaseT += C.DT;
    for (const a of this.avatars) this.stepAvatar(a, inputs[a.id] ?? NO_INPUT);
    const b = this.ball;
    if (this.phase === 'serve' && b.held && this.mode === 'practice') {
      if (this.phaseT >= C.SERVE_DELAY * 1.4) {
        const tx = (this.rand() * 2 - 1) * (this.court.hw - 0.5), tz = 1.2 + this.rand() * (this.court.len - 2);
        b.held = false; b.v = solveLaunch(b.p, tx, tz, 1.5 + this.rand() * 0.3); this.phase = 'rally';
        b.spin = v3(this.rand() * 4 - 2, this.rand() * 4 - 2, this.rand() * 4 - 2);
        this.emit({ t: 'launch' });
      }
    } else if (this.phase === 'serve' && b.held) {
      const s = this.avatars[this.server], h = this.hand(s);
      b.p = v3(h.x, h.y + 0.1, h.z - s.side * 0.2);
      if (this.phaseT >= C.SERVE_DELAY) {
        b.held = false; b.v = v3(0, 5.4, -s.side * 0.2); this.phase = 'rally';
        this.emit({ t: 'toss', id: s.id });
      }
    }
    this.stepBall();
    if (this.phase === 'dead' && this.phaseT >= (this.setBreak ? C.SET_BREAK : C.DEAD_TIME)) {
      if (this.mode === 'practice') this.startLaunch();
      else {
        if (this.setBreak) { this.setBreak = false; this.score = [0, 0]; this.setNo++; }
        this.startServe(this.nextServer);
      }
    }
  }

  private stepAvatar(a: Avatar, inp: Input) {
    const b = this.ball;
    let mx = inp.mx, mz = inp.mz;
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }
    if (!a.bot && this.assist && m < 0.1 && b.live && !b.held && this.phase === 'rally') {
      const L = landingPoint(b.p, b.v);
      if (L.z * a.side > 0) {
        const dx = L.x - a.p.x, dz = L.z + a.side * 0.15 - a.p.z, d = Math.hypot(dx, dz);
        if (d > 0.15 && d < 1.8) { const k = Math.min(1, d / 0.5) * 0.85 / d; mx = dx * k; mz = dz * k; }
      }
    }
    const sp = C.MOVE * (a.charging ? 0.7 : 1), acc = (a.ground ? C.ACC_GROUND : C.ACC_AIR) * C.DT;
    a.v.x = approach(a.v.x, mx * sp, acc);
    a.v.z = approach(a.v.z, mz * sp, acc);
    if (inp.jump && !a.prevJump && a.ground) {
      a.v.y = C.JUMP_V; a.ground = false; a.pushArmed = !a.charging && !inp.hit; // jumping while charging = spike approach, no push
      this.emit({ t: 'jump', id: a.id });
    }
    if (inp.hit && !a.prevHit && a.cool <= 0) { a.charging = true; a.charge = 0; a.pushArmed = false; }
    if (a.charging) {
      if (inp.hit) a.charge = Math.min(1, a.charge + C.DT / C.CHARGE_T);
      else { this.release(a, mx, mz); a.charging = false; }
    }
    a.prevJump = inp.jump; a.prevHit = inp.hit;
    if (!a.ground) a.v.y -= C.G_AV * C.DT;
    a.p.x += a.v.x * C.DT; a.p.y += a.v.y * C.DT; a.p.z += a.v.z * C.DT;
    if (!a.ground && a.p.y <= 0) {
      a.p.y = 0; a.v.y = 0; a.ground = true; a.landed = 0.18; a.pushArmed = false;
      this.emit({ t: 'land', id: a.id });
    }
    a.p.x = clamp(a.p.x, -this.court.hw - 1.5, this.court.hw + 1.5);
    const zs = a.p.z * a.side;
    if (zs < C.NET_GAP) a.p.z = a.side * C.NET_GAP;
    else if (zs > this.court.len + 2) a.p.z = a.side * (this.court.len + 2);
    const sv = Math.hypot(a.v.x, a.v.z);
    const fx = sv > 0.6 ? a.v.x : b.p.x - a.p.x, fz = sv > 0.6 ? a.v.z : b.p.z - a.p.z;
    if (Math.hypot(fx, fz) > 0.05) {
      let d = Math.atan2(fx, fz) - a.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.yaw += d * Math.min(1, 14 * C.DT);
    }
    a.cool -= C.DT; a.swing -= C.DT; a.landed -= C.DT;
    if (!a.ground && a.pushArmed) this.tryPush(a, mx, mz);
  }

  private canTouch(a: Avatar) { return this.ball.live && !this.ball.held && this.t - a.lastTouch >= C.TOUCH_COOL; }

  private tryPush(a: Avatar, mx: number, mz: number) {
    const b = this.ball;
    if (!this.canTouch(a) || dist(b.p, this.hand(a)) > C.REACH + C.BALL_R) return;
    const zs = b.p.z * a.side;
    if (Math.abs(a.p.z) < 1.1 && b.v.z * a.side > 0.5 && b.p.y > C.NET_H - 0.1 && zs > -0.6 && b.lastSide !== a.side) {
      b.v = v3(b.v.x * 0.3, -1.2, -a.side * (Math.abs(b.v.z) * 0.45 + 1.2));
      b.spin = v3((this.rand() - 0.5) * 8, 0, (this.rand() - 0.5) * 8);
      b.lastSide = a.side; b.touchSide = a.side; b.touches = 0; b.lastToucher = a.id;
      a.lastTouch = this.t; a.pushArmed = false; a.swing = 0.25; this.rally++; this.contacts++;
      this.emit({ t: 'block', id: a.id, p: { ...b.p } });
      return;
    }
    if (zs < -0.15) return;
    let dx = mx, dz = mz;
    if (Math.hypot(dx, dz) < 0.2) { dx = -b.p.x; dz = a.side * 2.2 - b.p.z; }
    const n = Math.hypot(dx, dz) || 1;
    b.v = v3((dx / n) * C.PUSH_SIDE, C.PUSH_UP, (dz / n) * C.PUSH_SIDE);
    b.spin = v3((this.rand() - 0.5) * 4, (this.rand() - 0.5) * 6, (this.rand() - 0.5) * 4);
    a.pushArmed = false; a.swing = 0.25;
    this.emit({ t: 'push', id: a.id, p: { ...b.p } });
    this.touch(a);
  }

  private release(a: Avatar, mx: number, mz: number) {
    const b = this.ball, d = dist(b.p, this.hand(a)), charge = a.charge;
    a.charge = 0;
    if (!this.canTouch(a) || d > C.REACH_HIT + C.BALL_R || b.p.z * a.side < -0.15) {
      a.cool = C.WHIFF_COOL; a.swing = 0.3;
      this.emit({ t: 'whiff', id: a.id, p: { ...this.hand(a) } });
      return;
    }
    const perfect = d < C.PERFECT_DIST;
    const plan = planHit(b.p, a.side, charge, mx, -mz * a.side, this.openX(a.side), !a.ground, perfect, this.court);
    b.v = plan.v;
    b.spin = v3(-plan.v.z * 1.5, (this.rand() - 0.5) * 4, plan.v.x * 1.5);
    a.swing = 0.3;
    this.emit({ t: 'hit', id: a.id, p: { ...b.p }, charge, spike: plan.spike, perfect });
    this.touch(a);
  }

  /** x lane on the far side that is farthest from its players. */
  private openX(side: Side) {
    const opp = this.avatars.filter(o => o.side !== side);
    let best = 0, bd = -1;
    for (const x of [-this.court.hw * 0.75, 0, this.court.hw * 0.75]) {
      const d = Math.min(...opp.map(o => Math.abs(o.p.x - x)), 99) + this.rand() * 0.5;
      if (d > bd) { bd = d; best = x; }
    }
    return best;
  }

  private touch(a: Avatar) {
    const b = this.ball;
    if (b.touchSide !== a.side) { b.touchSide = a.side; b.touches = 0; }
    b.touches++; b.lastSide = a.side; b.lastToucher = a.id; a.lastTouch = this.t;
    this.rally++; this.contacts++; this.best = Math.max(this.best, this.rally);
    this.emit({ t: 'touch', side: a.side, n: b.touches });
    if (b.touches > C.MAX_TOUCHES) this.point(-a.side as Side, 'touches');
  }

  private stepBall() {
    const b = this.ball;
    if (b.held) return;
    const pz = b.p.z;
    b.v.y -= C.G_BALL * C.DT;
    b.p.x += b.v.x * C.DT; b.p.y += b.v.y * C.DT; b.p.z += b.v.z * C.DT;
    if (pz !== 0 && Math.sign(pz) !== Math.sign(b.p.z) && Math.abs(b.p.x) <= this.court.hw + 0.4 && b.p.y < C.NET_H + C.BALL_R * 0.6) {
      b.p.z = Math.sign(pz) * C.BALL_R; b.v.z = -b.v.z * 0.25; b.v.x *= 0.5;
      this.emit({ t: 'net', p: { ...b.p } });
    }
    if (b.p.y <= C.BALL_R) {
      b.p.y = C.BALL_R;
      if (b.live && this.phase === 'rally') {
        if (b.lastToucher === -1) { this.startServe(this.server); return; } // dropped toss: toss again
        const landed: Side = b.p.z >= 0 ? 1 : -1;
        if (this.mode === 'practice') this.drill(b.lastSide === 1 && landed === -1 && inCourt(b.p.x, b.p.z, this.court));
        else if (inCourt(b.p.x, b.p.z, this.court)) this.point(-landed as Side, 'in');
        else this.point(-b.lastSide as Side, 'out');
      }
      if (Math.abs(b.v.y) > 1) this.emit({ t: 'bounce', p: { ...b.p }, v: Math.abs(b.v.y) });
      b.v.y = Math.abs(b.v.y) * 0.45; b.v.x *= 0.7; b.v.z *= 0.7;
      b.spin.x *= 0.6; b.spin.y *= 0.6; b.spin.z *= 0.6;
    }
  }

  private drill(ok: boolean) {
    if (this.phase === 'dead') return;
    this.streak = ok ? this.streak + 1 : 0; this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.phase = 'dead'; this.phaseT = 0; this.ball.live = false;
    this.emit({ t: 'drill', ok, streak: this.streak });
  }

  /** Award a rally to `side`: sets to SET_TO, win by WIN_BY, hard cap SET_CAP, best of BEST_OF. */
  point(side: Side, why: 'in' | 'out' | 'touches' | 'net') {
    if (this.mode === 'practice') return this.drill(false);
    if (this.phase === 'dead' || this.phase === 'over') return;
    const i = sideIdx(side), s = ++this.score[i], o = this.score[1 - i];
    this.phase = 'dead'; this.phaseT = 0; this.ball.live = false;
    this.emit({ t: 'point', side, why });
    let serving = side;
    if ((s >= C.SET_TO && s - o >= C.WIN_BY) || s >= C.SET_CAP) {
      this.sets[i]++;
      this.emit({ t: 'set', side, sets: [...this.sets] });
      if (this.sets[i] > C.BEST_OF / 2) { this.winner = side; this.phase = 'over'; this.emit({ t: 'match', side }); return; }
      this.setBreak = true; serving = -side as Side; // the team that lost the set serves first
    }
    const team = this.avatars.filter(a => a.side === serving), k = sideIdx(serving);
    this.nextServer = team[this.serveIdx[k]++ % team.length].id;
  }
}
