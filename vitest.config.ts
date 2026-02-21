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
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/integration/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'release'],
    setupFiles: [],
    testTimeout: 10000,
    hookTimeout: 10000,
    // Suppress console output in tests
    silent: true,
    logHeapUsage: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      src: path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
}))
