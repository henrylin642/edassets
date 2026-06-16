import { desc, eq, inArray, gt, and, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { buildObjectPrompt } from "@/lib/openai";
import { toMB } from "@/lib/meshinfo";
import type { Asset } from "@/lib/db/schema";

const { asset, scenario, sceneAsset } = schema;

/**
 * Public asset catalog feed (JSON) for downstream platforms.
 *
 *   GET /api/feed                 → all scenes + uploaded objects
 *   GET /api/feed?all=1           → include not-yet-uploaded objects
 *   GET /api/feed?since=ISO       → only items updated after a timestamp (delta sync)
 *   GET /api/feed?scene=<tag>     → a single scene by tag_key
 *   GET /api/feed?flat=1          → also include a flat tag_index for quick lookup
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeAll = url.searchParams.get("all") === "1";
  const flat = url.searchParams.get("flat") === "1";
  const sceneTag = url.searchParams.get("scene");
  const sinceStr = url.searchParams.get("since");
  const since = sinceStr ? new Date(sinceStr) : null;

  const config = await getConfig();

  const scenarios = await db.select().from(scenario).orderBy(desc(scenario.createdAt));

  const assetWhere = [
    includeAll ? undefined : eq(asset.status, "uploaded"),
    includeAll ? undefined : isNotNull(asset.imageUrl),
    since ? gt(asset.updatedAt, since) : undefined,
  ].filter(Boolean);
  const assets = await db
    .select()
    .from(asset)
    .where(assetWhere.length ? and(...(assetWhere as never[])) : undefined)
    .orderBy(asset.type, asset.nameEn);

  const byScene = new Map<string, Asset[]>();
  for (const a of assets) {
    if (!a.scenarioId) continue;
    (byScene.get(a.scenarioId) ?? byScene.set(a.scenarioId, []).get(a.scenarioId)!).push(a);
  }

  // assets reused across scenes (scene_asset membership) → include in each scene
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const memByScene = new Map<string, string[]>();
  for (const m of await db.select().from(sceneAsset)) {
    (memByScene.get(m.scenarioId) ?? memByScene.set(m.scenarioId, []).get(m.scenarioId)!).push(m.assetId);
  }

  const toObject = (a: Asset) => ({
    id: a.id,
    type: a.type, // "scene_object" | "keyword"
    en_name: a.nameEn,
    ch_name: a.nameZh,
    tag: a.tagKey, // primary normalized tag
    tags: a.tags, // all tags incl. zh aliases
    img_url: a.imageUrl,
    img_asset_id: a.ligImageId, // LiG asset id (image)
    image: {
      width: a.imageWidth, // px
      height: a.imageHeight,
      bytes: a.imageBytes,
      mb: toMB(a.imageBytes),
    },
    "3dmodel_url": a.modelUrl, // null until 3D generated
    "3dmodel_asset_id": a.ligModelId,
    model_format: a.modelUrl ? "glb" : null,
    model_ready: a.modelStatus === "done",
    model_status: a.modelStatus, // none | requested | generating | done | failed
    model: a.modelUrl
      ? {
          faces: a.modelFaces,
          bytes: a.modelBytes,
          mb: toMB(a.modelBytes),
          credits: (a.generationMeta as { model?: { creditsUsed?: number } } | null)?.model?.creditsUsed ?? null,
        }
      : null,
    prompt: a.imagePrompt, // subject phrase
    full_prompt: a.imagePrompt ? buildObjectPrompt(a.imagePrompt, config, a.type) : null,
    // AR placement (scene_object only): meters, Unity left-handed, Tom at origin facing +Z
    placement: a.placement ?? null,
    example: a.exampleSentence, // optional practice sentence
    background: "white",
    image_source: "gpt-image-1",
    model_source: a.modelUrl ? "tripo3d" : null,
    updated_at: a.updatedAt,
  });

  let scenesOut = scenarios
    .filter((s) => !sceneTag || s.tagKey === sceneTag)
    .map((s) => {
      const items = [...(byScene.get(s.id) ?? [])];
      const have = new Set(items.map((a) => a.id));
      for (const aid of memByScene.get(s.id) ?? []) {
        const a = assetById.get(aid);
        if (a && !have.has(aid)) { items.push(a); have.add(aid); }
      }
      return {
        id: s.id,
        en_name: s.nameEn,
        ch_name: s.nameZh,
        venue_category: s.venueCategory,
        tag: s.tagKey,
        concept: s.conceptImageUrl
          ? { description: s.conceptPrompt, img_url: s.conceptImageUrl, asset_id: s.conceptLigId }
          : null,
        // AR scene space: Tom at origin facing +Z (user side); meters, Unity left-handed
        space: {
          unit: "meter",
          coordinate_system: "unity_left_handed_y_up",
          origin: "tom",
          tom_faces: "+z",
          bounds: { x_min: -config.arLeft, x_max: config.arRight, z_min: -config.arBack, z_max: config.arFront },
        },
        scene_objects: items.filter((a) => a.type === "scene_object").map(toObject),
        keyword_objects: items.filter((a) => a.type === "keyword").map(toObject),
        updated_at: s.updatedAt,
      };
    });

  // Hide empty scenes unless explicitly asking for all / delta.
  if (!includeAll && !since) {
    scenesOut = scenesOut.filter((s) => s.concept || s.scene_objects.length || s.keyword_objects.length);
  }

  const allObjects = scenesOut.flatMap((s) => [...s.scene_objects, ...s.keyword_objects]);

  const body: Record<string, unknown> = {
    meta: {
      title: "AR Assets Studio Feed",
      version: "1.0",
      generated_at: new Date().toISOString(),
      scene_count: scenesOut.length,
      asset_count: allObjects.length,
      asset_host: "https://assets.lig.com.tw",
      filters: { all: includeAll, since: sinceStr ?? null, scene: sceneTag ?? null },
    },
    scenes: scenesOut,
  };

  // Optional flat tag → asset index for fast lookup (e.g. lesson-plan matching).
  if (flat) {
    const tagIndex: Record<string, string> = {};
    for (const o of allObjects) {
      for (const t of [o.tag, ...(o.tags ?? [])]) if (t && !(t in tagIndex)) tagIndex[t] = o.id;
    }
    body.tag_index = tagIndex;
    body.assets = allObjects;
  }

  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
