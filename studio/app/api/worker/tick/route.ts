import { drainOnce } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // capped by plan (Hobby ≈ 60s — long 3D jobs may not fit)

/**
 * Process ONE queued item (auto mode → uploads to LiG, no local files).
 * Driven by the client AutoRefresh poller while a tab is open (Vercel Hobby has
 * no per-minute cron). Concurrent calls are safe: claims use FOR UPDATE SKIP LOCKED.
 */
export async function GET() {
  const processed = await drainOnce("auto").catch(() => false);
  return Response.json({ ok: true, processed });
}
