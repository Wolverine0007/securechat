import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbo: {
      memoryLimit: 512,  // limit Turbopack RAM to 512MB
    }
  }
};

export default nextConfig;
