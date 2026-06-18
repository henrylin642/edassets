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
/** AR placement within the scene space (meters, Unity left-handed; Tom at origin facing +Z). */
export interface Placement {
  x: number; // +right / −left of Tom
  z: number; // +front (toward user) / −back
  y?: number; // base elevation above the floor (m); 0 = on floor, ~1 = on a counter
  rotationY: number; // degrees about Y (0 = facing +Z / the user)
  sizeM: number; // real-world height in meters (GLB scaled to this)
}
export interface PlannedObject {
  en: string;
  zh: string;
  /** concise visual subject; style is appended downstream */
  subject: string;
  /** AR placement (scene_objects only; keywords omit it) */
  placement?: Placement;
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

AR SCENE SPACE — place every scene_object in a real 3D room around the coach so the learner feels immersed.
Coordinate system (Unity, meters): the coach "Tom" stands at the ORIGIN (0,0) and FACES the learner along +Z.
- x axis: Tom's RIGHT is +x, Tom's LEFT is −x. Allowed range x ∈ [−{LEFT}, +{RIGHT}].
- z axis: in FRONT of Tom (toward the learner) is +z, BEHIND Tom is −z. Allowed range z ∈ [−{BACK}, +{FRONT}].
For EACH scene_object also give "placement": {"x","z","y","rotationY","sizeM"} where
  x,z = floor position in meters (within the ranges above; keep |x|,|z| inside the box),
  y = base elevation above the floor in meters: 0 for floor-standing furniture; for a SMALL item that normally rests ON a counter/table/shelf (e.g. cash register, coffee machine, microwave) set y to that surface height (~0.9–1.0) and place it at the same x,z as that surface,
  rotationY = facing in degrees (0 = facing +Z toward the learner, 90 = facing +X),
  sizeM = the object's real-world HEIGHT in meters (e.g. shelf ≈ 1.8, counter ≈ 1.0, stool ≈ 0.5, coffee machine ≈ 0.4).
Lay them out like a believable venue: large furniture (counters, shelves, machines) along the sides/back, leave the area right in front of Tom (small +z, x near 0) walkable, do NOT overlap objects, keep everything inside the box. keyword_objects do NOT get placement.

Also give "name_en", "name_zh" for the venue, and "concept_prompt": a vivid scene description IN TRADITIONAL CHINESE (繁體中文) for a wide-angle concept illustration, drawn from the LEARNER'S viewpoint looking toward "Tom" (湯姆) at the centre — 湯姆是面向使用者的英語教練/店員。描述湯姆、空間，以及依上面座標擺放在他左右後方與前方的關鍵道具，讓整個情境被傳達。Write it as natural Traditional Chinese prose. Do NOT mention any readable text/signage.

Return ONLY JSON:
{"name_en","name_zh","concept_prompt","scene_objects":[{"en","zh","subject","placement":{"x","z","y","rotationY","sizeM"}}],"keyword_objects":[{"en","zh","subject"}]}`;

export async function generateScenePlan(venue: string, config: StudioConfig): Promise<ScenePlan> {
  const system = PLAN_SYSTEM.replace("{LEFT}", String(config.arLeft))
    .replace("{RIGHT}", String(config.arRight))
    .replace("{BACK}", String(config.arBack))
    .replace("{FRONT}", String(config.arFront));
  const res = await client().chat.completions.create({
    model: config.namingModel,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `Venue: ${venue}\nScene space: ${config.arLeft}m left, ${config.arRight}m right, ${config.arFront}m front, ${config.arBack}m back of Tom.\nPropose about ${config.objectsPerCategory} objects per category.`,
      },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const plan = JSON.parse(raw) as ScenePlan;
  plan.scene_objects ??= [];
  plan.keyword_objects ??= [];
  plan.scene_objects = plan.scene_objects.map((o) => ({ ...o, placement: clampPlacement(o.placement, config) }));
  return plan;
}

/**
 * Assign AR placement to a set of EXISTING scene objects (no image regen).
 * Returns a map keyed by lowercased English name → clamped Placement.
 */
export async function planPlacements(
  venue: string,
  objects: { en: string; zh?: string | null }[],
  config: StudioConfig,
): Promise<Record<string, Placement>> {
  if (objects.length === 0) return {};
  const system = `You arrange EXISTING props into a believable 3D layout for a venue, for an AR English scene.
Coordinate system (Unity, meters): the coach "Tom" stands at the ORIGIN (0,0) and FACES the learner along +Z.
- x: Tom's RIGHT is +x, LEFT is −x; range x ∈ [−${config.arLeft}, +${config.arRight}].
- z: in FRONT of Tom (toward learner) is +z, BEHIND is −z; range z ∈ [−${config.arBack}, +${config.arFront}].
Lay them out like a real venue: large furniture (counters, shelves, machines) along sides/back; keep the spot right in front of Tom (small +z, x≈0) walkable; NEVER overlap; keep everything inside the box.
For EACH given object return placement: x, z (floor meters), y (base elevation: 0 on floor; ~0.9–1.0 for a small item that rests on a counter/table/shelf, placed at that surface's x,z), rotationY (degrees, 0 = facing +Z/the learner), sizeM (real-world HEIGHT in meters, e.g. shelf≈1.8, counter≈1.0, stool≈0.5, coffee machine≈0.4).
Return ONLY JSON using the EXACT same "en" strings given: {"placements":[{"en","x","z","y","rotationY","sizeM"}]}`;
  const list = objects.map((o) => `- ${o.en}${o.zh ? ` (${o.zh})` : ""}`).join("\n");
  const res = await client().chat.completions.create({
    model: config.namingModel,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Venue: ${venue}\nObjects to place:\n${list}` },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { placements?: ({ en?: string } & Partial<Placement>)[] };
  const out: Record<string, Placement> = {};
  for (const p of parsed.placements ?? []) {
    if (!p.en) continue;
    out[p.en.trim().toLowerCase()] = clampPlacement(p as Placement, config);
  }
  return out;
}

