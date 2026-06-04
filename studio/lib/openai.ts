/**
 * OpenAI engine — replaces Dify (naming) and ComfyUI (images).
 *
 *   generateScenePlan : venue → object lists (scene + keyword) + concept prompt
 *   buildObjectPrompt : subject + style → full gpt-image-1 prompt
 *   generateImageB64  : gpt-image-1 text→image (objects)
 *   generateConceptB64: gpt-image-1 image edit with Tom reference (concept art)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { StudioConfig } from "./settings";

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey });
}

// ── scene planning (LLM) ───────────────────────────────────────────────────
export interface PlannedObject {
  en: string;
  zh: string;
  /** concise visual subject; style is appended downstream */
  subject: string;
}
export interface ScenePlan {
  name_en: string;
  name_zh: string;
  /** Tom-centered concept scene description for the concept image */
  concept_prompt: string;
  scene_objects: PlannedObject[];
  keyword_objects: PlannedObject[];
}

const PLAN_SYSTEM = `You design AR English-learning scenes for kids. Given a VENUE, output a plan as JSON.

Two object categories:
- "scene_objects": physical props that furnish the venue for immersion (e.g. convenience store → checkout counter, cash register, shelf, coffee machine, freezer).
- "keyword_objects": concrete items a learner would name/practice in this venue (e.g. convenience store → a bag of chips, a drink bottle, a rice ball, coins).

For EACH object give: "en" (English word/short name), "zh" (Traditional Chinese), "subject" (a concise visual noun phrase to draw it as ONE recognizable physical item in this venue's typical form; no brand/logo/text words; no style words).

Also give "name_en", "name_zh" for the venue, and "concept_prompt": a vivid scene description IN TRADITIONAL CHINESE (繁體中文) for a wide-angle concept illustration whose visual center is "Tom" (湯姆), a friendly AI coach acting as the venue's staff, talking to the learner — describe 湯姆 as the staff, the setting, and the key props around him so the whole venue is conveyed. Write it as natural Traditional Chinese prose. Do NOT mention any readable text/signage.

Return ONLY JSON:
{"name_en","name_zh","concept_prompt","scene_objects":[{"en","zh","subject"}],"keyword_objects":[{"en","zh","subject"}]}`;

export async function generateScenePlan(venue: string, config: StudioConfig): Promise<ScenePlan> {
  const res = await client().chat.completions.create({
    model: config.namingModel,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PLAN_SYSTEM },
      {
        role: "user",
        content: `Venue: ${venue}\nPropose about ${config.objectsPerCategory} objects per category.`,
      },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const plan = JSON.parse(raw) as ScenePlan;
  plan.scene_objects ??= [];
  plan.keyword_objects ??= [];
  return plan;
}

// ── translate a Chinese object name → English name + visual subject ──────────
export async function translateObject(
  zh: string,
  venue?: string,
  model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
): Promise<{ en: string; subject: string }> {
  const res = await client().chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `Translate a Chinese object name into a short English noun name for a kids' AR vocab asset, ` +
          `and a concise English "subject" phrase describing that single physical object as it appears` +
          `${venue ? ` in a ${venue}` : ""} (the bare item, no brand/logo/text). ` +
          `Return ONLY JSON: {"en":"...","subject":"..."}.`,
      },
      { role: "user", content: `Chinese: ${zh}` },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const o = JSON.parse(raw) as { en?: string; subject?: string };
  const en = (o.en ?? zh).trim();
  return { en, subject: (o.subject ?? `a ${en}`).trim() };
}

// ── prompt assembly ─────────────────────────────────────────────────────────
export function buildObjectPrompt(
  subject: string,
  config: StudioConfig,
  type: "scene_object" | "keyword" = "keyword",
): string {
  const preset = type === "scene_object" ? config.sceneStylePreset : config.keywordStylePreset;
  return `${subject}, single object, ${preset}, plain solid white background, centered, no text`;
}

// ── gpt-image-1: objects ─────────────────────────────────────────────────────
export async function generateImageB64(prompt: string, config: StudioConfig): Promise<Buffer> {
  const r = await client().images.generate({
    model: config.gptImageModel,
    prompt,
    size: config.imageSize,
    quality: config.imageQuality,
    background: config.background,
  });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image");
  return Buffer.from(b64, "base64");
}

/**
 * Generate an alternate-angle view of an existing object image (for multiview 3D).
 * Edits the front image so the same object is shown from another side.
 */
export async function generateAltView(
  frontBuf: Buffer,
  angle: "left side" | "right side" | "back",
  config: StudioConfig,
): Promise<Buffer> {
  const file = await OpenAI.toFile(frontBuf, "front.png", { type: "image/png" });
  const view =
    angle === "back"
      ? "the BACK of the object — rotate the camera 180 degrees to show its rear face (the side opposite the front)"
      : `the ${angle} profile of the object — rotate the camera about 90 degrees so it is seen edge-on; ` +
        `if the object is thin or flat it must clearly look thin from this angle`;
  const prompt =
    `Show ${view}. It is the EXACT same object(s) as in the image — identical count, arrangement, colors, ` +
    `materials and proportions. Do NOT add, remove, duplicate or change any item, and do NOT change how many ` +
    `there are; only the camera angle changes. Plain solid white background, centered, no text.`;
  const r = await client().images.edit({ model: config.gptImageModel, image: file, prompt, size: config.imageSize });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no alt view");
  return Buffer.from(b64, "base64");
}

// ── gpt-image-1: concept art with Tom reference ──────────────────────────────
/** Resolve the Tom reference image path (env override or studio/assets/tom.png). */
export function tomRefPath(): string {
  return process.env.TOM_REF_PATH ?? path.join(process.cwd(), "assets", "tom.png");
}

export async function generateConceptB64(conceptPrompt: string, config: StudioConfig): Promise<Buffer> {
  // Wide establishing shot, the whole venue + Tom fully visible (not cropped).
  const composition =
    "Wide-angle establishing shot of the entire scene with everything visible in frame. " +
    "The main character (the person in the reference image) is fully visible from head to toe, " +
    "standing as the friendly staff, not cropped, with comfortable margin around him. " +
    "Show all the key props of the venue clearly arranged around him.";
  const prompt = `${conceptPrompt}. ${composition} ${config.sceneStylePreset}. Warm and inviting, no readable text.`;
  const c = client();

  // Use Tom as a visual reference when available → consistent character.
  try {
    const buf = await readFile(tomRefPath());
    const file = await OpenAI.toFile(buf, "tom.png", { type: "image/png" });
    const r = await c.images.edit({ model: config.gptImageModel, image: file, prompt, size: config.conceptSize });
    const b64 = r.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, "base64");
  } catch {
    // no Tom ref (or edit failed) → fall back to plain generate
  }
  const r = await c.images.generate({
    model: config.gptImageModel,
    prompt: `${prompt} The central character is Tom, a friendly older gentleman AI coach with grey hair, beard and glasses.`,
    size: config.conceptSize,
    quality: config.imageQuality,
  });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no concept image");
  return Buffer.from(b64, "base64");
}
