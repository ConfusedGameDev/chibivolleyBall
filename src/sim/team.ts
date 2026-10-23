import { landingPoint, pointAtHeight } from './physics';
import type { Avatar } from './types';
import type { World } from './world';

/**
 * Auto-switch for a human on a team: hand control to the teammate who is clearly closer to where the incoming
 * ball can be played. Never switches away from an avatar mid-jump or mid-charge. `taken` = avatars other humans control.
 */
export function pickControl(w: World, cur: Avatar, taken: Set<number>): Avatar {
  const b = w.ball;
  if (!b.live || b.held || w.phase !== 'rally' || !cur.ground || cur.charging) return cur;
  const L = landingPoint(b.p, b.v);
  if (L.z * cur.side <= 0) return cur;
  const P = pointAtHeight(b.p, b.v, 1.3) ?? L, d = (a: Avatar) => Math.hypot(a.p.x - P.x, a.p.z - P.z);
  let best = cur;
  for (const a of w.avatars) if (a.side === cur.side && !taken.has(a.id) && d(a) < d(best)) best = a;
  return d(cur) - d(best) > 0.6 ? best : cur;
}
