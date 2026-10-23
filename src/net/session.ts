// Client side of an online match: prediction plus snapshot reconciliation (the server is never rolled back).
// Pure TS (no DOM) so it is unit-tested against the real server Room.
//
// The client runs the shared sim slightly ahead of the server, applying its own input at once and assuming every
// other avatar (rival humans and bots) keeps doing what it did on the last confirmed step. Each snapshot resets to the
// server's state and replays the inputs the server hasn't confirmed yet, using the same merge rule (mergeDue) and the
// same auto-switch rule (pickControl) as the server.
import { DT } from '../sim/constants';
import { pickControl } from '../sim/team';
import type { Input, SimEvent } from '../sim/types';
import { World } from '../sim/world';
import { idle, mergeDue, type InputMsg, type ServerMessage } from './protocol';

type Snap = Extract<ServerMessage, { t: 'snap' }>;

/** Extra ticks of lead beyond a round trip, to absorb jitter. */
const LEAD_MARGIN = 3;
/** Never predict further than this past the last snapshot (e.g. while the server is paused between matches). */
const MAX_LEAD = 45;
const EVENT_MEMORY = 240;

const eventKey = (e: SimEvent) => `${e.t}:${'id' in e ? e.id : ''}:${'side' in e ? e.side : ''}`;

export class OnlineSession {
  /** What the game renders: the server's latest state advanced to now with predicted inputs. */
  readonly world: World;
  ctl: number[];
  rtt = 100;
  private pending: InputMsg[] = [];
  private seq = 0;
  private remote: Input[];
  private lastSnapTick: number;
  private lastSnapAt: number;
  private shown = new Map<number, Set<string>>();

  constructor(first: Snap, readonly seat: number, readonly size: number, now: number) {
    this.world = World.from(first.state);
    this.ctl = [...first.ctl];
    this.remote = first.last.map(x => ({ ...x }));
    this.lastSnapTick = first.tick;
    this.lastSnapAt = now;
  }

  /** The avatar this player controls right now. */
  get me(): number { return this.ctl[this.seat]; }

  /** The tick to simulate at `now`: a round trip (plus a margin) ahead of the last snapshot, so inputs land just in time. */
  targetTick(now: number): number {
    const t = Math.floor(this.lastSnapTick + (now - this.lastSnapAt + this.rtt) / (DT * 1000) + LEAD_MARGIN);
    return Math.min(t, this.lastSnapTick + MAX_LEAD);
  }

  /** Advances the prediction one tick with this frame's local input. Returns the input to send and new events to present. */
  advance(local: Input): { input: InputMsg; events: SimEvent[] } {
    const input: InputMsg = { seq: ++this.seq, tick: this.world.tick, input: { ...local } };
    this.pending.push(input);
    this.switchControl();
    const w = this.world;
    w.step(w.avatars.map(a => (a.id === this.me ? local : { ...this.remote[a.id] })));
    const events = this.fresh(w.tick, w.events);
    w.events.length = 0;
    return { input, events };
  }

  /** A snapshot arrived: reset to it, drop confirmed inputs and replay the rest. Returns events we had not predicted. */
  onSnapshot(s: Snap, now: number): SimEvent[] {
    if (s.tick < this.lastSnapTick) return []; // out of order
    this.lastSnapTick = s.tick; this.lastSnapAt = now;
    this.ctl = [...s.ctl];
    this.remote = s.last.map(x => ({ ...x }));
    const ack = s.acks[this.seat] ?? -1;
    this.pending = this.pending.filter(m => m.seq > ack);
    const w = this.world, reached = Math.min(w.tick, s.tick + MAX_LEAD);
    w.load(s.state);
    let queue = this.pending.slice(), last = this.me >= 0 ? { ...s.last[this.me] } : idle(), localAck = ack;
    const late: SimEvent[] = [];
    while (w.tick < reached && w.phase !== 'over') {
      const r = mergeDue(queue, w.tick, last, localAck);
      queue = r.rest; localAck = r.ack; last = r.input;
      this.switchControl();
      w.step(w.avatars.map(a => (a.id === this.me ? r.input : { ...this.remote[a.id] })));
      late.push(...this.fresh(w.tick, w.events));
      w.events.length = 0;
    }
    this.forget(s.tick);
    return late;
  }

  get pendingCount() { return this.pending.length; }

  /** Same rule the server applies at the start of every tick. */
  private switchControl() {
    if (this.size < 2 || this.me < 0) return;
    const w = this.world, cur = w.avatars[this.me];
    const nxt = pickControl(w, cur, new Set(this.ctl.filter((id, j) => j !== this.seat && id >= 0)));
    if (nxt !== cur) { cur.bot = true; nxt.bot = false; this.ctl[this.seat] = nxt.id; }
  }

  /** Keeps only events not already shown near this tick (re-simulation re-times them slightly), and records them. */
  private fresh(tick: number, events: SimEvent[]): SimEvent[] {
    let seen = this.shown.get(tick);
    if (!seen) this.shown.set(tick, (seen = new Set()));
    const out: SimEvent[] = [];
    for (const e of events) {
      const k = eventKey(e);
      let dup = false;
      for (let t = tick - 6; t <= tick + 6 && !dup; t++) dup = !!this.shown.get(t)?.has(k);
      if (dup) continue;
      seen.add(k); out.push(e);
    }
    return out;
  }

  private forget(before: number) { for (const t of this.shown.keys()) if (t < before - EVENT_MEMORY) this.shown.delete(t); }
}
