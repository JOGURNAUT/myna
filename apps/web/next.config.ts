import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace package ships TypeScript source.
  transpilePackages: ['@myna/shared'],
  serverExternalPackages: ['ioredis'],
};

export default config;
