import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Serve an asset's side view (base64 PNG stored in DB; not on LiG). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = (await db.select().from(schema.sideView).where(eq(schema.sideView.assetId, id)))[0];
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(row.b64, "base64")), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
