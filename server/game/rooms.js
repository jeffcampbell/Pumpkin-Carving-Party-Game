// In-memory game rooms. A room moves through these phases:
//
//   lobby -> carving -> collecting -> voting -> results -> (carving | lobby)
//
// "collecting" is a short grace period after the timer runs out, while clients
// auto-submit whatever they have carved. Rooms live only in this process, which
// is fine for a single Railway instance; see README for scaling notes.

import crypto from 'node:crypto';
import { pickPrompt } from './prompts.js';
import { DEFAULT_CATEGORY, isCategory, parseCustomPrompts } from '../../shared/prompt-categories.js';
import { pumpkinPayload, ValidationError } from '../validate.js';

export const LIMITS = {
  maxPlayers: { min: 2, max: 8, default: 8 },
  roundSeconds: { min: 30, max: 600, default: 120 },
  votesPerPlayer: { min: 1, max: 10, default: 3 },
  voteSeconds: { min: 15, max: 300, default: 60 },
};
export const MIN_PLAYERS_TO_START = 2;
export const SUBMIT_GRACE_MS = 5000;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const MAX_ROOMS = 500;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

export class GameError extends Error {}

export function normalizeConfig(input = {}, base = {}) {
  const config = {};
  for (const [key, { min, max, default: def }] of Object.entries(LIMITS)) {
    const raw = input[key] ?? base[key] ?? def;
    const n = Math.round(Number(raw));
    config[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  const category = input.category ?? base.category;
  config.category = isCategory(category) ? category : DEFAULT_CATEGORY;
  config.customPrompts = parseCustomPrompts(input.customPrompts ?? base.customPrompts);
  return config;
}

const newId = () => crypto.randomBytes(6).toString('base64url');

function cleanName(name) {
  const cleaned = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 20) : '';
  return cleaned || 'Pumpkin Fan';
}

export class Room {
  constructor(code, config, { now = Date.now } = {}) {
    this.code = code;
    this.config = normalizeConfig(config);
    this.now = now;
    this.phase = 'lobby';
    this.round = 0;
    this.prompt = null;
    this.deadline = null;
    this.timer = null;
    this.hostId = null;
    this.players = new Map();
    this.usedPrompts = new Set();
    this.entries = []; // voting order, set when voting begins
    this.results = null;
    this.emptySince = this.now();
  }

  // ---- membership -------------------------------------------------------

  addPlayer(name, send) {
    if (this.phase !== 'lobby') throw new GameError('That game has already started. Wait for the next one!');
    if (this.players.size >= this.config.maxPlayers) throw new GameError('That room is full.');

    let unique = cleanName(name);
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    for (let i = 2; taken.has(unique.toLowerCase()); i++) unique = `${cleanName(name).slice(0, 17)} ${i}`;

    const player = {
      id: newId(),
      token: crypto.randomBytes(16).toString('base64url'),
      name: unique,
      send,
      connected: true,
      submission: null,
      votes: [],
      doneVoting: false,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.emptySince = null;
    this.broadcast();
    return player;
  }

  /** Reattaches a player who reconnected with their resume token. */
  resume(token, send) {
    const player = [...this.players.values()].find((p) => p.token === token);
    if (!player) return null;
    player.send = send;
    player.connected = true;
    this.emptySince = null;
    if (!this.players.get(this.hostId)?.connected) this.hostId = player.id;
    this.broadcast();
    if (this.entries.length && (this.phase === 'voting' || this.phase === 'results')) this.sendGallery(player);
    return player;
  }

  disconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    // In the lobby nothing is at stake, so just drop them; mid-game we keep their
    // slot (and submission) so a refresh can resume.
    if (this.phase === 'lobby') this.players.delete(playerId);
    else player.connected = false;

    const connected = this.connectedPlayers();
    if (connected.length === 0) this.emptySince = this.now();
    if (this.hostId === playerId || !this.players.has(this.hostId)) {
      this.hostId = connected[0]?.id ?? [...this.players.keys()][0] ?? null;
    }
    this.checkProgress();
    this.broadcast();
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  // ---- messages ---------------------------------------------------------

  handle(playerId, msg) {
    const player = this.players.get(playerId);
    if (!player) throw new GameError('You are not in this room.');
    switch (msg.type) {
      case 'config': return this.updateConfig(player, msg.config);
      case 'start': return this.start(player);
      case 'submit': return this.submit(player, msg.pumpkin);
      case 'vote': return this.vote(player, msg.entryIds);
      case 'doneVoting': return this.finishVoting(player);
      case 'getMask': return this.sendMask(player, msg.entryId);
      case 'lobby': return this.backToLobby(player);
      default: throw new GameError(`Unknown message type: ${msg.type}`);
    }
  }

  requireHost(player) {
    if (player.id !== this.hostId) throw new GameError('Only the host can do that.');
  }

  updateConfig(player, config) {
    this.requireHost(player);
    if (this.phase !== 'lobby') throw new GameError('Settings can only change in the lobby.');
    const next = normalizeConfig(config, this.config);
    if (next.maxPlayers < this.players.size) next.maxPlayers = this.players.size;
    this.config = next;
    this.broadcast();
  }

  start(player) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'results') throw new GameError('A round is already running.');
    if (this.connectedPlayers().length < MIN_PLAYERS_TO_START) {
      throw new GameError(`You need at least ${MIN_PLAYERS_TO_START} players to start.`);
    }
    if (this.config.category === 'custom' && this.config.customPrompts.length === 0) {
      throw new GameError('Add at least one custom prompt first.');
    }
    // Anyone who left mid-game doesn't get carried into the next round.
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    for (const p of this.players.values()) {
      p.submission = null;
      p.votes = [];
      p.doneVoting = false;
    }
    this.round += 1;
    this.entries = [];
    this.results = null;
    this.prompt = pickPrompt(this.config, this.usedPrompts);
    this.setPhase('carving', this.config.roundSeconds * 1000, () => this.endCarving());
  }

  endCarving() {
    if (this.phase !== 'carving') return;
    this.setPhase('collecting', SUBMIT_GRACE_MS, () => this.beginVoting());
    this.checkProgress();
  }

  submit(player, pumpkin) {
    if (this.phase !== 'carving' && this.phase !== 'collecting') throw new GameError('Submissions are closed.');
    let data;
    try {
      data = pumpkinPayload(pumpkin);
    } catch (err) {
      if (err instanceof ValidationError) throw new GameError(err.message);
      throw err;
    }
    player.submission = { entryId: player.submission?.entryId ?? newId(), ...data };
    this.checkProgress();
    this.broadcast();
  }

  beginVoting() {
    if (this.phase !== 'carving' && this.phase !== 'collecting') return;
    const submitted = [...this.players.values()].filter((p) => p.submission);
    this.entries = shuffle(submitted.map((p) => ({ entryId: p.submission.entryId, playerId: p.id })));
    if (this.entries.length === 0) return this.showResults();
    this.setPhase('voting', this.config.voteSeconds * 1000, () => this.showResults());
    for (const p of this.connectedPlayers()) this.sendGallery(p);
  }

  vote(player, entryIds) {
    if (this.phase !== 'voting') throw new GameError('Voting is not open.');
    if (player.doneVoting) throw new GameError('Your votes are already locked in.');
    if (!Array.isArray(entryIds)) throw new GameError('Votes must be a list.');
    if (entryIds.length > this.config.votesPerPlayer) {
      throw new GameError(`You only get ${this.config.votesPerPlayer} votes.`);
    }
    for (const entryId of entryIds) {
      const entry = this.entries.find((e) => e.entryId === entryId);
      if (!entry) throw new GameError('That pumpkin does not exist.');
      if (entry.playerId === player.id) throw new GameError("You can't vote for your own pumpkin.");
    }
    player.votes = [...entryIds];
    this.sendState(player);
  }

  finishVoting(player) {
    if (this.phase !== 'voting') throw new GameError('Voting is not open.');
    player.doneVoting = true;
    this.checkProgress();
    this.broadcast();
  }

  showResults() {
    if (this.phase === 'results') return;
    const tally = new Map(this.entries.map((e) => [e.entryId, 0]));
    for (const p of this.players.values()) {
      for (const id of p.votes) if (tally.has(id)) tally.set(id, tally.get(id) + 1);
    }
    const rows = this.entries
      .map((e) => ({
        entryId: e.entryId,
        playerId: e.playerId,
        name: this.players.get(e.playerId)?.name ?? 'Someone',
        votes: tally.get(e.entryId),
      }))
      .sort((a, b) => b.votes - a.votes);
    // Ties share a rank: 1, 1, 3, ...
    rows.forEach((row, i) => {
      row.rank = i > 0 && row.votes === rows[i - 1].votes ? rows[i - 1].rank : i + 1;
    });
    this.results = rows;
    this.setPhase('results', null, null);
  }

  backToLobby(player) {
    this.requireHost(player);
    if (this.phase !== 'results') throw new GameError('Finish the round first.');
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    this.entries = [];
    this.results = null;
    this.prompt = null;
    this.setPhase('lobby', null, null);
  }

  sendMask(player, entryId) {
    if (this.phase !== 'voting' && this.phase !== 'results') throw new GameError('Nothing to show yet.');
    const entry = this.entries.find((e) => e.entryId === entryId);
    const sub = entry && this.players.get(entry.playerId)?.submission;
    if (!sub) throw new GameError('That pumpkin does not exist.');
    player.send({
      type: 'mask',
      entryId,
      mask: `data:image/png;base64,${sub.mask.toString('base64')}`,
      candleColor: sub.candleColor,
      skinColor: sub.skinColor,
      scene: sub.scene,
    });
  }

  // ---- progression ------------------------------------------------------

  /** Advances early once every connected player has done their part. */
  checkProgress() {
    const connected = this.connectedPlayers();
    if (connected.length === 0) return;
    if ((this.phase === 'carving' || this.phase === 'collecting') && connected.every((p) => p.submission)) {
      this.beginVoting();
    } else if (this.phase === 'voting' && connected.every((p) => p.doneVoting)) {
      this.showResults();
    }
  }

  setPhase(phase, durationMs, onExpire) {
    clearTimeout(this.timer);
    this.timer = null;
    this.phase = phase;
    this.deadline = durationMs ? this.now() + durationMs : null;
    if (durationMs) this.timer = setTimeout(onExpire, durationMs);
    this.broadcast();
  }

  // ---- outbound ---------------------------------------------------------

  publicState(forPlayer) {
    const showAuthors = this.phase === 'results';
    return {
      type: 'state',
      code: this.code,
      phase: this.phase,
      round: this.round,
      prompt: this.phase === 'lobby' ? null : this.prompt,
      // Only the host sees the custom list, so nobody can peek at upcoming prompts.
      config: { ...this.config, customPrompts: forPlayer.id === this.hostId ? this.config.customPrompts : [], customCount: this.config.customPrompts.length },
      hostId: this.hostId,
      you: forPlayer.id,
      remainingMs: this.deadline ? Math.max(0, this.deadline - this.now()) : null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        submitted: !!p.submission,
        doneVoting: p.doneVoting,
      })),
      myVotes: forPlayer.votes,
      results: showAuthors ? this.results : null,
    };
  }

  sendState(player) {
    if (player.connected) player.send(this.publicState(player));
  }

  broadcast() {
    for (const p of this.players.values()) this.sendState(p);
  }

  /** Thumbnails are sent once per voting phase rather than with every state update. */
  sendGallery(player) {
    player.send({
      type: 'gallery',
      round: this.round,
      entries: this.entries.map((e) => {
        const sub = this.players.get(e.playerId)?.submission;
        return {
          entryId: e.entryId,
          mine: e.playerId === player.id,
          thumb: sub ? `data:image/jpeg;base64,${sub.thumb.toString('base64')}` : null,
        };
      }),
    });
  }

  dispose() {
    clearTimeout(this.timer);
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class RoomManager {
  constructor({ now = Date.now } = {}) {
    this.rooms = new Map();
    this.now = now;
  }

  create(config) {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) throw new GameError('The server is busy. Try again in a few minutes.');
    let code;
    do {
      code = Array.from(crypto.randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, config, { now: this.now });
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return typeof code === 'string' ? this.rooms.get(code.trim().toUpperCase()) : undefined;
  }

  /** Removes rooms that have had nobody connected for a while. */
  sweep() {
    const cutoff = this.now() - EMPTY_ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && room.emptySince < cutoff) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}
