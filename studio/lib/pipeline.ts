/**
 * Generation pipeline (v2) — venue → AR objects, via OpenAI.
 *
 *   createScene   : venue → LLM plan → scenario + pending assets (scene + keyword)
 *   generateSceneConcept : Tom-centered concept image → LiG → scenario
 *   processAsset  : pending → generating → gpt-image-1 → review|auto upload LiG
 *   approve/reject: review → uploaded | pending
 *   request3d     : mark image-to-3D requested (stub; vendor TBD)
 *   processQueue  : serial worker
 *
 * Idempotency: asset (type, tag_key) unique; re-creating a venue skips dupes.
 */

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import type { Asset } from "./db/schema";
import { getConfig } from "./settings";
import { generateScenePlan, buildObjectPrompt, generateImageB64, generateConceptB64, translateObject, generateAltView } from "./openai";
import { uploadImage } from "./lig";
import {
  imageToModel,
  multiviewToModel,
  createMultiviewTask,
  createImageToModelTask,
  uploadImage as tripoUploadImage,
  fetchModelIfReady,
} from "./tripo";
import { buildTags, toTag } from "./prompt";
import { pngSize, glbFaceCount } from "./meshinfo";

const { scenario, asset, generationJob } = schema;

export type PipelineMode = "review" | "auto";

const PENDING_DIR = path.join(process.cwd(), "out", "pending");
const pendingPath = (id: string) => path.join(PENDING_DIR, `${id}.png`);

// ── create scene ───────────────────────────────────────────────────────────
export interface CreateSceneResult {
  scenarioId: string;
  nameEn: string;
  sceneObjects: string[];
  keywordObjects: string[];
  skipped: string[];
}

export async function createScene(venue: string): Promise<CreateSceneResult> {
  const config = await getConfig();
  const plan = await generateScenePlan(venue, config);

  const scTag = toTag(venue);
  const [inserted] = await db
    .insert(scenario)
    .values({
      nameEn: plan.name_en || venue,
      nameZh: plan.name_zh,
      venueCategory: venue,
      conceptPrompt: plan.concept_prompt,
      tagKey: scTag,
      source: "ai",
    })
    .onConflictDoNothing({ target: scenario.tagKey })
    .returning({ id: scenario.id });
  const scenarioId =
    inserted?.id ??
    (await db.select({ id: scenario.id }).from(scenario).where(eq(scenario.tagKey, scTag)))[0].id;

  const sceneObjects: string[] = [];
  const keywordObjects: string[] = [];
  const skipped: string[] = [];

  const insertObjects = async (
    items: { en: string; zh: string; subject: string }[],
    type: "scene_object" | "keyword",
    bucket: string[],
  ) => {
    for (const o of items) {
      if (!o.en?.trim()) continue;
      const [row] = await db
        .insert(asset)
        .values({
          scenarioId,
          type,
          nameEn: o.en.trim(),
          nameZh: o.zh,
          imagePrompt: o.subject,
          tagKey: toTag(o.en),
          tags: buildTags(o.en, o.zh),
          status: "pending",
        })
        .onConflictDoNothing({ target: [asset.type, asset.tagKey] })
        .returning({ id: asset.id });
      (row ? bucket : skipped).push(o.en.trim());
    }
  };

  await insertObjects(plan.scene_objects, "scene_object", sceneObjects);
  await insertObjects(plan.keyword_objects, "keyword", keywordObjects);

  return { scenarioId, nameEn: plan.name_en || venue, sceneObjects, keywordObjects, skipped };
}

// ── concept image ────────────────────────────────────────────────────────────
export async function generateSceneConcept(scenarioId: string): Promise<string> {
  const config = await getConfig();
  const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
  if (!sc) throw new Error("scenario not found");
  const prompt = sc.conceptPrompt ?? `A friendly AI coach Tom at a ${sc.venueCategory}, talking to a learner.`;

  try {
    const buf = await generateConceptB64(prompt, config);
    const ligAsset = await uploadImage(buf, `concept-${sc.tagKey}`, "png", [sc.tagKey, "concept", "tom"]);
    await db
      .update(scenario)
      .set({ conceptImageUrl: ligAsset.url, conceptLigId: ligAsset.id, conceptStatus: "done", updatedAt: new Date() })
      .where(eq(scenario.id, scenarioId));
    return ligAsset.url;
  } catch (err) {
    await db.update(scenario).set({ conceptStatus: "failed" }).where(eq(scenario.id, scenarioId));
    throw err;
  }
}

