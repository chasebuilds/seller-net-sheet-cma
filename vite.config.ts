import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'] },
});
