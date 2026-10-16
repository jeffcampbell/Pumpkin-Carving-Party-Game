// Single process: REST API + game WebSocket + the client app.
// `npm run dev` serves the client through Vite middleware (with HMR);
// `npm start` serves the built files from dist/.

import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { createStore } from './store.js';
import { pumpkinRoutes } from './pumpkins.js';
import { attachGameServer } from './game/socket.js';
import { Stats } from './stats.js';

const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 3000;
const root = new URL('..', import.meta.url).pathname;
const dist = new URL('../dist/', import.meta.url).pathname;

const store = await createStore();
const stats = new Stats(store);
const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', 1); // Railway terminates TLS in front of us

app.get('/healthz', async (req, res) => {
  try {
    await store.ping();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api', express.json({ limit: '3mb' }));
app.use('/api/pumpkins', pumpkinRoutes(store));
app.get('/api/stats', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=15');
    res.json(await stats.summary());
  } catch (err) {
    next(err);
  }
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const game = attachGameServer(server, { track: stats.track });
stats.live = () => game.rooms.live();

// ---- client app -----------------------------------------------------------

let renderIndex;
if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'custom',
  });
  app.use(vite.middlewares);
  renderIndex = async (url) => vite.transformIndexHtml(url, fs.readFileSync(`${root}/index.html`, 'utf8'));
} else {
  if (!fs.existsSync(`${dist}/index.html`)) {
    console.error('dist/index.html is missing — run `npm run build` first.');
    process.exit(1);
  }
  const html = fs.readFileSync(`${dist}/index.html`, 'utf8');
  app.use('/assets', express.static(`${dist}/assets`, { immutable: true, maxAge: '1y' }));
  app.use(express.static(dist, { index: false }));
  renderIndex = async () => html;
}

// Every other GET is a client-side route. Shared pumpkin links get link-preview
// tags so they unfurl nicely in chat apps.
app.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  try {
    stats.visit(req);
    let html = await renderIndex(req.originalUrl);
    const match = req.path.match(/^\/p\/([A-Za-z0-9_-]{8,16})$/);
    const meta = match && (await store.getMeta(match[1]));
    if (meta) html = html.replace('<!--og-->', ogTags(req, meta));
    res.type('html').send(html);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That pumpkin is too big to save.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

function ogTags(req, meta) {
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  const title = meta.title || 'A jack-o-lantern';
  const v = new Date(meta.updatedAt).getTime();
  const tags = {
    'og:title': title,
    'og:description': 'Carved on Pumpkin Patch. Carve your own!',
    'og:image': `${origin}/api/pumpkins/${meta.id}/thumb.jpg?v=${v}`,
    'og:url': `${origin}/p/${meta.id}`,
    'twitter:card': 'summary_large_image',
  };
  return Object.entries(tags)
    .map(([k, val]) => `<meta property="${k}" content="${escapeHtml(val)}">`)
    .join('\n    ');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

server.listen(PORT, () => console.log(`Pumpkin Patch listening on http://localhost:${PORT}${DEV ? ' (dev)' : ''}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
