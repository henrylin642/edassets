/**
 * Serial queue worker — processes pending assets one at a time (ComfyUI single-GPU).
 * Usage:
 *   npm run worker            # review mode (default), process all pending
 *   npm run worker -- auto    # auto mode (upload to LiG directly)
 *   npm run worker -- auto 2  # auto mode, process at most 2
 */
import "dotenv/config";
import { processQueue, type PipelineMode } from "../lib/pipeline";

async function main() {
  const mode = (process.argv[2] as PipelineMode) ?? "review";
  const max = process.argv[3] ? Number(process.argv[3]) : Infinity;
  console.log(`\nWorker starting (mode=${mode}, max=${max})…\n`);
  const { processed } = await processQueue(mode, max);
  console.log(`\nWorker done. Processed ${processed} asset(s).`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
