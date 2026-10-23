import { describe, expect, it } from 'vitest';
import { Bot } from './bot';
import * as C from './constants';
import { clearsNet, landingPoint, planHit, solveLaunch } from './physics';
import { pickControl } from './team';
import { World } from './world';

describe('hit solver', () => {
  it('solveLaunch lands on the target', () => {
    const from = { x: 1, y: 1.2, z: 3 }, v = solveLaunch(from, -1.5, -3, 1.2);
    const L = landingPoint(from, v);
    expect(L.x).toBeCloseTo(-1.5, 5);
    expect(L.z).toBeCloseTo(-3, 5);
  });

  it('every charged hit from the back court clears the net and lands in', () => {
    for (const charge of [0, 0.25, 0.5, 0.75, 1]) for (const z of [0.6, 2, 4.5]) for (const y of [0.9, 1.4]) {
      const from = { x: 0.5, y, z }, plan = planHit(from, 1, charge, 0, 0, -1, false, false);
      expect(clearsNet(from, plan.v), `charge ${charge} z ${z} y ${y}`).toBe(true);
      const L = landingPoint(from, plan.v);
      expect(L.z).toBeLessThan(0);
      expect(Math.abs(L.z)).toBeLessThanOrEqual(C.LEN);
      expect(Math.abs(L.x)).toBeLessThanOrEqual(C.HW);
    }
  });

  it('more charge means a faster, flatter ball', () => {
    const from = { x: 0, y: 1, z: 3 };
    const sp = (c: number) => { const v = planHit(from, 1, c, 0, 0, 0, false, false).v; return Math.hypot(v.x, v.z); };
    expect(sp(1)).toBeGreaterThan(sp(0.5));
    expect(sp(0.5)).toBeGreaterThan(sp(0));
  });

  it('a full-charge jump hit near the net is a downward spike', () => {
    const from = { x: 0, y: 2.2, z: 1 }, plan = planHit(from, 1, 1, 0, 0, 0, true, false);
    expect(plan.spike).toBe(true);
    expect(plan.v.y).toBeLessThan(0);
    expect(clearsNet(from, plan.v)).toBe(true);
  });
});

