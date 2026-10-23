// Match server: one process, rooms in memory, JSON over WebSocket, GET /health for Fly.
// Run locally: npm run server (ws://localhost:8787). Deployed to Fly.io as chibi-volley-match.
import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { CODE_ALPHABET, CODE_LENGTH, isCode, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { Room } from './room';

const PORT = Number(process.env.PORT ?? 8787);
/** Rooms nobody has touched for this long are dropped. */
const IDLE_ROOM_MS = 30 * 60 * 1000;
/** Matches step from a fast interval; Room.update() runs however many 60 Hz ticks are due. */
const LOOP_MS = 4;
/** Inputs are tiny; anything big is not ours. */
const MAX_MESSAGE_BYTES = 2048;

const rooms = new Map<string, { room: Room; touched: number }>();

const makeCode = (): string => {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
};

const newRoom = (size: number, quick: boolean) => {
  const code = makeCode();
  const room = new Room(code, size, quick, () => performance.now(), () => randomInt(1, 2 ** 31 - 1), () => randomBytes(12).toString('base64url'));
  rooms.set(code, { room, touched: Date.now() });
  return room;
};

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`ok ${rooms.size} rooms`);
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws: WebSocket) => {
  let seat: { room: Room; i: number } | null = null;
  const send = (m: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const error = (code: Extract<ServerMessage, { t: 'error' }>['code'], msg: string) => send({ t: 'error', code, msg });
  const sit = (room: Room, i: number | null) => { if (i !== null) seat = { room, i }; return i; };

  ws.on('message', data => {
    let m: ClientMessage;
    try { m = JSON.parse(String(data)); } catch { return error('bad-request', 'Not JSON.'); }
    if (m.t === 'ping') return send({ t: 'pong', c: m.c });
    if (!seat) {
      if (m.t === 'create') { const room = newRoom(m.size, false); sit(room, room.join(m.name, send)); return; }
      if (m.t === 'quick') {
        const open = [...rooms.values()].find(e => e.room.quick && e.room.open && e.room.size === Math.min(3, Math.max(1, m.size | 0)));
        const room = open?.room ?? newRoom(m.size, true);
        sit(room, room.join(m.name, send));
        return;
      }
      if (m.t === 'join' || m.t === 'rejoin') {
        const code = String(m.code ?? '').toUpperCase(), entry = isCode(code) ? rooms.get(code) : undefined;
        if (!entry || entry.room.closed) return error('no-room', 'No room with that code.');
        if (m.t === 'join' && !entry.room.open) return error(entry.room.phase === 'lobby' ? 'full' : 'started', entry.room.phase === 'lobby' ? 'That room is full.' : 'That match has already started.');
        const i = sit(entry.room, m.t === 'join' ? entry.room.join(m.name, send) : entry.room.rejoin(String(m.token), send));
        if (i === null) return error(m.t === 'join' ? 'full' : 'bad-token', m.t === 'join' ? 'That room is full.' : 'Could not rejoin.');
        entry.touched = Date.now();
        return;
      }
      return error('bad-request', 'Create or join a room first.');
    }
    const s: { room: Room; i: number } = seat;
    const e = rooms.get(s.room.code);
    if (e) e.touched = Date.now();
    s.room.handle(s.i, m);
    if (m.t === 'leave') seat = null;
  });

  ws.on('close', () => { if (seat) seat.room.disconnect(seat.i); });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, { room, touched }] of rooms) {
    room.update();
    if (room.closed || now - touched > IDLE_ROOM_MS) rooms.delete(code);
  }
}, LOOP_MS);

http.listen(PORT, () => console.log(`chibi volley match server on :${PORT}`));
