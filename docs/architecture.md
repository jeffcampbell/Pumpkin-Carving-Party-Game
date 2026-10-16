# Architecture

One Node process serves the client, the REST API and the game WebSocket. In
development (`npm run dev`, which passes `--dev`), Vite runs as Express
middleware for hot reload. In production, the server serves the built `dist/`.

```
browser ──HTTP──▶ Express ─┬─ /api/pumpkins ──▶ store (Postgres or memory)
        │                  ├─ /p/:id  (index.html with Open Graph tags)
        │                  ├─ /healthz
        │                  └─ static client (or Vite in dev)
        └──WS /ws──▶ RoomManager (in memory)
```

## Carving

### The mask

A carving is a single **2048×1024 grayscale mask** (`src/pumpkin/mask.js`)
wrapped around the pumpkin with an equirectangular UV mapping. Each pixel's
value says how much has been removed:

| Value | Meaning |
|-------|---------|
| 0 | untouched skin |
| 96, 115, 134 | etched, levels 1 to 3 (`LEVEL.etch`, `ETCH_STEP` 19, `ETCH_MAX`) |
| ≥ 158 | cut through (`CUT_THRESHOLD`). Tools write 255. |

The mask is a `CanvasTexture`, so the GPU sees edits as soon as the canvas is
marked dirty. Brushes are drawn with their horizontal size divided by
`sin(latitude)`, so a circle stays round near the top and bottom. Strokes that
cross the u = 0/1 seam are drawn twice, once shifted by the texture width.

**Etching** is applied per stroke, not per dab. The stroke is drawn to a
separate "cover" canvas, and each covered pixel is set to `etchTarget(before)`,
using the value from before the stroke started. Overlapping dabs within one
stroke therefore count once, and each new stroke goes exactly one level deeper.
`etchTarget` rounds anti-aliased edge values to the nearest level, so soft edges
don't break through early. One step past `ETCH_MAX` becomes a cut.

### Undo and redo

Every edit is recorded as an op: stroke points, stamp parameters or clear. Undo
and redo reset the canvas and replay the ops. That keeps memory small, since no
per-step snapshots are stored, and it is fast enough for hundreds of ops.

### Loose pieces

After any edit that can cut (saw, drill, cutter, or an etch that broke through),
`settle()` runs `findIslands` (`src/pumpkin/islands.js`):

- A 4-connected flood fill labels every connected region of uncut pixels.
  Neighbors wrap across the u seam.
- All pixels in the top row touch the north pole, so they are one physical
  point. Islands touching the top row are merged with union-find, and the same
  is done for the bottom row.
- The **main body** is the island with the largest area weighted by
  `sin(latitude)`, which corrects for the equirectangular stretch near the poles.

Every other island is a loose piece. Its pixels are set to cut in the mask, and
the piece is cropped out as its own small mask texture. The op is flagged
`drop`, with a random tumble stored on it. The stem is shown only while the top
row still has uncut skin, so cutting a lid takes the stem with it.

### Falling and rewinding

A falling piece is drawn as a copy of the pumpkin shell that uses the piece's
own mask. Its pose is a **pure function of age**
(`PumpkinStage.posePiece`): a closed-form ballistic arc with the stored tumble,
then landing on the scene floor and sliding to a stop. Because nothing is
integrated frame by frame:

- **Undo** of a `drop` op plays the same function backwards with an ease-out
  curve, so the piece flies back into its hole. Only then is the cut removed
  from the mask.
- **Redo** plays it forwards again, identically.
- Undoing mid-fall just reverses from the current age.

Any other action finishes a rewind in progress immediately.

## Rendering

`src/pumpkin/stage.js` builds the scene with Three.js.

- **Geometry** (`geometry.js`): a sphere with 10 ribs, squashed vertically. An
  inner shell at 93% scale gives cuts visible wall thickness, and the stem is a
  separate mesh.
- **Shell materials** are `MeshStandardMaterial` extended with `onBeforeCompile`:
  - Cut pixels are discarded on both the outer and inner shells.
  - Etched pixels get a flesh color, a bevel computed from the mask as a height
    map, and an emissive translucency term that depends on depth, viewing angle
    and a fibre noise. That makes them glow like thin flesh with a candle behind it.
  - The skin texture is generated on a canvas at startup.
- **Candle:** a `PointLight` inside the pumpkin that casts shadows. The shells
  use a custom distance material that discards cut pixels, so light escapes only
  through the carving and projects the design onto the scene. The shadow map
  re-renders only when the mask changes or the scene switches.
- **Thumbnails** are rendered from the front view at save time and stored as JPEG.

## Scenes

`shared/scenes.js` lists scene IDs, which both the client and the server use for
validation. `src/pumpkin/environments.js` builds each scene:

- A 360° backdrop painted on a large canvas (4096×700) and mapped to the inside
  of a cylinder.
