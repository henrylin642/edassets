/**
 * In-process background worker — drains the generation queues continuously so
 * UI actions never block and work proceeds with no browser tab open.
 *
 * Runs on any host with a persistent process (self-hosted Docker, `next start`,
 * `next dev`). NOT on Vercel serverless, which has no long-lived process; there
 * the client-driven poller calls /api/worker/tick instead.
 *
 * MODE — this matters once more than one deployment shares a database:
 *   "auto"   generate → upload to LiG immediately.
 *   "review" generate → write a preview to ./out/pending → wait for approval.
 *
 * "review" keeps the pending PNG on the local disk of whichever process
 * generated it, so a second deployment cannot serve or approve it. Any shared-DB
 * setup must therefore run "auto" everywhere — which is why production defaults
 * to auto and only `next dev` keeps the review gate.
 */
import type { PipelineMode } from "./pipeline";
import { drainOnce } from "./pipeline";

function mode(): PipelineMode {
  const m = process.env.PIPELINE_MODE;
  if (m === "auto" || m === "review") return m;
  return process.env.NODE_ENV === "production" ? "auto" : "review";
}

const g = globalThis as unknown as { __arWorker?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let worked = false;
    try {
      worked = await drainOnce(mode());
    } catch {
      // swallow; retry next tick
    }
    await sleep(worked ? 300 : 3000);
  }
}

/** Start the background worker once per server process (skipped on Vercel). */
export function ensureWorker() {
  if (process.env.VERCEL) return; // serverless → cron drives /api/worker/tick
  if (g.__arWorker) return;
  g.__arWorker = true;
  console.log(`[worker] background generation worker started (mode=${mode()})`);
  void loop();
}
