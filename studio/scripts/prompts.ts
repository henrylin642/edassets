/** List every asset's full assembled gpt-image-1 prompt. */
import "dotenv/config";
import { db, schema } from "../lib/db";
import { getConfig } from "../lib/settings";
import { buildObjectPrompt } from "../lib/openai";

async function main() {
  const config = await getConfig();
  const rows = await db.select().from(schema.asset).orderBy(schema.asset.type, schema.asset.nameEn);
  for (const a of rows) {
    console.log(`\n● [${a.type}] ${a.nameEn} (${a.nameZh})  status=${a.status} model=${a.modelStatus}`);
    console.log(`  subject : ${a.imagePrompt ?? "(none)"}`);
    console.log(`  prompt  : ${buildObjectPrompt(a.imagePrompt ?? `a ${a.nameEn}`, config, a.type)}`);
  }
  console.log(`\n(model=${config.gptImageModel} size=${config.imageSize} quality=${config.imageQuality})\n`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
