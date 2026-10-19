import type { NextConfig } from 'next';

const config: NextConfig = {
  // @matchup/contracts — TS manbalar (faqat tiplar), Next ularni transpile qiladi
  transpilePackages: ['@matchup/contracts'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
