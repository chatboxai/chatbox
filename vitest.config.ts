import path from 'node:path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Live-API suite must be opted into explicitly (set by the test:model-provider script);
  // an argv/path heuristic could silently run real API calls with keys auto-loaded from .env
  const isModelProviderRun = process.env.RUN_MODEL_PROVIDER_TESTS === '1'
  const defaultInclude = [
    'src/**/*.{test,spec}.{ts,tsx}',
    'packages/**/*.{test,spec}.{ts,tsx}',
    'test/integration/**/*.{test,spec}.{ts,tsx}',
  ]

  return {
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/renderer/routes',
        generatedRouteTree: './src/renderer/routeTree.gen.ts',
      }),
    ],
    test: {
      globals: true,
      environment: 'node',
      env: {
        ...loadEnv(mode, process.cwd(), ''),
        NODE_ENV: 'test',
      },
      include: defaultInclude,
      exclude: [
        // Workspace packages are symlinked into `packages/*/node_modules`, so a bare
        // `node_modules` glob (which only matches the repo root entry) would collect
        // every `packages/chatbox-core` suite a second time through the symlink.
        '**/node_modules/**',
        '**/dist/**',
        'release/**',
        '.erb/**',
        ...(isModelProviderRun ? [] : ['test/integration/model-provider/**']),
      ],
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
      // Vite defaults plus `.cjs`, so vendored CommonJS modules (e.g. src/main/mcp/shell-env.cjs)
      // resolve from extensionless imports the same way they do in the electron-vite build.
      extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.cjs'],
    },
  }
})