/** Keep a placement inside the configured box; supply sane defaults if missing. */
function clampPlacement(p: Placement | undefined, config: StudioConfig): Placement {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    x: clamp(Number(p?.x ?? 0), -config.arLeft, config.arRight),
    z: clamp(Number(p?.z ?? 1), -config.arBack, config.arFront),
    y: clamp(Number(p?.y ?? 0), 0, 3),
    rotationY: ((Number(p?.rotationY ?? 0) % 360) + 360) % 360,
    sizeM: clamp(Number(p?.sizeM ?? 1), 0.05, 4),
  };
}

// ── new flow: 文案 → concept → (vision) scene objects ────────────────────────
export interface ScriptDraft {
  venue: string;
  name_en: string;
  name_zh: string;
  concept_prompt: string;
  keyword_objects: PlannedObject[];
}

/** Free-text situation (文案) → venue/title/concept prompt + practice keyword objects. */
export async function draftFromScript(script: string, config: StudioConfig): Promise<ScriptDraft> {
  const system = `You turn a teacher's free-text situation (文案, often Traditional Chinese) into a plan for an AR English-learning scene, as JSON.
Infer from the script:
- "venue": a short English venue label (e.g. convenience store, zoo, coffee shop).
- "name_en","name_zh": a short scene title.
- "concept_prompt": a vivid description IN TRADITIONAL CHINESE for a wide-angle concept illustration centered on "Tom"(湯姆), a friendly older English coach acting as the venue's staff, FACING the learner. Describe 湯姆、空間、以及這個情境的關鍵道具，讓整個情境被傳達。No readable text/signage.
- "keyword_objects": the concrete vocabulary items the learner would name/practice in THIS situation (from its intent/dialogue). Each {en, zh, subject} where subject is a clean visual noun phrase (no brand/text/style words).
Return ONLY JSON: {"venue","name_en","name_zh","concept_prompt","keyword_objects":[{"en","zh","subject"}]}`;
  const res = await client().chat.completions.create({
    model: config.namingModel,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `文案 / situation:\n${script}\n\nPropose about ${config.objectsPerCategory} keyword_objects.` },
    ],
  });
  const d = JSON.parse(res.choices[0]?.message?.content ?? "{}") as ScriptDraft;
  d.keyword_objects ??= [];
  return d;
}

/** Vision: read the concept image → the props actually drawn, with floor positions → placement. */
export async function extractSceneObjectsFromConcept(
  conceptUrl: string,
  script: string,
  config: StudioConfig,
): Promise<PlannedObject[]> {
  const system = `You are shown a CONCEPT IMAGE of an AR English scene plus its situation script. List the physical PROPS / furniture that FURNISH the venue (immersion objects) actually visible in the image.
EXCLUDE: the coach/people, live animals, background plants, walls, floor, sky, ceiling.
For EACH prop give:
- "en","zh","subject": a clean visual noun phrase to redraw this single item alone (no brand/logo/text/style words).
- "sx": horizontal screen position 0=left edge .. 1=right edge.
- "sy": vertical position of where the prop MEETS THE FLOOR, 0=top/far .. 1=bottom/near the viewer.
- "est_height_m": estimated real-world height in meters.
Include only solid furnishing props relevant to the venue (max ~12), most prominent first. Return ONLY JSON: {"objects":[{"en","zh","subject","sx","sy","est_height_m"}]}`;
  const res = await client().chat.completions.create({
    model: config.namingModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: `Situation:\n${script || "(none)"}` },
          { type: "image_url", image_url: { url: conceptUrl } },
        ],
      },
    ],
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    objects?: { en?: string; zh?: string; subject?: string; sx?: number; sy?: number; est_height_m?: number }[];
  };
  return (parsed.objects ?? [])
    .filter((o) => o.en?.trim())
    .map((o) => {
      const sx = Math.max(0, Math.min(1, Number(o.sx ?? 0.5)));
      const sy = Math.max(0, Math.min(1, Number(o.sy ?? 0.5)));
      // screen → floor: x left→right, sy bottom(near,+z) .. top(far,−z)
      const placement = clampPlacement(
        {
          x: -config.arLeft + sx * (config.arLeft + config.arRight),
          z: -config.arBack + sy * (config.arFront + config.arBack),
          rotationY: 0,
          sizeM: Number(o.est_height_m ?? 1),
        },
        config,
      );
      return { en: o.en!.trim(), zh: o.zh ?? "", subject: o.subject ?? `a ${o.en}`, placement };
    });
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

// ── layout-faithful concept art (from placement coordinates) ─────────────────
/** Turn placement coords into a human spatial description (relative to Tom). */
function describeLayout(objects: { name: string; x: number; z: number; sizeM: number }[]): string {
  const behind: string[] = [], left: string[] = [], right: string[] = [], front: string[] = [];
  for (const o of objects) {
    const label = `a ${o.name} (~${o.sizeM}m tall)`;
    if (o.z < -0.3) behind.push(label);
    else if (o.x <= -1) left.push(label);
    else if (o.x >= 1) right.push(label);
    else front.push(label);
  }
  const part = (lead: string, arr: string[]) => (arr.length ? `${lead}: ${arr.join(", ")}.` : "");
  return [
    part("Directly behind Tom", behind),
    part("To Tom's left side", left),
    part("To Tom's right side", right),
    part("In front of Tom, closer to the viewer", front),
  ].filter(Boolean).join(" ");
}

/** Generate a wide establishing concept image that reflects the AR placement layout. */
export async function generateLayoutConceptB64(
  venue: string,
  objects: { name: string; x: number; z: number; sizeM: number }[],
  config: StudioConfig,
): Promise<Buffer> {
  const layout = describeLayout(objects);
  const w = config.arLeft + config.arRight;
  const d = config.arFront + config.arBack;
  const prompt =
    `Wide-angle establishing shot of a ${venue}. CAMERA: placed at the learner's standing point about ${config.arFront} meters ` +
    `directly in FRONT of the coach, at eye level (~1.5 m), looking straight toward the coach at the centre; frame the WHOLE ` +
    `space (about ${w} m wide and ${d} m deep) so every prop is visible, nothing cropped. ` +
    `The main character (the person in the reference image) is a friendly English coach in staff uniform, standing at the ` +
    `centre facing the viewer, fully visible head to toe. Arrange the venue props to match this layout (relative to the coach) — ` +
    `${layout} Keep the area right in front of him clear and walkable. ${config.sceneStylePreset}. Warm and inviting, no readable text.`;
  const c = client();
  try {
    const buf = await readFile(tomRefPath());
    const file = await OpenAI.toFile(buf, "tom.png", { type: "image/png" });
    const r = await c.images.edit({ model: config.gptImageModel, image: file, prompt, size: config.conceptSize });
    const b64 = r.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, "base64");
  } catch {
    // no Tom ref → fall back to plain generate
  }
  const r = await c.images.generate({
    model: config.gptImageModel,
    prompt: `${prompt} The central character is Tom, a friendly older gentleman AI coach with grey hair, beard and glasses.`,
    size: config.conceptSize,
    quality: config.imageQuality,
  });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image returned no layout concept image");
  return Buffer.from(b64, "base64");
}

/** Generate a top-down (bird's-eye) reference view of the scene from the placement. */
export async function generateTopViewB64(
  venue: string,
  objects: { name: string; x: number; z: number; sizeM: number }[],
  config: StudioConfig,
  ref?: Buffer,
): Promise<Buffer> {
  const layout = describeLayout(objects);
  const w = config.arLeft + config.arRight;
  const d = config.arFront + config.arBack;
  const prompt =
    `Top-down BIRD'S-EYE view of a ${venue}, camera directly overhead looking straight DOWN (orthographic floor-plan style). ` +
    `Orient it so the FRONT (where the learner stands) is at the BOTTOM edge and the back at the TOP; the coach is a small ` +
    `figure at the EXACT centre, seen from above. The square area (~${w} m wide × ${d} m deep) fills the frame; show all props ` +
    `laid out on the ground matching this layout (relative to the coach) — ${layout} ` +
    `${config.sceneStylePreset}. Clear even lighting, everything visible, no readable text.`;
  const c = client();
  // Prefer the existing concept art as a style/content reference for consistency.
  const refBuf = ref ?? (await readFile(tomRefPath()).catch(() => null));
  if (refBuf) {
    try {
      const file = await OpenAI.toFile(refBuf, "ref.png", { type: "image/png" });
      const r = await c.images.edit({ model: config.gptImageModel, image: file, prompt, size: config.conceptSize });
      const b64 = r.data?.[0]?.b64_json;
      if (b64) return Buffer.from(b64, "base64");
    } catch {
      // fall through to plain generate
    }
  }
  const r = await c.images.generate({ model: config.gptImageModel, prompt, size: config.conceptSize, quality: config.imageQuality });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image returned no top view");
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
