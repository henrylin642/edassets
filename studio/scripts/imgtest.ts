/**
 * Cheap prompt-tuning loop: generate an image for a word (no DB, no LiG).
 * Usage: npm run imgtest -- chips concrete   |   npm run imgtest -- hungry abstract
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateImage, downloadImage } from "../lib/comfy";
import { buildImageParams } from "../lib/prompt";
import type { SemanticClass } from "../lib/classify";

async function main() {
  const en = process.argv[2] ?? "chips";
  const cls = (process.argv[3] as SemanticClass) ?? "concrete";
  const params = buildImageParams({ en, semanticClass: cls });
  console.log("prompt:", params.positive_prompt);
  const { imageUrl } = await generateImage(params);
  const buf = await downloadImage(imageUrl);
  const dir = path.join(process.cwd(), "out");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `_test_${en}.png`);
  await writeFile(file, buf);
  console.log("saved:", file, `(${buf.length} bytes)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
