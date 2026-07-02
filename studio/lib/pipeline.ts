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
import { and, eq, sql, inArray, or, arrayContains } from "drizzle-orm";
import { db, schema } from "./db";
import type { Asset } from "./db/schema";
import { getConfig } from "./settings";
import { buildObjectPrompt, generateImageB64, generateConceptB64, translateObject, generateAltView, planPlacements, generateLayoutConceptB64, generateTopViewB64, draftFromScript, extractSceneObjectsFromConcept, suggestModelBudgets } from "./openai";
import { uploadImage } from "./lig";
import {
  imageToModel,
  multiviewToModel,
  createMultiviewTask,
  createImageToModelTask,
  uploadImage as tripoUploadImage,
  fetchModelIfReady,
  getBalance,
} from "./tripo";
import { buildTags, toTag } from "./prompt";
import { pngSize, glbFaceCount } from "./meshinfo";

const { scenario, asset, generationJob, sideView, sceneAsset } = schema;

export type PipelineMode = "review" | "auto";

/** Max concurrent in-flight Tripo 3D tasks. Tripo caps concurrent generations and
 * returns HTTP 429 when exceeded, so we serialize (1 at a time) to stay under it. */
const MODEL_CONCURRENCY = 1;

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

/**
 * New flow: free-text 文案 → draft (venue/title/concept prompt + keyword objects)
 * → create scenario, enqueue concept image. Scene objects are extracted LATER
 * from the concept image via extractSceneObjects().
 */
export async function createScene(script: string): Promise<CreateSceneResult> {
  const config = await getConfig();
  const draft = await draftFromScript(script, config);
  const venue = (draft.venue || draft.name_en || script).trim().slice(0, 80);
  const nameEn = draft.name_en || venue;

  const scTag = toTag(nameEn);
  const [inserted] = await db
    .insert(scenario)
    .values({
      nameEn,
      nameZh: draft.name_zh,
      venueCategory: venue,
      script,
      conceptPrompt: draft.concept_prompt,
      conceptStatus: "requested", // 文案 → 概念圖：background worker generates it
      tagKey: scTag,
      source: "ai",
    })
    .onConflictDoNothing({ target: scenario.tagKey })
    .returning({ id: scenario.id });
  const scenarioId =
    inserted?.id ??
    (await db.select({ id: scenario.id }).from(scenario).where(eq(scenario.tagKey, scTag)))[0].id;

  // keyword objects come from the script now; scene objects come from the concept image later
  const keywordObjects: string[] = [];
  const skipped: string[] = [];
  const created: Asset[] = [];
  for (const o of draft.keyword_objects) {
    if (!o.en?.trim()) continue;
    const [row] = await db
      .insert(asset)
      .values({
        scenarioId,
        type: "keyword",
        nameEn: o.en.trim(),
        nameZh: o.zh,
        imagePrompt: o.subject,
        tagKey: toTag(o.en),
        tags: buildTags(o.en, o.zh),
        status: "pending",
      })
      .onConflictDoNothing({ target: [asset.type, asset.tagKey] })
      .returning();
    if (row) { keywordObjects.push(o.en.trim()); created.push(row); }
    else skipped.push(o.en.trim());
  }

  await applyBudgetsSafe(created); // LLM-size each new keyword's 3D budget

  return { scenarioId, nameEn, sceneObjects: [], keywordObjects, skipped };
}

/**
 * Vision step: read the scene's concept image → the props actually drawn → insert
 * them as scene_objects with placement (positions estimated from the image).
 */
