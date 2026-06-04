/** De-risk gpt-image-1: generate one object image and save locally. */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

async function main() {
  const subject = process.argv[2] ?? "a bag of potato chips";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `${subject}, single object, cute 3D clay render style, soft pastel colors, plain solid white background, centered, soft studio lighting, no text`;
  console.log("model: gpt-image-1\nprompt:", prompt);

  try {
    const r = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "medium",
      background: "opaque",
    });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) throw new Error("no b64_json in response");
    const buf = Buffer.from(b64, "base64");
    const dir = path.join(process.cwd(), "out");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `_gpt_${subject.replace(/\s+/g, "_")}.png`);
    await writeFile(file, buf);
    console.log("saved:", file, `(${buf.length} bytes)`);
  } catch (e) {
    console.error("gpt-image-1 FAILED:", e instanceof Error ? e.message : e);
    process.exit(2);
  }
  process.exit(0);
}
main();