// ── background queue: enqueue + atomic claims ────────────────────────────────
/** Enqueue: mark image-to-3D requested (background worker will run it). */
export async function request3d(id: string): Promise<Asset> {
  return updateAsset(id, { modelStatus: "requested", error: null });
}

/** Enqueue concept-image (re)generation. */
export async function requestConcept(scenarioId: string): Promise<void> {
  await db.update(scenario).set({ conceptStatus: "requested" }).where(eq(scenario.id, scenarioId));
}

/** Batch: enqueue image-to-3D for all uploaded assets lacking a model (optional scene scope). */
export async function request3dAll(scenarioId?: string): Promise<number> {
  const conds = [eq(asset.status, "uploaded"), eq(asset.modelStatus, "none")];
  if (scenarioId) conds.push(eq(asset.scenarioId, scenarioId));
  const rows = await db
    .update(asset)
    .set({ modelStatus: "requested", updatedAt: new Date() })
    .where(and(...conds))
    .returning({ id: asset.id });
  return rows.length;
}

/** Claim one 'requested' concept scene atomically → 'generating'. Returns scenarioId. */
export async function claimNextConcept(): Promise<string | null> {
  const rows = await db.execute(sql`
    UPDATE ${scenario} SET concept_status = 'generating', updated_at = now()
    WHERE id = (SELECT id FROM ${scenario} WHERE concept_status = 'requested'
      ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`);
  return (rows as unknown as { id: string }[])[0]?.id ?? null;
}

