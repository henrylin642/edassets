"use server";

import { revalidatePath } from "next/cache";
import {
  createScene,
  requestConcept,
  approveAsset,
  rejectAsset,
  request3d,
  requestSideView,
  clearSideView,
  regenAsset,
  regenScene,
  setAssetSubject,
  enqueueAsset,
  enqueueAllPending,
  request3dAll,
  addObjectAuto,
  deleteAsset,
  deleteScene,
  replanLayout,
  extractSceneObjects,
  generateLayoutConcept,
  generateTopView,
  savePlacements,
  attachExisting,
  bulkAddKeywords,
  suggestBudgets,
  setModelYaw,
} from "@/lib/pipeline";
import type { KeywordMatch, BulkResult } from "@/lib/pipeline";
import { redirect } from "next/navigation";
import { ensureWorker } from "@/lib/worker";
import { saveConfig, type StudioConfig } from "@/lib/settings";
import { currentUser } from "@/lib/auth";
import { guard, friendlyError, type ActionResult } from "@/lib/errmsg";

export type { ActionResult };

/**
 * Every action below is an admin operation that mutates data or spends money on
 * OpenAI / Tripo, so each one gates itself.
 *
 * This is NOT redundant with proxy.ts. Next 16's docs are explicit: Server
 * Functions are POSTs to the route they live on, so a Proxy matcher change — or
 * simply moving an action to another route — silently removes Proxy coverage.
 * Authorization has to live in the function.
 *
 * redirect() is called OUTSIDE guard() everywhere it is used, because it works
 * by throwing NEXT_REDIRECT and a catch block would swallow the navigation.
 */
async function auth() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function createSceneAction(formData: FormData): Promise<ActionResult> {
  await auth();
  const script = String(formData.get("script") ?? formData.get("venue") ?? "").trim();
  if (!script) return { ok: false, message: "請先輸入文案或場域名稱。" };
  return guard(async () => {
    const r = await createScene(script);
    ensureWorker(); // 文案 → 概念圖 (background)
    revalidatePath("/");
    revalidatePath(`/scene/${r.scenarioId}`);
    return `已建立「${r.nameEn}」，關鍵字物件 ${r.keywordObjects.length} 個，概念圖生成中…`;
  });
}

export async function generateConceptAction(scenarioId: string) {
  await auth();
  await requestConcept(scenarioId); // enqueue; background worker generates
  ensureWorker();
  revalidatePath(`/scene/${scenarioId}`);
  revalidatePath("/");
}

/** Enqueue all idle objects (global or one scene) → background worker generates. */
export async function processNextAction(scenarioId?: string) {
  await auth();
  await enqueueAllPending(scenarioId);
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
  return { processed: true };
}

