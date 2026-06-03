const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      // server.js, bin/, and llm-adapter.js run inside spawned subprocesses
      // (integration/e2e), so v8 can't instrument them from the parent. They
      // are proven by those tests; coverage measures the unit-tested core.
      include: ['lib/**/*.js'],
      exclude: ['lib/llm-adapter.js'],
      thresholds: {
        lines: 70,
        functions: 80,
        branches: 60,
        statements: 70,
      },
    },
  },
});
