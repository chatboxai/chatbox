import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAvailableImageModelsMock,
  getImageGenerationByIdMock,
  getImageGenerationPageMock,
  getSessionMock,
  queueBackgroundTaskNotificationMock,
  requestAppActionApprovalMock,
  executionStorage,
  getStorageItemMock,
  setStorageItemNowMock,
  startImageGenerationMock,
} = vi.hoisted(() => ({
  getAvailableImageModelsMock: vi.fn(),
  getImageGenerationByIdMock: vi.fn(),
  getImageGenerationPageMock: vi.fn(),
  getSessionMock: vi.fn(),
  queueBackgroundTaskNotificationMock: vi.fn(),
  requestAppActionApprovalMock: vi.fn(),
  executionStorage: new Map<string, unknown>(),
  getStorageItemMock: vi.fn(),
  setStorageItemNowMock: vi.fn(),
  startImageGenerationMock: vi.fn(),
}))

vi.mock('@/packages/app-action-approval', () => ({ requestAppActionApproval: requestAppActionApprovalMock }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessionQueryBridge: { getSession: getSessionMock } },
}))
vi.mock('@/packages/image-model-catalog', () => ({
  getAvailableImageModels: getAvailableImageModelsMock,
}))
vi.mock('@/platform', () => ({
  default: {
    getImageGenerationStorage: () => ({
      getById: getImageGenerationByIdMock,
      getPage: getImageGenerationPageMock,
    }),
  },
}))
vi.mock('@/stores/imageGenerationActions', () => ({ startImageGeneration: startImageGenerationMock }))
vi.mock('@/stores/imageGenerationStore', () => ({
  imageGenerationStore: { getState: () => ({ currentGeneratingId: null }) },
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      licenseKey: 'license-key',
      providers: {},
      licenseDetail: {
        image_total_quota: 10,
        image_used_count: 3,
        remaining_quota_unified: 0.894,
        unified_token_usage: 106,
        unified_token_limit: 1_000,
      },
    }),
  },
}))
vi.mock('@/storage', () => ({
  default: {
    getItem: getStorageItemMock,
    setItemNow: setStorageItemNowMock,
  },
}))
vi.mock('./background-follow-up', () => ({
  queueBackgroundTaskNotification: queueBackgroundTaskNotificationMock,
}))

import type { ImageGeneration } from '@shared/types'
import { imageCommands, resetImageCommandExecutionsForTests } from './images'
import { parseArguments } from './parser'
import type { ChatboxCliCommandContext, ChatboxCliToolContext } from './types'

function command(name: string) {
  const result = imageCommands.find((candidate) => candidate.path[1] === name)
  if (!result) throw new Error(`Missing image command: ${name}`)
  return result
}

function context(argv: string[], options: ChatboxCliToolContext = {}): ChatboxCliCommandContext {
  return {
    argv,
    parsed: parseArguments(argv),
    displayCommand: `chatbox image ${argv.join(' ')}`,
    sessionId: 'session-1',
    toolCallId: options.toolCallId ?? 'tool-1',
    approved: options.approved ?? true,
    approvalDetails: options.approvalDetails,
  }
}

// The persisted result shape of a successfully accepted generate tool call — the
// condition under which the chat UI binds the inline gallery to that tool step.
function acceptedGenerateResult(recordId: string): Record<string, unknown> {
  return {
    ok: true,
    command: 'image generate',
    accepted: true,
    background: true,
    recordId,
    status: 'pending',
    startedAt: 1_000,
    wait: { mode: 'callback', managedBy: 'chatbox', modelShouldPoll: false },
  }
}

function sessionWithToolCall(toolCallId: string, result: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'session-1',
    name: 'QA session',
    type: 'chat',
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        contentParts: [{ type: 'tool-call', toolCallId, state: 'result', toolName: 'chatbox_cli', args: {}, result }],
      },
    ],
  }
}

