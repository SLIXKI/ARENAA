import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    // The browser utils touch window/localStorage; the setup file stubs them so we
    // do not need a full jsdom install for pure-logic tests.
  },
});
