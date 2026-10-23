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
import { Bot, LEVELS } from './sim/bot';
import { DT } from './sim/constants';
import type { Input, SimEvent } from './sim/types';
import { World } from './sim/world';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
const demo = q.has('demo'); // both sides played by bots (attract mode, automated checks)
const level = LEVELS[(q.get('bot') as keyof typeof LEVELS) ?? 'normal'] ?? LEVELS.normal;

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

/* ---------- game state ---------- */
const world = new World({ seed: (Date.now() % 1e6) | 0, humans: demo ? [] : [0] });
const bots = world.avatars.filter(a => a.bot).map(a => new Bot(a.id, world, level));
const me = world.avatars[0];
const rig = new CamRig();
const fx = new Fx($('fx'));
const markers = new Markers(world.avatars.length);
const hud = new Hud();
scene.add(markers.group, fx.mesh);

const assets = await loadAssets();
const views: AvatarView[] = world.avatars.map((a, i) =>
  assets.characters.length ? new GlbChibi(assets.characters[(i * 5) % assets.characters.length], a) : new PrimitiveChibi(a));
const ball = new PetBall(assets.pets.length ? assets.pets[Math.floor(Math.random() * assets.pets.length)] : undefined);
views.forEach(v => scene.add(v.root));
scene.add(ball.root);

/* ---------- input / UI ---------- */
const controls = new Controls(canvas, { zone: $('zone'), knob: $('knob'), base: $('base'), jump: $('bJump'), hit: $('bHit') });
let started = demo;
const start = () => {
  audioInit();
  if (controls.touchUsed || matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  if (started) return;
  started = true; $('start').classList.add('hide');
};
if (demo) $('start').classList.add('hide');
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
controls.onAny = start;
$('start').addEventListener('pointerdown', start);
const assistBtn = $('bAssist'), muteBtn = $('bMute');
const syncBtns = () => { assistBtn.textContent = world.assist ? 'assist on' : 'assist off'; muteBtn.textContent = muted ? 'muted' : 'sound'; };
controls.onCamera = () => rig.toggle();
controls.onAssist = () => { world.assist = !world.assist; syncBtns(); };
$('bCam').addEventListener('click', () => rig.toggle());
assistBtn.addEventListener('click', () => controls.onAssist());
muteBtn.addEventListener('click', () => { toggleMute(); syncBtns(); });
syncBtns();

/* ---------- events → juice ---------- */
let hitstop = 0;
function onEvent(e: SimEvent) {
  const mine = 'id' in e && e.id === me.id;
  switch (e.t) {
    case 'jump': if (mine) sfx.jump(); break;
    case 'push':
      sfx.push(); ball.pop(0.7); fx.burst(e.p, 6, 0xffffff, 2.5); if (mine) buzz(8);
      break;
    case 'block':
      sfx.spike(); ball.pop(1.2); fx.burst(e.p, 14, 0xffffff, 4); fx.word('BLOCK!', e.p, 'big'); rig.shake(0.18); hitstop = 0.05;
      break;
    case 'hit':
      ball.pop(0.6 + e.charge); fx.burst(e.p, 6 + Math.round(e.charge * 12), e.spike ? 0xffd84d : 0xffffff, 2 + e.charge * 4, 1 + e.charge * 0.6);
      if (e.spike) { sfx.spike(); fx.word('SPIKE!', e.p, 'big'); rig.shake(0.3); rig.kick(0, -0.25, -0.3); hitstop = 0.06; }
      else { sfx.hit(e.charge); if (e.charge > 0.95) { hitstop = 0.04; rig.shake(0.12); } }
      if (e.perfect) { sfx.perfect(); fx.word('Perfect!', e.p, 'good'); }
      if (mine) buzz(e.spike ? 30 : 14);
      break;
    case 'whiff': if (mine) { sfx.whiff(); fx.word('whiff', e.p, 'small'); } break;
    case 'net': sfx.net(); fx.word('Net!', e.p, 'bad'); break;
    case 'bounce': sfx.bounce(e.v); fx.burst(e.p, 4, 0xd9dcea, 1.2, 1.4); break;
    case 'point': {
      const win = e.side === me.side, p = world.ball.p;
      sfx.point(win);
      fx.word(win ? (world.rally >= 6 ? 'Nice!' : 'Point!') : e.why === 'touches' ? '4 touches' : e.why === 'out' ? 'Out!' : 'Miss…', p, win ? 'good' : 'bad');
      if (!win) rig.shake(0.15);
      break;
    }
    case 'touch': if (e.n >= 2) ball.pop(0.3); break;
  }
}

/* ---------- loop ---------- */
let acc = 0, last = performance.now(), W = innerWidth, H = innerHeight;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
}
addEventListener('resize', resize); resize();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (started) {
    if (hitstop > 0) hitstop -= dt;
    else {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) {
        const inputs: Input[] = [];
        if (!demo) inputs[me.id] = controls.read();
        for (const b of bots) inputs[b.id] = b.input();
        world.step(inputs);
        for (const e of world.events) onEvent(e);
        world.events.length = 0;
        acc -= DT; n++;
      }
      if (n === 6) acc = 0;
    }
  }
  world.avatars.forEach((a, i) => views[i].update(a, dt));
  ball.update(world.ball, dt);
  markers.update(world, me, rig.cam, dt);
  rig.update(me, world.ball.p, dt, W / H);
  fx.update(dt, rig.cam, W, H);
  hud.update(world, rig.cam, W, H);
  renderer.render(scene, rig.cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => { last = performance.now(); acc = 0; });

/* ---------- debug hook for automated checks ---------- */
(window as unknown as { __cv: unknown }).__cv = {
  world,
  get phase() { return world.phase; },
  get score() { return [...world.score]; },
  get rally() { return world.rally; },
  get best() { return world.best; },
  get ball() { return { ...world.ball.p }; },
  get me() { return { ...me.p, charging: me.charging, charge: me.charge }; },
  get clips() { return { characters: views.map(v => v.clips ?? null), pet: ball.clips }; },
  get models() { return { characters: assets.characters.length, pets: assets.pets.length }; },
  start,
};
