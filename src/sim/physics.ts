import { BALL_R, G_BALL, HW, LEN, NET_H } from './constants';
import type { Side, Vec } from './types';

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Launch velocity that lands the ball (centre at BALL_R) on (tx, tz) after T seconds. */
export function solveLaunch(from: Vec, tx: number, tz: number, T: number): Vec {
  return { x: (tx - from.x) / T, y: (BALL_R - from.y + 0.5 * G_BALL * T * T) / T, z: (tz - from.z) / T };
}

/** Height of the ball when it crosses the net plane, or Infinity if it never crosses going forward. */
export function heightAtNet(from: Vec, v: Vec): number {
  if (v.z === 0 || Math.sign(-from.z) !== Math.sign(v.z)) return Infinity;
  const t = -from.z / v.z;
  return from.y + v.y * t - 0.5 * G_BALL * t * t;
}

export const clearsNet = (from: Vec, v: Vec) => heightAtNet(from, v) > NET_H + BALL_R + 0.05;

/** Time until the ball centre reaches ground contact height. */
export function timeToLand(p: Vec, v: Vec): number {
  const h = p.y - BALL_R;
  if (h <= 0) return 0;
  return (v.y + Math.sqrt(v.y * v.y + 2 * G_BALL * h)) / G_BALL;
}

export function landingPoint(p: Vec, v: Vec): Vec {
  const t = timeToLand(p, v);
  return { x: p.x + v.x * t, y: 0, z: p.z + v.z * t };
}

/** Where the ball will be when it next passes height h on the way down (null if it never gets that high). */
export function pointAtHeight(p: Vec, v: Vec, h: number): Vec | null {
  const disc = v.y * v.y + 2 * G_BALL * (p.y - h);
  if (disc < 0) return null;
  const t = (v.y + Math.sqrt(disc)) / G_BALL;
  if (t < 0) return null;
  return { x: p.x + v.x * t, y: h, z: p.z + v.z * t };
}

export const inCourt = (x: number, z: number) => Math.abs(x) <= HW + BALL_R * 0.5 && Math.abs(z) <= LEN + BALL_R * 0.5;

export interface HitPlan { v: Vec; spike: boolean; T: number; target: { x: number; z: number } }

/**
 * Charged hit from `from` by a player on `side`.
 * aimX ∈ [-1,1] picks the lane (0 = use openX), fwd ∈ [-1,1] > 0 means "short / tip", < 0 "deep".
 * Low charge = high slow lob, full charge = flat drive; airborne above the net with charge > 0.6 = spike.
 */
export function planHit(from: Vec, side: Side, charge: number, aimX: number, fwd: number, openX: number, airborne: boolean, perfect: boolean): HitPlan {
  const tx = clamp(Math.abs(aimX) > 0.2 ? aimX * HW * 0.85 : openX, -HW + 0.3, HW - 0.3);
  let depth = lerp(1.4, LEN - 0.6, charge);
  if (fwd > 0.3) depth *= 0.55;
  else if (fwd < -0.3) depth += 0.6;
  depth = clamp(depth, 0.7, LEN - 0.3);
  const tz = -side * depth;
  const spike = airborne && from.y > NET_H + 0.15 && Math.abs(from.z) < 2.8 && charge > 0.6;
  let T = spike ? lerp(0.62, 0.34, (charge - 0.6) / 0.4) : lerp(1.75, 0.8, charge);
  if (perfect) T *= 0.87;
  let v = solveLaunch(from, tx, tz, T);
  while (!clearsNet(from, v) && T < 2.6) { T += 0.06; v = solveLaunch(from, tx, tz, T); }
  return { v, spike: spike && T < 0.75, T, target: { x: tx, z: tz } };
}
