import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Builds run on the Mac only (`make deploy`) — the Pi never builds — so the
    // type check is on: a type error fails the build instead of shipping.
    ignoreBuildErrors: false,
  },
  experimental: {
    // Limit page-data workers to 1 on Pi (3 workers OOM the 1GB RAM)
    cpus: 1,
  },
};

export default nextConfig;
