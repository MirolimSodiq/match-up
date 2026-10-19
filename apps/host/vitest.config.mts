import { defineConfig } from 'vitest/config';

// Faqat sof modullar (offline yadro, QR tekshiruvi) — RN/Expo'siz, Node'da.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
