# Doodad API

Doodad's receiving service, on Cloudflare (a Worker and a D1 database). It takes the small reports the Doodad app sends, checks each one against the same allowlist the app uses, and keeps it. The app's side is in the Doodad repo: `docs/27-telemetry.md` (what's collected and why), decisions D115 and D131, and `packages/telemetry` (the allowlist).

## What it has to do (requirements)

**Published builds collect the minimum (D131):**

| What | When the app sends it | What's in it | What this service keeps |
|---|---|---|---|
| **Install** (`POST /v1/install`) | Once, after the first run, unless the person switched it off | Doodad's version and channel, OS, OS major version, arch, the install week | **A count only:** one row per day, week, version and platform, with how many. No single install is stored. |
| **Feedback** (`POST /v1/report`, `kind: feedback`) | When someone presses Send in Settings › Privacy › Send feedback | Their own words, an optional reply email, the version and kind of computer | The report as checked, with the day it came |
| **Problem reports** (`POST /v1/report`, `kind: problem` or `crash`) | When someone presses Send after reading it all | Their note, optional email, lines they chose to leave in | The report as checked |

Also accepted, because the app has them (all off or by hand in published builds): weekly usage stats (`/v1/usage`, opt-in), failed changes given by hand (`/v1/donation`), and alpha diagnostics (`/v1/incident`, alpha builds only).

**Rules it keeps:**

- **No IPs, user agents, locations or IDs.** The Worker reads only the path, method, content type and body. Cloudflare's request logs (which would hold IPs) are off in `wrangler.toml` (`observability.enabled = false`); don't turn on Logpush for this Worker.
- **Days, not times.** Everything is stored with the UTC day it arrived, never the moment.
- **Only what the allowlist allows.** Every body is checked against `src/schema.ts` (a copy of the app's `packages/telemetry`); anything extra, the wrong shape, or too big is turned away and nothing is kept.
- **The app's contract:** `202` kept; `400` doesn't pass and `413` too big (the app drops it); `404`/`405` wrong path or method; `503` couldn't keep it (the app tries again later, waiting longer each time). `GET /health` answers `200`.

## Run it

```sh
pnpm install
pnpm test        # the Worker's checks, with a stand-in for D1
pnpm typecheck
```

When the app's allowlist changes (`packages/telemetry` in the Doodad repo), copy it here and deploy:

```sh
pnpm sync-schema   # expects ../Doodad beside this repo, or DOODAD_REPO=/path/to/Doodad
```

## Deploy (once)

Needs a Cloudflare account with `thedoodad.com` on it.

1. `npx wrangler login` (and `npx wrangler telemetry disable`, so wrangler itself doesn't report usage).
2. `npx wrangler d1 create doodad-api`, then put the `database_id` it prints into `wrangler.toml`.
3. `pnpm db:migrate` (makes the tables in the real database).
4. `pnpm deploy`. The `routes` entry gives it `https://api.thedoodad.com`, which is where the app sends (`TELEMETRY_URL` in the Doodad repo's `apps/desktop/src/main/telemetry/telemetry.ts`).
5. Check: `curl https://api.thedoodad.com/health` says `{"message":"ok"}`.

**Abuse:** the endpoints take no credentials, so anyone could post well-formed reports. Add a Cloudflare rate-limiting rule on `api.thedoodad.com/v1/*` (Security › WAF › Rate limiting rules; for example, 20 requests a minute per IP, block for 10 minutes). Cloudflare applies it at the edge; this Worker still never sees or stores the IP.

## Reading what came in

```sh
# Installs by week and platform
npx wrangler d1 execute doodad-api --remote --command \
  "SELECT week, os, arch, SUM(count) AS installs FROM installs GROUP BY week, os, arch ORDER BY week"

# The latest feedback
npx wrangler d1 execute doodad-api --remote --command \
  "SELECT received, json_extract(body, '$.note') AS note, json_extract(body, '$.replyTo') AS reply_to FROM reports WHERE kind = 'feedback' ORDER BY id DESC LIMIT 20"
```

Feedback can hold an email address someone chose to give: keep the database's access to the people who answer it, and delete feedback once it's dealt with (`DELETE FROM reports WHERE id = ?`).

## Costs

Within Cloudflare's free tier for a first release: Workers (100,000 requests a day) and D1 (5 GB, 5 million rows read a day). An install is one write; feedback is one write.
