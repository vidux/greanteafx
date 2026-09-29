import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The repo root has its own lockfile; without this Next picks it as the workspace root.
  turbopack: { root: path.join(__dirname) },
  /**
   * `node-web-audio-api` ships a native (N-API) binary. It must be `require`d from the
   * server runtime rather than traced/bundled by webpack, or the `.node` addon is lost.
   */
  serverExternalPackages: ['node-web-audio-api'],

  experimental: {
    serverActions: {
      // Mixdown jobs post the whole project graph; uploads go to /api/assets as multipart.
      bodySizeLimit: '64mb',
    },
  },

  async headers() {
    const origin = process.env.GREANTEAFX_CORS_ORIGIN ?? 'http://localhost:3000';
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: origin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          /*
           * Without this the browser hides every custom response header from JS on a
           * cross-origin request, so the render stats read back as null and the UI reported
           * "rendered in 0 ms". Only the safelisted headers are visible by default.
           */
          {
            key: 'Access-Control-Expose-Headers',
            value:
              'X-GreanTeaFX-Render-Ms, X-GreanTeaFX-Track-Count, X-GreanTeaFX-Clip-Count, X-GreanTeaFX-Asset-Count, X-GreanTeaFX-Sample-Rate, Content-Disposition, Retry-After',
          },
          { key: 'Access-Control-Max-Age', value: '86400' },
          // Browsers must honour the declared type, never sniff a response into HTML or script.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