export async function extractSceneObjects(scenarioId: string): Promise<number> {
  const config = await getConfig();
  const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
  if (!sc) throw new Error("scenario not found");
  if (!sc.conceptImageUrl) throw new Error("尚無概念圖，請先生成概念圖再萃取情境物件");

  const objs = await extractSceneObjectsFromConcept(sc.conceptImageUrl, sc.script ?? "", config);
  let n = 0;
  const created: Asset[] = [];
  for (const o of objs) {
    if (!o.en?.trim()) continue;
    const [row] = await db
      .insert(asset)
      .values({
        scenarioId,
        type: "scene_object",
        nameEn: o.en.trim(),
        nameZh: o.zh || null,
        imagePrompt: o.subject,
        tagKey: toTag(o.en),
        tags: buildTags(o.en, o.zh),
        placement: o.placement ?? null,
        status: "pending",
      })
      .onConflictDoNothing({ target: [asset.type, asset.tagKey] })
      .returning();
    if (row) { n++; created.push(row); }
  }
  await applyBudgetsSafe(created); // LLM-size each new scene object's 3D budget
  return n;
}

/** Re-plan AR placement for an existing scene's objects (no image/model regen). */
export async function replanLayout(scenarioId: string): Promise<number> {
  const config = await getConfig();
  const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
  if (!sc) throw new Error("scenario not found");
  const objs = await db
    .select()
    .from(asset)
    .where(and(eq(asset.scenarioId, scenarioId), eq(asset.type, "scene_object")));
  if (objs.length === 0) return 0;
  const placements = await planPlacements(
    sc.venueCategory ?? sc.nameEn,
    objs.map((o) => ({ en: o.nameEn, zh: o.nameZh })),
    config,
  );
  let n = 0;
  for (const o of objs) {
    const p = placements[o.nameEn.trim().toLowerCase()];
    if (p) {
      await db.update(asset).set({ placement: p, updatedAt: new Date() }).where(eq(asset.id, o.id));
      n++;
    }
  }
  return n;
}

/** Persist hand-edited placements (from the 3D editor) back to assets. */
export async function savePlacements(
  items: { id: string; placement: { x: number; y?: number; z: number; rotationY: number; sizeM: number } }[],
): Promise<number> {
  let n = 0;
  for (const it of items) {
    await db.update(asset).set({ placement: it.placement, updatedAt: new Date() }).where(eq(asset.id, it.id));
    n++;
  }
  return n;
}

/** Generate a layout-faithful concept image (from placement) and upload to LiG. Synchronous. */
export async function generateLayoutConcept(scenarioId: string): Promise<string> {
  const config = await getConfig();
  const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
  if (!sc) throw new Error("scenario not found");
  const objs = await db
    .select()
    .from(asset)
    .where(and(eq(asset.scenarioId, scenarioId), eq(asset.type, "scene_object")));
  const placed = objs
    .filter((o) => o.placement)
    .map((o) => ({ name: o.nameEn, x: o.placement!.x, z: o.placement!.z, sizeM: o.placement!.sizeM }));
  if (placed.length === 0) throw new Error("此場景尚無佈局座標，請先按「重算佈局」");

  const buf = await generateLayoutConceptB64(sc.venueCategory ?? sc.nameEn, placed, config);
  const ligAsset = await uploadImage(buf, `layout-${sc.tagKey}`, "png", [sc.tagKey, "layout", "concept"]);
  await db
    .update(scenario)
    .set({ layoutConceptUrl: ligAsset.url, layoutConceptLigId: ligAsset.id, updatedAt: new Date() })
    .where(eq(scenario.id, scenarioId));
  return ligAsset.url;
}

