/**
 * Drizzle DB client (postgres.js driver).
 * Reuses a single connection across hot-reloads in dev.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const globalForDb = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };

// Local Docker → no SSL; cloud (Neon/Supabase/Vercel PG) → require SSL.
// prepare:false keeps it compatible with serverless/transaction-pooled endpoints.
const isLocal = /localhost|127\.0\.0\.1/.test(url);
const client =
  globalForDb.__pg ??
  postgres(url, { max: 10, ssl: isLocal ? false : "require", prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.__pg = client;

export const db = drizzle(client, { schema });
export { schema };
