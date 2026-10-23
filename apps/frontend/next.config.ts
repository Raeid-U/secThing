import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_API_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["100.81.0.12", "localhost", "127.0.0.1"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
