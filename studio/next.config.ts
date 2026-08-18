import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the Tom reference image into serverless functions (it's read from disk
  // by lib/openai.ts for concept generation; otherwise it's missing on Vercel).
  outputFileTracingIncludes: {
    "/**": ["./assets/**"],
    // The /api/migrate route reads these SQL files at runtime to migrate the DB.
    "/api/migrate": ["./drizzle/**"],
  },
};

export default nextConfig;
