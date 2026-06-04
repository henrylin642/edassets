import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Serve an asset's auxiliary view (base64 PNG in DB; not on LiG). ?kind=left|back */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get("kind") === "back" ? "back" : "left";
  const row = (
    await db.select().from(schema.sideView).where(and(eq(schema.sideView.assetId, id), eq(schema.sideView.kind, kind)))
  )[0];
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(row.b64, "base64")), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
