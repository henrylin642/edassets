"use server";

import { revalidatePath } from "next/cache";
import {
  createScene,
  requestConcept,
  approveAsset,
  rejectAsset,
  request3d,
  regenAsset,
  regenScene,
  setAssetSubject,
  enqueueAsset,
  enqueueAllPending,
  request3dAll,
  addObjectAuto,
  deleteAsset,
} from "@/lib/pipeline";
import { ensureWorker } from "@/lib/worker";
import { saveConfig, type StudioConfig } from "@/lib/settings";

export async function createSceneAction(formData: FormData) {
  const venue = String(formData.get("venue") ?? "").trim();
  if (!venue) return;
  const r = await createScene(venue);
  revalidatePath("/");
  revalidatePath(`/scene/${r.scenarioId}`);
}

export async function generateConceptAction(scenarioId: string) {
  await requestConcept(scenarioId); // enqueue; background worker generates
  ensureWorker();
  revalidatePath(`/scene/${scenarioId}`);
  revalidatePath("/");
}

/** Enqueue all idle objects (global or one scene) → background worker generates. */
export async function processNextAction(scenarioId?: string) {
  await enqueueAllPending(scenarioId);
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
  return { processed: true };
}

export async function approveAction(id: string, scenarioId?: string) {
  await approveAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function rejectAction(id: string, scenarioId?: string) {
  await rejectAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function request3dAction(id: string, scenarioId?: string) {
  await request3d(id); // enqueue; background worker generates (~1-2 min)
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function regenAction(id: string, scenarioId?: string) {
  await regenAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function regenSceneAction(scenarioId: string) {
  await regenScene(scenarioId);
  revalidatePath("/");
  revalidatePath(`/scene/${scenarioId}`);
}

export async function updatePromptAction(id: string, subject: string, scenarioId?: string) {
  if (!subject.trim()) return;
  await setAssetSubject(id, subject.trim());
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

/** Batch enqueue image-to-3D for all uploaded objects without a model. */
export async function batch3dAction(scenarioId?: string) {
  await request3dAll(scenarioId);
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

/** Enqueue one object for background generation. */
export async function generateAssetAction(id: string, scenarioId?: string) {
  await enqueueAsset(id);
  ensureWorker();
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

export async function deleteAssetAction(id: string, scenarioId?: string) {
  await deleteAsset(id);
  revalidatePath("/");
  if (scenarioId) revalidatePath(`/scene/${scenarioId}`);
}

/** Manually add a custom object to a scene. */
export async function addObjectAction(formData: FormData) {
  const scenarioId = String(formData.get("scenarioId") ?? "");
  const type = String(formData.get("type") ?? "scene_object") as "scene_object" | "keyword";
  const nameEn = String(formData.get("nameEn") ?? "").trim();
  const nameZh = String(formData.get("nameZh") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  if (!scenarioId || (!nameEn && !nameZh)) return;
  await addObjectAuto(scenarioId, { type, nameEn, nameZh, subject });
  revalidatePath(`/scene/${scenarioId}`);
}

export async function saveSettingsAction(formData: FormData) {
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
  };
  await saveConfig(patch);
  revalidatePath("/settings");
}
