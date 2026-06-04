/**
 * M0 PoC — end-to-end chain validation.
 *
 *   Dify(scene) → keywords → [serial] ComfyUI 生圖 → download
 *               → LiG upload → get_asset → print file_url
 *
 * Run:  npm run m0 -- "convenience store" 2
 *   arg1 = scene (default "convenience store")
 *   arg2 = how many keywords to generate (default 2)
 *
 * If LIG_PASSWORD is empty, the upload step is skipped and images are saved
 * to studio/out/ so the Dify+ComfyUI half can be verified independently.
 */

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateLessonPlan, flattenKeywords } from "../lib/dify";
import { generateImage, downloadImage } from "../lib/comfy";
import { uploadImage } from "../lib/lig";
import { buildImageParams, buildTags } from "../lib/prompt";

async function main() {
  const scene = process.argv[2] ?? "convenience store";
  const limit = Number(process.argv[3] ?? 2);

  console.log(`\n=== M0: scene="${scene}", limit=${limit} ===\n`);

  // 1. Dify → keywords
  console.log("[1/4] Dify: requesting lesson plan…");
  const plan = await generateLessonPlan({
    scene,
    student_level: "L1",
    objective_steps: 3,
    number_of_keywords: 5,
  });
  const keywords = flattenKeywords(plan).slice(0, limit);
  console.log(`      concrete_scene: ${plan.concrete_scene}`);
  console.log(`      keywords: ${keywords.map((k) => k.en).join(", ")}\n`);

  const canUpload = !!process.env.LIG_PASSWORD;
  const outDir = path.join(process.cwd(), "out");
  if (!canUpload) {
    await mkdir(outDir, { recursive: true });
    console.log("      (LIG_PASSWORD empty → will save images locally, skip upload)\n");
  }

  // 2–4. Serial loop (ComfyUI is single-GPU, one task at a time)
  for (const [i, kw] of keywords.entries()) {
    const tags = buildTags(kw.en, kw.zh);
    console.log(`[${i + 1}/${keywords.length}] "${kw.en}" (${kw.zh}) tags=${JSON.stringify(tags)}`);

    // No scene context here: it overpowers the subject (scene gets rendered
    // instead of the keyword). Keyword images render the word as its own subject.
    const params = buildImageParams({ en: kw.en, zh: kw.zh });
    console.log(`      Comfy: generating…`);
    const { imageUrl } = await generateImage(params);
    const buf = await downloadImage(imageUrl);
    console.log(`      got image: ${buf.length} bytes`);

    if (canUpload) {
      const asset = await uploadImage(buf, kw.en, "png", tags);
      console.log(`      LiG: id=${asset.id}  url=${asset.url}\n`);
    } else {
      const file = path.join(outDir, `${kw.en}.png`);
      await writeFile(file, buf);
      console.log(`      saved: ${file}\n`);
    }
  }

  console.log("=== M0 done ===\n");
}

main().catch((err) => {
  console.error("\nM0 failed:", err);
  process.exit(1);
});
