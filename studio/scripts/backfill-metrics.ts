import "dotenv/config";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { pngSize, glbFaceCount } from "../lib/meshinfo";

async function dl(url: string) { const r = await fetch(url); return Buffer.from(await r.arrayBuffer()); }

(async () => {
  const a = schema.asset;
  const imgRows = await db.select().from(a).where(and(isNotNull(a.imageUrl), isNull(a.imageWidth)));
  for (const r of imgRows) {
    const buf = await dl(r.imageUrl!); const d = pngSize(buf);
    await db.update(a).set({ imageWidth: d?.width ?? null, imageHeight: d?.height ?? null, imageBytes: buf.length }).where(eq(a.id, r.id));
    console.log(`img ${r.nameEn}: ${d?.width}×${d?.height} ${(buf.length/1048576).toFixed(2)}MB`);
  }
  const mdlRows = await db.select().from(a).where(and(isNotNull(a.modelUrl), isNull(a.modelFaces)));
  for (const r of mdlRows) {
    const buf = await dl(r.modelUrl!); const f = glbFaceCount(buf);
    await db.update(a).set({ modelFaces: f, modelBytes: buf.length }).where(eq(a.id, r.id));
    console.log(`3d  ${r.nameEn}: ${f} faces ${(buf.length/1048576).toFixed(2)}MB`);
  }
  console.log("backfill done");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
