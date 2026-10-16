// WebSocket connection to a game room, with automatic resume after drops.
// Emits: 'state', 'gallery', 'mask', 'error' (server-reported), 'status'
// (detail: 'connecting' | 'open' | 'lost' | 'closed').

const SESSION_KEY = 'pumpkin:game';

export function savedSession(code) {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return s && (!code || s.code === code.toUpperCase()) ? s : null;
  } catch {
    return null;
  }
}

export class GameClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.session = null; // { code, token } once the server welcomes us
    this.closed = false;
    this.retries = 0;
  }

  create(name, config) {
    this.open({ type: 'create', name, config });
  }

  join(code, name) {
    const s = savedSession(code);
    this.open({ type: 'join', code, name, token: s?.token });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  open(hello) {
    this.emit('status', 'connecting');
    this.ws?.close(); // e.g. a failed join attempt; its onclose sees it's stale
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'welcome') {
        this.session = { code: msg.code, token: msg.token, playerId: msg.playerId };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
        this.retries = 0;
        this.emit('status', 'open');
      } else {
        this.emit(msg.type, msg);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      if (!this.session) return this.emit('status', 'closed'); // never got in (bad code, room full…)
      // Dropped mid-game: resume with our token.
      this.emit('status', 'lost');
      const delay = Math.min(10_000, 500 * 2 ** this.retries++);
      this.retryTimer = setTimeout(() => this.open({ type: 'join', code: this.session.code, token: this.session.token }), delay);
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
