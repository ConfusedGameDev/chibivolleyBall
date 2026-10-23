import * as THREE from 'three';
import './ui/style.css';
import { audioInit, buzz, muted, sfx, toggleMute } from './audio';
import { Controls } from './input/controls';
import { NetClient } from './net/client';
import { idle, type ClientMessage, type ServerMessage } from './net/protocol';
import { OnlineSession } from './net/session';
import { loadAssets } from './render/assets';
import { CamRig, type CamMode } from './render/camera';
import { GlbChibi, PrimitiveChibi, type AvatarView } from './render/chibi';
import { buildCourt } from './render/court';
import { Fx } from './render/fx';
import { Markers } from './render/markers';
import { PetBall } from './render/pet';
import { outline, toon } from './render/toon';
import { Bot, LEVELS } from './sim/bot';
import { BALL_R, DT } from './sim/constants';
import { pickControl } from './sim/team';
import type { Avatar, Input, SimEvent } from './sim/types';
import { World } from './sim/world';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
type Level = keyof typeof LEVELS;
type Kind = 'demo' | 'solo' | 'versus' | 'coop' | 'practice' | 'online';
type Size = 1 | 2 | 3;
/** A human at this screen: input slot (0 = P1, 1 = P2), the avatar they control, and whether control follows the ball. */
interface Player { slot: number; id: number; auto: boolean }
const RING = [0x64a9e8, 0xff9a3c];
type State = 'menu' | 'play' | 'paused' | 'over' | 'online' | 'lobby';

/* ---------- settings ---------- */
const settings = { level: 'normal' as Level, assist: true, cam: 0 as 0 | 1, size: 1 as Size };
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
let courtMesh = buildCourt({ hw: 2.5, len: 5 });
scene.add(courtMesh);

const rig = new CamRig();
const fx = new Fx($('fx'));
const hud = new Hud();
scene.add(fx.mesh);
// practice: the launcher post the ball sits on before each lob
const launcher = outline(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 1, 14), toon(0xb9bfd8)), 1.08);
scene.add(launcher);
const assets = await loadAssets();

/* ---------- game (re)construction ---------- */
let state: State = 'menu', kind: Kind = 'demo';
let world: World, bots: Bot[] = [], views: AvatarView[] = [], markers: Markers | null = null, ball: PetBall | null = null, players: Player[] = [];
const camModes = (): CamMode[] => (kind === 'versus' ? ['side', 'broadcast'] : ['follow', 'broadcast']);

function newGame(k: Kind, online?: OnlineSession) {
  kind = k;
  for (const v of views) scene.remove(v.root);
  if (markers) scene.remove(markers.group);
  if (ball) scene.remove(ball.root);
  const n = k === 'practice' ? 1 : k === 'demo' ? 2 : k === 'coop' ? Math.max(2, settings.size) : settings.size;
  players = online ? [{ slot: 0, id: online.me, auto: false }]
    : k === 'solo' ? [{ slot: 0, id: 0, auto: n > 1 }]
    : k === 'versus' ? [{ slot: 0, id: 0, auto: n > 1 }, { slot: 1, id: n, auto: n > 1 }]
    : k === 'coop' ? [{ slot: 0, id: 0, auto: false }, { slot: 1, id: 1, auto: false }]
    : k === 'practice' ? [{ slot: 0, id: 0, auto: false }] : [];
  world = online?.world ?? new World({ seed: (Date.now() % 1e6) | 0, mode: k === 'practice' ? 'practice' : 'match', teams: k === 'practice' ? [1, 0] : [n, n], humans: players.map(p => p.id), assist: settings.assist });
  // every avatar gets a bot so control can move between teammates; CPU opponents use the chosen difficulty, teammates play at normal.
  // Online the server runs the bots.
  bots = online ? [] : world.avatars.map(a => new Bot(a.id, world, (k === 'solo' || k === 'coop') && a.side === -1 ? LEVELS[settings.level] : LEVELS.normal));
  views = world.avatars.map((a, i) => assets.characters.length ? new GlbChibi(assets.characters[(i * 5) % assets.characters.length], a) : new PrimitiveChibi(a));
  views.forEach(v => scene.add(v.root));
  scene.remove(courtMesh); courtMesh = buildCourt(world.court); scene.add(courtMesh);
  markers = new Markers(world.avatars.length, players.map(p => RING[p.slot]));
  ball = new PetBall(assets.pets.length ? assets.pets[Math.floor(Math.random() * assets.pets.length)] : undefined);
  scene.add(markers.group, ball.root);
  rig.mode = k === 'versus' ? 'side' : settings.cam ? 'broadcast' : 'follow';
  rig.side = online ? world.avatars[online.me].side : 1;
  const [na, nb] = online ? (rig.side === 1 ? ['you', 'them'] : ['them', 'you']) : k === 'versus' ? ['P1', 'P2'] : k === 'coop' ? ['P1+P2', 'cpu'] : ['you', 'cpu'];
  hud.names(na, nb);
  document.body.classList.toggle('practice', k === 'practice');
  document.body.classList.toggle('two', k === 'versus' || k === 'coop');
  document.body.classList.toggle('online', k === 'online');
  $('tags').innerHTML = '';
}
const humans = (): Avatar[] => players.map(p => world.avatars[p.id]);
const isHuman = (id: number) => players.some(p => p.id === id);

