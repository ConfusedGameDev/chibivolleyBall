import * as THREE from 'three';
import './ui/style.css';
import { audioInit, buzz, muted, sfx, toggleMute } from './audio';
import { Controls } from './input/controls';
import { loadAssets } from './render/assets';
import { CamRig } from './render/camera';
import { GlbChibi, PrimitiveChibi, type AvatarView } from './render/chibi';
import { buildCourt } from './render/court';
import { Fx } from './render/fx';
import { Markers } from './render/markers';
import { PetBall } from './render/pet';
import { outline, toon } from './render/toon';
import { Bot, LEVELS } from './sim/bot';
import { BALL_R, DT } from './sim/constants';
import type { Input, SimEvent } from './sim/types';
import { World } from './sim/world';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
type Level = keyof typeof LEVELS;
type Kind = 'demo' | 'match' | 'practice';
type State = 'menu' | 'play' | 'paused' | 'over';

/* ---------- settings ---------- */
const settings = { level: 'normal' as Level, assist: true, cam: 0 as 0 | 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('chibivolley.settings') ?? '{}')); } catch { /* storage blocked */ }
const qb = q.get('bot');
if (qb && qb in LEVELS) settings.level = qb as Level;
const save = () => { try { localStorage.setItem('chibivolley.settings', JSON.stringify(settings)); } catch { /* storage blocked */ } };

/* ---------- renderer / scene ---------- */
const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef0f7);
scene.fog = new THREE.Fog(0xeef0f7, 22, 55);
scene.add(new THREE.HemisphereLight(0xffffff, 0xc4c9de, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(4, 10, 6); scene.add(sun);
scene.add(buildCourt());

const rig = new CamRig();
rig.mode = settings.cam;
const fx = new Fx($('fx'));
const hud = new Hud();
scene.add(fx.mesh);
// practice: the launcher post the ball sits on before each lob
const launcher = outline(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 1, 14), toon(0xb9bfd8)), 1.08);
scene.add(launcher);
const assets = await loadAssets();

/* ---------- game (re)construction ---------- */
let state: State = 'menu', kind: Kind = 'demo';
let world: World, bots: Bot[] = [], views: AvatarView[] = [], markers: Markers | null = null, ball: PetBall | null = null;

function newGame(k: Kind) {
  kind = k;
  for (const v of views) scene.remove(v.root);
  if (markers) scene.remove(markers.group);
  if (ball) scene.remove(ball.root);
  world = new World({ seed: (Date.now() % 1e6) | 0, mode: k === 'practice' ? 'practice' : 'match', humans: k === 'demo' ? [] : [0], assist: settings.assist });
  bots = world.avatars.filter(a => a.bot).map(a => new Bot(a.id, world, k === 'demo' ? LEVELS.normal : LEVELS[settings.level]));
  views = world.avatars.map((a, i) => assets.characters.length ? new GlbChibi(assets.characters[(i * 5) % assets.characters.length], a) : new PrimitiveChibi(a));
  views.forEach(v => scene.add(v.root));
  markers = new Markers(world.avatars.length);
  ball = new PetBall(assets.pets.length ? assets.pets[Math.floor(Math.random() * assets.pets.length)] : undefined);
  scene.add(markers.group, ball.root);
  document.body.classList.toggle('practice', k === 'practice');
}

/* ---------- overlays ---------- */
const panels = { menu: $('menu'), pause: $('pause'), over: $('over') };
function setState(s: State) {
  state = s;
  panels.menu.classList.toggle('hide', s !== 'menu');
  panels.pause.classList.toggle('hide', s !== 'paused');
  panels.over.classList.toggle('hide', s !== 'over');
  document.body.classList.toggle('menu', s === 'menu');
}
function play(k: Kind) { audioInit(); newGame(k); acc = 0; setState('play'); }
function showOver() {
  const won = world.winner === 1;
  $('overTitle').textContent = won ? 'You win!' : 'CPU wins';
  $('overSub').textContent = `sets ${world.sets[0]}–${world.sets[1]} · best rally ${world.best} · cpu ${settings.level}`;
  setState('over');
}
function act(a: string) {
  audioInit();
  if (a === 'match' || a === 'practice') play(a);
  else if (a === 'resume') setState('play');
  else if (a === 'restart') { world.restart(); acc = 0; setState('play'); }
  else if (a === 'menu') { newGame('demo'); setState('menu'); }
}
document.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a],[data-l]');
  if (!t) return;
  if (t.dataset.l) { settings.level = t.dataset.l as Level; save(); syncBtns(); } else act(t.dataset.a!);
});

