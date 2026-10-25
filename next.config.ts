import type { NextConfig } from "next";

const config: NextConfig = {
  // Load @vercel/functions from node_modules at runtime so /api/crash can
  // reach BuildCache, which the package doesn't export.
  serverExternalPackages: ["@vercel/functions"],
  outputFileTracingIncludes: {
    "/api/crash": ["./node_modules/@vercel/functions/**/*"],
  },
};

export default config;
