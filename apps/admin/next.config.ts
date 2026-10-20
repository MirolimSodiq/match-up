import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // @matchup/contracts — TS manbalar (faqat tiplar), Next ularni transpile qiladi
  transpilePackages: ['@matchup/contracts'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Docker image: .next/standalone (server.js + faqat kerakli node_modules). Trace root — monorepo ildizi
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default config;