// ── queue claim (atomic, single-worker safe) ───────────────────────────────
/** Claim one 'queued' image asset atomically → 'generating'. */
export async function claimNextQueued(): Promise<Asset | null> {
  // Raw UPDATE returns snake_case columns; re-fetch via Drizzle for camelCase mapping.
  const rows = await db.execute(sql`
    UPDATE ${asset} SET status = 'generating', updated_at = now()
    WHERE id = (
      SELECT id FROM ${asset} WHERE status = 'queued'
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const id = (rows as unknown as { id: string }[])[0]?.id;
  if (!id) return null;
  return (await getAsset(id)) ?? null;
}

/** Enqueue all idle (pending) image assets, optionally scoped to a scene. */
export async function enqueueAllPending(scenarioId?: string): Promise<number> {
  const where = scenarioId
    ? and(eq(asset.status, "pending"), eq(asset.scenarioId, scenarioId))
    : eq(asset.status, "pending");
  const rows = await db.update(asset).set({ status: "queued", updatedAt: new Date() }).where(where).returning({ id: asset.id });
  return rows.length;
}

// ── process one claimed asset ──────────────────────────────────────────────
export async function processAsset(a: Asset, mode: PipelineMode = "review"): Promise<Asset> {
  const config = await getConfig();
  const log = (stage: "image" | "upload", status: string, extra: object = {}) =>
    db.insert(generationJob).values({
      assetId: a.id,
      stage,
      status: status as never,
      provider: stage === "image" ? "openai" : "lig",
      ...extra,
    });

  try {
    const prompt = buildObjectPrompt(a.imagePrompt ?? `a ${a.nameEn}`, config, a.type);
    await log("image", "running", { request: { prompt } });
    const buf = await generateImageB64(prompt, config);
    await log("image", "completed", { result: { bytes: buf.length } });

    const dim = pngSize(buf);
    const meta = { prompt, model: config.gptImageModel };
    const metrics = {
      imageWidth: dim?.width ?? null,
      imageHeight: dim?.height ?? null,
      imageBytes: buf.length,
    };

    if (mode === "auto") {
      const ligAsset = await uploadImage(buf, a.nameEn, "png", a.tags);
      await log("upload", "completed", { result: { id: ligAsset.id, url: ligAsset.url } });
      return updateAsset(a.id, {
        status: "uploaded",
        imageUrl: ligAsset.url,
        ligImageId: ligAsset.id,
        generationMeta: meta,
        error: null,
        ...metrics,
      });
    }

    await mkdir(PENDING_DIR, { recursive: true });
    await writeFile(pendingPath(a.id), buf);
    return updateAsset(a.id, { status: "review", generationMeta: meta, error: null, ...metrics });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("image", "failed", { error: msg });
    return updateAsset(a.id, { status: "failed", error: msg });
  }
}

// ── approve / reject (review mode) ─────────────────────────────────────────
export async function approveAsset(id: string): Promise<Asset> {
  const a = await getAsset(id);
  if (!a || a.status !== "review") throw new Error("Asset not in review");
  const buf = await readFile(pendingPath(id));
  const ligAsset = await uploadImage(buf, a.nameEn, "png", a.tags);
  await db.insert(generationJob).values({
    assetId: id, stage: "upload", status: "completed", provider: "lig",
    result: { id: ligAsset.id, url: ligAsset.url },
  });
  await rm(pendingPath(id), { force: true });
  return updateAsset(id, { status: "uploaded", imageUrl: ligAsset.url, ligImageId: ligAsset.id });
}

export async function rejectAsset(id: string): Promise<Asset> {
  await rm(pendingPath(id), { force: true });
  return updateAsset(id, { status: "pending", generationMeta: null });
}

/** image-to-3D via Tripo: image → glb → upload LiG → store model_url. */
export async function generate3d(id: string): Promise<Asset> {
  const a = await getAsset(id);
  if (!a) throw new Error("asset not found");
  if (!a.imageUrl) throw new Error("asset has no image yet");

  const config = await getConfig();
  await updateAsset(id, { modelStatus: "generating", error: null });
  await db.insert(generationJob).values({ assetId: id, stage: "model", status: "running", provider: "tripo" });

  try {
    const imgRes = await fetch(a.imageUrl);
    if (!imgRes.ok) throw new Error(`download image ${imgRes.status}`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());

    const tripoOpts = {
      faceLimit: config.model3dFaceLimit,
      textureSize: config.model3dTextureSize,
      textureQuality: config.model3dTextureQuality,
      pbr: config.model3dPbr,
    };

    let glb: Buffer;
    let taskId: string;
    if (config.model3dMultiview) {
      // front + AI-generated side view → better thickness/geometry
      const sideBuf = await generateAltView(imgBuf, "left side", config).catch(() => null);
      ({ glb, taskId } = await multiviewToModel(
        sideBuf ? { front: imgBuf, left: sideBuf } : { front: imgBuf },
        "png",
        tripoOpts,
      ));
    } else {
      ({ glb, taskId } = await imageToModel(imgBuf, "png", tripoOpts));
    }
    const ligModel = await uploadImage(glb, `${a.nameEn}-3d`, "glb", [...a.tags, "3d"]);

    const faces = glbFaceCount(glb);
    await db.insert(generationJob).values({
      assetId: id, stage: "model", status: "completed", provider: "tripo",
      result: { taskId, id: ligModel.id, url: ligModel.url, faces, bytes: glb.length },
    });
    return updateAsset(id, {
      modelStatus: "done",
      modelUrl: ligModel.url,
      ligModelId: ligModel.id,
      modelFaces: faces,
      modelBytes: glb.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.insert(generationJob).values({ assetId: id, stage: "model", status: "failed", provider: "tripo", error: msg });
    return updateAsset(id, { modelStatus: "failed", error: msg });
  }
}

// ── async 3D state machine (Hobby-safe: each step < 60s) ─────────────────────
function tripoOptsFromConfig(c: Awaited<ReturnType<typeof getConfig>>) {
  return {
    faceLimit: c.model3dFaceLimit,
    textureSize: c.model3dTextureSize,
    textureQuality: c.model3dTextureQuality,
    pbr: c.model3dPbr,
  };
}

/** Step 1: create the Tripo task for a claimed ('generating') asset, store task id. */
export async function start3d(a: Asset): Promise<void> {
  const config = await getConfig();
  try {
    if (!a.imageUrl) throw new Error("asset has no image yet");
    const imgBuf = Buffer.from(await (await fetch(a.imageUrl)).arrayBuffer());
    const opts = tripoOptsFromConfig(config);

    let taskId: string;
    if (config.model3dMultiview) {
      const side = await generateAltView(imgBuf, "left side", config).catch(() => null);
      taskId = await createMultiviewTask(side ? { front: imgBuf, left: side } : { front: imgBuf }, "png", opts);
    } else {
      const token = await tripoUploadImage(imgBuf, "png");
      taskId = await createImageToModelTask(token, "png", opts);
    }
    await db.insert(generationJob).values({ assetId: a.id, stage: "model", status: "running", provider: "tripo", result: { taskId } });
    await updateAsset(a.id, { modelTaskId: taskId, modelStatus: "generating", error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.insert(generationJob).values({ assetId: a.id, stage: "model", status: "failed", provider: "tripo", error: msg });
    await updateAsset(a.id, { modelStatus: "failed", error: msg, modelTaskId: null });
  }
}

/** Step 2: poll the in-flight Tripo task; when ready, upload glb to LiG → done. */
export async function poll3d(a: Asset): Promise<void> {
  if (!a.modelTaskId) return;
  try {
    const r = await fetchModelIfReady(a.modelTaskId);
    if (!r) return; // still running (claim already touched updated_at)
    if ("failed" in r) {
      const msg = `Tripo task ${r.status}`;
      await db.insert(generationJob).values({ assetId: a.id, stage: "model", status: "failed", provider: "tripo", error: msg });
      await updateAsset(a.id, { modelStatus: "failed", error: msg, modelTaskId: null });
      return;
    }
    const ligModel = await uploadImage(r.glb, `${a.nameEn}-3d`, "glb", [...a.tags, "3d"]);
    const faces = glbFaceCount(r.glb);
    await db.insert(generationJob).values({
      assetId: a.id, stage: "model", status: "completed", provider: "tripo",
      result: { id: ligModel.id, url: ligModel.url, faces, bytes: r.glb.length },
    });
    await updateAsset(a.id, {
      modelStatus: "done", modelUrl: ligModel.url, ligModelId: ligModel.id,
      modelFaces: faces, modelBytes: r.glb.length, modelTaskId: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAsset(a.id, { modelStatus: "failed", error: msg, modelTaskId: null });
  }
}

/** Claim a 3D job to START: 'requested', or a stalled 'generating' with no task. */
export async function claimNextModelStart(): Promise<Asset | null> {
  const rows = await db.execute(sql`
    UPDATE ${asset} SET model_status = 'generating', updated_at = now()
    WHERE id = (
      SELECT id FROM ${asset}
      WHERE model_status = 'requested'
         OR (model_status = 'generating' AND model_task_id IS NULL AND updated_at < now() - interval '3 minutes')
      ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const id = (rows as unknown as { id: string }[])[0]?.id;
  return id ? (await getAsset(id)) ?? null : null;
}

/** Claim a 3D job to POLL: 'generating' with a task, not polled in the last 8s. */
export async function claimNextModelPoll(): Promise<Asset | null> {
  const rows = await db.execute(sql`
    UPDATE ${asset} SET updated_at = now()
    WHERE id = (
      SELECT id FROM ${asset}
      WHERE model_status = 'generating' AND model_task_id IS NOT NULL
        AND updated_at < now() - interval '8 seconds'
      ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const id = (rows as unknown as { id: string }[])[0]?.id;
  return id ? (await getAsset(id)) ?? null : null;
}

/** Regenerate one asset: send back to pending (keeps name/prompt; old LiG asset orphaned). */
export async function regenAsset(id: string): Promise<Asset> {
  await rm(pendingPath(id), { force: true }).catch(() => {});
  return updateAsset(id, { status: "pending", imageUrl: null, ligImageId: null, generationMeta: null });
}

/** Edit an asset's image subject (the editable part of the prompt) and queue regen. */
export async function setAssetSubject(id: string, subject: string): Promise<Asset> {
  await rm(pendingPath(id), { force: true }).catch(() => {});
  return updateAsset(id, {
    imagePrompt: subject,
    status: "pending",
    imageUrl: null,
    ligImageId: null,
    generationMeta: null,
  });
}

/** Reset all uploaded/failed assets in a scene back to pending (bulk re-style). */
export async function regenScene(scenarioId: string): Promise<number> {
  const rows = await db
    .update(asset)
    .set({ status: "pending", imageUrl: null, ligImageId: null, updatedAt: new Date() })
    .where(and(eq(asset.scenarioId, scenarioId), inArray(asset.status, ["uploaded", "failed"])))
    .returning({ id: asset.id });
  return rows.length;
}

/** Enqueue one asset for the background worker (→ queued). */
export async function enqueueAsset(id: string): Promise<Asset> {
  await rm(pendingPath(id), { force: true }).catch(() => {});
  return updateAsset(id, { status: "queued", error: null });
}

/** Delete an asset (generation_job rows cascade; local preview removed). */
export async function deleteAsset(id: string): Promise<void> {
  await rm(pendingPath(id), { force: true }).catch(() => {});
  await db.delete(asset).where(eq(asset.id, id));
}

/** Manually add a custom object to a scene (pending). */
export async function addObject(
  scenarioId: string,
  input: { type: "scene_object" | "keyword"; nameEn: string; nameZh?: string; subject?: string },
): Promise<Asset | null> {
  const en = input.nameEn.trim();
  if (!en) return null;
  const [row] = await db
    .insert(asset)
    .values({
      scenarioId,
      type: input.type,
      nameEn: en,
      nameZh: input.nameZh?.trim() || null,
      imagePrompt: input.subject?.trim() || `a ${en}`,
      tagKey: toTag(en),
      tags: buildTags(en, input.nameZh),
      status: "pending",
    })
    .onConflictDoNothing({ target: [asset.type, asset.tagKey] })
    .returning();
  return row ?? null;
}

/** Add an object; if English name is blank, AI-translate from the Chinese name. */
export async function addObjectAuto(
  scenarioId: string,
  input: { type: "scene_object" | "keyword"; nameEn?: string; nameZh?: string; subject?: string },
): Promise<Asset | null> {
  let en = input.nameEn?.trim() ?? "";
  let subject = input.subject?.trim() ?? "";
  const zh = input.nameZh?.trim() ?? "";

  if (!en && zh) {
    const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
    const t = await translateObject(zh, sc?.venueCategory ?? undefined);
    en = t.en;
    if (!subject) subject = t.subject;
  }
  if (!en) return null;
  return addObject(scenarioId, { type: input.type, nameEn: en, nameZh: zh || undefined, subject });
}

/** Process one queued item (image → concept → 3D). Returns true if it did work. */
export async function drainOnce(mode: PipelineMode = "review"): Promise<boolean> {
  const img = await claimNextQueued();
  if (img) { await processAsset(img, mode); return true; }
  const conceptId = await claimNextConcept();
  if (conceptId) { await generateSceneConcept(conceptId).catch(() => {}); return true; }
  const toStart = await claimNextModelStart();
  if (toStart) { await start3d(toStart); return true; }
  const toPoll = await claimNextModelPoll();
  if (toPoll) { await poll3d(toPoll); return true; }
  return false;
}

// ── serial worker ──────────────────────────────────────────────────────────
export async function processQueue(mode: PipelineMode = "review", max = Infinity) {
  let processed = 0;
  while (processed < max) {
    const claimed = await claimNextQueued();
    if (!claimed) break;
    await processAsset(claimed, mode);
    processed++;
  }
  return { processed };
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function updateAsset(id: string, patch: Partial<Asset>): Promise<Asset> {
  const [row] = await db
    .update(asset)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(asset.id, id))
    .returning();
  return row;
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  return (await db.select().from(asset).where(eq(asset.id, id)))[0];
}

export async function readPendingImage(id: string): Promise<Buffer> {
  return readFile(pendingPath(id));
}

export async function lookupByTag(tag: string): Promise<Asset | undefined> {
  const key = toTag(tag);
  return (
    await db
      .select()
      .from(asset)
      .where(and(eq(asset.status, "uploaded"), sql`(${asset.tagKey} = ${key} OR ${asset.tags} @> ARRAY[${tag}])`))
      .limit(1)
  )[0];
}
