import path from 'node:path'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

function normalizeEnvValue(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function isEnabledFlag(value: string | undefined) {
  return value === 'true' || value === '1'
}

export default defineConfig(({ mode }) => ({
  test: (() => {
    const loadedEnv = loadEnv(mode, process.cwd(), '')
    const env = {
      ...loadedEnv,
      NODE_ENV: 'test',
      LANGSMITH_PROJECT:
        normalizeEnvValue(loadedEnv.LANGSMITH_PROJECT ?? loadedEnv.LANGCHAIN_PROJECT) ?? 'chatbox-chatbridge',
      LANGSMITH_API_KEY: normalizeEnvValue(loadedEnv.LANGSMITH_API_KEY ?? loadedEnv.LANGCHAIN_API_KEY) ?? '',
      LANGSMITH_ENDPOINT: normalizeEnvValue(loadedEnv.LANGSMITH_ENDPOINT ?? loadedEnv.LANGCHAIN_ENDPOINT) ?? '',
      LANGSMITH_WORKSPACE_ID:
        normalizeEnvValue(loadedEnv.LANGSMITH_WORKSPACE_ID ?? loadedEnv.LANGCHAIN_WORKSPACE_ID) ?? '',
      LANGSMITH_TRACING: loadedEnv.LANGSMITH_TRACING ?? loadedEnv.LANGCHAIN_TRACING_V2 ?? 'false',
      LANGSMITH_TEST_TRACKING: loadedEnv.LANGSMITH_TEST_TRACKING ?? 'false',
    }
    const reporters = ['default']

    if (
      isEnabledFlag(env.LANGSMITH_TRACING) &&
      isEnabledFlag(env.LANGSMITH_TEST_TRACKING) &&
      env.LANGSMITH_API_KEY
    ) {
      reporters.push('langsmith/vitest/reporter')
    }

    return {
      globals: true,
      environment: 'node',
      env,
      include: ['test/integration/chatbridge/edd/**/*.eval.ts'],
      setupFiles: ['test/integration/chatbridge/setup.ts'],
      testTimeout: 300000,
      hookTimeout: 300000,
      reporters,
    }
  })(),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      src: path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
}))
