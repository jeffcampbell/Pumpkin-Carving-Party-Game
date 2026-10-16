// WebSocket transport for game rooms. Each socket must first send either
// {type:'create', name, config} or {type:'join', code, name, token?}; every later
// message is routed to the room it joined.

import { WebSocketServer } from 'ws';
import { GameError, RoomManager } from './rooms.js';

const HEARTBEAT_MS = 25_000;

export function attachGameServer(httpServer, { path = '/ws' } = {}) {
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 3 * 1024 * 1024 });

  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== path) return; // e.g. Vite HMR in dev
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    let room = null;
    let player = null;
    const send = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return send({ type: 'error', message: 'Bad message' });
      }
      try {
        if (!room) {
          ({ room, player } = enterRoom(rooms, msg, send));
          send({ type: 'welcome', code: room.code, playerId: player.id, token: player.token });
          room.sendState(player);
        } else {
          room.handle(player.id, msg);
        }
      } catch (err) {
        if (!(err instanceof GameError)) console.error('[game]', err);
        send({ type: 'error', message: err instanceof GameError ? err.message : 'Something went wrong' });
      }
    });

    ws.on('close', () => {
      // Only disconnect if this socket is still the player's current one (a
      // resumed connection replaces the send function).
      if (room && player && player.send === send) room.disconnect(player.id);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    rooms.sweep();
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return { rooms, wss };
}

function enterRoom(rooms, msg, send) {
  if (msg.type === 'create') {
    const room = rooms.create(msg.config);
    return { room, player: room.addPlayer(msg.name, send) };
  }
  if (msg.type === 'join') {
    const room = rooms.get(msg.code);
    if (!room) throw new GameError('No room with that code. Check it and try again.');
    const resumed = typeof msg.token === 'string' && room.resume(msg.token, send);
    return { room, player: resumed || room.addPlayer(msg.name, send) };
  }
  throw new GameError('Join or create a room first.');
}
