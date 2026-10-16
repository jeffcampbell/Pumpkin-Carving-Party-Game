import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomManager, normalizeConfig, GameError, SUBMIT_GRACE_MS } from '../server/game/rooms.js';

const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64')}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 1, 2]).toString('base64')}`;
const pumpkin = { mask: png, thumb: jpeg, candleColor: '#ff0000', skinColor: '#00ff00' };

function setup(config = {}, names = ['Ann', 'Bo', 'Cy']) {
  let now = 0;
  const room = new Room('ABCD', config, { now: () => now });
  const inbox = new Map();
  const players = names.map((name) => {
    const msgs = [];
    const p = room.addPlayer(name, (m) => msgs.push(m));
    inbox.set(p.id, msgs);
    return p;
  });
  const last = (p, type = 'state') => inbox.get(p.id).filter((m) => m.type === type).at(-1);
  const advance = (ms) => {
    now += ms;
    mock.timers.tick(ms);
  };
  return { room, players, last, advance };
}

afterEach(() => mock.timers.reset());

test('config defaults to 2 minute rounds, 3 votes, 8 players and clamps bad input', () => {
  assert.deepEqual(normalizeConfig(), { maxPlayers: 8, roundSeconds: 120, votesPerPlayer: 3, voteSeconds: 60 });
  assert.deepEqual(normalizeConfig({ maxPlayers: 50, roundSeconds: 5, votesPerPlayer: 'x' }), {
    maxPlayers: 8, roundSeconds: 30, votesPerPlayer: 3, voteSeconds: 60,
  });
});

test('rooms cap at maxPlayers and dedupe names', () => {
  const { room } = setup({ maxPlayers: 2 }, ['Ann', 'ann']);
  assert.deepEqual([...room.players.values()].map((p) => p.name), ['Ann', 'ann 2']);
  assert.throws(() => room.addPlayer('Cy', () => {}), /full/);
});

test('only the host can start, and it needs two players', () => {
  const { room, players: [ann, bo] } = setup({}, ['Ann', 'Bo']);
  assert.throws(() => room.handle(bo.id, { type: 'start' }), /host/);
  room.disconnect(bo.id);
  assert.throws(() => room.handle(ann.id, { type: 'start' }), /at least 2/);
});

test('full round: carve, time out, vote, results', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { room, players: [ann, bo, cy], last, advance } = setup({ roundSeconds: 60, votesPerPlayer: 2 });

  room.handle(ann.id, { type: 'start' });
  assert.equal(room.phase, 'carving');
  assert.equal(last(bo).remainingMs, 60_000);
  assert.ok(last(bo).prompt);

  room.handle(ann.id, { type: 'submit', pumpkin });
  room.handle(bo.id, { type: 'submit', pumpkin });
  advance(60_000);
  assert.equal(room.phase, 'collecting');
  // Cy never submits; the grace period runs out and voting starts with two entries.
  advance(SUBMIT_GRACE_MS);
  assert.equal(room.phase, 'voting');

  const gallery = last(cy, 'gallery');
  assert.equal(gallery.entries.length, 2);
  assert.ok(gallery.entries.every((e) => e.thumb.startsWith('data:image/jpeg')));
  const annEntry = room.entries.find((e) => e.playerId === ann.id).entryId;
  const boEntry = room.entries.find((e) => e.playerId === bo.id).entryId;
  assert.equal(last(ann, 'gallery').entries.find((e) => e.entryId === annEntry).mine, true);

  // Authors stay hidden while voting.
  assert.equal(last(cy).results, null);

  assert.throws(() => room.handle(ann.id, { type: 'vote', entryIds: [annEntry] }), /own/);
  assert.throws(() => room.handle(cy.id, { type: 'vote', entryIds: [annEntry, annEntry, boEntry] }), /only get 2/);
  room.handle(ann.id, { type: 'vote', entryIds: [boEntry, boEntry] });
  room.handle(cy.id, { type: 'vote', entryIds: [annEntry, boEntry] });
  assert.deepEqual(last(cy).myVotes, [annEntry, boEntry]);

  for (const p of [ann, bo, cy]) room.handle(p.id, { type: 'doneVoting' });
  assert.equal(room.phase, 'results');
  const results = last(bo).results;
  assert.deepEqual(results.map((r) => [r.name, r.votes, r.rank]), [['Bo', 3, 1], ['Ann', 1, 2]]);

  room.handle(cy.id, { type: 'getMask', entryId: annEntry });
  assert.equal(last(cy, 'mask').mask, png);
  assert.equal(last(cy, 'mask').candleColor, '#ff0000');
});

test('everyone submitting early skips straight to voting; voting timer ends the round', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { room, players, advance } = setup({ voteSeconds: 30 }, ['Ann', 'Bo']);
  room.handle(players[0].id, { type: 'start' });
  for (const p of players) room.handle(p.id, { type: 'submit', pumpkin });
  assert.equal(room.phase, 'voting');
  advance(30_000);
  assert.equal(room.phase, 'results');
  assert.deepEqual(room.results.map((r) => r.votes), [0, 0]);
  assert.deepEqual(room.results.map((r) => r.rank), [1, 1]);
});

test('bad submissions are rejected', () => {
  const { room, players: [ann] } = setup({}, ['Ann', 'Bo']);
  room.handle(ann.id, { type: 'start' });
  assert.throws(() => room.handle(ann.id, { type: 'submit', pumpkin: { ...pumpkin, mask: jpeg } }), GameError);
  assert.throws(() => room.handle(ann.id, { type: 'submit', pumpkin: { ...pumpkin, candleColor: 'red' } }), GameError);
  room.dispose();
});

test('players can resume mid-game with their token, and host passes on when the host leaves', () => {
  const { room, players: [ann, bo] } = setup({}, ['Ann', 'Bo']);
  room.handle(ann.id, { type: 'start' });
  room.disconnect(ann.id);
  assert.equal(room.hostId, bo.id);
  assert.equal(room.players.get(ann.id).connected, false);

  const msgs = [];
  const back = room.resume(ann.token, (m) => msgs.push(m));
  assert.equal(back.id, ann.id);
  assert.equal(msgs.at(-1).phase, 'carving');
  assert.equal(room.resume('nope', () => {}), null);
  room.dispose();
});

test('new players cannot join a running game; lobby leavers are removed', () => {
  const { room, players: [ann, bo, cy] } = setup();
  room.disconnect(cy.id);
  assert.equal(room.players.has(cy.id), false);
  room.handle(ann.id, { type: 'start' });
  assert.throws(() => room.addPlayer('Late', () => {}), /already started/);
  room.dispose();
});

test('room manager sweeps rooms that have been empty for a while', () => {
  let now = 0;
  const rooms = new RoomManager({ now: () => now });
  const room = rooms.create({});
  assert.match(room.code, /^[A-HJ-NP-Z]{4}$/);
  assert.equal(rooms.get(room.code.toLowerCase()), room);
  now += 6 * 60 * 1000;
  rooms.sweep();
  assert.equal(rooms.get(room.code), undefined);
});
