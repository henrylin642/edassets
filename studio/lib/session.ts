/**
 * Session token: a signed, stateless cookie.
 *
 *   <base64url(JSON payload)>.<base64url(HMAC-SHA256)>
 *
 * Signed with Web Crypto so the SAME code runs in `proxy.ts` (Next 16 runs Proxy
 * on the Node runtime, but Web Crypto keeps this portable) and in Server
 * Components / Server Actions. No DB round-trip is needed just to reject a
 * forged cookie.
 *
 * Stateless does not mean unrevokable: the payload carries the user's
 * `tokenVersion`, and lib/auth.ts re-checks it against the DB on every
 * authenticated request. Bumping app_user.token_version (password change,
 * "log out everywhere") invalidates every outstanding token immediately.
 */

export const SESSION_COOKIE = "ar_session";
/** 30 days, in seconds. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export interface SessionPayload {
  /** app_user.id */
  uid: string;
  /** app_user.token_version at issue time */
  sv: number;
  /** expiry, unix seconds */
  exp: number;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    // Fail closed and loudly: a missing/short secret means anyone could forge a
    // session, so refuse to run rather than silently accept everything.
    throw new Error(
      "AUTH_SECRET 未設定（或長度不足 16 字元）。請產生一組隨機字串設進環境變數，例如 `openssl rand -base64 32`。",
    );
  }
  return s;
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Backed by an explicit ArrayBuffer so the result is `Uint8Array<ArrayBuffer>`,
// which is what crypto.subtle's BufferSource wants under TS 5.7+ lib defs.
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Sign a payload into a cookie value. */
export async function signSession(payload: SessionPayload): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify a cookie value. Returns the payload, or null if the signature is
 * invalid, the format is wrong, or it has expired.
 *
 * Signature comparison goes through crypto.subtle.verify, which is constant
 * time — do not "optimize" this into a string compare.
 */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64urlDecode(sig), enc.encode(body));
  } catch {
    return null; // malformed base64 etc.
  }
  if (!ok) return null;

  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (typeof p.uid !== "string" || typeof p.sv !== "number" || typeof p.exp !== "number") return null;
    if (p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Cookie attributes used everywhere the session cookie is written. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Vercel/production is HTTPS; plain http://localhost in dev must not set Secure
    // or the browser drops the cookie.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
