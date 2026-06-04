/**
 * In-process background worker (local dev / `next start`) — drains queues so UI
 * actions never block. NOT used on Vercel serverless (no persistent process);
 * there, /api/worker/tick driven by Vercel Cron does the work instead.
 */
import { drainOnce } from "./pipeline";

const g = globalThis as unknown as { __arWorker?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let worked = false;
    try {
      worked = await drainOnce("review");
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
  console.log("[worker] background generation worker started");
  void loop();
}
