/** Ad-hoc: report model faces + bytes for a scenario's assets. */
import "dotenv/config";
import { db, schema } from "../lib/db";
import { or, ilike, eq, sql } from "drizzle-orm";

async function main() {
  const { scenario, asset, sceneAsset } = schema;

  // find convenience-store-ish scenarios
  const scs = await db
    .select()
    .from(scenario)
    .where(
      or(
        ilike(scenario.nameEn, "%convenience%"),
        ilike(scenario.nameZh, "%便利%"),
        ilike(scenario.venueCategory, "%convenience%"),
      ),
    );
  console.log("=== matching scenarios ===");
  for (const s of scs) console.log(`${s.id}  ${s.nameEn} / ${s.nameZh}  tag=${s.tagKey}`);

  for (const s of scs) {
    // origin assets + M2M members
    const origin = await db.select().from(asset).where(eq(asset.scenarioId, s.id));
    const members = await db
      .select()
      .from(asset)
      .innerJoin(sceneAsset, eq(sceneAsset.assetId, asset.id))
      .where(eq(sceneAsset.scenarioId, s.id));
    const byId = new Map<string, typeof origin[number]>();
    for (const a of origin) byId.set(a.id, a);
    for (const m of members) byId.set(m.asset.id, m.asset);
    const all = [...byId.values()];

    console.log(`\n=== scenario: ${s.nameZh ?? s.nameEn} (${all.length} assets total) ===`);
    for (const t of ["keyword", "scene_object"] as const) {
      const list = all.filter((a) => a.type === t);
      const withModel = list.filter((a) => a.modelUrl);
      const faces = withModel.reduce((n, a) => n + (a.modelFaces ?? 0), 0);
      const bytes = withModel.reduce((n, a) => n + (a.modelBytes ?? 0), 0);
      console.log(`\n--- ${t}: ${list.length} assets, ${withModel.length} with 3D model ---`);
      for (const a of list) {
        const mb = a.modelBytes ? (a.modelBytes / 1048576).toFixed(2) : "-";
        console.log(
          `  ${(a.nameZh ?? a.nameEn).padEnd(14)} model=${a.modelStatus.padEnd(10)} faces=${String(a.modelFaces ?? "-").padStart(7)}  ${String(mb).padStart(6)}MB`,
        );
      }
      console.log(`  >>> TOTAL ${t}: faces=${faces.toLocaleString()}  bytes=${(bytes / 1048576).toFixed(2)}MB (over ${withModel.length} models)`);
    }
  }

  // global stats on all models
  const g = await db
    .select({
      n: sql<number>`count(*)::int`,
      avgFaces: sql<number>`coalesce(avg(${asset.modelFaces}),0)::int`,
      maxFaces: sql<number>`coalesce(max(${asset.modelFaces}),0)::int`,
      avgMB: sql<number>`coalesce(avg(${asset.modelBytes}),0)/1048576.0`,
      maxMB: sql<number>`coalesce(max(${asset.modelBytes}),0)/1048576.0`,
    })
    .from(asset)
    .where(sql`${asset.modelUrl} is not null`);
  console.log("\n=== ALL models in DB ===", {
    count: g[0].n,
    avgFaces: g[0].avgFaces,
    maxFaces: g[0].maxFaces,
    avgMB: Number(g[0].avgMB).toFixed(2),
    maxMB: Number(g[0].maxMB).toFixed(2),
  });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
