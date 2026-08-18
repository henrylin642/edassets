import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-shot migration runner for serverless (Vercel), where DATABASE_URL is a
 * "Sensitive" env var that can't be read back to migrate from a laptop.
 * It applies any pending migrations in ./drizzle using the DATABASE_URL that
 * already exists in the running function — the secret is never exposed.
 *
 * Protected by MIGRATE_SECRET: GET /api/migrate?secret=<MIGRATE_SECRET>.
 * Uses a dedicated max:1 connection (recommended for migrations).
 */
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.DATABASE_URL;
  if (!url) return Response.json({ ok: false, error: "DATABASE_URL not set" }, { status: 500 });

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const client = postgres(url, { max: 1, ssl: isLocal ? false : "require", prepare: false });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
    return Response.json({ ok: true, migrated: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    await client.end();
  }
}
