# Deploying AR Assets Studio to Vercel

The Next.js app lives in **`studio/`**. Set that as the Vercel **Root Directory**.

## 1. Database (required — local Docker Postgres is dev-only)

Provision a cloud Postgres (Neon / Vercel Postgres / Supabase) and get its connection string.
Then apply the schema:

> **Use `db:migrate`, never `db:push`, against a real database.** `drizzle-kit push`
> applies the schema directly *without* recording anything in
> `drizzle.__drizzle_migrations`, so the database silently drifts ahead of its own
> bookkeeping. The next `db:migrate` then replays already-applied migrations and dies
> on `relation "…" already exists`. That happened to production here; the migrations
> from 0009 on are now written to be idempotent so the state is recoverable, but the
> rule stands: `push` is for throwaway local databases only.

```bash
cd studio
DATABASE_URL="postgres://…cloud…" npm run db:migrate
```

## 2. Vercel project settings

- **Root Directory:** `studio`
- **Framework:** Next.js (auto-detected)
- **Environment Variables** (Project → Settings → Environment Variables):

| Key | Value |
|---|---|
| `DATABASE_URL` | your cloud Postgres URL |
| `OPENAI_API_KEY` | OpenAI key (gpt-image-1 + LLM) |
| `OPENAI_MODEL` | `gpt-4.1-mini` |
| `LIG_BASE` | `https://api.lig.com.tw` |
| `LIG_EMAIL` / `LIG_PASSWORD` | LiG credentials |
| `TRIPO_BASE` | `https://api.tripo3d.ai/v2/openapi` |
| `TRIPO_API_KEY` | Tripo **server** key (`tsk_…`) |
| `AUTH_SECRET` | random 32 bytes — `openssl rand -base64 32` |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | e.g. `lig.com.tw,ezuse.ai` |
| `APP_URL` | `https://edassets.ezuse.ai` — used to build reset links |
| `MIGRATE_SECRET` | random string, protects `/api/migrate` |

> **Two vars fail closed on purpose.** An unset/short `AUTH_SECRET` makes every
> request unauthenticated (nobody can log in), and an empty
> `AUTH_ALLOWED_EMAIL_DOMAINS` rejects *all* registrations. A misconfigured
> deploy locks you out; it never silently opens the console to the internet.

> `studio/assets/tom.png` is committed, so the concept-image reference works on Vercel.

## 3. Background generation on serverless

Vercel has no long-running process, so the in-process worker (`lib/worker.ts`) is
**disabled when `VERCEL` is set**. Instead generation is **client-driven**: while a
tab is open and work is queued, the `AutoRefresh` poller calls `GET /api/worker/tick`
every few seconds, which processes **one** queued item in **auto mode** (generates →
uploads to LiG directly; no local files, no manual review gate). Concurrent calls are
safe (claims use `FOR UPDATE SKIP LOCKED`).

> No Vercel Cron is used — Hobby only allows once-per-day crons, which is useless for
> interactive generation. (If you upgrade to Pro you could add a `vercel.json` cron to
> also drain when no tab is open.)

### ⚠️ Hobby plan + 3D
Hobby caps serverless function duration (~60s). Image generation (~10–20s) fits, but a
**Tripo 3D job (1–2 min) will time out** on Hobby via `/api/worker/tick` → the model
stays `generating`. Options:
- Run **3D locally** (`npm run dev`/`npm start` — the in-process worker has no timeout)
  and let Vercel handle images; or
- Upgrade to **Pro** (longer `maxDuration`); or
- Ask to add an **async 3D state machine** (create Tripo task → poll in separate short
  requests) so each step fits Hobby limits.

## 4. Differences vs local

| | Local (`npm run dev`) | Vercel |
|---|---|---|
| Worker | in-process loop | Cron → `/api/worker/tick` |
| Generation mode | review (approve then upload) | auto (upload immediately) |
| Review preview files | `out/pending/*` on disk | n/a (auto mode) |
| DB | Docker Postgres :5433 | cloud Postgres |

## 5. Second deployment: self-hosted at `edassets.ezuse.ai`

The Vercel deployment stays exactly as it is, on its `*.vercel.app` URL. A second
deployment of the same code runs on our own host at **https://edassets.ezuse.ai**,
against the **same Neon database**, so both show the same data.

### Why self-host at all

Vercel has no long-running process. That forced two workarounds that self-hosting
simply removes:

| | Vercel | Self-hosted |
|---|---|---|
| Worker | client polls `/api/worker/tick`, one item per call | `lib/worker.ts` loops continuously |
| Queue drains when no tab is open | no | yes |
| Tripo 3D job (1–2 min) | must be split across sub-60s requests | runs straight through |
| Boot | n/a | `instrumentation.ts` starts the worker before the first request |

### Host recommendation

**Any Linux box with Docker.** The stack is two containers and reuses Neon, so it is
undemanding — 1 vCPU / 2 GB is plenty; the heavy lifting is all in OpenAI, Tripo and
LiG.

- **Preferred: the existing ezuse.ai server** (the one behind `comfyapi.ezuse.ai`).
  Zero new infrastructure or billing. If it already runs nginx/Caddy/Traefik, point a
  vhost at the `app` container and drop the `caddy` service from the compose file.
- **Otherwise: a small GCE VM** (e2-small) with a static IP, running the compose
  stack as-is. Caddy handles TLS automatically.
- **Not Cloud Run.** Keeping the worker alive there needs `min-instances=1` *and*
  "CPU always allocated", which costs about what a small VM does while adding
  constraints — you would be paying extra to emulate the persistent process that is
  the whole reason for leaving Vercel.

