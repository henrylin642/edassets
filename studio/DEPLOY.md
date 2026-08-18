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

## 7. Open items

- **No access control.** `/`, `/scene/[id]`, `/settings` and every Server Action are
  public. Once the app sits on a company domain this needs at minimum a shared-password
  middleware, with `/api/feed` left open for the AR client.
