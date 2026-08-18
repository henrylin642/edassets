/**
 * Boot hook — runs once when a Next.js server instance starts, before it serves
 * any request.
 *
 * Why this exists: ensureWorker() is otherwise called from page renders, so a
 * freshly started self-hosted container would not drain the generation queue
 * until somebody happened to load a page. Starting it here means the box keeps
 * generating with no browser open at all — the main reason for self-hosting.
 *
 * No-ops on Vercel (ensureWorker returns early when VERCEL is set) and on the
 * edge runtime, where the worker's Node APIs are unavailable.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL) return;
  const { ensureWorker } = await import("./lib/worker");
  ensureWorker();
}
