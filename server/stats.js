// Site stats for the /stats page.
//
// Counters are stored per day (daily_stats) and summed for totals. Visitors are
// counted once per day without cookies: a salted one-way hash of IP + user agent
// + date, kept only long enough to de-duplicate (see visitor_days) and never
// linkable across days. Pumpkin numbers come straight from the pumpkins table.

import crypto from 'node:crypto';

const NIGHTS = 30;
const CACHE_MS = 30_000;
const MAX_SEEN = 50_000;
// Link unfurlers, crawlers, uptime checks and scripts aren't visitors.
const NOT_A_PERSON = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|curl|wget|python|go-http|node-fetch|axios|undici|headless|lighthouse|monitor|uptime|pingdom/i;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

export class Stats {
  constructor(store, { secret = process.env.STATS_SALT || process.env.DATABASE_URL || 'local', now = Date.now, live = () => null } = {}) {
    this.store = store;
    this.secret = secret;
    this.now = now;
    this.live = live;
    this.seen = { day: null, visitors: new Set() }; // saves a DB round trip on repeat page loads
    this.cache = null;
  }

  /** Adds `by` to today's counter. Never throws: stats must not break the app. */
  track = (name, by = 1) => {
    if (!by) return;
    this.store.bumpStat(dayOf(this.now()), name, by).catch((err) => console.warn('[stats]', err.message));
  };

  /** Called for each page load. */
  visit(req) {
    const ua = req.get('user-agent') ?? '';
    if (!ua || NOT_A_PERSON.test(ua)) return;
    const day = dayOf(this.now());
    if (this.seen.day !== day) {
      this.seen = { day, visitors: new Set() };
      this.store.forgetVisitorsBefore(dayOf(this.now() - DAY_MS)).catch((err) => console.warn('[stats]', err.message));
    }
    const visitor = crypto.createHmac('sha256', this.secret).update(`${day}|${req.ip}|${ua}`).digest('base64url').slice(0, 22);
    if (this.seen.visitors.has(visitor)) return;
    if (this.seen.visitors.size >= MAX_SEEN) this.seen.visitors.clear();
    this.seen.visitors.add(visitor);
    this.store
      .addVisitor(day, visitor)
      .then((isNew) => isNew && this.track('visitors'))
      .catch((err) => console.warn('[stats]', err.message));
  }

  async summary() {
    if (!this.cache || this.now() - this.cache.at > CACHE_MS) {
      this.cache = { at: this.now(), data: this.build() };
      this.cache.data.catch(() => (this.cache = null));
    }
    return { ...(await this.cache.data), live: this.live() };
  }

  async build() {
    const end = this.now();
    const days = Array.from({ length: NIGHTS }, (_, i) => dayOf(end - (NIGHTS - 1 - i) * DAY_MS));
    const raw = await this.store.statSummary(days[0]);
    const daily = new Map(raw.daily.map((d) => [`${d.day}|${d.name}`, d.value]));
    const carvedOn = new Map(raw.pumpkins.perDay.map((d) => [d.day, d.count]));
    const t = (name) => raw.totals[name] ?? 0;
    const firstPumpkin = raw.pumpkins.first ? dayOf(new Date(raw.pumpkins.first).getTime()) : null;
    return {
      since: [raw.firstDay, firstPumpkin].filter(Boolean).sort()[0] ?? null,
      totals: {
        visitors: t('visitors'),
        pumpkinsSaved: raw.pumpkins.count,
        gamePumpkins: t('game_pumpkins'),
        roomsCreated: t('rooms_created'),
        roundsPlayed: t('rounds_played'),
        playersJoined: t('players_joined'),
        votesCast: t('votes_cast'),
      },
      lastCarvedAt: raw.pumpkins.last,
      nights: days.map((day) => ({
        day,
        visitors: daily.get(`${day}|visitors`) ?? 0,
        pumpkins: (carvedOn.get(day) ?? 0) + (daily.get(`${day}|game_pumpkins`) ?? 0),
        rounds: daily.get(`${day}|rounds_played`) ?? 0,
      })),
      scenes: raw.pumpkins.scenes.map(({ key, count }) => ({ scene: key, count })),
      candles: raw.pumpkins.candles.map(({ key, count }) => ({ color: key, count })),
    };
  }
}
