/**
 * Accounts, passwords and the current-user lookup.
 *
 * Server-only: this module touches node:crypto and the database, so it must
 * never be imported from a Client Component (or from proxy.ts, which only needs
 * lib/session.ts).
 *
 * Threat model for a small internal admin console that spends real money on
 * every click:
 *   - Registration is gated by an email-domain allowlist, so a stranger who
 *     finds the URL cannot mint an account.
 *   - Passwords are scrypt hashes with a per-user salt; comparison is
 *     timing-safe.
 *   - Login and password-reset responses do not reveal whether an address
 *     exists (no account enumeration).
 *   - Reset tokens are stored only as SHA-256 hashes, single-use, short TTL.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { AppUser } from "./db/schema";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  sessionCookieOptions,
} from "./session";

const scrypt = promisify(_scrypt) as (
  pw: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const { appUser, passwordReset } = schema;

const SCRYPT_KEYLEN = 64;

// ── passwords ──────────────────────────────────────────────────────────
/** "scrypt:<saltBase64>:<hashBase64>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split(":");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  // Lengths must match before timingSafeEqual or it throws.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Minimum password policy. Kept deliberately simple and explained to the user. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "密碼至少需要 10 個字元。";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "密碼需要同時包含字母與數字。";
  return null;
}

// ── email allowlist ────────────────────────────────────────────────────
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Domains permitted to register, from AUTH_ALLOWED_EMAIL_DOMAINS (comma separated). */
export function allowedDomains(): string[] {
  return (process.env.AUTH_ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Whether this address may register. An EMPTY allowlist blocks everyone rather
 * than allowing everyone — a misconfigured env var must not silently open
 * registration to the internet.
 */
export function emailAllowed(email: string): boolean {
  const domains = allowedDomains();
  if (domains.length === 0) return false;
  const at = normalizeEmail(email).lastIndexOf("@");
  if (at < 1) return false;
  const domain = normalizeEmail(email).slice(at + 1);
  return domains.includes(domain);
}

// ── users ──────────────────────────────────────────────────────────────
export async function findUserByEmail(email: string): Promise<AppUser | undefined> {
  return (await db.select().from(appUser).where(eq(appUser.email, normalizeEmail(email))))[0];
}

export async function findUserById(id: string): Promise<AppUser | undefined> {
  return (await db.select().from(appUser).where(eq(appUser.id, id)))[0];
}

export type RegisterOutcome =
  | { ok: true; user: AppUser }
  | { ok: false; reason: "not_allowed" | "exists" | "weak"; message: string };

export async function registerUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<RegisterOutcome> {
  const email = normalizeEmail(input.email);
  if (!emailAllowed(email)) {
    const list = allowedDomains();
    return {
      ok: false,
      reason: "not_allowed",
      message: list.length
        ? `此網域無法註冊，只開放：${list.map((d) => "@" + d).join("、")}`
        : "註冊尚未開放（AUTH_ALLOWED_EMAIL_DOMAINS 未設定），請聯絡管理員。",
    };
  }
  const weak = passwordProblem(input.password);
  if (weak) return { ok: false, reason: "weak", message: weak };

  const [row] = await db
    .insert(appUser)
    .values({
      email,
      passwordHash: await hashPassword(input.password),
      name: input.name?.trim() || null,
    })
    .onConflictDoNothing({ target: appUser.email })
    .returning();

  if (!row) return { ok: false, reason: "exists", message: "這個 email 已經註冊過了，請直接登入。" };
  return { ok: true, user: row };
}

/** Verify credentials. Returns null for both "no such user" and "wrong password". */
export async function authenticate(email: string, password: string): Promise<AppUser | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Spend comparable time on a dummy hash so response timing does not reveal
    // whether the address exists.
    await verifyPassword(password, `scrypt:${randomBytes(16).toString("base64")}:${randomBytes(64).toString("base64")}`);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  await db.update(appUser).set({ lastLoginAt: new Date() }).where(eq(appUser.id, user.id));
  return user;
}

// ── session lifecycle ──────────────────────────────────────────────────
export async function startSession(user: AppUser): Promise<void> {
  const token = await signSession({
    uid: user.id,
    sv: user.tokenVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The signed-in user, or null.
 *
 * Signature + expiry are checked first (cheap, no DB), then the DB confirms the
 * user still exists and the token version still matches — that second check is
 * what makes revocation work.
 */
export async function currentUser(): Promise<AppUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let payload = null;
  try {
    payload = await verifySession(token);
  } catch {
    // e.g. AUTH_SECRET missing → treat as signed out, never as signed in.
    return null;
  }
  if (!payload) return null;
  const user = await findUserById(payload.uid);
  if (!user || user.tokenVersion !== payload.sv) return null;
  return user;
}

/**
 * Assert a signed-in user, for use at the top of every Server Action.
 *
 * Next 16 note: Server Functions are POSTs to the route they live on, and the
 * Proxy matcher can be changed or the action moved without anyone noticing the
 * lost coverage. The framework docs are explicit that authorization belongs
 * inside each Server Function — proxy.ts is only an optimistic redirect.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHENTICATED: 請先登入後再操作。");
  return user;
}

// ── password reset ─────────────────────────────────────────────────────
/** Reset links are valid for 60 minutes. */
const RESET_TTL_MS = 60 * 60 * 1000;
/** At most one reset mail per address per this window, to stop mail-bombing. */
const RESET_THROTTLE_MS = 2 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Issue a reset token for an address. Returns the raw token to email, or null
 * when there is no such user or one was just issued — callers must show the
 * same message either way so the page cannot be used to test for accounts.
 */
export async function createPasswordResetToken(email: string): Promise<{ token: string; user: AppUser } | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;

  const recent = (
    await db
      .select({ createdAt: passwordReset.createdAt })
      .from(passwordReset)
      .where(
        and(
          eq(passwordReset.userId, user.id),
          gt(passwordReset.createdAt, new Date(Date.now() - RESET_THROTTLE_MS)),
        ),
      )
      .limit(1)
  )[0];
  if (recent) return null;

  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordReset).values({
    tokenHash: sha256(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  // Opportunistic cleanup of dead rows; cheap and keeps the table small.
  await db
    .delete(passwordReset)
    .where(or(lt(passwordReset.expiresAt, new Date()), sql`${passwordReset.usedAt} is not null`));

  return { token, user };
}

export type ResetOutcome =
  | { ok: true }
  | { ok: false; reason: "invalid" | "weak"; message: string };

/**
 * Consume a reset token and set the new password. Bumps token_version so every
 * existing session for that account is invalidated — a password reset is
 * exactly when you want other sessions killed.
 */
export async function consumePasswordResetToken(token: string, newPassword: string): Promise<ResetOutcome> {
  const weak = passwordProblem(newPassword);
  if (weak) return { ok: false, reason: "weak", message: weak };

  const row = (
    await db
      .select()
      .from(passwordReset)
      .where(
        and(
          eq(passwordReset.tokenHash, sha256(token)),
          isNull(passwordReset.usedAt),
          gt(passwordReset.expiresAt, new Date()),
        ),
      )
  )[0];
  if (!row) {
    return { ok: false, reason: "invalid", message: "這個重設連結無效或已過期，請重新申請一次。" };
  }

  await db
    .update(appUser)
    .set({
      passwordHash: await hashPassword(newPassword),
      tokenVersion: sql`${appUser.tokenVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(appUser.id, row.userId));
  await db
    .update(passwordReset)
    .set({ usedAt: new Date() })
    .where(eq(passwordReset.tokenHash, row.tokenHash));

  return { ok: true };
}
