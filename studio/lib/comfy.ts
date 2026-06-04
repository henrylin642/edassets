/**
 * ComfyUI client (LightEra internal 生圖 service).
 *
 * Async: POST /generate -> poll GET /status/{task_id} -> image_urls[].
 * Constraints:
 *  - Single GPU, one task at a time → callers must serialize (see queue).
 *  - Generated images are temporary → download bytes immediately, do not
 *    persist the signed /img URL.
 */

export interface ComfyParams {
  positive_prompt: string;
  negative_prompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
}

export interface ComfyResult {
  taskId: string;
  imageUrl: string;
}

function cfg(opts: { base?: string; apiKey?: string; workflowId?: string }) {
  const base = opts.base ?? process.env.COMFY_BASE;
  const apiKey = opts.apiKey ?? process.env.COMFY_API_KEY;
  const workflowId = opts.workflowId ?? process.env.COMFY_WORKFLOW_ID ?? "z_image";
  if (!base || !apiKey) throw new Error("COMFY_BASE / COMFY_API_KEY not set");
  return { base, apiKey, workflowId };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate one image and return the (temporary) signed URL.
 * Polls until completed/failed. Default cap ~5 min.
 */
export async function generateImage(
  params: ComfyParams,
  opts: {
    base?: string;
    apiKey?: string;
    workflowId?: string;
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<ComfyResult> {
  const { base, apiKey, workflowId } = cfg(opts);
  const headers = { "x-api-key": apiKey, "Content-Type": "application/json" };

  const submit = await fetch(`${base}/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ workflow_id: workflowId, params }),
  });
  if (!submit.ok) throw new Error(`Comfy /generate ${submit.status}: ${await submit.text()}`);
  const { task_id: taskId } = (await submit.json()) as { task_id: string };
  if (!taskId) throw new Error("Comfy /generate returned no task_id");

  const pollMs = opts.pollMs ?? 4000;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const res = await fetch(`${base}/status/${taskId}`, { headers });
    if (!res.ok) throw new Error(`Comfy /status ${res.status}: ${await res.text()}`);
    const s = (await res.json()) as {
      status: string;
      error?: string | null;
      image_urls?: string[];
    };
    if (s.status === "completed") {
      const url = s.image_urls?.[0];
      if (!url) throw new Error("Comfy completed but no image_urls");
      return { taskId, imageUrl: url };
    }
    if (s.status === "failed") {
      throw new Error(`Comfy task failed: ${s.error ?? "unknown"}`);
    }
  }
  throw new Error(`Comfy task ${taskId} timed out`);
}

/** Download the generated image bytes (signed URL needs no key). */
export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
