"use server";

/**
 * Authentication Server Actions.
 *
 * These deliberately return a result object instead of throwing: an uncaught
 * throw in a Server Action becomes an opaque 500 in production (the same class
 * of bug that made "由文案建立場景" show a blank error page), and a login form
 * of all things must be able to say what went wrong.
 *
 * redirect() is NOT used on success — it throws a control-flow exception that a
 * surrounding try/catch would swallow. The client component navigates instead.
 */
import { redirect } from "next/navigation";
import {
  authenticate,
  consumePasswordResetToken,
  createPasswordResetToken,
  endSession,
  normalizeEmail,
  registerUser,
  startSession,
} from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { friendlyError, type ActionResult } from "@/lib/errmsg";

/** Keep the post-login redirect on this site — never bounce to an attacker's URL. */
function safeNext(next: string | undefined): string {
  if (!next) return "/";
  // Must be a single-slash absolute path. Rejects "//evil.com" and "https://evil.com".
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function loginAction(formData: FormData): Promise<ActionResult & { next?: string }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "") || undefined);
  if (!email || !password) return { ok: false, message: "請輸入 email 與密碼。" };

  try {
    const user = await authenticate(email, password);
    // Same message for "no such account" and "wrong password" — telling them
    // apart lets anyone enumerate who works here.
    if (!user) return { ok: false, message: "Email 或密碼不正確。" };
    await startSession(user);
    return { ok: true, next };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}

export async function registerAction(formData: FormData): Promise<ActionResult & { next?: string }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const name = String(formData.get("name") ?? "");
  if (!email || !password) return { ok: false, message: "請輸入 email 與密碼。" };
  if (password !== confirm) return { ok: false, message: "兩次輸入的密碼不一致。" };

  try {
    const r = await registerUser({ email, password, name });
    if (!r.ok) return { ok: false, message: r.message };
    await startSession(r.user);
    return { ok: true, next: "/" };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}

/**
 * Always reports the same thing, whether or not the address has an account and
 * whether or not a mail was throttled — otherwise this form is an oracle for
 * "does this person have an account here".
 */
export async function forgotPasswordAction(formData: FormData): Promise<ActionResult> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const generic = "如果這個 email 有帳號，重設連結已經寄出，請收信（也看一下垃圾郵件匣）。";
  if (!email) return { ok: false, message: "請輸入 email。" };

  try {
    const issued = await createPasswordResetToken(email);
    if (issued) await sendPasswordResetEmail(email, issued.token);
    return { ok: true, message: generic };
  } catch (err) {
    // A genuine mail-delivery failure IS worth surfacing — otherwise the admin
    // waits forever for a mail that was never going to arrive.
    return { ok: false, message: `寄信失敗：${friendlyError(err)}` };
  }
}

export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!token) return { ok: false, message: "缺少重設權杖，請從信件中的連結進入。" };
  if (password !== confirm) return { ok: false, message: "兩次輸入的密碼不一致。" };

  try {
    const r = await consumePasswordResetToken(token, password);
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, message: "密碼已更新，請用新密碼登入。" };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
