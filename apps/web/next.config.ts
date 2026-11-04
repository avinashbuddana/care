import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@platform/contracts'],
  rewrites() {
    return Promise.resolve([
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:3001'}/api/:path*`,
      },
    ]);
  },
};
export default config;
