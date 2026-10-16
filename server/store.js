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
}

class MemoryStore {
  constructor() {
    this.rows = new Map();
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

  meta({ id, title, candleColor, skinColor, scene, createdAt, updatedAt }) {
    return { id, title, candleColor, skinColor, scene, createdAt, updatedAt };
  }
}