/* ---------- overlays ---------- */
const panels = { menu: $('menu'), paused: $('pause'), over: $('over'), online: $('online'), lobby: $('lobby') };
function setState(s: State) {
  state = s;
  for (const [k, el] of Object.entries(panels)) el.classList.toggle('hide', s !== k);
  document.body.classList.toggle('menu', s === 'menu' || s === 'online' || s === 'lobby');
}
function play(k: Kind) { audioInit(); newGame(k); acc = 0; setState('play'); }
const mySide = () => world.avatars[players[0]?.id ?? 0]?.side ?? 1;
function showOver() {
  const won = world.winner === 1;
  if (kind === 'online') {
    $('overTitle').textContent = world.winner === mySide() ? 'Your team wins!' : 'They win';
    $('overSub').textContent = `sets ${world.sets[0]}–${world.sets[1]} · best rally ${world.best}`;
    syncRematch();
    return setState('over');
  }
  $('overTitle').textContent = kind === 'versus' ? (won ? 'P1 wins!' : 'P2 wins!') : won ? (kind === 'coop' ? 'You both win!' : 'You win!') : 'CPU wins';
  $('overSub').textContent = `sets ${world.sets[0]}–${world.sets[1]} · best rally ${world.best}` + (kind === 'versus' ? '' : ` · cpu ${settings.level}`);
  setState('over');
}
function act(a: string) {
  audioInit();
  if (a === 'solo' || a === 'versus' || a === 'coop' || a === 'practice') play(a);
  else if (a === 'resume') setState('play');
  else if (a === 'restart' && kind === 'online') { net.client?.send({ t: 'rematch' }); $('over').querySelector<HTMLElement>('[data-a=restart]')!.textContent = 'Waiting for the others…'; }
  else if (a === 'restart') { world.restart(); acc = 0; setState('play'); }
  else if (a === 'menu') { if (net.client) leaveOnline(); newGame('demo'); setState('menu'); }
  else if (a === 'online') { setState('online'); status(''); }
  else if (a === 'quick') void goOnline({ t: 'quick', name: '', size: settings.size });
  else if (a === 'create') void goOnline({ t: 'create', name: '', size: settings.size });
  else if (a === 'join') void goOnline({ t: 'join', name: '', code: codeInput.value.trim().toUpperCase() });
  else if (a === 'team') net.client?.send({ t: 'team' });
  else if (a === 'startOnline') net.client?.send({ t: 'start' });
  else if (a === 'invite' && net.lobby) {
    const url = `${location.origin}${location.pathname}?room=${net.lobby.code}`;
    navigator.clipboard?.writeText(url).then(() => toast('Invite link copied'), () => toast(url));
  }
}

