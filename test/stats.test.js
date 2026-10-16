import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { createStore } from '../server/store.js';
import { Stats } from '../server/stats.js';
import { RoomManager } from '../server/game/rooms.js';

delete process.env.DATABASE_URL; // always the in-memory store here

const DAY = 86_400_000;
const browser = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const req = (ip, ua = browser) => ({ ip, get: (name) => (name === 'user-agent' ? ua : undefined) });

async function setup() {
  let now = Date.UTC(2026, 9, 31, 20);
  const stats = new Stats(await createStore(), { secret: 'test', now: () => now });
  return { stats, later: (ms) => (now += ms) };
}

test('visitors count once per day, and bots and link previews are ignored', async () => {
  const { stats, later } = await setup();
  stats.visit(req('1.1.1.1'));
  stats.visit(req('1.1.1.1'));
  stats.visit(req('2.2.2.2'));
  stats.visit(req('3.3.3.3', 'Slackbot-LinkExpanding 1.0'));
  stats.visit(req('4.4.4.4', 'curl/8.4.0'));
  stats.visit(req('5.5.5.5', ''));
  await flush();
  later(DAY);
  stats.visit(req('1.1.1.1'));
  await flush();
  const { totals, nights } = await stats.build();
  assert.equal(totals.visitors, 3);
  assert.deepEqual(nights.slice(-2).map((n) => n.visitors), [2, 1]);
});

test('the summary has 30 nights ending today, live counts, and pumpkin breakdowns', async () => {
  const { stats } = await setup();
  await stats.store.create({ id: 'aaaaaaaa', title: '', mask: Buffer.from(''), thumb: Buffer.from(''), candleColor: '#FFAA00', skinColor: '#ff7a1a', scene: 'graveyard', editTokenHash: 'x' });
  stats.track('game_pumpkins', 3);
  stats.live = () => ({ rooms: 1, players: 2, carving: 1 });
  await flush();
  const summary = await stats.summary();
  assert.equal(summary.nights.length, 30);
  assert.equal(summary.nights.at(-1).day, '2026-10-31');
  assert.equal(summary.totals.pumpkinsSaved, 1);
  assert.equal(summary.totals.gamePumpkins, 3);
  assert.deepEqual(summary.scenes, [{ scene: 'graveyard', count: 1 }]);
  assert.deepEqual(summary.candles, [{ color: '#ffaa00', count: 1 }]);
  assert.deepEqual(summary.live, { rooms: 1, players: 2, carving: 1 });
});

test('game rooms report rooms, players, rounds, entries and votes', () => {
  const events = {};
  const rooms = new RoomManager({ track: (name, by) => (events[name] = (events[name] ?? 0) + by) });
  const room = rooms.create({});
  const [ann, bo] = ['Ann', 'Bo'].map((name) => room.addPlayer(name, () => {}));
  room.handle(ann.id, { type: 'start' });
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')}`;
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 1]).toString('base64')}`;
  for (const p of [ann, bo]) room.handle(p.id, { type: 'submit', pumpkin: { mask: png, thumb: jpeg, candleColor: '#ffaa00', skinColor: '#ff7a1a' } });
  const boEntry = room.entries.find((e) => e.playerId === bo.id).entryId;
  room.handle(ann.id, { type: 'vote', entryIds: [boEntry, boEntry] });
  for (const p of [ann, bo]) room.handle(p.id, { type: 'doneVoting' });
  assert.deepEqual(events, { rooms_created: 1, players_joined: 2, rounds_played: 1, game_pumpkins: 2, votes_cast: 2 });
  assert.deepEqual(rooms.live(), { rooms: 1, players: 2, carving: 0 });
  room.dispose();
});
