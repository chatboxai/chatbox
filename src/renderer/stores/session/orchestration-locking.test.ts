// @vitest-environment jsdom
import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => {
  return {
    retryFromLastToolCallAfterApiError: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('@/adapters/CurrentGenerationService', () => ({
  currentGenerationService: serviceMocks,
}))
// The retry entry point consults the session action guard, which reads the
// session; resolving null keeps the guard permissive so the delegation
// behavior under test is exercised.
vi.mock('../chatStore', () => ({ getSession: vi.fn(() => Promise.resolve(null)) }))

import {
  applyPersistentToolCallPause,
  createInitialState,
  createPausedToolCallExecutionContext,
  finishPausedToolCallContinuation,
} from '@chatbox/core/generation'
import { retryFromLastToolCallAfterApiError } from './generation'

const approvalDetails = {
  type: 'image_generation' as const,
  provider: 'chatbox-ai',
  modelId: 'image-model',
  prompt: 'first image',
  count: 1,
  billing: 'chatbox_quota' as const,
}

describe('retryFromLastToolCallAfterApiError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the session action gate before delegating to the shared GenerationService', async () => {
    await retryFromLastToolCallAfterApiError('session-1', 'message-1', 'tool-1')

    expect(serviceMocks.retryFromLastToolCallAfterApiError).toHaveBeenCalledOnce()
    expect(serviceMocks.retryFromLastToolCallAfterApiError).toHaveBeenCalledWith('session-1', 'message-1', 'tool-1')
  })
})

describe('paused tool-call approval binding', () => {
  it('forwards the continuation abort signal to the resumed tool', () => {
    const controller = new AbortController()
    const context = createPausedToolCallExecutionContext(
      {
        toolCallId: 'tool-1',
        pauseReason: { type: 'user_exec_approval', command: 'sleep 30', workdir: '/workspace/project' },
      },
      'tool-1',
      controller.signal
    )

    expect(context).toMatchObject({
      toolCallId: 'tool-1',
      approved: true,
      approvalWorkdir: '/workspace/project',
      abortSignal: controller.signal,
    })
  })

  it('authorizes only the tool call explicitly approved by the user', () => {
    const selected = createPausedToolCallExecutionContext(
      {
        toolCallId: 'tool-1',
        pauseReason: {
          type: 'app_action_approval',
          action: 'image.generate',
          title: 'Generate image',
          preview: 'first image',
          details: approvalDetails,
        },
      },
      'tool-1'
    )
    const sibling = createPausedToolCallExecutionContext(
      {
        toolCallId: 'tool-2',
        pauseReason: {
          type: 'app_action_approval',
          action: 'image.generate',
          title: 'Generate image',
          preview: 'second image',
          details: { ...approvalDetails, prompt: 'second image' },
        },
      },
      'tool-1'
    )

    expect(selected).toEqual({ toolCallId: 'tool-1', approved: true, approvalDetails })
    expect(sibling).toEqual({ toolCallId: 'tool-2', approved: false, approvalDetails: undefined })
  })

  it('does not authorize calls resumed from a tool-call-limit pause', () => {
    expect(
      createPausedToolCallExecutionContext(
        {
          toolCallId: 'tool-1',
          pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
        },
        undefined
      )
    ).toEqual({ toolCallId: 'tool-1', approved: false, approvalDetails: undefined })
  })
})

describe('paused tool-call continuation cancellation', () => {
  it('clears runtime generation controls when continuation stops', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      contentParts: [],
      generating: true,
      finishReason: 'tool-call-paused',
    } as Message

    expect(finishPausedToolCallContinuation(message, 'canceled')).toMatchObject({
      generating: false,
      finishReason: 'canceled',
    })
  })
})

describe('parallel approval message ownership', () => {
  it('keeps both approvals in the original assistant message with independent details', () => {
    const state = createInitialState([
      {
        type: 'tool-call',
        state: 'call',
        toolCallId: 'tool-1',
        toolName: 'chatbox_cli',
        args: { argv: ['image', 'generate', '--prompt', 'first image'] },
        stepIndex: 0,
      },
      {
        type: 'tool-call',
        state: 'call',
        toolCallId: 'tool-2',
        toolName: 'chatbox_cli',
        args: { argv: ['image', 'generate', '--prompt', 'second image'] },
        stepIndex: 0,
      },
    ])

    const firstPaused = applyPersistentToolCallPause(state, {
      name: 'AppActionApprovalPausedError',
      toolCallId: 'tool-1',
      action: 'image.generate',
      title: 'Generate image',
      preview: 'first image',
      details: { ...approvalDetails, prompt: 'first image' },
    })
    const bothPaused = applyPersistentToolCallPause(firstPaused, {
      name: 'AppActionApprovalPausedError',
      toolCallId: 'tool-2',
      action: 'image.generate',
      title: 'Generate image',
      preview: 'second image',
      details: { ...approvalDetails, prompt: 'second image' },
    })

    expect(bothPaused.contentParts).toMatchObject([
      {
        type: 'tool-call',
        state: 'paused',
        toolCallId: 'tool-1',
        pauseReason: {
          type: 'app_action_approval',
          details: { type: 'image_generation', prompt: 'first image' },
        },
      },
      {
        type: 'tool-call',
        state: 'paused',
        toolCallId: 'tool-2',
        pauseReason: {
          type: 'app_action_approval',
          details: { type: 'image_generation', prompt: 'second image' },
        },
      },
    ])
  })
})
