import { allowedDomains } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Diagnostic: which required env vars are visible AT RUNTIME.
 *
 * Booleans only — never the values. Public on purpose (see proxy.ts): this is
 * the page you need precisely when you cannot log in, and the most common
 * failure by far is adding variables in Vercel without redeploying, which this
 * makes obvious in one request.
 */
export async function GET() {
  const keys = [
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "LIG_BASE",
    "LIG_EMAIL",
    "LIG_PASSWORD",
    "TRIPO_BASE",
    "TRIPO_API_KEY",
    // auth (added with the login system)
    "AUTH_SECRET",
    "AUTH_ALLOWED_EMAIL_DOMAINS",
    "MIGRATE_SECRET",
    "APP_URL",
  ];
  const present = Object.fromEntries(keys.map((k) => [k, Boolean(process.env[k]?.trim())]));

  // A secret shorter than 16 chars is rejected by lib/session.ts, which would
  // otherwise look like "set, but nobody can log in".
  const authSecretLen = process.env.AUTH_SECRET?.length ?? 0;

  return Response.json({
    env: process.env.VERCEL_ENV ?? "local",
    present,
    auth: {
      // not secret — /register already displays this list
      allowedDomains: allowedDomains(),
      authSecretLongEnough: authSecretLen >= 16,
      // Catches the classic "pasted with a trailing newline" case without
      // revealing anything about the value itself.
      migrateSecretHasWhitespace: /^\s|\s$/.test(process.env.MIGRATE_SECRET ?? ""),
    },
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  });
}
