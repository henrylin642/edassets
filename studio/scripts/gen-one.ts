import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { processAsset } from "../lib/pipeline";
(async () => {
  const name = process.argv[2];
  const a = (await db.select().from(schema.asset).where(eq(schema.asset.nameEn, name)))[0];
  if (!a) { console.error("not found:", name); process.exit(1); }
  await db.update(schema.asset).set({ status: "pending", imageUrl: null, ligImageId: null }).where(eq(schema.asset.id, a.id));
  const fresh = (await db.select().from(schema.asset).where(eq(schema.asset.id, a.id)))[0];
  const r = await processAsset(fresh, "auto");
  console.log(`${name} [${a.type}] → ${r.status} ${r.imageUrl ?? r.error}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
