import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The studio reuses the agent code in ../web/lib (one copy of every agent, rule and safety gate), so the bundler root is the repo.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['127.0.0.1', '*.local'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }];
  },
};
export default nextConfig;
