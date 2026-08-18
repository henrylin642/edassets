/**
 * Transactional email through Google Workspace, via the Gmail API.
 *
 * Why this and not SMTP: Google disabled legacy-password SMTP in March 2025 and
 * now positions app passwords as a fallback for devices that cannot do OAuth,
 * revocable by admin policy. The Gmail REST API is the supported path, and it
 * is plain HTTPS — far better suited to serverless than holding open an SMTP
 * connection through a cold start.
 *
 * Zero dependencies: the service-account JWT is signed with node:crypto, so
 * there is no googleapis / nodemailer in the tree.
 *
 * Auth flow (service account + domain-wide delegation):
 *   1. build a JWT that asks to impersonate GMAIL_SENDER with the gmail.send scope
 *   2. sign it RS256 with the service account's private key
 *   3. exchange it at oauth2.googleapis.com for an access token
 *   4. POST the RFC 5322 message to gmail.googleapis.com
 *
 * Setup (one time, see DEPLOY.md):
 *   GCP → enable Gmail API → create service account → enable domain-wide
 *   delegation → Workspace Admin → API controls → authorize that client ID for
 *   scope https://www.googleapis.com/auth/gmail.send
 *
 * env: GOOGLE_SERVICE_ACCOUNT_JSON (the whole key file), GMAIL_SENDER, AUTH_EMAIL_FROM
 */
import { createSign } from "node:crypto";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 未設定，無法寄出密碼重設信。");
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 不是合法的 JSON，請貼入完整的服務帳號金鑰檔內容。");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key。");
  }
  // Some dashboards store the PEM with literal \n; normalize either form.
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}

/** The Workspace mailbox the service account impersonates (must really exist). */
function sender(): string {
  const s = process.env.GMAIL_SENDER;
  if (!s) throw new Error("GMAIL_SENDER 未設定（要寄件的 Workspace 信箱，例如 noreply@ezuse.ai）。");
  return s;
}

function fromHeader(): string {
  return process.env.AUTH_EMAIL_FROM || `AR Assets Studio <${sender()}>`;
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── access token ───────────────────────────────────────────────────────
/** Tokens last an hour; reuse within a warm instance instead of minting per mail. */
let cachedToken: { token: string; expiresAtMs: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) return cachedToken.token;

  const sa = serviceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: sender(), // domain-wide delegation: act as this mailbox
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = b64url(
    createSign("RSA-SHA256").update(`${header}.${claims}`).end().sign(sa.private_key),
  );

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${body}`);
  const json = JSON.parse(body) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error(`Google OAuth 未回傳 access_token：${body}`);

  cachedToken = {
    token: json.access_token,
    expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// ── RFC 5322 assembly ──────────────────────────────────────────────────
/** Wrap base64 at 76 chars, as required for a well-formed MIME body part. */
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

/** RFC 2047 encoded-word, so a Traditional Chinese subject survives transport. */
const encodeSubject = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

function buildMime(opts: { from: string; to: string; subject: string; text: string; html: string }): string {
  const boundary = `b_${b64url(String(Date.now())).slice(0, 16)}_arstudio`;
  const part = (contentType: string, content: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(Buffer.from(content, "utf8").toString("base64")),
      "",
    ].join("\r\n");

  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeSubject(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", opts.text),
    part("text/html", opts.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// ── send ───────────────────────────────────────────────────────────────
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const raw = b64url(
    buildMime({
      from: fromHeader(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    }),
  );
  const res = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
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
