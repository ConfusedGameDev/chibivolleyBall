export type Side = 1 | -1;
export interface Vec { x: number; y: number; z: number }
export interface Court { hw: number; len: number }

/** One tick of input. mx/mz are world-space (x right, z toward the camera for side +1), length ≤ 1. */
export interface Input { mx: number; mz: number; jump: boolean; hit: boolean }
export const NO_INPUT: Input = { mx: 0, mz: 0, jump: false, hit: false };

export interface Avatar {
  id: number;
  side: Side;
  bot: boolean;
  p: Vec;
  v: Vec;
  ground: boolean;
  yaw: number;
  charging: boolean;
  charge: number;
  cool: number; // whiff cooldown
  lastTouch: number; // world time of this avatar's last contact
  pushArmed: boolean; // one push per jump
  prevJump: boolean;
  prevHit: boolean;
  swing: number; // > 0 while a push/hit animation plays
  landed: number; // > 0 right after landing (squash)
}

export interface Ball {
  p: Vec;
  v: Vec;
  spin: Vec;
  live: boolean; // false once it has scored (still bounces for show)
  held: boolean; // waiting for a serve toss
  lastSide: Side;
  touchSide: Side;
  touches: number;
  lastToucher: number;
}

export type Phase = 'serve' | 'rally' | 'dead' | 'over';
export type Mode = 'match' | 'practice';

export type SimEvent =
  | { t: 'push'; id: number; p: Vec }
  | { t: 'block'; id: number; p: Vec }
  | { t: 'hit'; id: number; p: Vec; charge: number; spike: boolean; perfect: boolean }
  | { t: 'whiff'; id: number; p: Vec }
  | { t: 'jump'; id: number }
  | { t: 'land'; id: number }
  | { t: 'net'; p: Vec }
  | { t: 'bounce'; p: Vec; v: number }
  | { t: 'toss'; id: number }
  | { t: 'point'; side: Side; why: 'in' | 'out' | 'touches' | 'net' }
  | { t: 'touch'; side: Side; n: number }
  | { t: 'set'; side: Side; sets: [number, number] }
  | { t: 'match'; side: Side }
  | { t: 'launch' }
  | { t: 'drill'; ok: boolean; streak: number };