/* ---------- online ---------- */
type Lobby = Extract<ServerMessage, { t: 'lobby' }>;
const net = { client: null as NetClient | null, seat: -1, lobby: null as Lobby | null, session: null as OnlineSession | null, size: 1, names: [] as string[] };
const nameInput = $<HTMLInputElement>('name'), codeInput = $<HTMLInputElement>('code');
try { nameInput.value = localStorage.getItem('chibivolley.name') ?? ''; } catch { /* storage blocked */ }
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') act('join'); });
const status = (msg: string) => { $('netStatus').textContent = msg; };
const esc = (t: string) => t.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
let toastT = 0;
function toast(msg: string) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); toastT = 2.5; }

async function goOnline(m: ClientMessage) {
  const name = nameInput.value.trim() || 'player';
  try { localStorage.setItem('chibivolley.name', name); } catch { /* storage blocked */ }
  if ('name' in m) m.name = name;
  if (m.t === 'join' && m.code.length !== 4) return status('Enter a 4-letter room code.');
  if (!net.client) {
    const c = new NetClient();
    status('connecting…');
    try { await c.connect(); } catch { return status('Could not reach the match server.'); }
    c.on(onNet);
    c.onStatus = st => { if (st === 'reconnecting') toast('Reconnecting…'); else if (st === 'lost') { toast('Connection lost'); act('menu'); } };
    net.client = c;
  }
  status('');
  net.client.send(m);
}

function onNet(m: ServerMessage) {
  switch (m.t) {
    case 'joined': net.seat = m.seat; history.replaceState(null, '', `?room=${m.code}`); if (state !== 'play' && state !== 'over' && state !== 'paused') setState('lobby'); break;
    case 'lobby':
      net.lobby = m; renderLobby(); syncRematch();
      if (m.phase === 'playing' && state === 'over') { overT = -1; setState('play'); }
      if (m.phase === 'over' && state === 'play' && overT < 0) overT = 1.6;
      break;
    case 'start': net.size = m.size; net.names = m.names; net.session = null; break;
    case 'snap':
      if (!net.session) { net.session = new OnlineSession(m, net.seat, net.size, performance.now()); newGame('online', net.session); overT = -1; setState('play'); }
      else for (const e of net.session.onSnapshot(m, performance.now())) onEvent(e);
      break;
    case 'peer': toast(`${net.lobby?.seats[m.seat]?.name ?? 'A player'} ${m.connected ? 'is back' : 'dropped · a bot covers for now'}`); break;
    case 'error': status(m.msg); toast(m.msg); break;
  }
}

function leaveOnline() {
  net.client?.send({ t: 'leave' }); net.client?.close();
  Object.assign(net, { client: null, seat: -1, lobby: null, session: null });
  history.replaceState(null, '', location.pathname);
}

function renderLobby() {
  const l = net.lobby!, humans = l.seats.filter(Boolean).length, host = l.host === net.seat;
  $('lobbyCode').textContent = l.code;
  $('lobbyInfo').textContent = l.quick ? (l.startsIn ? `quick match · starting in ${l.startsIn}s` : 'quick match · waiting for players') : host ? 'share the code, start when everyone is in' : 'waiting for the host to start';
  for (const [el, side] of [[$('teamA'), 1], [$('teamB'), -1]] as const) {
    const rows = l.seats.map((s, i) => (s && s.side === side ? `<li class="${i === net.seat ? 'me' : ''} ${s.connected ? '' : 'off'}">${esc(s.name)}${i === l.host ? ' ★' : ''}${i === net.seat ? ' (you)' : ''}</li>` : '')).join('');
    el.innerHTML = rows + '<li class="cpu">cpu</li>'.repeat(Math.max(0, l.size - l.seats.filter(s => s?.side === side).length));
  }
  document.querySelectorAll<HTMLButtonElement>('#lsize button').forEach(b => { b.classList.toggle('on', Number(b.dataset.ls) === l.size); b.disabled = !host || l.quick; });
  const start = $<HTMLButtonElement>('bStart');
  start.style.display = l.quick ? 'none' : '';
  start.disabled = !host || humans < 2;
  start.textContent = humans < 2 ? 'Waiting for players…' : host ? 'Start' : 'Host starts the match';
}