/* ---------- input / buttons ---------- */
const controls = new Controls(canvas, { zone: $('zone'), knob: $('knob'), base: $('base'), jump: $('bJump'), hit: $('bHit') });
const isTouch = () => controls.touchUsed || matchMedia('(pointer: coarse)').matches;
if (isTouch()) document.body.classList.add('touch');
controls.onAny = () => { audioInit(); if (isTouch()) document.body.classList.add('touch'); };
const assistBtn = $('bAssist'), muteBtn = $('bMute');
function syncBtns() {
  assistBtn.textContent = settings.assist ? 'assist on' : 'assist off';
  muteBtn.textContent = muted ? 'muted' : 'sound';
  document.querySelectorAll<HTMLElement>('#lvl button').forEach(b => b.classList.toggle('on', b.dataset.l === settings.level));
}
const toggleCam = () => { rig.toggle(); settings.cam = rig.mode; save(); };
const toggleAssist = () => { settings.assist = world.assist = !settings.assist; save(); syncBtns(); };
const togglePause = () => { if (state === 'play') setState('paused'); else if (state === 'paused') setState('play'); };
controls.onCamera = toggleCam;
controls.onAssist = toggleAssist;
controls.onPause = togglePause;
$('bCam').addEventListener('click', toggleCam);
assistBtn.addEventListener('click', toggleAssist);
muteBtn.addEventListener('click', () => { toggleMute(); syncBtns(); });
$('bPause').addEventListener('click', togglePause);
addEventListener('keydown', e => {
  if (e.code === 'Escape') togglePause();
  if (e.code === 'Enter' && state === 'menu') act('match');
  if (e.code === 'Enter' && state === 'over') act('restart');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setState('paused'); last = performance.now(); acc = 0; });
syncBtns();

/* ---------- events → juice ---------- */
let hitstop = 0, overT = -1;
function onEvent(e: SimEvent) {
  const me = world.avatars[0], mine = 'id' in e && e.id === me.id, p = world.ball.p;
  switch (e.t) {
    case 'jump': if (mine) sfx.jump(); break;
    case 'push':
      sfx.push(); ball!.pop(0.7); fx.burst(e.p, 6, 0xffffff, 2.5); if (mine) buzz(8);
      break;
    case 'block':
      sfx.spike(); ball!.pop(1.2); fx.burst(e.p, 14, 0xffffff, 4); fx.word('BLOCK!', e.p, 'big'); rig.shake(0.18); hitstop = 0.05;
      break;
    case 'hit':
      ball!.pop(0.6 + e.charge); fx.burst(e.p, 6 + Math.round(e.charge * 12), e.spike ? 0xffd84d : 0xffffff, 2 + e.charge * 4, 1 + e.charge * 0.6);
      if (e.spike) { sfx.spike(); fx.word('SPIKE!', e.p, 'big'); rig.shake(0.3); rig.kick(0, -0.25, -0.3); hitstop = 0.06; }
      else { sfx.hit(e.charge); if (e.charge > 0.95) { hitstop = 0.04; rig.shake(0.12); } }
      if (e.perfect) { sfx.perfect(); fx.word('Perfect!', e.p, 'good'); }
      if (mine) buzz(e.spike ? 30 : 14);
      break;
    case 'whiff': if (mine) { sfx.whiff(); fx.word('whiff', e.p, 'small'); } break;
    case 'net': sfx.net(); fx.word('Net!', e.p, 'bad'); break;
    case 'bounce': sfx.bounce(e.v); fx.burst(e.p, 4, 0xd9dcea, 1.2, 1.4); break;
    case 'point': {
      const win = e.side === me.side;
      sfx.point(win);
      fx.word(win ? (world.rally >= 6 ? 'Nice!' : 'Point!') : e.why === 'touches' ? '4 touches' : e.why === 'out' ? 'Out!' : 'Miss…', p, win ? 'good' : 'bad');
      if (!win) rig.shake(0.15);
      break;
    }
    case 'set': fx.word(e.side === me.side ? 'SET!' : 'Set lost', { ...p, y: p.y + 0.6 }, 'big'); sfx.perfect(); break;
    case 'match': fx.word(e.side === me.side ? 'YOU WIN!' : 'CPU WINS', { ...p, y: p.y + 0.6 }, 'big'); overT = 1.6; break;
    case 'drill':
      if (e.ok) { sfx.point(true); fx.word(e.streak >= 3 ? `x${e.streak}!` : 'Nice!', p, 'good'); }
      else { sfx.point(false); fx.word('Miss…', p, 'bad'); }
      break;
    case 'launch': sfx.jump(); break;
    case 'touch': if (e.n >= 2) ball!.pop(0.3); break;
  }
}

