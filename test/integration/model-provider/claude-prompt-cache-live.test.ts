/**
 * NeoRouter-backed live coverage for the official Claude Provider prompt-cache
 * duration setting.
 *
 * Run:
 *   pnpm test:claude-prompt-cache-live
 *
 * Required in the managed environment:
 *   CLAUDE_API_KEY=...
 *   CLAUDE_API_HOST=https://api.neorouter.ai/v1
 *
 * Optional:
 *   TEST_CLAUDE_MODEL=...
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ModelMessage } from 'ai'
import dotenv from 'dotenv'
import { beforeAll, describe, expect, it } from 'vitest'
import TestPlatform from '../../../src/renderer/platform/test_platform'
import { settings as getDefaultSettings, newConfigs, SystemProviders } from '../../../src/shared/defaults'
import { getModel } from '../../../src/shared/providers'
import {
  ModelProviderEnum,
  type ProviderModelInfo,
  type SessionSettings,
  type Settings,
} from '../../../src/shared/types'
import { createMockModelDependencies } from '../mocks/model-dependencies'
import { MockSentryAdapter } from '../mocks/sentry'

const RUN_LIVE_TEST = process.env.RUN_CLAUDE_PROMPT_CACHE_LIVE === '1'
const MANAGED_ENV_READ_TIMEOUT_MS = 10_000
const NEOROUTER_ORIGIN = 'https://api.neorouter.ai'

function loadManagedEnvironment(): void {
  if (process.env.CLAUDE_API_KEY?.trim() && process.env.CLAUDE_API_HOST?.trim()) {
    return
  }

  const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()
  const resolvedGitCommonDir = path.resolve(process.cwd(), gitCommonDir)
  const envPath = resolvedGitCommonDir.endsWith('.git')
    ? path.join(path.dirname(resolvedGitCommonDir), '.env')
    : undefined
  if (!envPath || !existsSync(envPath)) {
    return
  }

  const result = spawnSync('cat', [envPath], {
    encoding: 'utf8',
    timeout: MANAGED_ENV_READ_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })
  if (result.error || result.status !== 0 || !result.stdout) {
    throw new Error(`Managed environment is unavailable or empty: ${envPath}`)
  }

  for (const [name, value] of Object.entries(dotenv.parse(result.stdout))) {
    if (process.env[name] === undefined) {
      process.env[name] = value
    }
  }
}

if (RUN_LIVE_TEST) {
  loadManagedEnvironment()
}

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY?.trim() || ''
const CLAUDE_API_HOST = process.env.CLAUDE_API_HOST?.trim() || ''
const TEST_MODEL = process.env.TEST_CLAUDE_MODEL?.trim() || 'claude-haiku-4-5-20251001'

type PromptCacheTTL = '5m' | '1h'

interface PromptCacheCase {
  name: string
  ttl?: PromptCacheTTL
}

const PROMPT_CACHE_CASES: PromptCacheCase[] = [
  { name: 'Auto' },
  { name: '5 minutes', ttl: '5m' },
  { name: '1 hour', ttl: '1h' },
]

const TRANSPORT_CASES = [
  { name: 'streaming', stream: true },
  { name: 'non-streaming', stream: false },
] as const

const MESSAGES: ModelMessage[] = [
  { role: 'system', content: 'Follow the user instruction exactly.' },
  { role: 'user', content: 'Reply with exactly: CACHE_TTL_OK' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectCacheControls(value: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item)
      }
      return
    }
    if (!isRecord(node)) {
      return
    }

    if (isRecord(node.cache_control)) {
      result.push(node.cache_control)
    }
    for (const child of Object.values(node)) {
      visit(child)
    }
  }

  visit(value)
  return result
}

async function createClaudeModel(promptCacheTTL: PromptCacheTTL | undefined, stream: boolean) {
  const dependencies = await createMockModelDependencies(new TestPlatform(), new MockSentryAdapter())

  const systemProvider = SystemProviders().find((provider) => provider.id === ModelProviderEnum.Claude)
  if (!systemProvider) {
    throw new Error('Claude provider not found')
  }
  const model: ProviderModelInfo = {
    modelId: TEST_MODEL,
    type: 'chat',
  }
  const defaults = getDefaultSettings()
  const globalSettings: Settings = {
    ...defaults,
    providers: {
      ...defaults.providers,
      [ModelProviderEnum.Claude]: {
        ...systemProvider.defaultSettings,
        apiKey: CLAUDE_API_KEY,
        apiHost: CLAUDE_API_HOST,
        models: [model],
        useProxy: true,
      },
    },
  }
  const sessionSettings: SessionSettings = {
    provider: ModelProviderEnum.Claude,
    modelId: TEST_MODEL,
    maxTokens: 64,
    stream,
    ...(promptCacheTTL ? { claudePromptCacheTTL: promptCacheTTL } : {}),
  }

  return getModel(sessionSettings, globalSettings, newConfigs(), dependencies)
}

function installAnthropicRequestSpy() {
  const originalFetch = globalThis.fetch
  const requestBodies: Record<string, unknown>[] = []

  globalThis.fetch = (input, init) => {
    if ((init?.method || 'GET') === 'POST') {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
      expect(url.origin, 'Claude must call the approved NeoRouter origin').toBe(NEOROUTER_ORIGIN)
      expect(url.pathname, 'Claude must use the Anthropic Messages endpoint').toBe('/v1/messages')
      if (typeof init?.body !== 'string') {
        throw new Error('Expected the Anthropic request body to be serialized JSON')
      }
      const body: unknown = JSON.parse(init.body)
      if (!isRecord(body)) {
        throw new Error('Expected the Anthropic request body to be a JSON object')
      }
      requestBodies.push(body)
    }
    return originalFetch(input, init)
  }

  return {
    requestBodies,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

describe.runIf(RUN_LIVE_TEST)('Claude prompt cache duration via NeoRouter Anthropic API', () => {
  beforeAll(() => {
    expect(CLAUDE_API_KEY, 'CLAUDE_API_KEY is required for the NeoRouter live suite').toBeTruthy()
    expect(CLAUDE_API_HOST, 'CLAUDE_API_HOST is required for the NeoRouter live suite').toBeTruthy()
    expect(new URL(CLAUDE_API_HOST).origin, 'CLAUDE_API_HOST must use NeoRouter').toBe(NEOROUTER_ORIGIN)
  })

  for (const promptCacheCase of PROMPT_CACHE_CASES) {
    for (const transportCase of TRANSPORT_CASES) {
      it(`${transportCase.name} request accepts ${promptCacheCase.name}`, async () => {
        const model = await createClaudeModel(promptCacheCase.ttl, transportCase.stream)
        const requestSpy = installAnthropicRequestSpy()
        try {
          const response = await model.chat(MESSAGES, {})
          const text = response.contentParts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')

          expect(text).toContain('CACHE_TTL_OK')
          expect(requestSpy.requestBodies.length, 'The live case must issue an Anthropic POST request').toBeGreaterThan(
            0
          )

          const expectedCacheControl = {
            type: 'ephemeral',
            ...(promptCacheCase.ttl ? { ttl: promptCacheCase.ttl } : {}),
          }
          for (const body of requestSpy.requestBodies) {
            expect(body.stream).toBe(transportCase.stream ? true : undefined)
            const cacheControls = collectCacheControls(body)
            expect(cacheControls.length, 'The wire request must contain a prompt-cache breakpoint').toBeGreaterThan(0)
            for (const cacheControl of cacheControls) {
              expect(cacheControl).toEqual(expectedCacheControl)
            }
          }
        } finally {
          requestSpy.restore()
        }
      }, 180_000)
    }
  }
})
