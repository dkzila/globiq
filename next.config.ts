import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` — Vercel manages builds itself (P1-S1 decision).
  reactStrictMode: true,
  typescript: {
    // Fail builds on type errors — quality is enforced by `bun run type-check` in CI.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
