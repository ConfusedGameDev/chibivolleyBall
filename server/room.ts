// One match room: lobby, the authoritative 60 Hz match, snapshots, rematch, drop/rejoin.
// No sockets or timers here: index.ts passes in `send` functions and calls update(), so tests drive it deterministically.
import {
  GRACE_MS, MAX_SEATS, QUICK_START_MS, SNAPSHOT_EVERY, cleanName, idle, mergeDue,
  type ClientMessage, type InputMsg, type ServerMessage,
} from '../src/net/protocol';
import { Bot, LEVELS } from '../src/sim/bot';
import { DT } from '../src/sim/constants';
import { pickControl } from '../src/sim/team';
import type { Input, Side } from '../src/sim/types';
import { World } from '../src/sim/world';

export type Send = (m: ServerMessage) => void;

interface Seat {
  token: string;
  name: string;
  side: Side;
  send: Send | null;
  queue: InputMsg[];
  ack: number;
  last: Input;
  droppedAt: number | null;
  rematch: boolean;
}

/** Catch up at most this many ticks per update (a stalled event loop shouldn't fast-forward the match). */
const MAX_CATCHUP = 10;
const clampSize = (n: number) => Math.min(3, Math.max(1, n | 0 || 2));

export class Room {
  readonly seats: (Seat | null)[] = Array(MAX_SEATS).fill(null);
  host = 0;
  size: number;
  phase: 'lobby' | 'playing' | 'over' = 'lobby';
  world: World | null = null;
  /** seat -> avatar it controls (-1 = empty seat). */
  ctl: number[] = Array(MAX_SEATS).fill(-1);
  closed = false;
  private bots: Bot[] = [];
  private last: Input[] = [];
  private nextTickAt = 0;
  private startAt = 0;
  private shownLeft = -1;

  constructor(readonly code: string, size: number, readonly quick: boolean, private now: () => number, private seed: () => number, private token: () => string) {
    this.size = clampSize(size);
  }

  get humans() { return this.seats.filter(Boolean).length; }
  private team(side: Side) { return this.seats.filter(s => s?.side === side).length; }
  get open() { return this.phase === 'lobby' && !this.closed && this.humans < this.size * 2; }

  /** Seats a new player on the smaller team. Returns the seat, or null when the room is full or already playing. */
  join(name: string, send: Send): number | null {
    if (!this.open) return null;
    const i = this.seats.indexOf(null);
    if (i < 0) return null;
    const side: Side = this.team(1) <= this.team(-1) ? 1 : -1;
    this.seats[i] = { token: this.token(), name: cleanName(name), side, send, queue: [], ack: -1, last: idle(), droppedAt: null, rematch: false };
    if (this.humans === 1) this.host = i;
    send({ t: 'joined', code: this.code, token: this.seats[i]!.token, seat: i });
    if (this.quick && this.humans >= 2 && !this.startAt) this.startAt = this.now() + QUICK_START_MS;
    this.broadcastLobby();
    return i;
  }

  /** Reattaches a dropped player by token. */
  rejoin(token: string, send: Send): number | null {
    const i = this.seats.findIndex(s => s?.token === token);
    if (i < 0) return null;
    const seat = this.seats[i]!;
    seat.send = send; seat.droppedAt = null; seat.queue = []; seat.last = idle();
    send({ t: 'joined', code: this.code, token, seat: i });
    if (this.world) send({ t: 'start', size: this.size, names: this.names() });
    this.broadcastLobby();
    this.broadcast({ t: 'peer', seat: i, connected: true });
    if (this.world) send(this.snapshot());
    return i;
  }

  handle(i: number, m: ClientMessage): void {
    const seat = this.seats[i];
    if (!seat) return;
    switch (m.t) {
      case 'team': {
        const other = -seat.side as Side;
        if (this.phase === 'lobby' && this.team(other) < this.size) seat.side = other;
        return this.broadcastLobby();
      }
      case 'size':
        if (i === this.host && this.phase === 'lobby' && !this.quick) {
          this.size = Math.max(clampSize(m.size), Math.ceil(this.humans / 2));
          for (const side of [1, -1] as Side[]) while (this.team(side) > this.size) this.seats.find(s => s?.side === side)!.side = -side as Side;
        }
        return this.broadcastLobby();
      case 'start':
        if (i === this.host && this.phase === 'lobby' && this.humans >= 2) this.startMatch();
        return;
      case 'input':
        if (this.phase === 'playing' && m.seq > seat.ack) seat.queue.push({ seq: m.seq, tick: m.tick, input: m.input });
        return;
      case 'rematch':
        if (this.phase !== 'over') return;
        seat.rematch = true;
        if (this.seats.every(s => !s || s.rematch || !s.send)) this.rematchNow();
        else this.broadcastLobby();
        return;
      case 'leave':
        return this.leave(i);
      default:
    }
  }

  /** Socket closed. In the lobby the seat is freed; in a match a bot plays the avatar until they rejoin or GRACE_MS passes. */
  disconnect(i: number): void {
    const seat = this.seats[i];
    if (!seat) return;
    seat.send = null;
    if (this.phase === 'lobby') return this.leave(i);
    seat.droppedAt = this.now();
    this.broadcast({ t: 'peer', seat: i, connected: false });
    this.broadcastLobby();
  }

