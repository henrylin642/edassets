# Deploying AR Assets Studio to Vercel

The Next.js app lives in **`studio/`**. Set that as the Vercel **Root Directory**.

## 1. Database (required — local Docker Postgres is dev-only)

Provision a cloud Postgres (Neon / Vercel Postgres / Supabase) and get its connection string.
Then apply the schema:

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
| `GOOGLE_SERVICE_ACCOUNT_JSON` | whole service-account key file, pasted as one line |
| `GMAIL_SENDER` | `noreply@ezuse.ai` — real Workspace mailbox to send as |
| `AUTH_EMAIL_FROM` | e.g. `AR Assets Studio <noreply@ezuse.ai>` |
| `APP_URL` | `https://edassets.ezuse.ai` — used for links in emails |
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

## 5. Custom domain — `edassets.ezuse.ai`

Production runs on **https://edassets.ezuse.ai** (the `*.vercel.app` URL keeps working
as an alias). Setup is DNS-only; no code change is needed.

1. **Vercel** → project `edassets` → Settings → **Domains** → Add `edassets.ezuse.ai`.
   Vercel shows the record to create — for a subdomain it is a `CNAME`.
2. **ezuse.ai DNS** (same zone as `comfyapi.ezuse.ai`) → add:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `edassets` | `cname.vercel-dns.com` | auto / 300 |

   > Use the exact target Vercel displays — it occasionally differs per project.
3. Wait for Vercel to show **Valid Configuration** (usually < 5 min, DNS TTL can make
   it longer). SSL is issued automatically via Let's Encrypt.

### Gotchas

- **Cloudflare**: if ezuse.ai is on Cloudflare, set the record to **DNS only (grey
  cloud)**. Orange-cloud proxying in front of Vercel breaks certificate issuance and
  causes redirect loops.
- **CAA records**: if the zone has `CAA` records, `letsencrypt.org` must be allowed or
  Vercel cannot issue the certificate.
- **Existing record**: make sure no `A`/`CNAME` for `edassets` already exists.
- Set the new domain as the **Production** domain in Vercel so redirects and
  `VERCEL_URL` point at it.

## 6. Feed

Public JSON catalog for downstream platforms (Unity / AR Foundation):

```
https://edassets.ezuse.ai/api/feed
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

### Password reset

`/forgot-password` mails a link. The token is single use, valid 60 minutes, and only
its SHA-256 hash is stored — a database leak cannot be replayed into account takeover.
The reply is identical whether or not the address has an account, so the form cannot
be used to enumerate staff.

#### Mail goes out through Google Workspace (Gmail API)

No third-party mail vendor and **no DNS changes** — ezuse.ai already has its SPF/DKIM
set up for Workspace. `lib/email.ts` signs a service-account JWT with `node:crypto`
(zero dependencies), exchanges it for an access token, and POSTs the message to the
Gmail API over HTTPS. Plain HTTPS matters here: an SMTP connection through a
serverless cold start is markedly more fragile.

> Why not SMTP + app password: Google disabled legacy-password SMTP in March 2025 and
> now treats app passwords as a fallback for devices that cannot do OAuth, revocable
> by admin policy. The API is the supported path.

One-time setup:

1. **GCP** → pick/create a project → enable the **Gmail API**.
2. **IAM & Admin → Service Accounts** → create one (e.g. `ar-studio-mailer`) →
   Keys → Add key → **JSON**. Keep the file; paste its contents into
   `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. On that service account, note the **Unique ID (client ID)** — a long number.
4. **Workspace Admin** (admin.google.com, super-admin required) → Security → Access
   and data control → **API controls** → **Domain-wide delegation** → Add new:
   - Client ID: the number from step 3
   - OAuth scopes: `https://www.googleapis.com/auth/gmail.send`
5. Make sure `GMAIL_SENDER` is a mailbox that actually exists in the domain
   (e.g. create `noreply@ezuse.ai`). The service account sends *as* that mailbox.

Troubleshooting: `invalid_grant` almost always means step 4 was missed or
`GMAIL_SENDER` does not exist; `403` from the Gmail API means step 1 was missed.
The UI surfaces both in Chinese via `lib/errmsg.ts`.

## 8. Open items

- **`/api/feed` is fully public**, including every image/model URL and the generation
  prompts. That is deliberate so the Unity client can read it without credentials — if
  the prompts are considered proprietary, put it behind a shared bearer token and
  configure the AR client to send it.
