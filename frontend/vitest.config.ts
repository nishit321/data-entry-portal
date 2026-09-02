import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test config kept separate from vite.config.ts so the app build stays lean.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // `e2e/` belongs to Playwright. Vitest picking those up gives a confusing failure about
    // `test()` being called in the wrong place, which says nothing about either suite.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