  private leave(i: number): void {
    if (!this.seats[i]) return;
    this.seats[i] = null;
    if (this.ctl[i] >= 0 && this.world) this.world.avatars[this.ctl[i]].bot = true;
    this.ctl[i] = -1;
    if (!this.humans) { this.closed = true; return; }
    if (i === this.host) this.host = this.seats.findIndex(Boolean);
    if (this.quick && this.humans < 2) this.startAt = 0;
    this.broadcastLobby();
  }

  /** Runs every tick that is due. Call often (index.ts uses a few ms interval). */
  update(): void {
    const t = this.now();
    if (this.phase === 'lobby' && this.startAt && t >= this.startAt && this.humans >= 2) this.startMatch();
    const left = this.phase === 'lobby' && this.startAt ? Math.ceil((this.startAt - t) / 1000) : -1;
    if (left !== this.shownLeft) { this.shownLeft = left; if (left >= 0) this.broadcastLobby(); }
    this.seats.forEach((s, i) => { if (s?.droppedAt != null && t - s.droppedAt >= GRACE_MS) this.leave(i); });
    if (this.phase !== 'playing' || !this.world) return;
    for (let n = 0; this.nextTickAt <= t && n < MAX_CATCHUP; n++) {
      this.nextTickAt += DT * 1000;
      this.tick();
      if (this.phase !== 'playing') return;
    }
    if (this.nextTickAt <= t) this.nextTickAt = t; // too far behind: drop the backlog rather than spiral
  }

  private startMatch(): void {
    const n = this.size, w = this.world = new World({ seed: this.seed(), teams: [n, n], humans: [], assist: true });
    this.ctl = Array(MAX_SEATS).fill(-1);
    const free: Record<number, number[]> = { 1: [], [-1]: [] };
    for (const a of w.avatars) free[a.side].push(a.id);
    this.seats.forEach((s, i) => {
      if (!s) return;
      const id = free[s.side].shift() ?? free[-s.side].shift()!;
      this.ctl[i] = id; w.avatars[id].bot = false;
      Object.assign(s, { queue: [], ack: -1, last: idle(), rematch: false });
    });
    this.bots = w.avatars.map(a => new Bot(a.id, w, LEVELS.normal));
    this.last = w.avatars.map(idle);
    this.phase = 'playing'; this.startAt = 0;
    this.nextTickAt = this.now();
    this.broadcast({ t: 'start', size: n, names: this.names() });
    this.broadcastLobby();
    this.broadcast(this.snapshot());
  }

  private rematchNow(): void {
    this.world!.restart();
    for (const s of this.seats) if (s) Object.assign(s, { rematch: false });
    this.phase = 'playing';
    this.nextTickAt = this.now();
    this.broadcastLobby();
    this.broadcast(this.snapshot());
  }

  private tick(): void {
    const w = this.world!, live = (i: number) => !!this.seats[i]?.send && this.ctl[i] >= 0;
    if (this.size > 1) this.seats.forEach((_, i) => {
      if (!live(i)) return;
      const cur = w.avatars[this.ctl[i]], nxt = pickControl(w, cur, new Set(this.ctl.filter((id, j) => j !== i && id >= 0)));
      if (nxt !== cur) { cur.bot = true; nxt.bot = false; this.ctl[i] = nxt.id; }
    });
    const inputs: Input[] = w.avatars.map(a => {
      const i = this.ctl.indexOf(a.id);
      if (i >= 0 && live(i)) {
        const s = this.seats[i]!, r = mergeDue(s.queue, w.tick, s.last, s.ack);
        s.queue = r.rest; s.ack = r.ack; s.last = r.input; a.bot = false;
        return r.input;
      }
      a.bot = true;
      return this.bots[a.id].input();
    });
    w.step(inputs);
    w.events.length = 0;
    this.last = inputs;
    if (w.phase === 'over') {
      this.phase = 'over';
      this.broadcast(this.snapshot());
      return this.broadcastLobby();
    }
    if (w.tick % SNAPSHOT_EVERY === 0) this.broadcast(this.snapshot());
  }

  /** Name per seat ('' for empty seats). */
  private names() { return this.seats.map(s => s?.name ?? ''); }

  snapshot(): ServerMessage {
    const w = this.world!;
    return { t: 'snap', tick: w.tick, state: w.snapshot(), ctl: [...this.ctl], acks: this.seats.map(s => s?.ack ?? -1), last: this.last.map(x => ({ ...x })) };
  }

  private broadcastLobby(): void {
    this.broadcast({
      t: 'lobby', code: this.code, host: this.host, size: this.size, quick: this.quick, phase: this.phase,
      seats: this.seats.map(s => (s ? { name: s.name, side: s.side, connected: !!s.send, rematch: s.rematch } : null)),
      startsIn: this.startAt ? Math.max(0, Math.ceil((this.startAt - this.now()) / 1000)) : 0,
    });
  }

  private broadcast(m: ServerMessage): void { for (const s of this.seats) s?.send?.(m); }
}
