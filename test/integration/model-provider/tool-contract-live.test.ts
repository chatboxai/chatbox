/**
 * Natural-task first-call evaluation across four live protocols.
 * Run explicitly with test:model-provider, targeting this file.
 * Requires managed DeepSeek and Gemini credentials. These exact first-call
 * expectations measure model behavior and are separate from the mandatory API gate.
 */

import type { ModelMessage } from 'ai'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSchema, uploadedFileSearchSchema } from '../../../src/shared/uploaded-file-tools'
import { validatedToolSchema } from '../../../src/shared/validated-tool-schema'
import TestPlatform from '../../../src/renderer/platform/test_platform'
import { settings as getDefaultSettings, newConfigs } from '../../../src/shared/defaults'
import { getModel } from '../../../src/shared/providers'
import {
  ModelProviderType,
  type ProviderModelInfo,
  type SessionSettings,
  type Settings,
} from '../../../src/shared/types'
import type { ModelDependencies } from '../../../src/shared/types/adapters'
import { createMockModelDependencies } from '../mocks/model-dependencies'
import { MockSentryAdapter } from '../mocks/sentry'

interface LiveProviderCase {
  name: string
  providerId: string
  providerType: ModelProviderType
  apiKeyEnv: string
  apiHost: string
  expectedOrigin: string
  modelEnv: string
  defaultModel: string
}

const LIVE_PROVIDER_CASES: LiveProviderCase[] = [
  {
    name: 'DeepSeek via OpenAI Responses API',
    providerId: 'live-openai-responses',
    providerType: ModelProviderType.OpenAIResponses,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiHost: 'https://api.deepseek.com',
    expectedOrigin: 'https://api.deepseek.com',
    modelEnv: 'AI_API_LIVE_OPENAI_RESPONSES_MODEL',
    defaultModel: 'deepseek-v4-flash',
  },
  {
    name: 'DeepSeek via OpenAI-compatible custom Provider',
    providerId: 'live-deepseek-custom-openai-compatible',
    providerType: ModelProviderType.OpenAI,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiHost: 'https://api.deepseek.com',
    expectedOrigin: 'https://api.deepseek.com',
    modelEnv: 'AI_API_LIVE_CUSTOM_PROVIDER_MODEL',
    defaultModel: 'deepseek-v4-flash',
  },
  {
    name: 'DeepSeek via Anthropic-compatible API',
    providerId: 'live-deepseek-anthropic-compatible',
    providerType: ModelProviderType.Claude,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiHost: 'https://api.deepseek.com/anthropic/v1',
    expectedOrigin: 'https://api.deepseek.com',
    modelEnv: 'AI_API_LIVE_CLAUDE_MODEL',
    defaultModel: 'deepseek-v4-flash',
  },
  {
    name: 'Google Gemini',
    providerId: 'live-gemini',
    providerType: ModelProviderType.Gemini,
    apiKeyEnv: 'GEMINI_API_KEY',
    apiHost: 'https://generativelanguage.googleapis.com',
    expectedOrigin: 'https://generativelanguage.googleapis.com',
    modelEnv: 'AI_API_LIVE_GEMINI_MODEL',
    defaultModel: 'gemini-2.5-flash',
  },
]

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  expect(value, `${name} is required; the live gate must not pass with a missing input`).toBeTruthy()
  return value || ''
}

async function createTrackedDependencies(providerName: string, expectedOrigin: string) {
  const baseDependencies = await createMockModelDependencies(new TestPlatform(), new MockSentryAdapter())
  const baseApiRequest = baseDependencies.request.apiRequest.bind(baseDependencies.request)
  let postRequestCount = 0
  const dependencies: ModelDependencies = {
    ...baseDependencies,
    request: {
      ...baseDependencies.request,
      apiRequest(options) {
        if ((options.method || 'GET') === 'POST') {
          postRequestCount += 1
          expect(options.useProxy, `${providerName} must forward useProxy=true to the host RequestAdapter`).toBe(true)
          expect(new URL(options.url).origin, `${providerName} must use its expected API origin`).toBe(expectedOrigin)
        }
        return baseApiRequest(options)
      },
    },
  }

  return {
    dependencies,
    getPostRequestCount: () => postRequestCount,
  }
}

function createSettings(liveCase: LiveProviderCase, apiKey: string, apiHost: string, model: ProviderModelInfo) {
  const defaults = getDefaultSettings()
  const globalSettings: Settings = {
    ...defaults,
    customProviders: [
      ...(defaults.customProviders || []),
      {
        id: liveCase.providerId,
        name: liveCase.name,
        type: liveCase.providerType,
        isCustom: true,
        defaultSettings: {
          apiHost,
          models: [model],
        },
      },
    ],
    providers: {
      ...defaults.providers,
      [liveCase.providerId]: {
        apiKey,
        apiHost,
        models: [model],
        useProxy: true,
      },
    },
  }
  const sessionSettings: SessionSettings = {
    provider: liveCase.providerId,
    modelId: model.modelId,
    maxTokens: 1024,
    stream: true,
  }
  return { globalSettings, sessionSettings }
}