function syncRematch() {
  const l = net.lobby, b = $('over').querySelector<HTMLElement>('[data-a=restart]')!;
  if (kind !== 'online' || !l) { b.textContent = 'Rematch'; return; }
  const on = l.seats.filter(s => s?.connected), votes = on.filter(s => s!.rematch).length;
  b.textContent = l.seats[net.seat]?.rematch ? `Waiting for the others… (${votes}/${on.length})` : `Rematch (${votes}/${on.length})`;
}
document.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a],[data-l],[data-s],[data-ls]');
  if (!t) return;
  if (t.dataset.ls) net.client?.send({ t: 'size', size: Number(t.dataset.ls) });
  else if (t.dataset.l) { settings.level = t.dataset.l as Level; save(); syncBtns(); }
  else if (t.dataset.s) { settings.size = Number(t.dataset.s) as Size; save(); syncBtns(); }
  else act(t.dataset.a!);
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
  document.querySelectorAll<HTMLElement>('[data-s]').forEach(b => b.classList.toggle('on', Number(b.dataset.s) === settings.size));
}
const toggleCam = () => {
  const m = camModes(); rig.mode = m[(m.indexOf(rig.mode) + 1) % m.length];
  if (kind !== 'versus') { settings.cam = rig.mode === 'broadcast' ? 1 : 0; save(); }
};
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
  if (e.code === 'Enter' && state === 'menu') act('solo');
  if (e.code === 'Enter' && state === 'over') act('restart');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && kind !== 'online') setState('paused'); last = performance.now(); acc = 0; });
syncBtns();

/* ---------- events → juice ---------- */
let hitstop = 0, overT = -1;
function onEvent(e: SimEvent) {
  const mine = 'id' in e && isHuman(e.id), p = world.ball.p, vs = kind === 'versus', me = { side: kind === 'online' ? mySide() : 1 };
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
      const win = e.side === me.side || vs, why = e.why === 'touches' ? '4 touches' : e.why === 'out' ? 'Out!' : '';
      sfx.point(win);
      if (vs) fx.word(`${e.side === 1 ? 'P1' : 'P2'} point${why ? ' · ' + why : '!'}`, p, e.side === 1 ? 'good' : 'bad');
      else fx.word(win ? (world.rally >= 6 ? 'Nice!' : 'Point!') : why || 'Miss…', p, win ? 'good' : 'bad');
      if (!win) rig.shake(0.15);
      break;
    }
    case 'set': fx.word(vs ? `${e.side === 1 ? 'P1' : 'P2'} takes the set` : e.side === me.side ? 'SET!' : 'Set lost', { ...p, y: p.y + 0.6 }, 'big'); sfx.perfect(); break;
    case 'match': fx.word(vs ? `${e.side === 1 ? 'P1' : 'P2'} WINS!` : e.side === me.side ? 'YOU WIN!' : kind === 'online' ? 'THEY WIN' : 'CPU WINS', { ...p, y: p.y + 0.6 }, 'big'); overT = 1.6; break;
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
  const sess = net.session;
  if (kind === 'online' && sess) {
    // online: predict ahead of the server and send every predicted tick's input (the pause menu doesn't stop the match)
    if (net.lobby?.phase === 'playing') {
      sess.rtt = net.client?.rtt ?? 100;
      const target = sess.targetTick(performance.now());
      for (let n = 0; sess.world.tick < target && n < 8; n++) {
        const r = state === 'play' ? controls.read(0, false) : idle(), [mx, mz] = rig.toWorld(r.mx, r.mz);
        const { input, events } = sess.advance({ ...r, mx, mz });
        net.client?.send({ t: 'input', ...input });
        events.forEach(onEvent);
      }
    }
    players[0].id = sess.me;
  } else if (running) {
    if (hitstop > 0) hitstop -= dt;
    else {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) {
        const inputs: Input[] = [];
        for (const p of players) {
          if (!p.auto) continue;
          const cur = world.avatars[p.id], nxt = pickControl(world, cur, new Set(players.filter(o => o !== p).map(o => o.id)));
          if (nxt !== cur) { cur.bot = true; nxt.bot = false; p.id = nxt.id; }
        }
        const two = players.length > 1;
        for (const p of players) {
          const r = state === 'play' ? controls.read(p.slot, two) : { mx: 0, mz: 0, jump: false, hit: false }, [mx, mz] = rig.toWorld(r.mx, r.mz);
          inputs[p.id] = { ...r, mx, mz };
        }
        for (const b of bots) if (!isHuman(b.id)) inputs[b.id] = b.input();
        world.step(inputs);
        for (const e of world.events) if (kind !== 'demo') onEvent(e);
        world.events.length = 0;
        if (kind === 'demo' && world.phase === 'over') world.restart();
        acc -= DT; n++;
      }
      if (n === 6) acc = 0;
    }
  }
  if (overT > 0 && (overT -= dt) <= 0 && (state === 'play' || state === 'paused')) showOver();
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('on');
  const hs = humans(), focus = hs.length ? { x: hs.reduce((s, a) => s + a.p.x, 0) / hs.length, y: 0, z: hs.reduce((s, a) => s + a.p.z, 0) / hs.length } : world.avatars[0].p;
  world.avatars.forEach((a, i) => views[i].update(a, dt));
  ball!.update(world.ball, dt);
  const wb = world.ball;
  launcher.visible = world.mode === 'practice' && wb.held;
  if (launcher.visible) { const h = wb.p.y - BALL_R * 1.1; launcher.scale.set(1, h, 1); launcher.position.set(wb.p.x, h / 2, wb.p.z); }
  markers!.update(world, hs, rig.cam, dt);
  rig.update(focus, world.ball.p, world.court, dt, W / H);
  fx.update(dt, rig.cam, W, H);
  hud.update(world, rig.cam, W, H);
  if (kind === 'online' && sess) drawTags(sess);
  $('ping').textContent = kind === 'online' && net.client ? `${Math.round(net.client.rtt)} ms` : '';
  renderer.render(scene, rig.cam);
  requestAnimationFrame(frame);
}

