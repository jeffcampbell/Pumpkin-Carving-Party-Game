// REST API for saved pumpkins.
//
// There are no accounts: creating a pumpkin returns a secret edit token that the
// creator's browser keeps. Anyone with the link can view; only the token holder
// can overwrite it.

import crypto from 'node:crypto';
import express from 'express';
import * as validate from './validate.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{8,16}$/;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newId = () => crypto.randomBytes(6).toString('base64url'); // 8 chars

function tokenMatches(token, expectedHash) {
  if (typeof token !== 'string' || !expectedHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Fixed-window rate limit per IP, to keep one client from filling the database. */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) ?? 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'Slow down a little and try again in a minute.' });
    next();
  };
}

export function pumpkinRoutes(store) {
  const router = express.Router();
  const writeLimit = rateLimit({ windowMs: 60_000, max: 20 });

  router.param('id', (req, res, next, id) => {
    if (!ID_PATTERN.test(id)) return res.status(404).json({ error: 'Pumpkin not found' });
    next();
  });

  router.post('/', writeLimit, async (req, res) => {
    const fields = { ...validate.pumpkinPayload(req.body), title: validate.title(req.body.title) };
    const editToken = crypto.randomBytes(24).toString('base64url');
    const meta = await store.create({ id: newId(), ...fields, editTokenHash: hashToken(editToken) });
    res.status(201).json({ ...meta, editToken });
  });

  router.put('/:id', writeLimit, async (req, res) => {
    const expected = await store.getEditTokenHash(req.params.id);
    if (!expected) return res.status(404).json({ error: 'Pumpkin not found' });
    if (!tokenMatches(req.get('x-edit-token'), expected)) {
      return res.status(403).json({ error: "You can't edit this pumpkin. Save it as a new one instead." });
    }
    const fields = { ...validate.pumpkinPayload(req.body), title: validate.title(req.body.title) };
    res.json(await store.update(req.params.id, fields));
  });

  router.get('/:id', async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Pumpkin not found' });
    res.json(meta);
  });

  for (const [kind, file, type] of [['mask', 'mask.png', 'image/png'], ['thumb', 'thumb.jpg', 'image/jpeg']]) {
    router.get(`/:id/${file}`, async (req, res) => {
      const image = await store.getImage(req.params.id, kind);
      if (!image) return res.status(404).end();
      // Clients add ?v=<updatedAt>, so a versioned URL never changes content.
      res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
      res.type(type).send(image.data);
    });
  }

  router.use((err, req, res, next) => {
    if (err instanceof validate.ValidationError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That pumpkin is too big to save.' });
    next(err);
  });

  return router;
}