### Deploy

```bash
git clone https://github.com/henrylin642/edassets.git
cd edassets/studio
cp .env.example .env.production      # fill in: DATABASE_URL (the Neon one),
                                     # OPENAI_*, LIG_*, TRIPO_*, AUTH_SECRET,
                                     # AUTH_ALLOWED_EMAIL_DOMAINS, MIGRATE_SECRET,
                                     # APP_URL=https://edassets.ezuse.ai
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
```

DNS: an **A record** for `edassets` → the host's public IP. Ports 80 and 443 must be
reachable, or Caddy cannot complete the ACME challenge. (Note this is an A record to
our own host — *not* a CNAME to Vercel; the Vercel deployment keeps its own URL.)

### Running both at once — the one real hazard

Both deployments drain the same queue. That is safe: every claim uses
`FOR UPDATE SKIP LOCKED`, and Tripo concurrency is capped by a DB-wide count, so
nothing is processed twice and the 429 ceiling still holds.

The hazard is **pipeline mode**. In `review` mode the generated PNG is written to the
local disk of whichever process made it, then waits for approval — and the *other*
deployment cannot serve or approve that file. So a shared database must run `auto`
everywhere. The Dockerfile and compose file both pin `PIPELINE_MODE=auto`, matching
what Vercel already does; `next dev` still defaults to `review` for local work.

### Updating

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Migrations: run once from either deployment —
`GET /api/migrate?secret=<MIGRATE_SECRET>` — since they share one database.

## 6. Feed

Public JSON catalog for downstream platforms (Unity / AR Foundation). Both
deployments serve identical data (same database) — point the AR client at whichever
is authoritative:

```
https://edassets.ezuse.ai/api/feed      # self-hosted
https://<project>.vercel.app/api/feed   # Vercel
```

Supports `?all=1 ?since=ISO ?scene=<tag> ?flat=1`.

> The feed is **unauthenticated**, and so is the whole admin UI — anyone with the URL
> can create and delete scenes and burn OpenAI / Tripo credits. Before advertising the
> ezuse.ai address, put the admin pages behind auth (see the open item below).

## 7. Authentication

Self-hosted accounts — no third-party auth service. Three moving parts:

| File | Role |
|---|---|
| `lib/session.ts` | signed stateless cookie (`HMAC-SHA256` over `{uid, sv, exp}`) |
| `lib/auth.ts` | scrypt passwords, domain allowlist, `currentUser()` / `requireUser()` |
| `proxy.ts` | Next 16's renamed Middleware — optimistic redirect to `/login` |

### Defence in depth, and why

`proxy.ts` is only the first gate. Next.js Server Functions are POSTs to the route
they live on, so changing a matcher — or moving an action to another route — can
silently drop Proxy coverage. **Every Server Action in `app/actions.ts` therefore
calls `auth()` itself**, which also re-checks `token_version` against the DB so a
password reset instantly kills sessions on other devices.

### Public surface

Everything requires a session except: `/login`, `/register`, `/forgot-password`,
`/reset-password`, `/api/feed` (the AR client reads it), `/api/env-check` (booleans
only), and `/api/migrate` (has its own `MIGRATE_SECRET`; it must stay reachable
because the `app_user` table is itself created by a migration — requiring login here
would deadlock the first deploy).

### First deploy — order matters

1. Set every env var above (including `AUTH_SECRET`, `MIGRATE_SECRET`).
2. Deploy.
3. `GET https://edassets.ezuse.ai/api/migrate?secret=<MIGRATE_SECRET>` — creates
   `app_user` and `password_reset`. **Do this before step 4** or registration 500s.
4. Open `/register` and create your account with an allowlisted address.
5. Optional: once the team has accounts, blank `AUTH_ALLOWED_EMAIL_DOMAINS` to close
   registration entirely.

### Password reset — no email is sent

An admin opens **`/users`**, clicks *產生重設連結* next to the person, and hands the
link over on an existing trusted channel (LINE / Slack). The token is single use,
valid 60 minutes, and only its SHA-256 hash is stored — a database leak cannot be
replayed into account takeover. Using it also bumps `token_version`, so the person's
other sessions are signed out.

#### Why there is no "forgot password" email

Every option for sending mail costs a long-lived credential this deployment should
not hold:

- **Service account + Gmail API** — blocked. The org enforces
  `iam.disableServiceAccountKeyCreation`, so no JSON key can be created.
- **OAuth refresh token** — not blocked, but Google revokes a refresh token after
  *six months unused*, and also whenever the mailbox owner changes their password.
  A password-reset mailer can easily sit unused for six months; it would fail silently
  on the one day it is needed.
- **SMTP + app password** — Google disabled legacy-password SMTP in March 2025 and
  treats app passwords as a revocable fallback.
- **Workload Identity Federation** — policy-compliant and keyless, but reaching the
  Gmail API needs Vercel OIDC → STS → service-account impersonation → `signJwt` for
  domain-wide delegation, plus `google-auth-library`. Disproportionate for a handful
  of mails a year.
- **A third-party mail vendor** — workable, but adds a vendor and DNS records.

Admin-issued links have none of those failure modes. If the team outgrows this
(dozens of users, or self-service becomes a real need), a mail vendor is the next
step — `issueResetLink()` in `lib/auth.ts` already returns exactly what an email
would need to contain.

## 8. Open items

- **`/api/feed` is fully public**, including every image/model URL and the generation
  prompts. That is deliberate so the Unity client can read it without credentials — if
  the prompts are considered proprietary, put it behind a shared bearer token and
  configure the AR client to send it.
