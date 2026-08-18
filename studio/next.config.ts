import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted Docker builds need a standalone server bundle. Gated behind an
  // env var so the Vercel build path is byte-for-byte what it was before —
  // Vercel handles output tracing itself and setting this unconditionally can
  // interfere with it.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  // Bundle the Tom reference image into serverless functions (it's read from disk
  // by lib/openai.ts for concept generation; otherwise it's missing on Vercel).
  outputFileTracingIncludes: {
    "/**": ["./assets/**"],
    // The /api/migrate route reads these SQL files at runtime to migrate the DB.
    "/api/migrate": ["./drizzle/**"],
  },
};

export default nextConfig;
