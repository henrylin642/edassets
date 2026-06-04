/**
 * Create a scene: venue → OpenAI plan → scenario + pending objects (2 categories).
 * Usage: npm run ingest -- "convenience store"
 */
import "dotenv/config";
import { createScene } from "../lib/pipeline";

async function main() {
  const venue = process.argv[2] ?? "convenience store";
  console.log(`\nCreating scene for venue: "${venue}"…\n`);
  const r = await createScene(venue);
  console.log(`scenario: ${r.scenarioId} (${r.nameEn})`);
  console.log(`scene_objects (${r.sceneObjects.length}): ${r.sceneObjects.join(", ")}`);
  console.log(`keyword_objects (${r.keywordObjects.length}): ${r.keywordObjects.join(", ")}`);
  console.log(`skipped (dedup): ${r.skipped.join(", ") || "(none)"}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
