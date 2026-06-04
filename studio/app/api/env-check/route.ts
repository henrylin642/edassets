export const dynamic = "force-dynamic";

/**
 * Diagnostic: reports which required env vars are visible AT RUNTIME (booleans
 * only — no values leaked). Open /api/env-check on the deployed site to confirm.
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
  ];
  const present = Object.fromEntries(keys.map((k) => [k, Boolean(process.env[k]?.trim())]));
  return Response.json({ env: process.env.VERCEL_ENV ?? "local", present });
}
