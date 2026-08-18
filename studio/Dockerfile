# syntax=docker/dockerfile:1
#
# Self-hosted image for AR Assets Studio (edassets.ezuse.ai).
#
# Unlike the Vercel deployment this runs a persistent Node process, so
# lib/worker.ts drains the generation queue continuously: no 60-second function
# ceiling on Tripo 3D jobs, and no need for a browser tab to be open.

# ── deps ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Emit .next/standalone (see next.config.ts — gated so Vercel is unaffected).
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
# lib/db/index.ts throws at import time if DATABASE_URL is missing, and Next
# imports every route module while collecting page data. Nothing connects during
# the build; this placeholder only satisfies that check. The real value is
# injected at runtime from .env.production.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Both deployments share one Neon database, and "review" mode leaves the pending
# PNG on the local disk of whichever process made it. Auto keeps them consistent.
ENV PIPELINE_MODE=auto
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Read from disk at runtime: the Tom reference image for concept generation,
# and the SQL files /api/migrate applies.
COPY --from=builder --chown=nextjs:nodejs /app/assets ./assets
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

RUN mkdir -p out/pending && chown -R nextjs:nodejs out

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/env-check > /dev/null || exit 1

CMD ["node", "server.js"]
