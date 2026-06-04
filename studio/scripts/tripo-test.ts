import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { generate3d } from "../lib/pipeline";
(async () => {
  const name = process.argv[2] ?? "cash register";
  const a = (await db.select().from(schema.asset).where(eq(schema.asset.nameEn, name)))[0];
  if (!a) { console.error("not found / not uploaded:", name); process.exit(1); }
  console.log(`generating 3D for "${name}" (image: ${a.imageUrl})…`);
  const r = await generate3d(a.id);
  console.log(`→ model_status=${r.modelStatus}  model_url=${r.modelUrl ?? r.error}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
