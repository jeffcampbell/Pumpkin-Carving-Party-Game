// Pumpkin storage. Uses Postgres (Supabase) when DATABASE_URL is set, otherwise
// an in-memory map so local development needs no database.

import fs from 'node:fs';
import pg from 'pg';

const SCHEMA = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

export async function createStore() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[store] DATABASE_URL not set — saved pumpkins live in memory and vanish on restart.');
    return new MemoryStore();
  }
  const store = new PgStore(url);
  await store.init();
  return store;
}

const META_COLUMNS = 'id, title, candle_color, skin_color, scene, created_at, updated_at';

function toMeta(row) {
  return {
    id: row.id,
    title: row.title,
    candleColor: row.candle_color,
    skinColor: row.skin_color,
    scene: row.scene,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class PgStore {
  constructor(connectionString) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
    this.pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_SIZE) || 5,
      ssl: local ? false : { rejectUnauthorized: false },
    });
  }

  async init() {
    await this.pool.query(SCHEMA);
  }

  async create({ id, title, mask, thumb, candleColor, skinColor, scene, editTokenHash }) {
    const { rows } = await this.pool.query(
      `insert into pumpkins (id, title, mask_png, thumb_jpg, candle_color, skin_color, scene, edit_token_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${META_COLUMNS}`,
      [id, title, mask, thumb, candleColor, skinColor, scene, editTokenHash],
    );
    return toMeta(rows[0]);
  }

  async update(id, { title, mask, thumb, candleColor, skinColor, scene }) {
    const { rows } = await this.pool.query(
      `update pumpkins set title = $2, mask_png = $3, thumb_jpg = $4, candle_color = $5, skin_color = $6,
         scene = $7, updated_at = now() where id = $1 returning ${META_COLUMNS}`,
      [id, title, mask, thumb, candleColor, skinColor, scene],
    );
    return rows[0] ? toMeta(rows[0]) : null;
  }

  async getMeta(id) {
    const { rows } = await this.pool.query(`select ${META_COLUMNS} from pumpkins where id = $1`, [id]);
    return rows[0] ? toMeta(rows[0]) : null;
  }

  async getEditTokenHash(id) {
    const { rows } = await this.pool.query('select edit_token_hash from pumpkins where id = $1', [id]);
    return rows[0]?.edit_token_hash ?? null;
  }

  async getImage(id, kind) {
    const column = kind === 'mask' ? 'mask_png' : 'thumb_jpg';
    const { rows } = await this.pool.query(`select ${column} as data, updated_at from pumpkins where id = $1`, [id]);
    return rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : null;
  }

  async ping() {
    await this.pool.query('select 1');
  }

  // ---- stats --------------------------------------------------------------

  async bumpStat(day, name, by) {
    await this.pool.query(
      `insert into daily_stats (day, name, value) values ($1, $2, $3)
       on conflict (day, name) do update set value = daily_stats.value + excluded.value`,
      [day, name, by],
    );
  }

  /** Records a visitor for the day; true the first time they're seen that day. */
  async addVisitor(day, visitor) {
    const { rowCount } = await this.pool.query(
      'insert into visitor_days (day, visitor) values ($1, $2) on conflict do nothing',
      [day, visitor],
    );
    return rowCount === 1;
  }

  async forgetVisitorsBefore(day) {
    await this.pool.query('delete from visitor_days where day < $1', [day]);
  }

  async statSummary(sinceDay) {
    const [totals, daily, pumpkins, perDay, scenes, candles] = await Promise.all([
      this.pool.query('select name, sum(value)::bigint as value, min(day)::text as first from daily_stats group by name'),
      this.pool.query('select day::text, name, value from daily_stats where day >= $1', [sinceDay]),
      this.pool.query('select count(*)::int as count, min(created_at) as first, max(created_at) as last from pumpkins'),
      this.pool.query(
        `select (created_at at time zone 'utc')::date::text as day, count(*)::int as count
         from pumpkins where created_at >= $1 group by 1`,
        [sinceDay],
      ),
      this.pool.query('select scene as key, count(*)::int as count from pumpkins group by 1 order by 2 desc'),
      this.pool.query('select lower(candle_color) as key, count(*)::int as count from pumpkins group by 1 order by 2 desc limit 6'),
    ]);
    return {
      totals: Object.fromEntries(totals.rows.map((r) => [r.name, Number(r.value)])),
      firstDay: totals.rows.reduce((min, r) => (!min || r.first < min ? r.first : min), null),
      daily: daily.rows.map((r) => ({ day: r.day, name: r.name, value: Number(r.value) })),
      pumpkins: { ...pumpkins.rows[0], perDay: perDay.rows, scenes: scenes.rows, candles: candles.rows },
    };
  }
}

class MemoryStore {
  constructor() {
    this.rows = new Map();
    this.stats = new Map(); // "day|name" -> count
    this.visitors = new Set(); // "day|visitor"
  }

  async create({ id, title, mask, thumb, candleColor, skinColor, scene, editTokenHash }) {
    const now = new Date();
    const row = { id, title, mask, thumb, candleColor, skinColor, scene, editTokenHash, createdAt: now, updatedAt: now };
    this.rows.set(id, row);
    return this.meta(row);
  }

  async update(id, fields) {
    const row = this.rows.get(id);
    if (!row) return null;
    Object.assign(row, fields, { updatedAt: new Date() });
    return this.meta(row);
  }

  async getMeta(id) {
    const row = this.rows.get(id);
    return row ? this.meta(row) : null;
  }

  async getEditTokenHash(id) {
    return this.rows.get(id)?.editTokenHash ?? null;
  }

  async getImage(id, kind) {
    const row = this.rows.get(id);
    return row ? { data: row[kind], updatedAt: row.updatedAt } : null;
  }

  async ping() {}

  async bumpStat(day, name, by) {
    const key = `${day}|${name}`;
    this.stats.set(key, (this.stats.get(key) ?? 0) + by);
  }

  async addVisitor(day, visitor) {
    const key = `${day}|${visitor}`;
    if (this.visitors.has(key)) return false;
    this.visitors.add(key);
    return true;
  }

  async forgetVisitorsBefore(day) {
    for (const key of this.visitors) if (key.split('|')[0] < day) this.visitors.delete(key);
  }

  async statSummary(sinceDay) {
    const totals = {};
    const daily = [];
    let firstDay = null;
    for (const [key, value] of this.stats) {
      const [day, name] = key.split('|');
      totals[name] = (totals[name] ?? 0) + value;
      if (!firstDay || day < firstDay) firstDay = day;
      if (day >= sinceDay) daily.push({ day, name, value });
    }
    const rows = [...this.rows.values()];
    const tally = (keyOf) => [...rows.reduce((m, r) => m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1), new Map())]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
    const times = rows.map((r) => r.createdAt.getTime());
    return {
      totals,
      firstDay,
      daily,
      pumpkins: {
        count: rows.length,
        first: times.length ? new Date(Math.min(...times)) : null,
        last: times.length ? new Date(Math.max(...times)) : null,
        perDay: tally((r) => r.createdAt.toISOString().slice(0, 10)).filter((d) => d.key >= sinceDay).map(({ key, count }) => ({ day: key, count })),
        scenes: tally((r) => r.scene),
        candles: tally((r) => r.candleColor.toLowerCase()).slice(0, 6),
      },
    };
  }

  meta({ id, title, candleColor, skinColor, scene, createdAt, updatedAt }) {
    return { id, title, candleColor, skinColor, scene, createdAt, updatedAt };
  }
}
