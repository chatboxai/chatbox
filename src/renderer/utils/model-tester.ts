import { getModel } from '@shared/models'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import type { Config, Settings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { jsonSchema, type ToolSet } from 'ai'

export type TestResult = {
  status: 'success' | 'error' | 'pending'
  error?: string
}

export type ModelTestState = {
  testing: boolean
  basicTest?: TestResult
  visionTest?: TestResult
  toolTest?: TestResult
}

export type TestModelOptions = {
  providerId: string
  modelId: string
  settings: Settings
  configs: Config
  dependencies: ModelDependencies
  onStateChange?: (state: ModelTestState) => void
}

const TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const testWeatherTools: CallChatCompletionOptions['tools'] = {
  get_weather: {
    description: 'Get the weather',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
      additionalProperties: false,
    }),
    execute: async () => ({ temperature: 72, condition: 'sunny' }),
  },
} satisfies ToolSet

/**
 * Lightweight connectivity ping used by the Model Rig self-check.
 */
export async function pingModel(
  options: Omit<TestModelOptions, 'onStateChange'> & { vision?: boolean; signal?: AbortSignal }
): Promise<{ ok: boolean; error?: string }> {
  const { providerId, modelId, settings, configs, dependencies, vision, signal } = options
  try {
    const modelInstance = getModel({ ...settings, provider: providerId, modelId }, settings, configs, dependencies)
    if (vision) {
      await modelInstance.chat(
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What color is in this image?' },
              { type: 'image', image: `data:image/png;base64,${TEST_IMAGE_BASE64}` },
            ],
          },
        ],
        { onResultChange: () => {}, signal }
      )
    } else {
      await modelInstance.chat([{ role: 'user', content: 'Hi' }], { onResultChange: undefined, signal })
    }
    return { ok: true }
  } catch (e: unknown) {
    const error = e as { responseBody?: string; message?: string }
    return { ok: false, error: error?.responseBody || error?.message || String(e) }
  }
}

/**
 * Test a model's capabilities
 * @returns The final test state
 */
export async function testModelCapabilities(options: TestModelOptions): Promise<ModelTestState> {
  const { providerId, modelId, settings, configs, dependencies, onStateChange } = options

  let state: ModelTestState = {
    testing: true,
    basicTest: { status: 'pending' },
    visionTest: { status: 'pending' },
    toolTest: { status: 'pending' },
  }

  onStateChange?.(state)

  try {
    const modelInstance = getModel({ ...settings, provider: providerId, modelId }, settings, configs, dependencies)

    // Test 1: Basic text request
    state = await testBasicRequest(modelInstance, state)
    onStateChange?.({ ...state })

    // Test 2: Vision request (if basic test passed)
    if (state.basicTest?.status === 'success') {
      state = await testVisionRequest(modelInstance, state)
      onStateChange?.({ ...state })
    }

    // Test 3: Tool use request (if basic test passed)
    if (state.basicTest?.status === 'success') {
      state = await testToolUseRequest(modelInstance, state)
      onStateChange?.({ ...state })
    }
    state = { ...state, testing: false }
    onStateChange?.({ ...state })
  } catch (e: unknown) {
    state = { ...state, testing: false, basicTest: { status: 'error', error: String(e) } }
    onStateChange?.({ ...state })
  }
  return state
}

async function testBasicRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    await modelInstance.chat([{ role: 'user', content: 'Hi' }], { onResultChange: undefined })

    return { ...state, basicTest: { status: 'success' } }
  } catch (e: unknown) {
    const error = e as { responseBody?: string; message?: string }
    return {
      ...state,
      basicTest: {
        status: 'error',
        error: error?.responseBody || error?.message || String(e),
      },
    }
  }
}

async function testVisionRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    await modelInstance.chat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What color is in this image?' },
            { type: 'image', image: `data:image/png;base64,${TEST_IMAGE_BASE64}` },
          ],
        },
      ],
      { onResultChange: () => {} }
    )
    return {
      ...state,
      visionTest: { status: 'success' },
    }
  } catch (e: unknown) {
    const error = e as { responseBody?: string; message?: string }

    return {
      ...state,
      visionTest: {
        status: 'error',
        error: error?.responseBody || error?.message || String(e),
      },
    }
  }
}

async function testToolUseRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    await modelInstance.chat([{ role: 'user', content: 'What is the weather in San Francisco?' }], {
      tools: testWeatherTools,
      onResultChange: () => {},
      maxSteps: 1,
    })
    return { ...state, toolTest: { status: 'success' } }
  } catch (e: unknown) {
    const error = e as { responseBody?: string; message?: string }
    return {
      ...state,
      toolTest: {
        status: 'error',
        error: error?.responseBody || error?.message || String(e),
      },
    }
  }
}
