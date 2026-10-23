import { describe, expect, it } from 'vitest';
import { Bot } from './bot';
import * as C from './constants';
import { clearsNet, landingPoint, planHit, solveLaunch } from './physics';
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
    for (let i = 0; i < seconds * 60; i++) { w.step(bots.map(b => b.input())); w.events.length = 0; }
    return w;
  };

  it('two bots play points and the state stays finite', () => {
    const w = run(7, 180);
    expect(w.score[0] + w.score[1]).toBeGreaterThan(5);
    expect(w.best).toBeGreaterThanOrEqual(3);
    for (const v of [w.ball.p, ...w.avatars.map(a => a.p)]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect(run(3, 60).score).toEqual(run(3, 60).score);
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
