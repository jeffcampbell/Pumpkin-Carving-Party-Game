# Deploying to Railway and Supabase

The app is a single Node service plus one Postgres table. A typical saved
pumpkin is 20 to 150 KB (mask plus thumbnail), so the free tiers go a long way.

## 1. Supabase (database)

1. Create a project.
2. Open **Connect** and copy the **Session pooler** connection string (port 5432).
   - Use the session pooler, not the direct connection. The direct connection is
     IPv6-only, and Railway connects over IPv4.
   - Replace `[YOUR-PASSWORD]` with the database password.
3. That's all. The server creates the `pumpkins` table on startup and applies
   any new columns, with row-level security enabled, so Supabase's public REST
   API can't read it. To create the table yourself, paste `db/schema.sql` into
   the SQL editor. It's safe to re-run.

## 2. Railway (app)

1. Create a new service from this GitHub repo. Railway's Node builder runs
   `npm install`, `npm run build` and `npm start`.
2. Set the variables:

   | Variable | Required | Value |
   |----------|----------|-------|
   | `DATABASE_URL` | yes | the Supabase session pooler string |
   | `PUBLIC_URL` | no | the public origin, e.g. `https://pumpkins.example.com`. Used for absolute URLs in link previews. If it isn't set, the request's host is used. |
   | `PORT` | no | Railway sets this for you |

3. Don't set `NODE_ENV=production` for the build. Doing so makes `npm install`
   skip devDependencies, and Vite and Three.js are needed to build the client.
   The server doesn't use `NODE_ENV`.
4. Under **Settings → Deploy**, set the health check path to `/healthz`. It
   returns 200 only when the database answers.
5. Generate a domain, or attach your own, and open it.

If `DATABASE_URL` is missing, the server still starts but keeps pumpkins in
memory and logs a warning. Saved pumpkins then disappear on every deploy.

## Scaling notes

- **Game rooms are in memory** in the one process. That's fine for a single
  Railway instance, which can handle many rooms (the cap is 500). If you run
  several replicas, players in the same room must reach the same instance.
  Either use sticky sessions or move room state to a shared store such as
  Redis or Supabase Realtime.
- A deploy or restart ends any games in progress. Saved pumpkins are unaffected.
- The rate limit (20 saves per minute per IP) is also per process. The server
  trusts the proxy's `X-Forwarded-For` header, so client IPs are correct behind
  Railway.
- Mask and thumbnail URLs include a version parameter and are served with
  long-lived immutable caching, so putting a CDN in front works without extra
  setup.

## Running in production mode locally

```bash
npm run build
DATABASE_URL=postgresql://... npm start   # serves dist/ on http://localhost:3000
```