describe('Chatbox CLI image commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetImageCommandExecutionsForTests()
    executionStorage.clear()
    getStorageItemMock.mockImplementation(async (key: string, initialValue: unknown) =>
      executionStorage.has(key) ? executionStorage.get(key) : initialValue
    )
    setStorageItemNowMock.mockImplementation((key: string, value: unknown) => {
      executionStorage.set(key, value)
      return Promise.resolve()
    })
    getAvailableImageModelsMock.mockResolvedValue([
      { provider: 'chatbox-ai', modelId: 'manifest-image', nickname: 'Manifest Image' },
    ])
    getSessionMock.mockResolvedValue(null)
  })

  it('selects the first available catalog model and anchors the completion follow-up', async () => {
    const approvalDetails = {
      type: 'image_generation' as const,
      provider: 'chatbox-ai',
      modelId: 'manifest-image',
      prompt: 'red fox',
      count: 1,
      billing: 'chatbox_quota' as const,
    }
    startImageGenerationMock.mockResolvedValue({
      recordId: 'record-1',
      startedAt: 1_000,
      monitoring: { mode: 'polling', intervalMs: 2_000 },
      completion: Promise.resolve({
        id: 'record-1',
        status: 'done',
        generatedImages: ['storage://image-1'],
      }),
    })

    await expect(
      command('generate').execute(context(['--prompt', 'red fox'], { approvalDetails }))
    ).resolves.toMatchObject({
      accepted: true,
      background: true,
      recordId: 'record-1',
      startedAt: 1_000,
      wait: {
        mode: 'callback',
        managedBy: 'chatbox',
        modelShouldPoll: false,
        pollIntervalMs: 2_000,
      },
    })
    await Promise.resolve()

    expect(startImageGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: { provider: 'chatbox-ai', modelId: 'manifest-image' } }),
      expect.objectContaining({ onRecordCreated: expect.any(Function) })
    )
    expect(queueBackgroundTaskNotificationMock).toHaveBeenCalledWith(
      'session-1',
      'tool-1',
      expect.objectContaining({
        recordId: 'record-1',
        status: 'completed',
        startedAt: 1_000,
        elapsedMs: expect.any(Number),
      })
    )
  })

  it('requires a tool-call anchor', async () => {
    await expect(command('generate').execute(context(['--prompt', 'red fox'], { toolCallId: '' }))).rejects.toThrow(
      'requires a tool call id'
    )
    expect(startImageGenerationMock).not.toHaveBeenCalled()
  })

  it('rejects explicit models outside the configured image catalog', async () => {
    await expect(
      command('generate').execute(context(['--prompt', 'red fox', '--provider', 'openai', '--model', 'gpt-4o']))
    ).rejects.toThrow('Image model is not available')
    expect(startImageGenerationMock).not.toHaveBeenCalled()
  })

  it('resolves case, display-name, and punctuation variants of --model to the exact catalog id', async () => {
    getAvailableImageModelsMock.mockResolvedValue([
      { provider: 'chatbox-ai', modelId: 'gemini-3.1-flash-image', nickname: 'Gemini 3.1 Flash Image' },
      { provider: 'chatbox-ai', modelId: 'gpt-image-2', nickname: 'GPT Image 2' },
    ])
    const pause = new Error('approval required')
    requestAppActionApprovalMock.mockRejectedValue(pause)

    for (const reference of ['gpt-image-2', 'GPT-IMAGE-2', 'GPT Image 2', 'gpt image 2']) {
      requestAppActionApprovalMock.mockClear()
      await expect(
        command('generate').execute(context(['--prompt', 'red fox', '--model', reference], { approved: false }))
      ).rejects.toBe(pause)
      expect(requestAppActionApprovalMock).toHaveBeenCalledWith(
        expect.any(String),
        'image.generate',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ provider: 'chatbox-ai', modelId: 'gpt-image-2' })
      )
    }
  })

  it('resolves --provider case-insensitively and defaults to its first model', async () => {
    getAvailableImageModelsMock.mockResolvedValue([
      { provider: 'chatbox-ai', modelId: 'gemini-3.1-flash-image', nickname: 'Gemini 3.1 Flash Image' },
      { provider: 'openai', modelId: 'gpt-image-1', nickname: 'GPT Image 1' },
    ])
    const pause = new Error('approval required')
    requestAppActionApprovalMock.mockRejectedValueOnce(pause)

    await expect(
      command('generate').execute(context(['--prompt', 'red fox', '--provider', 'OpenAI'], { approved: false }))
    ).rejects.toBe(pause)
    expect(requestAppActionApprovalMock).toHaveBeenCalledWith(
      expect.any(String),
      'image.generate',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ provider: 'openai', modelId: 'gpt-image-1' })
    )
  })

  it('lists the available models when a requested model cannot be resolved', async () => {
    await expect(
      command('generate').execute(context(['--prompt', 'red fox', '--model', 'gpt-image-9'], { approved: false }))
    ).rejects.toThrow(
      'Image model is not available: "gpt-image-9". Available image models: chatbox-ai/manifest-image ("Manifest Image").'
    )
    expect(requestAppActionApprovalMock).not.toHaveBeenCalled()
    expect(startImageGenerationMock).not.toHaveBeenCalled()
  })

  it('rejects a model reference that matches several different model ids instead of guessing', async () => {
    getAvailableImageModelsMock.mockResolvedValue([
      { provider: 'chatbox-ai', modelId: 'flux-pro', nickname: 'Fast Image' },
      { provider: 'openai', modelId: 'gpt-image-1', nickname: 'Fast Image' },
    ])

    await expect(
      command('generate').execute(context(['--prompt', 'red fox', '--model', 'Fast Image'], { approved: false }))
    ).rejects.toThrow('Image model "Fast Image" is ambiguous: chatbox-ai/flux-pro, openai/gpt-image-1')
    expect(requestAppActionApprovalMock).not.toHaveBeenCalled()
  })

  it('accepts approval continuations whose --model flag is a display-name variant of the approved model', async () => {
    getAvailableImageModelsMock.mockResolvedValue([
      { provider: 'chatbox-ai', modelId: 'gpt-image-2', nickname: 'GPT Image 2' },
    ])
    const approvalDetails = {
      type: 'image_generation' as const,
      provider: 'chatbox-ai',
      modelId: 'gpt-image-2',
      prompt: 'red fox',
      count: 1,
      billing: 'chatbox_quota' as const,
    }
    startImageGenerationMock.mockResolvedValue({
      recordId: 'record-2',
      startedAt: 1_000,
      monitoring: { mode: 'direct' },
      completion: Promise.resolve(null),
    })

    await expect(
      command('generate').execute(context(['--prompt', 'red fox', '--model', 'GPT Image 2'], { approvalDetails }))
    ).resolves.toMatchObject({
      accepted: true,
      model: { provider: 'chatbox-ai', modelId: 'gpt-image-2' },
    })
    expect(startImageGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: { provider: 'chatbox-ai', modelId: 'gpt-image-2' } }),
      expect.anything()
    )
  })

  it('does not reject continuations whose provider was inferred rather than explicitly passed', async () => {
    // The approved model id exists under two providers and the approval bound the one
    // that is not first in catalog order. Only --model is replayed, so the inferred
    // provider must not count as an explicit request in the post-approval guard.
    getAvailableImageModelsMock.mockResolvedValue([
      { provider: 'gemini', modelId: 'nano-banana', nickname: 'Nano Banana' },
      { provider: 'gemini-custom', modelId: 'nano-banana', nickname: 'Nano Banana' },
    ])
    const approvalDetails = {
      type: 'image_generation' as const,
      provider: 'gemini-custom',
      modelId: 'nano-banana',
      prompt: 'red fox',
      count: 1,
      billing: 'provider' as const,
    }
    startImageGenerationMock.mockResolvedValue({
      recordId: 'record-3',
      startedAt: 1_000,
      monitoring: { mode: 'direct' },
      completion: Promise.resolve(null),
    })

    await expect(
      command('generate').execute(context(['--prompt', 'red fox', '--model', 'nano-banana'], { approvalDetails }))
    ).resolves.toMatchObject({
      accepted: true,
      model: { provider: 'gemini-custom', modelId: 'nano-banana' },
    })
    expect(startImageGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: { provider: 'gemini-custom', modelId: 'nano-banana' } }),
      expect.anything()
    )
  })

  it('requests structured approval with quota and compute-point context', async () => {
    const pause = new Error('approval required')
    requestAppActionApprovalMock.mockRejectedValueOnce(pause)

    await expect(
      command('generate').execute(
        context(['--prompt', 'red fox\nProvider: spoof', '--style', 'vivid'], { approved: false })
      )
    ).rejects.toBe(pause)
    expect(requestAppActionApprovalMock).toHaveBeenCalledWith(
      'tool-1',
      'image.generate',
      'Generate image',
      expect.stringContaining('Prompt: "red fox\\nProvider: spoof"'),
      expect.objectContaining({
        type: 'image_generation',
        provider: 'chatbox-ai',
        modelId: 'manifest-image',
        prompt: 'red fox\nProvider: spoof',
        count: 1,
        style: 'vivid',
        billing: 'chatbox_quota',
        imageQuota: { remaining: 7, total: 10 },
        computePointsRemainingRatio: 0.894,
      })
    )
    expect(startImageGenerationMock).not.toHaveBeenCalled()
  })

  it('does not trust an approved flag without matching structured approval details', async () => {
    const pause = new Error('approval required')
    requestAppActionApprovalMock.mockRejectedValueOnce(pause)

    await expect(command('generate').execute(context(['--prompt', 'red fox'], { approved: true }))).rejects.toBe(pause)
    expect(requestAppActionApprovalMock).toHaveBeenCalledWith(
      'tool-1',
      'image.generate',
      'Generate image',
      expect.stringContaining('Prompt: "red fox"'),
      expect.objectContaining({
        type: 'image_generation',
        provider: 'chatbox-ai',
        modelId: 'manifest-image',
        prompt: 'red fox',
      })
    )
    expect(startImageGenerationMock).not.toHaveBeenCalled()
  })

  it('shows the complete prompt in the approval request', async () => {
    const pause = new Error('approval required')
    const prompt = `${'a'.repeat(600)} hidden tail`
    requestAppActionApprovalMock.mockRejectedValueOnce(pause)

    await expect(command('generate').execute(context(['--prompt', prompt], { approved: false }))).rejects.toBe(pause)
    expect(requestAppActionApprovalMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.stringContaining('hidden tail'),
      expect.objectContaining({ prompt })
    )
  })

  it('executes the exact model persisted in the approved request when catalog order changes', async () => {
    const pause = new Error('approval required')
    requestAppActionApprovalMock.mockRejectedValueOnce(pause)
    getAvailableImageModelsMock.mockResolvedValueOnce([
      { provider: 'chatbox-ai', modelId: 'reviewed-model', nickname: 'Reviewed Model' },
      { provider: 'chatbox-ai', modelId: 'new-default', nickname: 'New Default' },
    ])

    await expect(command('generate').execute(context(['--prompt', 'red fox'], { approved: false }))).rejects.toBe(pause)
    const approvalDetails = requestAppActionApprovalMock.mock.calls[0]?.[4]
    expect(approvalDetails).toMatchObject({ provider: 'chatbox-ai', modelId: 'reviewed-model' })

    getAvailableImageModelsMock.mockResolvedValueOnce([
      { provider: 'chatbox-ai', modelId: 'new-default', nickname: 'New Default' },
      { provider: 'chatbox-ai', modelId: 'reviewed-model', nickname: 'Reviewed Model' },
    ])
    startImageGenerationMock.mockResolvedValueOnce({
      recordId: 'record-reviewed',
      startedAt: 1_000,
      monitoring: { mode: 'direct' },
      completion: Promise.resolve(null),
    })

    await command('generate').execute(context(['--prompt', 'red fox'], { approved: true, approvalDetails }))

    expect(startImageGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: 'chatbox-ai', modelId: 'reviewed-model' },
        source: {
          type: 'chatbox_cli',
          sessionId: 'session-1',
          toolCallId: 'tool-1',
        },
      }),
      expect.objectContaining({ onRecordCreated: expect.any(Function) })
    )
  })

  it('reuses the durable image record after the in-memory execution cache is lost', async () => {
    const approvalDetails = {
      type: 'image_generation' as const,
      provider: 'chatbox-ai',
      modelId: 'manifest-image',
      prompt: 'red fox',
      count: 1,
      billing: 'chatbox_quota' as const,
    }
    const createdRecord: ImageGeneration = {
      id: 'record-persisted',
      prompt: 'red fox',
      referenceImages: [],
      generatedImages: [],
      createdAt: 1_000,
      model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
      imageGenerateNum: 1,
      status: 'generating',
      taskId: 'task-persisted',
    }
    startImageGenerationMock.mockImplementationOnce(
      async (_params: unknown, options: { onRecordCreated?: (record: ImageGeneration) => Promise<void> }) => {
        await options.onRecordCreated?.(createdRecord)
        return {
          recordId: createdRecord.id,
          startedAt: createdRecord.createdAt,
          monitoring: { mode: 'polling', intervalMs: 2_000 },
          completion: Promise.resolve(null),
        }
      }
    )

    await command('generate').execute(context(['--prompt', 'red fox'], { approvalDetails }))
    expect(setStorageItemNowMock).toHaveBeenCalledOnce()

    resetImageCommandExecutionsForTests()
    const catalogCallsBeforeRestore = getAvailableImageModelsMock.mock.calls.length
    getAvailableImageModelsMock.mockRejectedValue(new Error('catalog unavailable'))
    getImageGenerationByIdMock.mockResolvedValueOnce(createdRecord)

    await expect(command('generate').execute(context(['--prompt', 'red fox']))).resolves.toMatchObject({
      restored: true,
      recordId: 'record-persisted',
      status: 'generating',
      wait: {
        mode: 'manual_resume',
        managedBy: 'chatbox',
        modelShouldPoll: false,
      },
    })
    expect(startImageGenerationMock).toHaveBeenCalledTimes(1)
    expect(getAvailableImageModelsMock).toHaveBeenCalledTimes(catalogCallsBeforeRestore)
  })

  it('uses the shared image model catalog for model discovery', async () => {
    getAvailableImageModelsMock.mockResolvedValueOnce([
      { provider: 'chatbox-ai', modelId: 'server-default', nickname: 'Server Default' },
      { provider: 'chatbox-ai', modelId: 'gpt-image-1.5', nickname: 'GPT Image 1.5' },
    ])

    await expect(command('models').execute(context([]))).resolves.toEqual({
      models: [
        { provider: 'chatbox-ai', modelId: 'server-default', nickname: 'Server Default' },
        { provider: 'chatbox-ai', modelId: 'gpt-image-1.5', nickname: 'GPT Image 1.5' },
      ],
      defaultModel: { provider: 'chatbox-ai', modelId: 'server-default', nickname: 'Server Default' },
    })
    expect(getAvailableImageModelsMock).toHaveBeenCalledOnce()
  })

  it('marks an orphaned pending task for manual recovery instead of promising a callback', async () => {
    getImageGenerationByIdMock.mockResolvedValue({
      id: 'record-1',
      status: 'generating',
      createdAt: 1_000,
      prompt: 'red fox',
      referenceImages: [],
      generatedImages: [],
      model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
      taskId: 'task-1',
    })

    await expect(command('status').execute(context(['record-1']))).resolves.toMatchObject({
      id: 'record-1',
      status: 'generating',
      wait: {
        mode: 'manual_resume',
        managedBy: 'chatbox',
        modelShouldPoll: false,
        location: 'original chat or Image Creator',
      },
    })
  })

  it('masks result references whose images are already displayed inline in this chat', async () => {
    getSessionMock.mockResolvedValue(sessionWithToolCall('tool-origin', acceptedGenerateResult('record-1')))
    getImageGenerationByIdMock.mockResolvedValue({
      id: 'record-1',
      status: 'done',
      createdAt: 1_000,
      prompt: 'red fox',
      referenceImages: [],
      generatedImages: ['https://example.com/image-1.png', 'https://example.com/image-2.png'],
      generatedImageThumbnails: ['https://example.com/thumb-1.png', 'https://example.com/thumb-2.png'],
      model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
      taskId: 'task-1',
      source: { type: 'chatbox_cli', sessionId: 'session-1', toolCallId: 'tool-origin' },
    })

    const result = await command('status').execute(context(['record-1']))
    expect(result).toMatchObject({
      id: 'record-1',
      status: 'done',
      generatedImages: [
        '[image 1 already shown to the user in this chat]',
        '[image 2 already shown to the user in this chat]',
      ],
      note: expect.stringContaining('Do not render them again'),
    })
    expect(result.generatedImageThumbnails).toBeUndefined()
  })

  it('keeps result references readable for records that are not displayed in the current chat', async () => {
    getImageGenerationByIdMock.mockResolvedValue({
      id: 'record-2',
      status: 'done',
      createdAt: 1_000,
      prompt: 'red fox',
      referenceImages: [],
      generatedImages: ['https://example.com/image-1.png'],
      model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
      taskId: 'task-2',
      source: { type: 'chatbox_cli', sessionId: 'session-other', toolCallId: 'tool-origin' },
    })

    const result = await command('status').execute(context(['record-2']))
    expect(result).toMatchObject({ generatedImages: ['https://example.com/image-1.png'] })
    expect(result.note).toBeUndefined()
  })

  it('keeps result references when the originating tool call left the active thread', async () => {
    // Switching or clearing threads archives the originating tool call while the
    // session id stays the same; nothing in the active view shows the gallery then.
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      name: 'QA session',
      type: 'chat',
      messages: [],
      threads: [sessionWithToolCall('tool-origin', acceptedGenerateResult('record-1'))],
    })
    getImageGenerationByIdMock.mockResolvedValue({
      id: 'record-1',
      status: 'done',
      createdAt: 1_000,
      prompt: 'red fox',
      referenceImages: [],
      generatedImages: ['https://example.com/image-1.png'],
      model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
      taskId: 'task-1',
      source: { type: 'chatbox_cli', sessionId: 'session-1', toolCallId: 'tool-origin' },
    })

    const result = await command('status').execute(context(['record-1']))
    expect(result).toMatchObject({ generatedImages: ['https://example.com/image-1.png'] })
    expect(result.note).toBeUndefined()
  })

  it('keeps result references when the originating tool call has a non-gallery restored result', async () => {
    // A restored completed execution is not an accepted-pending result, so the tool
    // step does not bind the inline gallery; the references are the only display.
    getSessionMock.mockResolvedValue(
      sessionWithToolCall('tool-origin', {
        ok: true,
        command: 'image generate',
        restored: true,
        recordId: 'record-1',
        status: 'done',
      })
    )
    getImageGenerationByIdMock.mockResolvedValue({
      id: 'record-1',
      status: 'done',
      createdAt: 1_000,
      prompt: 'red fox',
      referenceImages: [],
      generatedImages: ['https://example.com/image-1.png'],
      model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
      taskId: 'task-1',
      source: { type: 'chatbox_cli', sessionId: 'session-1', toolCallId: 'tool-origin' },
    })

    const result = await command('status').execute(context(['record-1']))
    expect(result).toMatchObject({ generatedImages: ['https://example.com/image-1.png'] })
    expect(result.note).toBeUndefined()
  })

  it('masks only the history items whose images are displayed in the current chat', async () => {
    getSessionMock.mockResolvedValue(sessionWithToolCall('tool-origin', acceptedGenerateResult('record-here')))
    getImageGenerationPageMock.mockResolvedValue({
      items: [
        {
          id: 'record-here',
          status: 'done',
          createdAt: 1_000,
          prompt: 'red fox',
          referenceImages: [],
          generatedImages: ['https://example.com/image-here.png'],
          model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
          source: { type: 'chatbox_cli', sessionId: 'session-1', toolCallId: 'tool-origin' },
        },
        {
          id: 'record-creator',
          status: 'done',
          createdAt: 2_000,
          prompt: 'blue bird',
          referenceImages: [],
          generatedImages: ['https://example.com/image-creator.png'],
          model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
        },
      ],
      nextCursor: null,
      total: 2,
    })

    await expect(command('history').execute(context([]))).resolves.toMatchObject({
      items: [
        {
          id: 'record-here',
          generatedImages: ['[image 1 already shown to the user in this chat]'],
          note: expect.stringContaining('Do not render them again'),
        },
        { id: 'record-creator', generatedImages: ['https://example.com/image-creator.png'] },
      ],
    })
  })

  it('requires a newly approved retry when an interrupted record has no resumable task id', async () => {
    getImageGenerationByIdMock.mockResolvedValue({
      id: 'record-direct',
      status: 'generating',
      createdAt: 1_000,
      prompt: 'red fox',
      referenceImages: [],
      generatedImages: [],
      model: { provider: 'openai', modelId: 'gpt-image-1' },
    })

    await expect(command('status').execute(context(['record-direct']))).resolves.toMatchObject({
      id: 'record-direct',
      status: 'generating',
      wait: {
        mode: 'manual_retry',
        managedBy: 'chatbox',
        modelShouldPoll: false,
        requiresNewApproval: true,
      },
    })
  })

  it('labels image history as device-wide', async () => {
    getImageGenerationPageMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 })

    await expect(command('history').execute(context([]))).resolves.toEqual({
      scope: 'global',
      items: [],
      nextCursor: null,
      total: 0,
    })
  })
})
