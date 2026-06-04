/**
 * LiG Cloud client — the asset library.
 *
 * Three steps:
 *   1. POST /api/v1/login           -> { token } (JWT, Bearer)
 *   2. POST /api/v1/assets          -> { id: ["29422"] }
 *   3. GET  /api/v1/get_asset/{id}  -> { url, filename, tags, ... }
 *
 * Token is a JWT; we read its `exp` claim and re-login before expiry.
 */

export interface LigUploadItem {
  /** base64 of the file. Q-C: prefix vs raw — confirm in M0. */
  data: string;
  ext: string; // e.g. "png"
  filename: string; // without ext; LiG stores as `${filename}.${ext}`
  tags: string[];
}

export interface LigAsset {
  id: string;
  filename: string;
  url: string; // ← the file_url we persist
  content_type: string;
  tags: string[];
}

function cfg(opts: { base?: string; email?: string; password?: string }) {
  const base = opts.base ?? process.env.LIG_BASE;
  const email = opts.email ?? process.env.LIG_EMAIL;
  const password = opts.password ?? process.env.LIG_PASSWORD;
  if (!base || !email || !password) {
    throw new Error("LIG_BASE / LIG_EMAIL / LIG_PASSWORD not set");
  }
  return { base, email, password };
}

/** Decode a JWT's `exp` (seconds) without verifying the signature. */
function jwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

let cached: { token: string; expMs: number } | null = null;

export async function getToken(
  opts: { base?: string; email?: string; password?: string } = {},
): Promise<string> {
  const skewMs = 60_000; // refresh 1 min before expiry
  if (cached && Date.now() < cached.expMs - skewMs) return cached.token;

  const { base, email, password } = cfg(opts);
  const res = await fetch(`${base}/api/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "*/*" },
    body: JSON.stringify({ user: { email, password } }),
  });
  if (!res.ok) throw new Error(`LiG /login ${res.status}: ${await res.text()}`);
  const { token } = (await res.json()) as { token?: string };
  if (!token) throw new Error("LiG /login returned no token");

  const exp = jwtExp(token);
  cached = { token, expMs: exp ? exp * 1000 : Date.now() + 30 * 60_000 };
  return token;
}

/** Upload one or more assets; returns the LiG asset id(s) in input order. */
export async function uploadAssets(
  items: LigUploadItem[],
  opts: { base?: string; email?: string; password?: string } = {},
): Promise<string[]> {
  const { base } = cfg(opts);
  const token = await getToken(opts);
  const res = await fetch(`${base}/api/v1/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accept: "*/*",
    },
    body: JSON.stringify({ assets: items }),
  });
  if (!res.ok) throw new Error(`LiG /assets ${res.status}: ${await res.text()}`);
  const { id } = (await res.json()) as { id?: string[] };
  if (!Array.isArray(id)) throw new Error("LiG /assets returned no id[]");
  return id;
}

/** Fetch an asset's metadata (incl. the public `url`). */
export async function getAsset(
  assetId: string,
  opts: { base?: string; email?: string; password?: string } = {},
): Promise<LigAsset> {
  const { base } = cfg(opts);
  const token = await getToken(opts);
  const res = await fetch(`${base}/api/v1/get_asset/${assetId}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "*/*" },
  });
  if (!res.ok) throw new Error(`LiG /get_asset ${res.status}: ${await res.text()}`);
  return (await res.json()) as LigAsset;
}

/** Convenience: upload one image buffer and return its public url. */
export async function uploadImage(
  buf: Buffer,
  filename: string,
  ext: string,
  tags: string[],
  opts: { base?: string; email?: string; password?: string } = {},
): Promise<LigAsset> {
  const data = buf.toString("base64"); // Q-C: raw base64 (no data: prefix) for now
  const [id] = await uploadAssets([{ data, ext, filename, tags }], opts);
  return getAsset(id, opts);
}
