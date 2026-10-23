// Tiny Web Audio synth: no sound files. The context is created on the first user gesture.
let ctx: AudioContext | null = null;
let master: GainNode;
export let muted = false;
try { muted = localStorage.getItem('chibivolley.muted') === '1'; } catch { /* storage blocked */ }

export function audioInit() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new AudioContext();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  try { localStorage.setItem('chibivolley.muted', muted ? '1' : '0'); } catch { /* storage blocked */ }
  return muted;
}

function tone(f: number, d: number, type: OscillatorType = 'sine', v = 0.2, f2?: number, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(d: number, v: number, freq = 1000, q = 0.8) {
  if (!ctx) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + d + 0.02);
}

export const sfx = {
  jump: () => tone(320, 0.07, 'sine', 0.06, 480),
  push: () => { tone(520, 0.1, 'triangle', 0.22, 780); noise(0.05, 0.12, 2000); },
  hit: (c: number) => { noise(0.07, 0.3, 900 + c * 900); tone(200 + c * 260, 0.12, 'square', 0.08, 110); },
  spike: () => { noise(0.14, 0.5, 500, 0.6); tone(140, 0.28, 'sawtooth', 0.16, 45); },
  perfect: () => { tone(1046, 0.12, 'triangle', 0.12); tone(1568, 0.18, 'triangle', 0.12, undefined, 0.07); },
  whiff: () => noise(0.14, 0.09, 2800, 0.5),
  bounce: (v: number) => tone(95, 0.09, 'sine', Math.min(0.3, v * 0.05), 55),
  net: () => { tone(70, 0.22, 'square', 0.08, 45); noise(0.15, 0.1, 400); },
  point: (win: boolean) => { tone(win ? 660 : 330, 0.12, 'triangle', 0.18); tone(win ? 880 : 247, 0.2, 'triangle', 0.18, undefined, 0.11); },
};

export const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };
