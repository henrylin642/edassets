/**
 * Settings center — single-row app config (studio-wide generation params).
 * Cached in-process; getConfig merges stored config over defaults.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export interface StudioConfig {
  /** style for scene_object (immersion props) — more realistic */
  sceneStylePreset: string;
  /** style for keyword objects — stylized 3D render */
  keywordStylePreset: string;
  imageSize: "1024x1024" | "1024x1536" | "1536x1024";
  /** concept image size — landscape for a wide establishing shot */
  conceptSize: "1536x1024" | "1024x1024";
  imageQuality: "low" | "medium" | "high";
  background: "opaque" | "transparent";
  gptImageModel: string;
  namingModel: string;
  /** how many objects per category the LLM should propose */
  objectsPerCategory: number;
  // ── Tripo image-to-3D (keep models small for AR) ──
  model3dFaceLimit: number; // max faces (e.g. 30000)
  model3dTextureSize: number; // texture px (e.g. 512)
  model3dTextureQuality: "standard" | "detailed";
  model3dPbr: boolean;
  /** use multi-view (front + side) for more accurate geometry (e.g. flat objects) */
  model3dMultiview: boolean;
}

export const DEFAULT_CONFIG: StudioConfig = {
  // scene objects → realistic for immersion
  sceneStylePreset:
    "photorealistic 3D render, realistic PBR materials, detailed textures, realistic studio lighting, high fidelity product visualization",
  // keyword objects → clean realistic product render (less clay/cartoon)
  keywordStylePreset:
    "clean realistic 3D product render, accurate detailed materials, crisp studio product photography lighting, true-to-life colors, high detail, not cartoon, not clay",
  imageSize: "1024x1024",
  conceptSize: "1536x1024",
  imageQuality: "medium",
  background: "opaque",
  gptImageModel: "gpt-image-1",
  namingModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  objectsPerCategory: 8,
  model3dFaceLimit: 30000,
  model3dTextureSize: 512,
  model3dTextureQuality: "standard",
  model3dPbr: true,
  model3dMultiview: true,
};

export async function getConfig(): Promise<StudioConfig> {
  const row = (await db.select().from(schema.appSetting).where(eq(schema.appSetting.id, 1)))[0];
  return { ...DEFAULT_CONFIG, ...(row?.config as Partial<StudioConfig> | undefined) };
}

export async function saveConfig(patch: Partial<StudioConfig>): Promise<StudioConfig> {
  const next = { ...(await getConfig()), ...patch };
  await db
    .insert(schema.appSetting)
    .values({ id: 1, config: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.appSetting.id, set: { config: next, updatedAt: new Date() } });
  return next;
}
