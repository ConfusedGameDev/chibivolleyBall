// Browser connection to the match server: JSON over WebSocket, ping/RTT, artificial lag for testing,
// and automatic rejoin (within the server's grace period) if the connection drops mid-room.
import { GRACE_MS, type ClientMessage, type ServerMessage } from './protocol';

/** Production server; `?server=ws://...` overrides, and dev builds default to a local server. */
export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (import.meta.env.DEV) return `ws://${location.hostname}:8787`;
  return 'wss://chibi-volley-match.fly.dev';
}

/** `?lag=100` adds 100 ms of round-trip delay (half each way) to test netcode on a fast connection. */
const ARTIFICIAL_RTT = Number(new URLSearchParams(location.search).get('lag') ?? 0);
const PING_MS = 1000;
const REJOIN_EVERY_MS = 1000;

type Listener = (m: ServerMessage) => void;

export class NetClient {
  /** Smoothed round-trip time in ms (includes artificial lag). */
  rtt = 100;
  /** Set once seated; used to rejoin after a dropped connection. */
  room: { code: string; token: string } | null = null;
  onStatus: (s: 'open' | 'reconnecting' | 'lost') => void = () => {};
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pinger: number | undefined;
  private closedByUs = false;

  connect(): Promise<void> {
    this.closedByUs = false;
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(serverUrl()));
      ws.onopen = () => { this.startPing(); this.onStatus('open'); resolve(); };
      ws.onerror = () => reject(new Error('Could not reach the match server.'));
      ws.onmessage = ev => this.deliver(JSON.parse(String(ev.data)) as ServerMessage);
      ws.onclose = () => {
        window.clearInterval(this.pinger);
        if (!this.closedByUs && this.room) void this.rejoinLoop();
      };
    });
  }

  send(m: ClientMessage): void {
    const go = () => this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify(m));
    if (ARTIFICIAL_RTT) window.setTimeout(go, ARTIFICIAL_RTT / 2); else go();
  }

  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  close(): void {
    this.closedByUs = true; this.room = null;
    window.clearInterval(this.pinger);
    this.ws?.close(); this.ws = null;
  }

  private deliver(m: ServerMessage): void {
    const go = () => {
      if (m.t === 'pong') { this.rtt = this.rtt * 0.8 + (performance.now() - m.c) * 0.2; return; }
      if (m.t === 'joined') this.room = { code: m.code, token: m.token };
      for (const fn of [...this.listeners]) fn(m);
    };
    if (ARTIFICIAL_RTT) window.setTimeout(go, ARTIFICIAL_RTT / 2); else go();
  }

  private startPing(): void {
    window.clearInterval(this.pinger);
    this.send({ t: 'ping', c: performance.now() });
    this.pinger = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), PING_MS);
  }

  /** The socket dropped while seated: keep trying to rejoin until the server's grace period is over. */
  private async rejoinLoop(): Promise<void> {
    const room = this.room!;
    this.onStatus('reconnecting');
    const giveUpAt = performance.now() + GRACE_MS;
    while (!this.closedByUs && performance.now() < giveUpAt) {
      try { await this.connect(); this.send({ t: 'rejoin', code: room.code, token: room.token }); return; }
      catch { await new Promise(r => setTimeout(r, REJOIN_EVERY_MS)); }
    }
    if (!this.closedByUs) this.onStatus('lost');
  }
}
