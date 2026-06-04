import { drainOnce } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow long 3D jobs (Vercel Pro); Hobby caps lower

/**
 * Serverless queue drainer — Vercel Cron hits this on a schedule (see vercel.json).
 * Processes items in "auto" mode (uploads straight to LiG; no local files).
 * Bounded by a wall-clock budget so it returns before the function timeout.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  }

  const budgetMs = 250_000;
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < deadline) {
    const did = await drainOnce("auto").catch(() => false);
    if (!did) break;
    processed++;
  }
  return Response.json({ ok: true, processed });
}
