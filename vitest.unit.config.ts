import path from 'node:path'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: 'node',
    env: {
      ...loadEnv(mode, process.cwd(), ''),
      NODE_ENV: 'test',
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'release', '.erb', 'test/integration'],
    setupFiles: [],
    testTimeout: 10000,
    hookTimeout: 10000,
    silent: true,
    logHeapUsage: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage/unit',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        statements: 25,
        branches: 18,
        functions: 18,
        lines: 25,
      },
      exclude: [
        'node_modules/**',
        'release/**',
        '.erb/**',
        'test/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/**/*.stories.{ts,tsx}',
        'src/renderer/i18n/changelogs/**',
        'src/renderer/i18n/locales/**',
        'src/renderer/static/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/routeTree.gen.ts',
        '**/*.generated.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      src: path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
}))