/* ---------- loop ---------- */
let acc = 0, last = performance.now(), W = innerWidth, H = innerHeight;
function resize() { W = innerWidth; H = innerHeight; renderer.setSize(W, H, false); }
addEventListener('resize', resize); resize();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const running = state === 'play' || state === 'menu' || state === 'over';
  if (running) {
    if (hitstop > 0) hitstop -= dt;
    else {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) {
        const inputs: Input[] = [];
        if (kind !== 'demo') inputs[0] = state === 'play' ? controls.read() : { mx: 0, mz: 0, jump: false, hit: false };
        for (const b of bots) inputs[b.id] = b.input();
        world.step(inputs);
        for (const e of world.events) if (kind !== 'demo') onEvent(e);
        world.events.length = 0;
        if (kind === 'demo' && world.phase === 'over') world.restart();
        acc -= DT; n++;
      }
      if (n === 6) acc = 0;
    }
  }
  if (overT > 0 && (overT -= dt) <= 0 && state === 'play') showOver();
  const me = world.avatars[0];
  world.avatars.forEach((a, i) => views[i].update(a, dt));
  ball!.update(world.ball, dt);
  const wb = world.ball;
  launcher.visible = world.mode === 'practice' && wb.held;
  if (launcher.visible) { const h = wb.p.y - BALL_R * 1.1; launcher.scale.set(1, h, 1); launcher.position.set(wb.p.x, h / 2, wb.p.z); }
  markers!.update(world, me, rig.cam, dt);
  rig.update(me, world.ball.p, dt, W / H);
  fx.update(dt, rig.cam, W, H);
  hud.update(world, rig.cam, W, H);
  renderer.render(scene, rig.cam);
  requestAnimationFrame(frame);
}

newGame('demo');
setState('menu');
if (q.has('demo')) setState('menu');
else if (q.get('play') === 'practice' || q.get('play') === 'match') play(q.get('play') as Kind);
requestAnimationFrame(frame);

/* ---------- debug hook for automated checks ---------- */
(window as unknown as { __cv: unknown }).__cv = {
  get world() { return world; },
  get state() { return state; },
  get kind() { return kind; },
  get phase() { return world.phase; },
  get score() { return [...world.score]; },
  get sets() { return [...world.sets]; },
  get rally() { return world.rally; },
  get best() { return world.best; },
  get streak() { return world.streak; },
  get ball() { return { ...world.ball.p }; },
  get me() { const a = world.avatars[0]; return { ...a.p, charging: a.charging, charge: a.charge }; },
  get clips() { return { characters: views.map(v => v.clips ?? null), pet: ball!.clips }; },
  get models() { return { characters: assets.characters.length, pets: assets.pets.length }; },
  act,
};
