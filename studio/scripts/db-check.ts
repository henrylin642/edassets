/** Smoke test: insert scenario + asset, query by tag, dedup, cleanup. */
import "dotenv/config";
import { db, schema } from "../lib/db";
import { and, eq, sql } from "drizzle-orm";

async function main() {
  const { scenario, asset } = schema;

  const [sc] = await db
    .insert(scenario)
    .values({ nameEn: "convenience store", nameZh: "便利商店", tagKey: "convenience-store", source: "ai" })
    .onConflictDoNothing()
    .returning();
  const scId = sc?.id ?? (await db.select().from(scenario).where(eq(scenario.tagKey, "convenience-store")))[0].id;
  console.log("scenario:", scId);

  await db
    .insert(asset)
    .values({
      scenarioId: scId,
      type: "keyword",
      nameEn: "hungry",
      nameZh: "餓",
      tagKey: "hungry",
      tags: ["hungry", "餓"],
      semanticClass: "abstract",
      status: "uploaded",
      imageUrl: "https://assets.lig.com.tw/ar_asset/demo.png",
    })
    .onConflictDoNothing(); // (type, tag_key) unique → idempotent

  // dedup check: second insert should be a no-op
  await db
    .insert(asset)
    .values({ type: "keyword", nameEn: "hungry", tagKey: "hungry", tags: ["hungry"], status: "pending" })
    .onConflictDoNothing();

  // query by tag via GIN (array contains)
  const found = await db
    .select({ id: asset.id, nameEn: asset.nameEn, tags: asset.tags, url: asset.imageUrl })
    .from(asset)
    .where(and(eq(asset.type, "keyword"), sql`${asset.tags} @> ARRAY['餓']`));
  console.log("query by tag '餓':", found);

  const count = await db.select({ n: sql<number>`count(*)::int` }).from(asset);
  console.log("asset count (should be 1, dedup worked):", count[0].n);

  // cleanup
  await db.delete(asset).where(eq(asset.tagKey, "hungry"));
  await db.delete(scenario).where(eq(scenario.tagKey, "convenience-store"));
  console.log("cleaned up ✓");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
