# Deploying to Railway and Supabase

The app is a single Node service plus one Postgres table. Set up as described
here, it runs for about **$5 a month**: Railway's Hobby plan, whose fee
includes $5 of usage, and Supabase's free tier. A typical saved pumpkin is 20
to 150 KB (mask plus thumbnail), so the free 500 MB database holds thousands.

| Piece | Where | Plan |
|-------|-------|------|
| App (web server, API, game WebSockets) | Railway, US East | Hobby, sleeps when idle |
| Database | Supabase, `us-east-1` | Free |
| Keep-awake ping | GitHub Actions | Free (about 10 of 2,000 minutes a month) |

Keep the app and the database in the same area (here both are in US East) so
queries stay fast.

## 1. Supabase (database)

**Dashboard:** create a project, open **Connect**, and copy the **Session
pooler** connection string (port 5432), with your database password in place
of `[YOUR-PASSWORD]`.

**CLI:**

```bash
supabase projects create pumpkin-carving-party-game --org-id <org> --region us-east-1 --db-password <password>
supabase link --project-ref <ref> --password <password>   # writes supabase/.temp/pooler-url
```

The pooler URL has no password in it. Add it as
`postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.

Notes:

- Use the **session pooler**, not the direct connection. The direct connection
  is IPv6-only, and Railway connects over IPv4.
- Stick to letters and digits in the password so it doesn't need URL-encoding.
- You don't need to run any SQL. The server creates the `pumpkins` table on
  startup and applies new columns, with row-level security enabled, so
  Supabase's public REST API can't read it. To do it by hand, paste
  `db/schema.sql` into the SQL editor. It's safe to re-run.

## 2. Railway (app)

Deploy settings live in [`railway.json`](../railway.json) in the repo:

- build with `npm run build` and start with `npm start`
- health check at `/healthz`, which returns 200 only when the database answers
- one replica, restarted on failure
- **app sleeping** turned on: no compute charges while nobody is using it.
  The first visitor after a quiet spell waits a few seconds while it starts,
  and an active game keeps it awake.
- capped at 1 vCPU and 512 MB of memory, so a bug can't run up the bill

To set it up:

1. Create a project and an empty service, and link this folder to it:
   ```bash
   railway init -n pumpkin-carving-party-game
   railway add --service web
   railway service link web
   ```
2. Set the region and variables:
   ```bash
   railway scale us-east=1
   railway variable set DATABASE_URL --stdin --skip-deploys   # paste the pooler URL, then Ctrl+D
   railway domain                                            # generates https://<name>.up.railway.app
   railway variable set PUBLIC_URL=https://<name>.up.railway.app
   ```
3. Connect the GitHub repo so every push to `main` deploys:
   ```bash
   railway service source connect --repo <owner>/Pumpkin-Carving-Party-Game --branch main --service web
   ```
   For a private repo, Railway's GitHub app needs access first. On GitHub, go to
   **Settings → Applications → Railway → Configure** and add the repo. Until
   then, `railway up` deploys straight from your local folder.

| Variable | Required | Value |
|----------|----------|-------|
| `DATABASE_URL` | yes | the Supabase session pooler string |
| `PUBLIC_URL` | no | the public origin. Used for absolute URLs in link previews. If it isn't set, the request's host is used. |
| `PORT` | no | Railway sets this for you |

Don't set `NODE_ENV=production`. It makes `npm install` skip devDependencies,
and Vite and Three.js are needed for the build. The server doesn't use it.

If `DATABASE_URL` is missing, the server still starts but keeps pumpkins in
memory and logs a warning. Saved pumpkins then disappear on every deploy.

Also set a **usage limit** in your Railway workspace's billing settings as a
backstop.

## 3. Keep-awake ping (GitHub Actions)

Supabase pauses free projects after a week without activity. Once paused,
saving and share links fail until someone clicks **Restore** in the dashboard.
[`.github/workflows/keep-awake.yml`](../.github/workflows/keep-awake.yml) calls
`/healthz` every 3 days. That wakes the Railway app and runs a database query.

It reads the app's address from the `APP_URL` repository variable:

```bash
gh variable set APP_URL --body https://<name>.up.railway.app
```

To test it, run **Actions → Keep awake → Run workflow** on GitHub, or use
`gh workflow run keep-awake.yml`. A failed run (for example, if the database
is already paused) shows up as a failed workflow, and GitHub emails you about it.

## Scaling notes

- **Game rooms are in memory** in the one process. That's fine for a single
  instance, which can handle many rooms (the cap is 500). If you run several
  replicas, players in the same room must reach the same instance. Either use
  sticky sessions or move room state to a shared store such as Redis or
  Supabase Realtime. If you add replicas, raise `numReplicas` in `railway.json`.
- A deploy or restart ends any games in progress. Saved pumpkins are
  unaffected. The app only sleeps when nobody is connected, so sleeping never
  interrupts a game.
- The rate limit (20 saves per minute per IP) is also per process. The server
  trusts the proxy's `X-Forwarded-For` header, so client IPs are correct behind
  Railway.
- Mask and thumbnail URLs include a version parameter and are served with
  long-lived immutable caching, so putting a CDN in front works without extra
  setup.

## Running in production mode locally

```bash
npm run build
node --env-file=.env server/index.js   # serves dist/ on http://localhost:3000
```
