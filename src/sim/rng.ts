/** mulberry32 with its state exposed, so a World can be snapshotted and restored exactly (netcode, replays). */
export class Rng {
  constructor(public s: number) { this.s >>>= 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