/** Name tags over the avatars other online players control. */
const tagV = new THREE.Vector3();
function drawTags(s: OnlineSession) {
  const box = $('tags');
  s.ctl.forEach((id, seat) => {
    let el = box.children[seat] as HTMLElement | undefined;
    while (!el) { box.appendChild(document.createElement('div')); el = box.children[seat] as HTMLElement | undefined; }
    const name = net.lobby?.seats[seat]?.name;
    el.style.display = id >= 0 && name && seat !== net.seat ? '' : 'none';
    if (id < 0 || !name || seat === net.seat) return;
    const a = world.avatars[id];
    el.textContent = name;
    tagV.set(a.p.x, a.p.y + 1.45, a.p.z).project(rig.cam);
    el.style.transform = `translate(${(tagV.x * 0.5 + 0.5) * W}px, ${(-tagV.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
  });
}

newGame('demo');
setState('menu');
const qroom = q.get('room')?.toUpperCase();
if (qroom) { codeInput.value = qroom; setState('online'); }
else if (q.has('demo')) setState('menu');
else if (['solo', 'versus', 'coop', 'practice'].includes(q.get('play') ?? '')) play(q.get('play') as Kind);
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
  get me() { const a = world.avatars[players[0]?.id ?? 0]; return { id: a.id, ...a.p, charging: a.charging, charge: a.charge }; },
  get players() { return players.map(p => ({ ...p })); },
  get court() { return { ...world.court }; },
  get cam() { return rig.mode; },
  get clips() { return { characters: views.map(v => v.clips ?? null), pet: ball!.clips }; },
  get models() { return { characters: assets.characters.length, pets: assets.pets.length }; },
  get online() { const s = net.session; return { seat: net.seat, lobby: net.lobby, me: s?.me, tick: s?.world.tick, pending: s?.pendingCount, rtt: net.client?.rtt }; },
  act,
};
