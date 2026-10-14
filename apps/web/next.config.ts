import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  eslint: {
    // Lint is run explicitly via `npm run lint`; keep builds focused on type/compile errors.
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