describe('world', () => {
  const run = (seed: number, seconds: number) => {
    const w = new World({ seed, humans: [] }), bots = w.avatars.map(a => new Bot(a.id, w));
    let points = 0;
    for (let i = 0; i < seconds * 60; i++) { w.step(bots.map(b => b.input())); points += w.events.filter(e => e.t === 'point').length; w.events.length = 0; }
    return Object.assign(w, { points });
  };

  it('two bots play points and the state stays finite', () => {
    const w = run(7, 180);
    expect(w.points).toBeGreaterThan(5);
    expect(w.best).toBeGreaterThanOrEqual(3);
    for (const v of [w.ball.p, ...w.avatars.map(a => a.p)]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect([run(3, 90).score, run(3, 90).points]).toEqual([run(3, 90).score, run(3, 90).points]);
  });

  it('a fourth touch gives the point away', () => {
    const w = new World({ seed: 1, humans: [0, 1] });
    w.phase = 'rally'; w.ball.held = false; w.ball.live = true; w.ball.lastToucher = 0;
    const a = w.avatars[0];
    let pts = 0;
    for (let i = 0; i < 4 && !pts; i++) {
      a.p = { x: 0, y: 0, z: 2 }; a.ground = true; a.lastTouch = -9;
      w.ball.p = { ...w.hand(a) }; w.ball.p.y += 0.6; w.ball.v = { x: 0, y: 0, z: 0 };
      w.step([{ mx: 0, mz: 0, jump: true, hit: false }, { mx: 0, mz: 0, jump: false, hit: false }]);
      w.step([{ mx: 0, mz: 0, jump: false, hit: false }, { mx: 0, mz: 0, jump: false, hit: false }]);
      for (let k = 0; k < 6; k++) w.step([]);
      pts = w.score[1];
    }
    expect(w.ball.touches).toBe(4);
    expect(w.score).toEqual([0, 1]);
  });
});

describe('sets and match', () => {
  const settle = (w: World) => { for (let i = 0; i < 400 && w.phase === 'dead'; i++) w.step([]); };
  const win = (w: World, side: 1 | -1, n: number) => { for (let k = 0; k < n; k++) { w.point(side, 'in'); settle(w); } };

  it('a set needs 7 and a 2-point lead, capped at 11', () => {
    const w = new World({ seed: 1, humans: [] });
    win(w, 1, 6); win(w, -1, 6);
    win(w, 1, 1);
    expect(w.sets).toEqual([0, 0]); // 7-6 is not enough
    win(w, -1, 1); win(w, 1, 1); win(w, -1, 1); // 8-8
    win(w, 1, 1); win(w, -1, 1); // 9-9
    win(w, 1, 1); win(w, -1, 1); // 10-10
    win(w, -1, 1); // 10-11: cap
    expect(w.sets).toEqual([0, 1]);
    expect(w.score).toEqual([0, 0]);
    expect(w.setNo).toBe(2);
  });

  it('the team that lost the set serves the next one', () => {
    const w = new World({ seed: 1, humans: [] });
    win(w, 1, 7);
    expect(w.avatars[w.server].side).toBe(-1);
  });

  it('best of three ends the match', () => {
    const w = new World({ seed: 1, humans: [] });
    win(w, -1, 7); win(w, -1, 7);
    expect(w.phase).toBe('over');
    expect(w.winner).toBe(-1);
    expect(w.sets).toEqual([0, 2]);
    w.restart();
    expect([w.phase, w.sets, w.score, w.winner]).toEqual(['serve', [0, 0], [0, 0], 0]);
  });
});

describe('practice', () => {
  it('the launcher lobs balls that land on the player side', () => {
    const w = new World({ seed: 5, mode: 'practice' });
    expect(w.avatars.length).toBe(1);
    const fails: boolean[] = [];
    for (let i = 0; i < 60 * 30; i++) { w.step([]); for (const e of w.events) if (e.t === 'drill') fails.push(e.ok); w.events.length = 0; }
    expect(fails.length).toBeGreaterThan(5);
    expect(fails.every(ok => !ok)).toBe(true); // nobody returns them, so every launch is a miss
    expect(w.score).toEqual([0, 0]);
  });

  it('a clean return counts toward the streak', () => {
    const w = new World({ seed: 5, mode: 'practice' });
    for (let i = 0; i < 200 && w.phase !== 'rally'; i++) w.step([]);
    const a = w.avatars[0], b = w.ball;
    b.p = { x: 0, y: 1.1, z: 2 }; b.v = { x: 0, y: 0, z: 0 };
    a.p = { x: 0, y: 0, z: 2.2 }; a.yaw = Math.PI;
    w.step([{ mx: 0, mz: 0, jump: false, hit: true }]);
    for (let i = 0; i < 20; i++) w.step([{ mx: 0, mz: 0, jump: false, hit: true }]);
    b.p = { ...w.hand(a) }; b.v = { x: 0, y: 0, z: 0 };
    w.step([{ mx: 0, mz: 0, jump: false, hit: false }]);
    let ok: boolean | null = null;
    for (let i = 0; i < 400 && ok === null; i++) { w.step([]); for (const e of w.events) if (e.t === 'drill') ok = e.ok; w.events.length = 0; }
    expect(ok).toBe(true);
    expect(w.streak).toBe(1);
  });
});

describe('teams', () => {
  const play = (n: number, seed: number, secs: number) => {
    const w = new World({ seed, humans: [], teams: [n, n] }), bots = w.avatars.map(a => new Bot(a.id, w)), c: Record<string, number> = {};
    for (let i = 0; i < secs * 60; i++) {
      w.step(bots.map(b => b.input()));
      for (const e of w.events) { c[e.t] = (c[e.t] ?? 0) + 1; if (e.t === 'hit' && e.spike) c.spike = (c.spike ?? 0) + 1; if (e.t === 'point' && e.why === 'touches') c.fault = (c.fault ?? 0) + 1; }
      w.events.length = 0; if (w.phase === 'over') w.restart();
    }
    return c;
  };

  it('bigger teams get a bigger court', () => {
    expect(new World({ teams: [3, 3] }).court.hw).toBeGreaterThan(new World({ teams: [1, 1] }).court.hw);
  });

  for (const n of [2, 3]) it(`${n}v${n} bots dig, set and spike`, () => {
    const c = play(n, 1, 240);
    expect(c.point).toBeGreaterThan(10);
    expect(c.push).toBeGreaterThan(c.point); // teams use their touches
    expect(c.spike ?? 0).toBeGreaterThan(3);
    expect((c.fault ?? 0) / c.point).toBeLessThan(0.15);
  });

  it('jumping while charging is a spike approach, not a push', () => {
    const w = new World({ seed: 1, humans: [0, 1] });
    w.phase = 'rally'; Object.assign(w.ball, { held: false, live: true, lastToucher: 1, lastSide: -1, touchSide: -1, touches: 1 });
    const a = w.avatars[0]; a.p = { x: 0, y: 0, z: 2 };
    const idle = { mx: 0, mz: 0, jump: false, hit: false };
    w.step([{ mx: 0, mz: 0, jump: false, hit: true }, idle]);
    w.ball.p = { x: 0, y: 2.1, z: 2.1 }; w.ball.v = { x: 0, y: 0, z: 0 };
    w.step([{ mx: 0, mz: 0, jump: true, hit: true }, idle]);
    for (let i = 0; i < 10; i++) { w.ball.v = { x: 0, y: 0, z: 0 }; w.step([{ mx: 0, mz: 0, jump: false, hit: true }, idle]); }
    expect(w.events.some(e => e.t === 'push')).toBe(false);
  });

  it('auto-switch hands control to the teammate under the ball', () => {
    const w = new World({ seed: 1, humans: [0], teams: [2, 1] });
    w.phase = 'rally'; Object.assign(w.ball, { held: false, live: true, lastToucher: 2, lastSide: -1 });
    w.avatars[0].p = { x: -2, y: 0, z: 4 }; w.avatars[1].p = { x: 2, y: 0, z: 2 };
    w.ball.p = { x: 2, y: 3, z: 1 }; w.ball.v = { x: 0, y: 0, z: 1 };
    expect(pickControl(w, w.avatars[0], new Set()).id).toBe(1);
    expect(pickControl(w, w.avatars[0], new Set([1])).id).toBe(0);
  });
});
