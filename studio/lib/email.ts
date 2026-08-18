/**
 * Transactional email via Resend's REST API.
 *
 * Called with plain fetch rather than the `resend` SDK: one HTTP POST does not
 * justify a dependency, and this keeps the module runtime-agnostic.
 *
 * env: RESEND_API_KEY, AUTH_EMAIL_FROM (e.g. "AR Assets Studio <noreply@ezuse.ai>")
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function cfg() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey) throw new Error("RESEND_API_KEY 未設定，無法寄出密碼重設信。");
  if (!from) throw new Error("AUTH_EMAIL_FROM 未設定（例如 \"AR Assets Studio <noreply@ezuse.ai>\"）。");
  return { apiKey, from };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const { apiKey, from } = cfg();
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/** Public base URL for links in emails. */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  // Vercel injects the deployment host; falls back to the production domain.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "https://edassets.ezuse.ai";
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: "重設你的 AR Assets Studio 密碼",
    text:
      `我們收到重設 AR Assets Studio 密碼的請求。\n\n` +
      `請點以下連結設定新密碼（60 分鐘內有效，只能使用一次）：\n${link}\n\n` +
      `如果不是你本人操作，忽略這封信即可，密碼不會有任何變動。`,
    html: `<div style="font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;line-height:1.7;color:#111">
  <h2 style="margin:0 0 12px">重設密碼</h2>
  <p>我們收到重設 <strong>AR Assets Studio</strong> 密碼的請求。</p>
  <p style="margin:24px 0">
    <a href="${link}" style="background:#db2777;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">設定新密碼</a>
  </p>
  <p style="color:#666;font-size:13px">連結 60 分鐘內有效，且只能使用一次。<br>如果不是你本人操作，忽略這封信即可，密碼不會有任何變動。</p>
  <p style="color:#999;font-size:12px;word-break:break-all">若按鈕無法點擊，請複製此網址：<br>${link}</p>
</div>`,
  });
}
