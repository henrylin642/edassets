/**
 * Turn a thrown error into a short, actionable Traditional-Chinese message for
 * the admin UI.
 *
 * Why: every LLM / image / 3D call can fail for reasons the operator can fix
 * (no OpenAI credits, bad key, rate limit, LiG down). Next.js hides the real
 * message in production builds — it only ships an opaque `digest` — so if an
 * action lets the error escape, the whole page 500s with "This page couldn't
 * load" and the operator has to dig through Vercel logs. Catch it, map it here,
 * show it next to the button that caused it.
 */

/** Best-effort extraction of a message from unknown thrown values. */
function raw(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** OpenAI SDK errors carry `status` / `code`; read them without importing the SDK. */
function fields(err: unknown): { status?: number; code?: string } {
  const e = err as { status?: unknown; code?: unknown } | null;
  return {
    status: typeof e?.status === "number" ? e.status : undefined,
    code: typeof e?.code === "string" ? e.code : undefined,
  };
}

export function friendlyError(err: unknown): string {
  const msg = raw(err);
  const { status, code } = fields(err);

  // ── auth ──────────────────────────────────────────────────────────────
  if (/^UNAUTHENTICATED/.test(msg)) {
    return "工作階段已過期，請重新登入後再操作。";
  }

  // ── OpenAI ────────────────────────────────────────────────────────────
  if (code === "credit_balance_exhausted" || code === "insufficient_quota" || /insufficient_quota|no credits remaining/i.test(msg)) {
    return "OpenAI 帳戶額度已用盡，請到 platform.openai.com 的 Billing 頁面儲值後再試。";
  }
  if (status === 429 || /rate limit/i.test(msg)) {
    return "OpenAI 請求太頻繁（429），請稍等幾秒再試。";
  }
  if (status === 401 || /invalid[_ ]api[_ ]key|OPENAI_API_KEY not set/i.test(msg)) {
    return "OpenAI API key 無效或未設定，請檢查 Vercel 的 OPENAI_API_KEY 環境變數。";
  }
  if (/model.*(does not exist|not found)|invalid model/i.test(msg)) {
    return `OpenAI 模型不存在或此帳戶無權限使用：${msg}`;
  }
  if (status === 400 && /content|safety|moderation/i.test(msg)) {
    return `內容被 OpenAI 拒絕，請修改文案或 prompt 後再試：${msg}`;
  }

  // ── LiG ───────────────────────────────────────────────────────────────
  if (/LIG_BASE|LIG_EMAIL|LIG_PASSWORD/.test(msg)) {
    return "LiG 環境變數未設定（LIG_BASE / LIG_EMAIL / LIG_PASSWORD）。";
  }
  if (/LiG \/login/.test(msg)) return `LiG 登入失敗：${msg}`;
  if (/LiG \//.test(msg)) return `LiG 上架失敗：${msg}`;

  // ── Tripo ─────────────────────────────────────────────────────────────
  if (/TRIPO_API_KEY not set/.test(msg)) return "Tripo API key 未設定（TRIPO_API_KEY）。";
  if (/Tripo /.test(msg)) return `Tripo 3D 失敗：${msg}`;

  // ── DB / infra ────────────────────────────────────────────────────────
  if (/DATABASE_URL not set/.test(msg)) return "DATABASE_URL 未設定。";
  if (/too many connections|remaining connection slots/i.test(msg)) {
    return "資料庫連線數已滿，請稍等幾秒再試。";
  }
  if (/column .* does not exist|relation .* does not exist/i.test(msg)) {
    return `資料庫 schema 落後於程式碼，請先跑 migration：${msg}`;
  }
  if (/fetch failed|ETIMEDOUT|ECONNRESET|socket hang up/i.test(msg)) {
    return `連線外部服務失敗（可能是逾時），請再試一次：${msg}`;
  }

  return msg || "發生未知錯誤。";
}

/** Standard shape returned by admin server actions so the UI can show failures. */
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

/** Run an action body, converting any throw into a displayable ActionResult. */
export async function guard(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? undefined };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}