- A floor or table and a few 3D props, such as candles, small pumpkins,
  headstones, a hay bale or a cauldron.
- Lighting settings: hemisphere, key and fill lights, fog and exposure.

Nothing is downloaded. Scenes are built on demand and disposed when you switch.

## Data model

One Postgres table, defined in `db/schema.sql` and applied idempotently on boot:

| Column | Notes |
|--------|-------|
| `id` | 8-character random base64url |
| `title` | up to 60 characters |
| `mask_png` | the carving mask as PNG bytes |
| `thumb_jpg` | front-view thumbnail |
| `candle_color`, `skin_color` | `#rrggbb` |
| `scene` | a scene ID. Defaults to `studio` for rows saved before scenes existed. |
| `edit_token_hash` | SHA-256 of the creator's edit token |
| `created_at`, `updated_at` | timestamps |

Row-level security is enabled with no policies. The app connects as the
database owner, but Supabase's public REST API can't read the table.

## REST API

All bodies are JSON. Errors are `{ "error": "message" }`.

| Method and path | Description |
|-----------------|-------------|
| `POST /api/pumpkins` | Create. Body: `{ mask, thumb, candleColor, skinColor, scene, title }`, where `mask` is a PNG data URL and `thumb` is a JPEG data URL. Returns `201` with the metadata plus `editToken`. |
| `PUT /api/pumpkins/:id` | Update. Same body, with the `x-edit-token` header required. Returns `403` if the token is wrong. |
| `GET /api/pumpkins/:id` | Metadata: `{ id, title, candleColor, skinColor, scene, createdAt, updatedAt }`. |
| `GET /api/pumpkins/:id/mask.png` | Mask image. With `?v=<updatedAt>` it is cached as immutable. |
| `GET /api/pumpkins/:id/thumb.jpg` | Thumbnail, cached the same way. |
| `GET /healthz` | `200` when the server and database are reachable. |

Limits: request bodies up to 3 MB, masks up to 1.5 MB, thumbnails up to 300 KB.
PNG and JPEG signatures are checked. Writes are limited to 20 per minute per IP.

## Game protocol

Rooms live in memory in `server/game/rooms.js`, and `server/game/socket.js`
carries JSON messages over `/ws`.

### Phases

```
lobby ─start─▶ carving ─timer─▶ collecting (5 s) ─▶ voting ─▶ results ─┬─start─▶ carving
                  └──── everyone submitted ────────▶ │                └─lobby─▶ lobby
                                                     └── everyone locked in ──▶ results
```

`collecting` is a grace period. Clients see the timer hit zero and auto-submit
whatever they have.

### Client → server

The first message on a socket must be `create` or `join`.

| Message | Who | Notes |
|---------|-----|-------|
| `{ type: 'create', name, config }` | anyone | `config`: `{ roundSeconds, votesPerPlayer, maxPlayers, voteSeconds }`. Values are clamped to the allowed ranges. |
| `{ type: 'join', code, name, token? }` | anyone | A `token` from an earlier `welcome` resumes the same seat. |
| `{ type: 'config', config }` | host | Lobby only. |
| `{ type: 'start' }` | host | From the lobby or results. Needs 2 or more connected players. |
| `{ type: 'submit', pumpkin }` | player | `pumpkin` has the same shape as the REST body. Can be resent until submissions close. |
| `{ type: 'vote', entryIds }` | player | Replaces your votes. Repeats are allowed, own entry is not, and there are at most `votesPerPlayer`. |
| `{ type: 'doneVoting' }` | player | Locks in your votes. |
| `{ type: 'getMask', entryId }` | player | During voting or results, to inspect an entry in 3D. |
| `{ type: 'lobby' }` | host | From results. |

### Server → client

| Message | Notes |
|---------|-------|
| `welcome` | `{ code, playerId, token }`. The client keeps the token in `sessionStorage` for resuming. |
| `state` | Sent on every change: `phase`, `round`, `prompt`, `config`, `hostId`, `you`, `remainingMs`, `players[]` (with `submitted` and `doneVoting` flags), `myVotes`, and `results` (results phase only). |
| `gallery` | Once per voting phase: `{ round, entries: [{ entryId, mine, thumb }] }`. Entries are shuffled and anonymous. |
| `mask` | Reply to `getMask`: `{ entryId, mask, candleColor, skinColor, scene }`. |
| `error` | `{ message }`, shown to the player as a toast. |

Authors are revealed only in `results`. Rooms are removed 5 minutes after the
last player disconnects, and a server holds at most 500 rooms. A 25-second
ping/pong heartbeat drops dead sockets.

## Tests

`npm test` runs `node:test` suites in `test/`:

- `rooms.test.js`: the room state machine, using mocked timers.
- `api.test.js`: REST endpoints and share-page tags against a real server, plus creating and joining a room over the WebSocket.
- `islands.test.js`: loose-piece detection, including seam wrap and the poles.
- `etch.test.js`: etch level stepping and break-through.
