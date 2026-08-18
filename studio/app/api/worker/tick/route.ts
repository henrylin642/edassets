import { drainOnce } from "@/lib/pipeline";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // capped by plan (Hobby ≈ 60s — long 3D jobs may not fit)

/**
 * Process ONE queued item (auto mode → uploads to LiG, no local files).
 * Driven by the client AutoRefresh poller while a tab is open (Vercel Hobby has
 * no per-minute cron). Concurrent calls are safe: claims use FOR UPDATE SKIP LOCKED.
 */
export async function GET() {
  // proxy.ts already gates this path, but every tick can start a paid image or
  // 3D job — worth its own check so an unauthenticated request can never drain
  // the queue if the matcher is ever changed.
  if (!(await currentUser())) {
    return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const processed = await drainOnce("auto").catch(() => false);
  return Response.json({ ok: true, processed });
}
