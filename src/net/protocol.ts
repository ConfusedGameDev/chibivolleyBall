// Wire protocol between the game and the match server (server/). Pure TS, shared by both. JSON over WebSocket.
// Same shape as Super Tennis Deluxo's: authoritative 60 Hz server, snapshots, client prediction with mergeDue.
import type { Input, Side } from '../sim/types';
import type { WorldState } from '../sim/world';

/** Room codes: 4 letters, no I or O (they read like 1 and 0). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;
/** The server sends a snapshot every N ticks (60 / 3 = 20 per second). */
export const SNAPSHOT_EVERY = 3;
/** A dropped player's avatar is played by a bot; they can rejoin their seat for this long. */
export const GRACE_MS = 60_000;
/** Quick-match rooms start on their own this long after a second player joins. */
export const QUICK_START_MS = 6_000;
export const MAX_SEATS = 6;
export const NAME_MAX = 12;

export interface InputMsg {
  seq: number;
  /** The sim tick this input belongs to (the world's tick before that step). */
  tick: number;
  input: Input;
}

export type ClientMessage =
  | { t: 'create'; name: string; size: number }
  | { t: 'join'; code: string; name: string }
  | { t: 'quick'; name: string; size: number }
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'team' }
  | { t: 'size'; size: number }
  | { t: 'start' }
  | ({ t: 'input' } & InputMsg)
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; c: number };

export interface SeatInfo { name: string; side: Side; connected: boolean; rematch: boolean }

export type ErrorCode = 'no-room' | 'full' | 'started' | 'bad-request' | 'bad-token' | 'closed';

export type ServerMessage =
  | { t: 'joined'; code: string; token: string; seat: number }
  | { t: 'lobby'; code: string; host: number; size: number; quick: boolean; phase: 'lobby' | 'playing' | 'over'; seats: (SeatInfo | null)[]; startsIn: number }
  | { t: 'start'; size: number; names: string[] /* per avatar, '' for bots */ }
  /** ctl: seat -> controlled avatar (-1 for empty seats); acks: per seat; last: the input each avatar used on the last step. */
  | { t: 'snap'; tick: number; state: WorldState; ctl: number[]; acks: number[]; last: Input[] }
  | { t: 'peer'; seat: number; connected: boolean }
  | { t: 'error'; code: ErrorCode; msg: string }
  | { t: 'pong'; c: number };

export const idle = (): Input => ({ mx: 0, mz: 0, jump: false, hit: false });

/**
 * The input a seat gets for the step at `tick`, used identically by server and client so they agree: every
 * not-yet-applied input with tick <= `tick` is merged. Movement and hit (a held button: charging) come from the
 * newest; jump from any, so a quick tap that arrives bundled with its release still jumps. With nothing due, everything
 * stays as it was (a late packet must not read as a release).
 */
export function mergeDue(queue: InputMsg[], tick: number, last: Input, ack: number): { input: Input; ack: number; rest: InputMsg[] } {
  const input: Input = { ...last, jump: false };
  const rest: InputMsg[] = [];
  let got = false;
  for (const m of queue) {
    if (m.seq <= ack) continue;
    if (m.tick > tick) { rest.push(m); continue; }
    input.mx = m.input.mx; input.mz = m.input.mz; input.hit = m.input.hit;
    input.jump ||= m.input.jump;
    ack = Math.max(ack, m.seq); got = true;
  }
  if (!got) input.jump = last.jump; // nothing new this tick: buttons stay as they were
  return { input, ack, rest };
}

export const isCode = (s: string) => s.length === CODE_LENGTH && [...s].every(c => CODE_ALPHABET.includes(c));
export const cleanName = (s: unknown) => String(s ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, NAME_MAX) || 'player';
