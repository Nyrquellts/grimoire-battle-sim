import { defineConfig } from 'vitest/config';

/** Headless test configuration for CI. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false
  }
});