export async function approveAction(id: string, scenarioId?: string) {
  await auth();
  await approveAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function rejectAction(id: string, scenarioId?: string) {
  await auth();
  await rejectAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function request3dAction(id: string, scenarioId?: string) {
  await auth();
  await request3d(id); // enqueue; background worker generates (~1-2 min)
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function sideViewAction(id: string, scenarioId?: string) {
  await auth();
  await requestSideView(id); // enqueue side-view generation (background)
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function clearSideViewAction(id: string, scenarioId?: string) {
  await auth();
  await clearSideView(id); // 3D will use single-image
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function regenAction(id: string, scenarioId?: string) {
  await auth();
  await regenAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function regenSceneAction(scenarioId: string) {
  await auth();
  await regenScene(scenarioId);
  revalidatePath("/");
  revalidatePath(`/scene/${scenarioId}`);
}

export async function updatePromptAction(id: string, subject: string, scenarioId?: string) {
  await auth();
  if (!subject.trim()) return;
  await setAssetSubject(id, subject.trim());
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

/** Save an asset's AR facing correction (deg about Y). */
export async function saveModelYawAction(id: string, yaw: number, scenarioId?: string) {
  await auth();
  await setModelYaw(id, yaw);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

/** LLM-size each object's 3D budget (face_limit / texture) for this scene. */
export async function suggestBudgetsAction(scenarioId: string): Promise<ActionResult> {
  await auth();
  return guard(async () => {
    const n = await suggestBudgets(scenarioId);
    revalidatePath("/");
    revalidatePath(`/scene/${scenarioId}`);
    return `已估算 ${n} 個`;
  });
}

/** Batch enqueue image-to-3D for all uploaded objects without a model. */
export async function batch3dAction(scenarioId?: string) {
  await auth();
  await request3dAll(scenarioId);
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

/** Enqueue one object for background generation. */
export async function generateAssetAction(id: string, scenarioId?: string) {
  await auth();
  await enqueueAsset(id);
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function deleteAssetAction(id: string, scenarioId?: string) {
  await auth();
  await deleteAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

/** Delete an entire scene and all its objects, then go back to the dashboard. */
export async function deleteSceneAction(scenarioId: string) {
  await auth();
  await deleteScene(scenarioId);
  revalidatePath("/");
  redirect("/");
}

/** Re-plan AR placement for an existing scene's objects (for scenes created before placement). */
export async function replanLayoutAction(scenarioId: string): Promise<ActionResult> {
  await auth();
  return guard(async () => {
    const n = await replanLayout(scenarioId);
    revalidatePath(`/scene/${scenarioId}`);
    return `已重排 ${n} 個物件的佈局`;
  });
}

/** Vision: extract scene objects from the concept image (new flow step 3). */
export async function extractObjectsAction(scenarioId: string): Promise<ActionResult> {
  await auth();
  return guard(async () => {
    const n = await extractSceneObjects(scenarioId);
    revalidatePath(`/scene/${scenarioId}`);
    return `新增 ${n} 個情境物件`;
  });
}

/** Generate a layout-faithful concept image from placement coordinates (synchronous). */
export async function generateLayoutConceptAction(scenarioId: string): Promise<ActionResult> {
  await auth();
  return guard(async () => {
    await generateLayoutConcept(scenarioId);
    revalidatePath(`/scene/${scenarioId}`);
    return "佈局概念圖已生成";
  });
}

/** Generate a top-down (bird's-eye) reference view from placement (synchronous). */
export async function generateTopViewAction(scenarioId: string): Promise<ActionResult> {
  await auth();
  return guard(async () => {
    await generateTopView(scenarioId);
    revalidatePath(`/scene/${scenarioId}`);
    return "上視圖已生成";
  });
}

/** Persist hand-edited placements from the 3D editor. */
export async function savePlacementsAction(
  scenarioId: string,
  items: { id: string; placement: { x: number; y?: number; z: number; rotationY: number; sizeM: number } }[],
) {
  await auth();
  await savePlacements(items);
  revalidatePath(`/scene/${scenarioId}`);
}

export type AddObjectResult =
  | { status: "added"; name: string }
  | { status: "exists" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "duplicate"; matches: KeywordMatch[]; resolved: { en: string; zh: string; subject: string } };

/** Manually add a custom object to a scene. Returns a status for UI feedback. */
export async function addObjectAction(formData: FormData): Promise<AddObjectResult> {
  await auth();
  const scenarioId = String(formData.get("scenarioId") ?? "");
  const type = String(formData.get("type") ?? "scene_object") as "scene_object" | "keyword";
  const nameEn = String(formData.get("nameEn") ?? "").trim();
  const nameZh = String(formData.get("nameZh") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const force = String(formData.get("force") ?? "") === "1";
  if (!scenarioId || (!nameEn && !nameZh)) return { status: "empty" };
  try {
    const r = await addObjectAuto(scenarioId, { type, nameEn, nameZh, subject }, { force });
    if (r.ok) {
      revalidatePath(`/scene/${scenarioId}`);
      return { status: "added", name: r.asset.nameEn };
    }
    if (r.reason === "duplicate") return { status: "duplicate", matches: r.matches, resolved: r.resolved };
    return { status: r.reason };
  } catch (e) {
    return { status: "error", message: friendlyError(e) };
  }
}

/** Split a CSV line, honoring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse CSV text → rows of {nameZh, nameEn, subject}. Columns: 中文名, 英文名, 生圖描述. */
function parseKeywordCsv(text: string): { nameZh?: string; nameEn?: string; subject?: string }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const cells = lines.map(splitCsvLine);
  // drop a header row if the first row looks like labels
  if (/中文|英文|名|chinese|english|name|zh|en|subject|描述/i.test(cells[0].join(","))) cells.shift();
  return cells.map((c) => ({ nameZh: c[0] || undefined, nameEn: c[1] || undefined, subject: c[2] || undefined }));
}

/** Batch import keyword objects from CSV text (file uploaded client-side). */
export async function importKeywordsAction(scenarioId: string, csvText: string): Promise<BulkResult> {
  await auth();
  const rows = parseKeywordCsv(csvText);
  const r = await bulkAddKeywords(scenarioId, rows);
  revalidatePath(`/scene/${scenarioId}`);
  return r;
}

/** Reuse an existing keyword asset in this scene (no regeneration). */
export async function attachExistingAction(scenarioId: string, assetId: string): Promise<AddObjectResult> {
  await auth();
  const a = await attachExisting(scenarioId, assetId);
  revalidatePath(`/scene/${scenarioId}`);
  return a ? { status: "added", name: a.nameEn } : { status: "error", message: "找不到該物件" };
}

export async function saveSettingsAction(formData: FormData) {
  await auth();
  const patch: Partial<StudioConfig> = {
    sceneStylePreset: String(formData.get("sceneStylePreset") ?? "").trim(),
    keywordStylePreset: String(formData.get("keywordStylePreset") ?? "").trim(),
    imageSize: formData.get("imageSize") as StudioConfig["imageSize"],
    imageQuality: formData.get("imageQuality") as StudioConfig["imageQuality"],
    background: formData.get("background") as StudioConfig["background"],
    objectsPerCategory: Number(formData.get("objectsPerCategory") ?? 8),
    model3dFaceLimit: Number(formData.get("model3dFaceLimit") ?? 30000),
    model3dTextureSize: Number(formData.get("model3dTextureSize") ?? 512),
    model3dTextureQuality: formData.get("model3dTextureQuality") as StudioConfig["model3dTextureQuality"],
    model3dPbr: formData.get("model3dPbr") === "on",
    model3dYawDefault: Number(formData.get("model3dYawDefault") ?? 0),
    arLeft: Number(formData.get("arLeft") ?? 4),
    arRight: Number(formData.get("arRight") ?? 4),
    arFront: Number(formData.get("arFront") ?? 6),
    arBack: Number(formData.get("arBack") ?? 2),
  };
  await saveConfig(patch);
  revalidatePath("/settings");
}
