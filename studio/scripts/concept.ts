import "dotenv/config";
import { generateSceneConcept } from "../lib/pipeline";
(async () => {
  const id = process.argv[2];
  const url = await generateSceneConcept(id);
  console.log("concept url:", url);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
