"use server";

/**
 * Admin actions for account management.
 *
 * Same rule as app/actions.ts: each Server Function gates itself. Next 16's
 * Proxy cannot be relied on for Server Functions — they are POSTs to the route
 * they live on, so a matcher change silently removes coverage.
 */
import { revalidatePath } from "next/cache";
import { deleteUser, issueResetLink, requireUserOrRedirect } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/errmsg";

export type ResetLinkResult =
  | { ok: true; url: string; expiresAt: string; email: string }
  | { ok: false; message: string };

/** Generate a single-use reset link for a colleague, to hand over via LINE/Slack. */
export async function issueResetLinkAction(userId: string, email: string): Promise<ResetLinkResult> {
  await requireUserOrRedirect();
  try {
    const { url, expiresAt } = await issueResetLink(userId);
    return { ok: true, url, expiresAt: expiresAt.toISOString(), email };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}

export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const me = await requireUserOrRedirect();
  // Deleting the account you are signed in as would lock you out of the console
  // with no way back — and if it is the last account, out of the app entirely.
  if (me.id === userId) return { ok: false, message: "不能刪除自己正在使用的帳號。" };
  try {
    await deleteUser(userId);
    revalidatePath("/users");
    return { ok: true, message: "帳號已刪除" };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}
