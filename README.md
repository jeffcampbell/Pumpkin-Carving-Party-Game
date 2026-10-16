# 🎃 Pumpkin Patch

Carve a 3D jack-o-lantern in the browser, pick a candle color, save it, and share
a link. There's also a party game: up to 8 people join a room, get the same prompt
and a timer, then vote on their favorites.

## Stack

One small Node process does everything:

- **Client:** vanilla JS + [Three.js](https://threejs.org), bundled by Vite (~150 KB gzipped).
- **Server:** Express (REST API + serves the client) and `ws` (game rooms).
- **Database:** Postgres on Supabase, through the plain `pg` driver. There's one
  table (`pumpkins`), and the server creates it on startup.

```
server/
  index.js        HTTP server, link-preview tags for /p/:id, Vite middleware in dev
  pumpkins.js     REST API: POST/PUT/GET /api/pumpkins, mask.png, thumb.jpg
  store.js        Postgres store (or in-memory when DATABASE_URL is unset)
  validate.js     payload checks shared by the API and the game
  game/rooms.js   room state machine (lobby → carving → voting → results)
  game/socket.js  WebSocket transport at /ws
  game/prompts.js carving prompts
src/
  pumpkin/        3D scene, pumpkin geometry/shaders, carving mask, tools
  ui/workbench.js the carving UI shared by solo mode and the game
  pages/          editor (/, /edit/:id), viewer (/p/:id), /mine, /game
db/schema.sql     table definition (applied automatically)
```

## How carving works

The pumpkin is a ribbed, squashed sphere. Carving paints a 2048×1024 grayscale
**mask** that wraps around it: black is untouched skin, greys are **etched** (skin
shaved off, so the flesh glows; each new etching pass goes one step deeper, three
steps in all, and a fourth pass breaks through to a hole), and white is **cut through**. A shader discards
cut pixels on the outer skin and on a slightly smaller inner wall, which gives
the cuts visible thickness. A point light inside acts as the candle. Brush
sizes are corrected for latitude, so a circle still looks round near the top.

| Tool | What it does |
|------|--------------|
| Saw | freehand cut-through line |
| Drill | round hole per tap |
| Cutters | punch a shape (triangle, circle, diamond, eye, toothy grin, star, moon, heart, bat), with size and tilt |
| Etcher | shave the skin; each pass goes deeper, and the fourth breaks through |
| Patch | put skin back |
| Rotate | orbit only (dragging off the pumpkin or right-dragging also orbits) |

After every cut, patch or etch that breaks through, a flood fill over the mask (wrapping at the seam and
joined through the poles) finds skin that's no longer attached to the main body.
Those pieces are removed from the mask and shown popping out and tumbling away.
A lid cut around the stem takes the stem with it. Undo/redo works by replaying
the recorded edits. Each piece's fall is a fixed function of time, with its
spin stored on the edit. So undoing a cut plays the fall in reverse (the piece
flies back into its hole before the cut closes), and redo drops it the same way again. Shortcuts: `1`–`6` pick a tool, `[` `]` change the size, `Ctrl/Cmd+Z` undoes and `Ctrl/Cmd+Shift+Z` redoes.

## Scenes

The pumpkin sits on a surface in one of six scenes: Studio, Kitchen table,
Witch's cottage, Graveyard, Pumpkin patch and Front porch (`shared/scenes.js`).
Each has a 360° backdrop, a few props, and its own lighting, all generated in
code from canvas drawings and simple geometry (`src/pumpkin/environments.js`),
so there are no image files to download. The candle casts shadows through the
shell, so light only escapes through the carving: the face is projected onto
the table and walls. Carve the back or look around behind the pumpkin to see
it. The scene is saved with the pumpkin, so share links and game entries show
it too.

## Saving and sharing (no accounts)

Saving stores the mask PNG, a front-view JPEG thumbnail, the colors and the scene, and
returns an **edit token**. The browser keeps the token in `localStorage`, so
whoever made a pumpkin can update it in place. Anyone else who opens
`/edit/:id` gets a remix, which saves as a new pumpkin. Share links (`/p/:id`)
include Open Graph tags, so they unfurl with the thumbnail in chat apps. The
work-in-progress pumpkin is also autosaved locally, so a refresh doesn't lose it.

## The party game

- The host creates a room with these settings: **carving time (default 2 min)**, **votes per
  player (default 3)**, room size (max 8), and voting time (default 60 s). The host can change
  them in the lobby.
- Players join with the 4-letter code or the invite link (`/game/ABCD`).
- Everyone gets the same prompt. Players can submit early and resubmit until the clock runs out.
  When time is up, clients auto-submit whatever they have, with a 5-second grace period.
- During voting, pumpkins are anonymous and you can tap one to inspect it in 3D. Votes
  can be stacked on one pumpkin, but not cast for your own. When voting closes, the
  results reveal who carved what, with tied entries sharing a rank. Players can save
  their round entry as a normal shareable pumpkin.
- If a player refreshes or drops, they rejoin automatically (a resume token is kept in `sessionStorage`).

Rooms live in server memory and are cleaned up 5 minutes after the last player
leaves. That's right for a single instance. If you ever run more than one
replica, you'll need sticky sessions or a shared store (e.g. Redis or Supabase
Realtime) for rooms.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000, API + game + Vite HMR in one process
npm test         # room logic unit tests + API/WebSocket integration tests
```

Without `DATABASE_URL`, pumpkins are stored in memory and are lost on restart.
To use a database locally, copy `.env.example`, fill it in, and run
`node --env-file=.env server/index.js --dev`.

## Deploying: Supabase + Railway

1. **Supabase:** create a project. Under *Connect*, copy the **Session pooler**
   connection string (port 5432). It works over IPv4, which Railway needs; the direct
   connection is IPv6-only. You don't need to run any SQL, because the server creates
   the table on boot with RLS enabled, which keeps the public REST API locked out.
   To create it yourself, paste `db/schema.sql` into the SQL editor.
2. **Railway:** create a service from this repo. Railway's Node builder runs
   `npm install`, `npm run build`, then `npm start`. Set these variables:
   - `DATABASE_URL`: the Supabase connection string
   - `PUBLIC_URL` (optional): e.g. `https://pumpkins.example.com`, used for absolute
     link-preview URLs (otherwise taken from the request host)
   - Don't set `NODE_ENV=production` at build time: it skips the devDependencies
     (Vite, Three.js) that the build needs. The server doesn't need it either.
3. Set the health check path to `/healthz`, which also pings the database.

Storage cost is small: a typical pumpkin is roughly 20–150 KB (mask + thumbnail).

## Limits and safety

- Request bodies are capped at 3 MB, masks at 1.5 MB, and thumbnails at 300 KB. PNG and JPEG signatures and hex colors are validated.
- Saves and updates are rate-limited to 20 per minute per IP.
- Edit tokens are stored only as SHA-256 hashes and compared in constant time.
- Each server holds at most 500 rooms. WebSocket messages are capped at 3 MB, with a heartbeat that drops dead sockets.
