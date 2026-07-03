import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Type checking runs on Mac — skip on Pi to avoid OOM/hang
    ignoreBuildErrors: true,
  },
  experimental: {
    // Limit page-data workers to 1 on Pi (3 workers OOM the 1GB RAM)
    cpus: 1,
  },
};

export default nextConfig;
