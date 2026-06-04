/**
 * Tripo3D client — image-to-3D (returns a .glb model).
 *
 * Flow: upload image → create image_to_model task → poll → download model glb.
 * Docs: https://platform.tripo3d.ai (v2 openapi). Auth: Bearer TRIPO_API_KEY.
 */

function cfg() {
  const base = process.env.TRIPO_BASE ?? "https://api.tripo3d.ai/v2/openapi";
  const key = process.env.TRIPO_API_KEY;
  if (!key) throw new Error("TRIPO_API_KEY not set");
  return { base, key };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Upload an image, return its file token. */
export async function uploadImage(buf: Buffer, ext = "png"): Promise<string> {
  const { base, key } = cfg();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: `image/${ext}` }), `image.${ext}`);
  const res = await fetch(`${base}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Tripo /upload ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { code: number; data?: { image_token?: string } };
  const token = j.data?.image_token;
  if (!token) throw new Error(`Tripo upload returned no token: ${JSON.stringify(j)}`);
  return token;
}

export interface TripoModelOptions {
  faceLimit?: number; // cap face count
  textureSize?: number; // texture resolution in px (e.g. 512)
  textureQuality?: "standard" | "detailed"; // texture detail
  pbr?: boolean; // include PBR maps (bigger) or single diffuse
}

/** Create an image_to_model task, return task_id. */
export async function createImageToModelTask(
  fileToken: string,
  ext = "png",
  opts: TripoModelOptions = {},
): Promise<string> {
  const { base, key } = cfg();
  const body: Record<string, unknown> = {
    type: "image_to_model",
    file: { type: ext, file_token: fileToken },
    texture: true,
    pbr: opts.pbr ?? true,
  };
  if (opts.faceLimit && opts.faceLimit > 0) body.face_limit = opts.faceLimit;
  if (opts.textureSize && opts.textureSize > 0) body.texture_size = opts.textureSize;
  if (opts.textureQuality) body.texture_quality = opts.textureQuality;

  const res = await fetch(`${base}/task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tripo /task ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { code: number; data?: { task_id?: string } };
  const id = j.data?.task_id;
  if (!id) throw new Error(`Tripo task returned no task_id: ${JSON.stringify(j)}`);
  return id;
}

export interface TripoTask {
  status: string; // queued | running | success | failed | cancelled | unknown
  progress: number;
  modelUrl?: string;
}

export async function getTask(taskId: string): Promise<TripoTask> {
  const { base, key } = cfg();
  const res = await fetch(`${base}/task/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Tripo /task/${taskId} ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as {
    data?: { status?: string; progress?: number; output?: { pbr_model?: string; model?: string } };
  };
  const d = j.data ?? {};
  return {
    status: d.status ?? "unknown",
    progress: d.progress ?? 0,
    modelUrl: d.output?.pbr_model ?? d.output?.model,
  };
}

/** Full flow: image buffer → glb model buffer (+ taskId). Polls up to ~5 min. */
export async function imageToModel(
  buf: Buffer,
  ext = "png",
  opts: { pollMs?: number; timeoutMs?: number } & TripoModelOptions = {},
): Promise<{ glb: Buffer; taskId: string }> {
  const token = await uploadImage(buf, ext);
  const taskId = await createImageToModelTask(token, ext, {
    faceLimit: opts.faceLimit,
    textureSize: opts.textureSize,
    textureQuality: opts.textureQuality,
    pbr: opts.pbr,
  });

  const pollMs = opts.pollMs ?? 5000;
  const deadline = Date.now() + (opts.timeoutMs ?? 6 * 60_000);
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const t = await getTask(taskId);
    if (t.status === "success") {
      if (!t.modelUrl) throw new Error("Tripo success but no model url");
      const mr = await fetch(t.modelUrl);
      if (!mr.ok) throw new Error(`Tripo model download ${mr.status}`);
      return { glb: Buffer.from(await mr.arrayBuffer()), taskId };
    }
    if (t.status === "failed" || t.status === "cancelled") {
      throw new Error(`Tripo task ${t.status}`);
    }
  }
  throw new Error(`Tripo task ${taskId} timed out`);
}