describe('Natural-task first-call tool contract evaluation', () => {
  beforeAll(() => {
    const requiredEnvironment = LIVE_PROVIDER_CASES.map((liveCase) => liveCase.apiKeyEnv)
    const missingEnvironment = [...new Set(requiredEnvironment)].filter((name) => !process.env[name]?.trim())
    expect(
      missingEnvironment,
      `All live inputs are required before the first billable request: ${missingEnvironment.join(', ')}`
    ).toEqual([])
  })

  for (const liveCase of LIVE_PROVIDER_CASES) {
    it(`streams a real ${liveCase.name} reply through the production custom-provider path`, async () => {
      const apiKey = requireEnvironmentVariable(liveCase.apiKeyEnv)
      const apiHost = liveCase.apiHost
      expect(new URL(apiHost).origin, `${liveCase.name} must use its approved API origin`).toBe(liveCase.expectedOrigin)
      const model: ProviderModelInfo = {
        modelId: process.env[liveCase.modelEnv]?.trim() || liveCase.defaultModel,
        type: 'chat',
      }
      const { globalSettings, sessionSettings } = createSettings(liveCase, apiKey, apiHost, model)
      const { dependencies, getPostRequestCount } = await createTrackedDependencies(
        liveCase.name,
        liveCase.expectedOrigin
      )
      const providerModel = getModel(sessionSettings, globalSettings, newConfigs(), dependencies)
      const messages: ModelMessage[] = [
        { role: 'system', content: 'Follow the user instruction exactly.' },
        { role: 'user', content: 'Reply with exactly: LIVE_OK' },
      ]

      const result = await providerModel.chat(messages, {})
      const text = result.contentParts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')

      expect(getPostRequestCount(), `${liveCase.name} must issue a real POST request`).toBeGreaterThan(0)
      expect(text).toContain('LIVE_OK')

      const recordChange = vi.fn(async (_input: unknown) => ({ receipt: 'LIVE_TOOL_OK' }))
      const toolResult = await providerModel.chat(
        [
          {
            role: 'system',
            content: 'Use the available tools to complete the task. Report the receipt after it returns.',
          },
          {
            role: 'user',
            content: 'Preview a text replacement changing "before" to "after", and report the receipt.',
          },
        ],
        {
          maxSteps: 2,
          tools: {
            record_change: {
              description: 'Record a proposed text change and return a receipt.',
              inputSchema: validatedToolSchema({
                type: 'object',
                properties: {
                  mode: { type: 'string', enum: ['preview'] },
                  edits: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: { old_text: { type: 'string' }, new_text: { type: 'string' } },
                      required: ['old_text', 'new_text'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['mode', 'edits'],
                additionalProperties: false,
              }),
              execute: recordChange,
            },
          },
        }
      )
      expect(toolResult.contentParts.filter((part) => part.type === 'tool-call')).toHaveLength(1)
      expect(recordChange).toHaveBeenCalledTimes(1)
      expect(recordChange.mock.calls[0][0]).toEqual({
        mode: 'preview',
        edits: [{ old_text: 'before', new_text: 'after' }],
      })
      expect(
        toolResult.contentParts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      ).toContain('LIVE_TOOL_OK')

      const readAttachment = vi.fn(async (_input: unknown) => '201: ALPHA\n202: BETA')
      const searchAttachment = vi.fn(async (_input: unknown) => 'No matches')
      const attachmentResult = await providerModel.chat(
        [
          { role: 'system', content: 'Use the available tools to retrieve the requested content, then quote it.' },
          {
            role: 'user',
            content:
              'Show only lines 201 through 202 of the attached report.\n<ATTACHMENT_FILE><FILE_NAME>report.txt</FILE_NAME><FILE_PATH>/__chatbox__/files/57f1e3b0-8954-559d-a610-30d0b27953ce</FILE_PATH><FILE_LINES>600</FILE_LINES></ATTACHMENT_FILE>',
          },
        ],
        {
          maxSteps: 2,
          tools: {
            read_file: {
              description: 'Read a file by its path in <FILE_PATH>. Use offset (1-based) and limit for line ranges.',
              inputSchema: validatedToolSchema(readFileSchema),
              execute: readAttachment,
            },
            search_file_content: {
              description: 'Search for a keyword or phrase in a user-uploaded attachment.',
              inputSchema: validatedToolSchema(uploadedFileSearchSchema),
              execute: searchAttachment,
            },
          },
        }
      )
      expect(attachmentResult.contentParts.filter((part) => part.type === 'tool-call')).toHaveLength(1)
      expect(searchAttachment).not.toHaveBeenCalled()
      expect(readAttachment).toHaveBeenCalledTimes(1)
      expect(readAttachment.mock.calls[0][0]).toEqual({
        file_path: '/__chatbox__/files/57f1e3b0-8954-559d-a610-30d0b27953ce',
        offset: 201,
        limit: 2,
      })
      expect(
        attachmentResult.contentParts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      ).toContain('ALPHA')
    })
  }
})
