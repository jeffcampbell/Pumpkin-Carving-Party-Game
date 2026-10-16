import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

// Boots the real server (in-memory store) and exercises the HTTP + WebSocket surface.
const PORT = 3999;
const base = `http://localhost:${PORT}`;
let server;

const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]).toString('base64')}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 9]).toString('base64')}`;

before(async () => {
  server = spawn(process.execPath, ['server/index.js', '--dev'], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(() => server.kill());

const json = (method, path, body, headers = {}) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });

test('save, fetch, edit with token, and share page tags', async () => {
  const res = await json('POST', '/api/pumpkins', { mask: png, thumb: jpeg, candleColor: '#7DFFB0', title: '  Spooky   Steve ' });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.match(created.id, /^[A-Za-z0-9_-]{8}$/);
  assert.equal(created.title, 'Spooky Steve');
  assert.equal(created.candleColor, '#7dffb0');
  assert.ok(created.editToken);

  const meta = await (await fetch(`${base}/api/pumpkins/${created.id}`)).json();
  assert.equal(meta.editToken, undefined);

  const mask = await fetch(`${base}/api/pumpkins/${created.id}/mask.png`);
  assert.equal(mask.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await mask.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47, 9]);

  const forbidden = await json('PUT', `/api/pumpkins/${created.id}`, { mask: png, thumb: jpeg }, { 'x-edit-token': 'wrong' });
  assert.equal(forbidden.status, 403);
  const updated = await json('PUT', `/api/pumpkins/${created.id}`, { mask: png, thumb: jpeg, title: 'Steve 2' }, { 'x-edit-token': created.editToken });
  assert.equal((await updated.json()).title, 'Steve 2');

  const page = await (await fetch(`${base}/p/${created.id}`)).text();
  assert.match(page, /<meta property="og:title" content="Steve 2">/);
  assert.match(page, new RegExp(`/api/pumpkins/${created.id}/thumb.jpg`));
});

test('pumpkins remember their scene, defaulting to the kitchen', async () => {
  const plain = await (await json('POST', '/api/pumpkins', { mask: png, thumb: jpeg })).json();
  assert.equal(plain.scene, 'kitchen');
  const spooky = await (await json('POST', '/api/pumpkins', { mask: png, thumb: jpeg, scene: 'graveyard' })).json();
  assert.equal((await (await fetch(`${base}/api/pumpkins/${spooky.id}`)).json()).scene, 'graveyard');
  assert.equal((await json('POST', '/api/pumpkins', { mask: png, thumb: jpeg, scene: 'the-moon' })).status, 400);
});

test('rejects bad pumpkins and unknown ids', async () => {
  assert.equal((await json('POST', '/api/pumpkins', { mask: jpeg, thumb: jpeg })).status, 400);
  assert.equal((await json('POST', '/api/pumpkins', { mask: png, thumb: jpeg, candleColor: 'red' })).status, 400);
  assert.equal((await fetch(`${base}/api/pumpkins/doesnotexist`)).status, 404);
  assert.equal((await fetch(`${base}/api/pumpkins/bad%21id`)).status, 404);
});

test('two players can create and join a room over the socket', async () => {
  const connect = () =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      const msgs = [];
      ws.on('message', (d) => msgs.push(JSON.parse(d)));
      ws.on('open', () => resolve({ ws, msgs }));
    });
  const waitFor = async (msgs, pred) => {
    for (let i = 0; i < 100; i++) {
      const m = msgs.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out');
  };

  const host = await connect();
  host.ws.send(JSON.stringify({ type: 'create', name: 'Host', config: { roundSeconds: 90 } }));
  const welcome = await waitFor(host.msgs, (m) => m.type === 'welcome');
  assert.match(welcome.code, /^[A-Z]{4}$/);

  const guest = await connect();
  guest.ws.send(JSON.stringify({ type: 'join', code: welcome.code.toLowerCase(), name: 'Guest' }));
  await waitFor(guest.msgs, (m) => m.type === 'welcome');
  const state = await waitFor(host.msgs, (m) => m.type === 'state' && m.players.length === 2);
  assert.equal(state.config.roundSeconds, 90);
  assert.equal(state.config.votesPerPlayer, 3);

  host.ws.send(JSON.stringify({ type: 'start' }));
  const carving = await waitFor(guest.msgs, (m) => m.type === 'state' && m.phase === 'carving');
  assert.ok(carving.prompt);

  const bad = await connect();
  bad.ws.send(JSON.stringify({ type: 'join', code: 'ZZZZ', name: 'X' }));
  assert.match((await waitFor(bad.msgs, (m) => m.type === 'error')).message, /No room/);

  for (const c of [host, guest, bad]) c.ws.close();
});
