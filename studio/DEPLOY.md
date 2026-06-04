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
| `CRON_SECRET` | random string (protects /api/worker/tick) |

> `studio/assets/tom.png` is committed, so the concept-image reference works on Vercel.

## 3. Background generation on serverless

Vercel has no long-running process, so the in-process worker (`lib/worker.ts`) is
**disabled when `VERCEL` is set**. Instead `vercel.json` registers a **Cron** that
calls `/api/worker/tick` every minute; that endpoint drains the queue in **auto mode**
(generates → uploads to LiG directly, no local files, no manual review gate).

- Cron runs once/min (Hobby). For faster draining, upgrade plan or trigger
  `/api/worker/tick` from a client poller while a tab is open.
- `maxDuration` is set to 300s for long 3D jobs — requires a plan that allows it
  (Hobby caps function duration lower; reduce 3D `face_limit`/quality if needed).

## 4. Differences vs local

| | Local (`npm run dev`) | Vercel |
|---|---|---|
| Worker | in-process loop | Cron → `/api/worker/tick` |
| Generation mode | review (approve then upload) | auto (upload immediately) |
| Review preview files | `out/pending/*` on disk | n/a (auto mode) |
| DB | Docker Postgres :5433 | cloud Postgres |

## 5. Feed

Public JSON catalog for downstream platforms: `https://<your-app>.vercel.app/api/feed`
(supports `?all=1 ?since=ISO ?scene=<tag> ?flat=1`).
