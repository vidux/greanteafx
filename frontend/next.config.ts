import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The repo root has its own lockfile; without this Next picks it as the workspace root.
  turbopack: { root: path.join(__dirname) },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_GREANTEAFX_API_URL:
      process.env.NEXT_PUBLIC_GREANTEAFX_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