/** Generate a top-down (bird's-eye) reference view from the placement; uses concept art as reference. */
export async function generateTopView(scenarioId: string): Promise<string> {
  const config = await getConfig();
  const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
  if (!sc) throw new Error("scenario not found");
  const objs = await db
    .select()
    .from(asset)
    .where(and(eq(asset.scenarioId, scenarioId), eq(asset.type, "scene_object")));
  const placed = objs
    .filter((o) => o.placement)
    .map((o) => ({ name: o.nameEn, x: o.placement!.x, z: o.placement!.z, sizeM: o.placement!.sizeM }));
  if (placed.length === 0) throw new Error("此場景尚無佈局座標，請先按「重算佈局」");

  // reference existing concept art (layout concept first, else the Tom concept) for consistency
  let ref: Buffer | undefined;
  const refUrl = sc.layoutConceptUrl ?? sc.conceptImageUrl;
  if (refUrl) {
    try {
      ref = Buffer.from(await (await fetch(refUrl)).arrayBuffer());
    } catch {
      ref = undefined;
    }
  }

  const buf = await generateTopViewB64(sc.venueCategory ?? sc.nameEn, placed, config, ref);
  const ligAsset = await uploadImage(buf, `topview-${sc.tagKey}`, "png", [sc.tagKey, "topview", "layout"]);
  await db
    .update(scenario)
    .set({ topViewUrl: ligAsset.url, topViewLigId: ligAsset.id, updatedAt: new Date() })
    .where(eq(scenario.id, scenarioId));
  return ligAsset.url;
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

// ── per-object 3D budget (LLM-suggested face_limit / texture size) ───────────
/** LLM-size each asset's 3D budget and persist it. Returns how many were set. */
async function applyBudgets(assets: Asset[], config: Awaited<ReturnType<typeof getConfig>>): Promise<number> {
  const items = assets.map((a) => ({ en: a.nameEn, zh: a.nameZh, type: a.type }));
  const budgets = await suggestModelBudgets(items, config);
  let n = 0;
  for (const a of assets) {
    const b = budgets[a.nameEn.trim().toLowerCase()];
    if (!b) continue;
    await db
      .update(asset)
      .set({ recFaceLimit: b.faceLimit, recTextureSize: b.textureSize, model3dTier: b.tier, updatedAt: new Date() })
      .where(eq(asset.id, a.id));
    n++;
  }
  return n;
}

/** Best-effort budget sizing for newly-created objects (never fails the caller). */
async function applyBudgetsSafe(assets: Asset[]): Promise<void> {
  if (assets.length === 0) return;
  try {
    await applyBudgets(assets, await getConfig());
  } catch {
    // sizing is advisory; object creation must not fail on it
  }
}

/** (Re)compute LLM 3D budgets for a whole scene's assets (origin + reused members). */
export async function suggestBudgets(scenarioId: string): Promise<number> {
  const config = await getConfig();
  const direct = await db.select().from(asset).where(eq(asset.scenarioId, scenarioId));
  const memberRows = await db
    .select({ assetId: sceneAsset.assetId })
    .from(sceneAsset)
    .where(eq(sceneAsset.scenarioId, scenarioId));
  const directIds = new Set(direct.map((d) => d.id));
  const memberIds = memberRows.map((r) => r.assetId).filter((id) => !directIds.has(id));
  const members = memberIds.length ? await db.select().from(asset).where(inArray(asset.id, memberIds)) : [];
  return applyBudgets([...direct, ...members], config);
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

/** Batch: enqueue image-to-3D for all uploaded assets without a model, incl. retrying
 * previously-failed ones (e.g. Tripo 429). Optional scene scope. */
export async function request3dAll(scenarioId?: string): Promise<number> {
  const conds = [eq(asset.status, "uploaded"), inArray(asset.modelStatus, ["none", "failed"])];
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

    const tripoOpts = tripoOptsForAsset(a, config);

    // multiview only when aux views exist for this asset; else single-image
    const sideBuf = a.hasSideView ? await loadView(a.id, "left") : null;
    const backBuf = a.hasSideView ? await loadView(a.id, "back") : null;
    let glb: Buffer;
    let taskId: string;
    if (sideBuf) {
      ({ glb, taskId } = await multiviewToModel({ front: imgBuf, left: sideBuf, back: backBuf ?? undefined }, "png", tripoOpts));
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

// ── side view (own button + reused by multiview 3D) ─────────────────────────
/** Enqueue side-view generation for one asset. */
export async function requestSideView(id: string): Promise<Asset> {
  return updateAsset(id, { sideViewStatus: "requested", sideViewError: null });
}

/** Clear a stored side view → that asset's 3D falls back to single-image. */
export async function clearSideView(id: string): Promise<Asset> {
  await db.delete(sideView).where(eq(sideView.assetId, id));
  return updateAsset(id, { hasSideView: false, sideViewStatus: "none", sideViewError: null });
}

/** Claim one 'requested' side view → 'generating'. */
export async function claimNextSideView(): Promise<Asset | null> {
  const rows = await db.execute(sql`
    UPDATE ${asset} SET side_view_status = 'generating', updated_at = now()
    WHERE id = (SELECT id FROM ${asset} WHERE side_view_status = 'requested'
      ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`);
  const id = (rows as unknown as { id: string }[])[0]?.id;
  return id ? (await getAsset(id)) ?? null : null;
}

/** Generate + store the auxiliary views (side + back) for multiview 3D. DB only, not LiG. */
export async function makeAuxViews(a: Asset): Promise<{ left: Buffer; back: Buffer }> {
  const config = await getConfig();
  if (!a.imageUrl) throw new Error("asset has no image yet");
  const front = Buffer.from(await (await fetch(a.imageUrl)).arrayBuffer());
  const left = await generateAltView(front, "left side", config);
  const back = await generateAltView(front, "back", config);
  for (const [kind, buf] of [["left", left], ["back", back]] as const) {
    const b64 = buf.toString("base64");
    await db
      .insert(sideView)
      .values({ assetId: a.id, kind, b64 })
      .onConflictDoUpdate({ target: [sideView.assetId, sideView.kind], set: { b64, createdAt: new Date() } });
  }
  return { left, back };
}

/** Worker step: generate side + back views for a claimed asset. */
export async function processSideView(a: Asset): Promise<void> {
  try {
    await makeAuxViews(a);
    await updateAsset(a.id, { hasSideView: true, sideViewStatus: "done", sideViewError: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAsset(a.id, { sideViewStatus: "failed", sideViewError: msg });
  }
}

/** Load a stored auxiliary view (kind = 'left' | 'back'), if present. */
async function loadView(assetId: string, kind: "left" | "back"): Promise<Buffer | null> {
  const row = (
    await db.select().from(sideView).where(and(eq(sideView.assetId, assetId), eq(sideView.kind, kind)))
  )[0];
  return row ? Buffer.from(row.b64, "base64") : null;
}

/** Merge fields into generation_meta.model (keeps image-gen meta intact). */
async function mergeModelMeta(id: string, patch: Record<string, unknown>): Promise<void> {
  const a = await getAsset(id);
  const meta = (a?.generationMeta as Record<string, unknown> | null) ?? {};
  const model = { ...((meta.model as Record<string, unknown>) ?? {}), ...patch };
  await updateAsset(id, { generationMeta: { ...meta, model } });
}

// ── async 3D state machine (Hobby-safe: each step < 60s) ─────────────────────
/** Tripo options for one asset: LLM-suggested budget wins, else global config. */
function tripoOptsForAsset(a: Asset, c: Awaited<ReturnType<typeof getConfig>>) {
  return {
    faceLimit: a.recFaceLimit ?? c.model3dFaceLimit,
    textureSize: a.recTextureSize ?? c.model3dTextureSize,
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
    const opts = tripoOptsForAsset(a, config);

    // Multiview only when aux views exist for this asset (side + back, generated
    // manually via the side-view button); otherwise single-image.
    const side = a.hasSideView ? await loadView(a.id, "left") : null;
    const back = a.hasSideView ? await loadView(a.id, "back") : null;

    // Balance before/after task creation → credits charged for THIS task
    // (Tripo charges at creation; capturing here is robust to concurrency).
    const balanceBefore = await getBalance().catch(() => null);
    let taskId: string;
    const mode = side ? "multiview" : "single";
    if (side) {
      taskId = await createMultiviewTask({ front: imgBuf, left: side, back: back ?? undefined }, "png", opts);
    } else {
      const token = await tripoUploadImage(imgBuf, "png");
      taskId = await createImageToModelTask(token, "png", opts);
    }
    const balanceAfter = await getBalance().catch(() => null);
    const creditsUsed =
      balanceBefore != null && balanceAfter != null ? balanceBefore - balanceAfter : null;

    const modelMeta = {
      provider: "tripo",
      taskId,
      mode,
      faceLimit: opts.faceLimit,
      textureSize: opts.textureSize,
      creditsUsed,
      balanceAfter,
      startedAt: new Date().toISOString(),
    };
    await db.insert(generationJob).values({
      assetId: a.id, stage: "model", status: "running", provider: "tripo",
      result: { taskId, mode, creditsUsed, balanceAfter },
    });
    await mergeModelMeta(a.id, modelMeta);
    await updateAsset(a.id, { modelTaskId: taskId, modelStatus: "generating", error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tripo 429 = concurrency/rate limit exceeded → not a real failure; requeue to
    // retry later (the concurrency gate + poll cadence keeps retries paced).
    if (/\b429\b|exceeded the limit|rate limit/i.test(msg)) {
      await updateAsset(a.id, { modelStatus: "requested", error: msg, modelTaskId: null });
      return;
    }
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
    await mergeModelMeta(a.id, { faces, bytes: r.glb.length, ligModelId: ligModel.id, finishedAt: new Date().toISOString() });
    await updateAsset(a.id, {
      modelStatus: "done", modelUrl: ligModel.url, ligModelId: ligModel.id,
      modelFaces: faces, modelBytes: r.glb.length, modelTaskId: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAsset(a.id, { modelStatus: "failed", error: msg, modelTaskId: null });
  }
}

/** Claim a 3D job to START: 'requested', or a stalled 'generating' with no task.
 * Gated by MODEL_CONCURRENCY — won't start a new Tripo task while enough are in
 * flight (task created, not yet polled done), so we stay under Tripo's 429 limit. */
export async function claimNextModelStart(): Promise<Asset | null> {
  const rows = await db.execute(sql`
    UPDATE ${asset} SET model_status = 'generating', updated_at = now()
    WHERE id = (
      SELECT id FROM ${asset}
      WHERE (
        model_status = 'requested'
        OR (model_status = 'generating' AND model_task_id IS NULL AND updated_at < now() - interval '3 minutes')
      )
      AND (SELECT count(*)::int FROM ${asset} a2 WHERE a2.model_status = 'generating'
            AND (a2.model_task_id IS NOT NULL OR a2.updated_at >= now() - interval '3 minutes')) < ${MODEL_CONCURRENCY}
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

/** Delete a whole scene: its assets (side_view + generation_job cascade) then the scenario row. */
export async function deleteScene(scenarioId: string): Promise<void> {
  const rows = await db
    .select({ id: asset.id })
    .from(asset)
    .where(eq(asset.scenarioId, scenarioId));
  await Promise.all(rows.map((r) => rm(pendingPath(r.id), { force: true }).catch(() => {})));
  await db.delete(asset).where(eq(asset.scenarioId, scenarioId));
  await db.delete(scenario).where(eq(scenario.id, scenarioId));
}

/** Manually add a custom object to a scene (pending). */
export type KeywordMatch = {
  id: string;
  nameEn: string;
  nameZh: string | null;
  imageUrl: string | null;
  status: string;
  modelStatus: string;
  modelUrl: string | null;
  /** all scenes this asset belongs to (origin + reused), for the manager to see */
  scenes: string[];
};
export type AddResult =
  | { ok: true; asset: Asset }
  | { ok: false; reason: "empty" | "exists" }
  | { ok: false; reason: "duplicate"; matches: KeywordMatch[]; resolved: { en: string; zh: string; subject: string } };

/** Existing keyword assets sharing this tag, not already in the given scene (origin or membership). */
export async function findKeywordMatches(scenarioId: string, baseTag: string): Promise<KeywordMatch[]> {
  const rows = await db
    .select({
      id: asset.id,
      nameEn: asset.nameEn,
      nameZh: asset.nameZh,
      imageUrl: asset.imageUrl,
      status: asset.status,
      modelStatus: asset.modelStatus,
      modelUrl: asset.modelUrl,
      scenarioId: asset.scenarioId,
      originScene: scenario.nameEn,
    })
    .from(asset)
    .leftJoin(scenario, eq(scenario.id, asset.scenarioId))
    .where(and(eq(asset.type, "keyword"), or(eq(asset.tagKey, baseTag), arrayContains(asset.tags, [baseTag]))));
  const mem = await db
    .select({ assetId: sceneAsset.assetId })
    .from(sceneAsset)
    .where(eq(sceneAsset.scenarioId, scenarioId));
  const inScene = new Set(mem.map((m) => m.assetId));
  const candidates = rows.filter((r) => r.scenarioId !== scenarioId && !inScene.has(r.id));

  // collect every scene each candidate belongs to (origin + reused memberships)
  const ids = candidates.map((c) => c.id);
  const memScenes = ids.length
    ? await db
        .select({ assetId: sceneAsset.assetId, name: scenario.nameEn })
        .from(sceneAsset)
        .innerJoin(scenario, eq(scenario.id, sceneAsset.scenarioId))
        .where(inArray(sceneAsset.assetId, ids))
    : [];
  const sceneMap = new Map<string, Set<string>>();
  for (const c of candidates) sceneMap.set(c.id, new Set(c.originScene ? [c.originScene] : []));
  for (const m of memScenes) if (m.name) sceneMap.get(m.assetId)?.add(m.name);

  return candidates.map(({ scenarioId: _s, originScene: _o, ...m }) => ({
    ...m,
    scenes: [...(sceneMap.get(m.id) ?? [])],
  }));
}

/** Add an existing asset to a scene (reuse across scenes; no regeneration). */
export async function attachExisting(scenarioId: string, assetId: string): Promise<Asset | null> {
  await db.insert(sceneAsset).values({ scenarioId, assetId }).onConflictDoNothing();
  return (await getAsset(assetId)) ?? null;
}

export type BulkKeywordRow = { nameZh?: string; nameEn?: string; subject?: string };
export type BulkResult = { created: string[]; reused: string[]; skipped: string[]; failed: string[] };

/**
 * Batch add keyword objects (e.g. from a CSV). Per row: translate if needed,
 * reuse an existing same-keyword asset (attach to this scene), else create new;
 * skip if it already lives in this scene.
 */
export async function bulkAddKeywords(scenarioId: string, rows: BulkKeywordRow[]): Promise<BulkResult> {
  const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
  const venue = sc?.venueCategory ?? undefined;
  const out: BulkResult = { created: [], reused: [], skipped: [], failed: [] };

  for (const row of rows) {
    const zh = row.nameZh?.trim() ?? "";
    let en = row.nameEn?.trim() ?? "";
    let subject = row.subject?.trim() ?? "";
    if (!en && !zh) continue;
    try {
      if (!en && zh) {
        const t = await translateObject(zh, venue);
        en = t.en;
        if (!subject) subject = t.subject;
      }
      if (!en) { out.failed.push(zh || "(空白)"); continue; }

      const matches = await findKeywordMatches(scenarioId, toTag(en));
      if (matches.length) {
        await attachExisting(scenarioId, matches[0].id); // reuse existing across scenes
        out.reused.push(en);
        continue;
      }
      const r = await addObject(scenarioId, { type: "keyword", nameEn: en, nameZh: zh || undefined, subject });
      if (r.ok) out.created.push(en);
      else out.skipped.push(en); // already in this scene
    } catch (e) {
      out.failed.push(`${en || zh}（${e instanceof Error ? e.message : "錯誤"}）`);
    }
  }
  return out;
}

/** Find the next free tag for a variant: base, base-2, base-3 … */
async function nextVariantTag(baseTag: string): Promise<string> {
  const taken = new Set(
    (
      await db
        .select({ tagKey: asset.tagKey })
        .from(asset)
        .where(and(eq(asset.type, "keyword"), or(eq(asset.tagKey, baseTag), sql`${asset.tagKey} LIKE ${baseTag + "-%"}`)))
    ).map((r) => r.tagKey),
  );
  if (!taken.has(baseTag)) return baseTag;
  let n = 2;
  while (taken.has(`${baseTag}-${n}`)) n++;
  return `${baseTag}-${n}`;
}

export async function addObject(
  scenarioId: string,
  input: { type: "scene_object" | "keyword"; nameEn: string; nameZh?: string; subject?: string; tagKey?: string },
): Promise<AddResult> {
  const en = input.nameEn.trim();
  if (!en) return { ok: false, reason: "empty" };
  const baseTag = toTag(en);
  const tags = buildTags(en, input.nameZh);
  if (!tags.includes(baseTag)) tags.unshift(baseTag); // keep the keyword for AR lookup even on variants
  const [row] = await db
    .insert(asset)
    .values({
      scenarioId,
      type: input.type,
      nameEn: en,
      nameZh: input.nameZh?.trim() || null,
      imagePrompt: input.subject?.trim() || `a ${en}`,
      tagKey: input.tagKey ?? baseTag,
      tags,
      status: "pending",
    })
    .onConflictDoNothing({ target: [asset.type, asset.tagKey] })
    .returning();
  if (!row) return { ok: false, reason: "exists" }; // (type, tagKey) already taken
  return { ok: true, asset: row };
}

/**
 * Add an object; if English name is blank, AI-translate from the Chinese name.
 * For keywords, detects existing same-keyword assets and returns them for the
 * manager to choose reuse vs. new variant (unless `force` creates a variant).
 */
export async function addObjectAuto(
  scenarioId: string,
  input: { type: "scene_object" | "keyword"; nameEn?: string; nameZh?: string; subject?: string },
  opts?: { force?: boolean },
): Promise<AddResult> {
  let en = input.nameEn?.trim() ?? "";
  let subject = input.subject?.trim() ?? "";
  const zh = input.nameZh?.trim() ?? "";

  if (!en && zh) {
    const sc = (await db.select().from(scenario).where(eq(scenario.id, scenarioId)))[0];
    const t = await translateObject(zh, sc?.venueCategory ?? undefined);
    en = t.en;
    if (!subject) subject = t.subject;
  }
  if (!en) return { ok: false, reason: "empty" };
  const baseTag = toTag(en);

  if (input.type === "keyword") {
    if (!opts?.force) {
      const matches = await findKeywordMatches(scenarioId, baseTag);
      if (matches.length) return { ok: false, reason: "duplicate", matches, resolved: { en, zh, subject } };
    }
    // forced variant (or no collision): pick a free tag so multiple variants can coexist
    const tagKey = await nextVariantTag(baseTag);
    const r = await addObject(scenarioId, { type: input.type, nameEn: en, nameZh: zh || undefined, subject, tagKey });
    if (r.ok) await applyBudgetsSafe([r.asset]);
    return r;
  }
  const r = await addObject(scenarioId, { type: input.type, nameEn: en, nameZh: zh || undefined, subject });
  if (r.ok) await applyBudgetsSafe([r.asset]);
  return r;
}

/** Process one queued item (image → concept → 3D). Returns true if it did work. */
export async function drainOnce(mode: PipelineMode = "review"): Promise<boolean> {
  const img = await claimNextQueued();
  if (img) { await processAsset(img, mode); return true; }
  const conceptId = await claimNextConcept();
  if (conceptId) { await generateSceneConcept(conceptId).catch(() => {}); return true; }
  const sv = await claimNextSideView();
  if (sv) { await processSideView(sv); return true; }
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
