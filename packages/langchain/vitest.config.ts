import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['./src/**/*.test.ts', './src/**/*.test.tsx'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'json'],
      reportOnFailure: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/index.ts'],
    },
  },
})
