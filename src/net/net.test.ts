import { describe, expect, it } from 'vitest';
import { Room } from '../../server/room';
import { Bot } from '../sim/bot';
import { World } from '../sim/world';
import { idle, mergeDue, type ServerMessage } from './protocol';
import { OnlineSession } from './session';

describe('world snapshots', () => {
  it('a restored world continues identically', () => {
    const a = new World({ seed: 9, teams: [2, 2], humans: [] }), bots = a.avatars.map(x => new Bot(x.id, a));
    for (let i = 0; i < 600; i++) { a.step(bots.map(b => b.input())); a.events.length = 0; }
    const b = World.from(a.snapshot());
    for (let i = 0; i < 600; i++) {
      const inputs = bots.map(x => x.input());
      a.step(inputs); b.step(inputs); a.events.length = b.events.length = 0;
    }
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});

describe('mergeDue', () => {
  const mv = (seq: number, tick: number, mx: number, jump = false, hit = false) => ({ seq, tick, input: { mx, mz: 0, jump, hit } });
  it('newest movement wins, a jump anywhere counts, future inputs wait', () => {
    const r = mergeDue([mv(1, 5, 1, true), mv(2, 5, -1), mv(3, 9, 0.5)], 5, idle(), 0);
    expect(r.input).toEqual({ mx: -1, mz: 0, jump: true, hit: false });
    expect(r.ack).toBe(2);
    expect(r.rest.map(m => m.seq)).toEqual([3]);
  });
  it('with nothing due, held buttons stay held', () => {
    expect(mergeDue([], 5, { mx: 1, mz: 0, jump: true, hit: true }, 4).input).toEqual({ mx: 1, mz: 0, jump: true, hit: true });
  });
});

/** A fake network: each message arrives `lag / 2` ms after it is sent. */
function harness(n: number, lag = 80, size = 2) {
  let now = 0;
  const q: { at: number; go: () => void }[] = [];
  const later = (go: () => void) => q.push({ at: now + lag / 2, go });
  let s = 1;
  const room = new Room('ABCD', size, false, () => now, () => 1234, () => `tok${s++}`);
  const inbox: ServerMessage[][] = [];
  const seats: number[] = [];
  for (let k = 0; k < n; k++) {
    inbox[k] = [];
    seats[k] = room.join(`p${k}`, m => later(() => inbox[k].push(m)))!;
  }
  const flush = () => { q.sort((a, b) => a.at - b.at); while (q.length && q[0].at <= now) q.shift()!.go(); };
  const run = (ms: number, each?: () => void) => { for (let t = 0; t < ms; t += 4) { now += 4; flush(); room.update(); each?.(); } };
  return { room, inbox, seats, run, later, get now() { return now; } };
}

describe('room and sessions', () => {
  it('seats balance across teams and the host can start', () => {
    const h = harness(3, 0, 2);
    expect(h.room.seats.filter(Boolean).map(x => x!.side)).toEqual([1, -1, 1]);
    h.room.handle(h.seats[1], { t: 'start' });
    expect(h.room.phase).toBe('lobby'); // only the host starts
    h.room.handle(h.seats[0], { t: 'start' });
    expect(h.room.phase).toBe('playing');
    expect(h.room.ctl.slice(0, 3).every(id => id >= 0)).toBe(true);
  });

  it('the server applies a predicting client input and the prediction matches the server tick for tick', () => {
    const h = harness(2, 100, 1);
    h.room.handle(h.seats[0], { t: 'start' });
    let sess: OnlineSession | null = null;
    const predicted = new Map<number, number>(), actual = new Map<number, number>();
    let input = { mx: 1, mz: 0, jump: false, hit: false };
    const frame = () => {
      for (const m of h.inbox[0].splice(0)) {
        if (m.t !== 'snap') continue;
        if (!sess) sess = new OnlineSession(m, h.seats[0], 1, h.now); else sess.onSnapshot(m, h.now);
      }
      const w = h.room.world!;
      actual.set(w.tick, w.avatars[h.room.ctl[h.seats[0]]].p.x);
      if (!sess) return;
      sess.rtt = 100;
      while (sess.world.tick < sess.targetTick(h.now)) {
        const { input: msg } = sess.advance(input);
        predicted.set(sess.world.tick, sess.world.avatars[sess.me].p.x);
        h.later(() => h.room.handle(h.seats[0], { t: 'input', ...msg }));
      }
    };
    h.run(800, frame); // hold right
    const me = h.room.ctl[h.seats[0]];
    expect(h.room.world!.avatars[me].p.x).toBeGreaterThan(1); // the server applied our input
    input = { mx: 0, mz: 0, jump: false, hit: false };
    predicted.clear();
    h.run(1500, frame); // let go; after a round trip the prediction must be exact
    const ticks = [...predicted.keys()].filter(t => actual.has(t)).slice(20);
    expect(ticks.length).toBeGreaterThan(40);
    const err = Math.max(...ticks.map(t => Math.abs(predicted.get(t)! - actual.get(t)!)));
    expect(err).toBeLessThan(1e-9);
  });

  it('a dropped player is replaced by a bot and can rejoin', () => {
    const h = harness(2, 0, 1);
    h.room.handle(h.seats[0], { t: 'start' });
    h.run(200);
    h.room.disconnect(h.seats[1]);
    h.run(200);
    const av = h.room.ctl[h.seats[1]];
    expect(h.room.world!.avatars[av].bot).toBe(true);
    const box: ServerMessage[] = [];
    const tok = h.room.seats[h.seats[1]]!.token;
    expect(h.room.rejoin(tok, m => box.push(m))).toBe(h.seats[1]);
    h.run(100);
    expect(h.room.world!.avatars[av].bot).toBe(false);
    expect(box.some(m => m.t === 'snap')).toBe(true);
  });

  it('rematch needs every connected player', () => {
    const h = harness(2, 0, 1);
    h.room.handle(h.seats[0], { t: 'start' });
    const w = h.room.world!;
    for (let k = 0; k < 14; k++) { w.point(-1, 'in'); for (let i = 0; i < 400 && w.phase === 'dead'; i++) w.step([]); }
    h.run(50);
    expect(h.room.phase).toBe('over');
    h.room.handle(h.seats[0], { t: 'rematch' });
    expect(h.room.phase).toBe('over');
    h.room.handle(h.seats[1], { t: 'rematch' });
    expect(h.room.phase).toBe('playing');
    expect(w.sets).toEqual([0, 0]);
  });
});
