import type { Message, MessageContentToolCallPart, MessageToolCallPart } from '@shared/types'
import type { ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import {
  createPausedToolCallExecutionContext,
  findLastRetryableToolCallPart,
  findPausedApprovalBatch,
  findPausedToolCallLimitBatch,
  getApprovalTrackingTarget,
  getToolCallPause,
  hasPausedToolCallPart,
  isRetryableToolCallStep,
  keepContentPartsThroughToolCall,
  markToolCallPaused,
  shouldPersistStreamingChunk,
  updateToolCallPart,
  withToolCallLimitPause,
} from './generation-flow'

function toolPart(
  toolCallId: string,
  state: MessageContentToolCallPart['state'] = 'call',
  stepIndex = 0
): MessageContentToolCallPart {
  return {
    type: 'tool-call',
    state,
    toolCallId,
    toolName: 'user_exec',
    args: { command: 'pwd' },
    stepIndex,
  }
}

function message(parts: Message['contentParts']): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    contentParts: parts,
  }
}

describe('generation flow', () => {
  it.each([
    [
      {
        name: 'UserExecApprovalPausedError',
        toolCallId: 'exec-1',
        command: 'pwd',
        explanation: 'Inspect directory',
        explanationError: true,
        workdir: '/workspace/project',
      },
      {
        toolCallId: 'exec-1',
        pauseReason: {
          type: 'user_exec_approval',
          command: 'pwd',
          explanation: 'Inspect directory',
          explanationError: true,
          workdir: '/workspace/project',
        },
      },
    ],
    [
      {
        name: 'CommandEscalationApprovalPausedError',
        toolCallId: 'retry-1',
        command: 'git status',
        retryOf: 'failed-1',
        justification: 'The sandbox denied access to repository metadata.',
        workdir: '/workspace/project',
      },
      {
        toolCallId: 'retry-1',
        pauseReason: {
          type: 'command_escalation_approval',
          command: 'git status',
          retryOf: 'failed-1',
          justification: 'The sandbox denied access to repository metadata.',
          workdir: '/workspace/project',
        },
      },
    ],
    [
      {
        name: 'FileMutationApprovalPausedError',
        toolCallId: 'file-1',
        title: 'Write file',
        preview: 'hello',
      },
      {
        toolCallId: 'file-1',
        pauseReason: {
          type: 'file_mutation_approval',
          title: 'Write file',
          preview: 'hello',
        },
      },
    ],
    [
      {
        name: 'AppActionApprovalPausedError',
        toolCallId: 'app-1',
        action: 'create_session',
        title: 'Create session',
        preview: 'New session',
        details: {
          type: 'image_generation',
          provider: 'openai',
          modelId: 'gpt-image-1',
          prompt: 'New session',
          count: 1,
          billing: 'provider',
        },
      },
      {
        toolCallId: 'app-1',
        pauseReason: {
          type: 'app_action_approval',
          action: 'create_session',
          title: 'Create session',
          preview: 'New session',
          details: {
            type: 'image_generation',
            provider: 'openai',
            modelId: 'gpt-image-1',
            prompt: 'New session',
            count: 1,
            billing: 'provider',
          },
        },
      },
    ],
  ])('maps host pause error %o without importing its concrete class', (error, expected) => {
    expect(getToolCallPause(error)).toEqual(expected)
  })

  it('pauses the complete in-flight batch at the tool-call limit', () => {
    const parts = [toolPart('one'), toolPart('two'), { type: 'text' as const, text: 'done' }]

    expect(markToolCallPaused(parts, 'two', { type: 'tool_call_limit', maxToolCalls: 25 })).toEqual([
      expect.objectContaining({ toolCallId: 'one', state: 'paused' }),
      expect.objectContaining({ toolCallId: 'two', state: 'paused' }),
      { type: 'text', text: 'done' },
    ])
  })

  it('wraps executable tools and raises a structured limit pause', async () => {
    const execute = vi.fn(() => Promise.resolve('ok'))
    const tools = withToolCallLimitPause(
      {
        search: {
          execute,
        },
      } as unknown as ToolSet,
      1
    ) as unknown as Record<string, { execute: (input: unknown, context: { toolCallId?: string }) => Promise<unknown> }>

    await expect(tools.search.execute({}, { toolCallId: 'one' })).resolves.toBe('ok')
    expect(() => tools.search.execute({}, { toolCallId: 'two' })).toThrowError(
      expect.objectContaining({
        name: 'ToolCallLimitPausedError',
        toolCallId: 'two',
        maxToolCalls: 1,
      })
    )
  })

  it('binds app-action approval details only to the explicitly approved call', () => {
    const part: MessageToolCallPart = {
      ...toolPart('app-1', 'paused'),
      pauseReason: {
        type: 'app_action_approval',
        action: 'create_session',
        title: 'Create session',
        preview: 'New session',
        details: {
          type: 'image_generation',
          provider: 'openai',
          modelId: 'gpt-image-1',
          prompt: 'New session',
          count: 1,
          billing: 'provider',
        },
      },
    }

    expect(createPausedToolCallExecutionContext(part, 'app-1')).toEqual({
      toolCallId: 'app-1',
      approved: true,
      approvalDetails: part.pauseReason?.type === 'app_action_approval' ? part.pauseReason.details : undefined,
    })
    expect(createPausedToolCallExecutionContext(part, 'other')).toEqual({
      toolCallId: 'app-1',
      approved: false,
      approvalDetails: undefined,
    })
  })

  it('binds the internal command retry reference only to the approved escalation call', () => {
    const part: MessageToolCallPart = {
      ...toolPart('command-1', 'paused'),
      pauseReason: {
        type: 'command_escalation_approval',
        command: 'git status',
        retryOf: 'sandbox-retry-1',
        justification: 'Repository metadata is outside the sandbox.',
        workdir: '/workspace/project',
      },
    }

    expect(createPausedToolCallExecutionContext(part, 'command-1')).toMatchObject({
      toolCallId: 'command-1',
      approved: true,
      approvalWorkdir: '/workspace/project',
      approvalRetryOf: 'sandbox-retry-1',
    })
    expect(createPausedToolCallExecutionContext(part, 'other')).not.toHaveProperty('approvalRetryOf')
  })

  it('finds limit and parallel approval batches without crossing step boundaries', () => {
    const limitReason = { type: 'tool_call_limit' as const, maxToolCalls: 25 }
    const approvalReason = { type: 'user_exec_approval' as const, command: 'pwd', workdir: '/workspace/project' }
    const current = message([
      { ...toolPart('limit-1', 'paused', 0), pauseReason: limitReason },
      { ...toolPart('limit-2', 'paused', 1), pauseReason: limitReason },
      { ...toolPart('approval-1', 'paused', 2), pauseReason: approvalReason },
      { ...toolPart('approval-2', 'paused', 2), pauseReason: approvalReason },
      { ...toolPart('approval-3', 'paused', 3), pauseReason: approvalReason },
    ])

    expect(findPausedToolCallLimitBatch(current, 'limit-1').map((part) => part.toolCallId)).toEqual([
      'limit-1',
      'limit-2',
    ])
    expect(findPausedApprovalBatch(current, 'approval-1').map((part) => part.toolCallId)).toEqual([
      'approval-1',
      'approval-2',
    ])
  })

  it('updates, detects, and classifies tool-call projections', () => {
    const current = message([
      { type: 'text', text: 'before' },
      toolPart('search-1', 'call'),
      toolPart('exec-1', 'paused'),
      { type: 'text', text: 'after' },
    ])
    const updated = updateToolCallPart(current, 'search-1', (part) => ({
      ...part,
      state: 'result',
      result: { ok: true },
    }))

    expect(hasPausedToolCallPart(updated)).toBe(true)
    expect(findLastRetryableToolCallPart(updated)?.toolCallId).toBe('search-1')
    expect(isRetryableToolCallStep(updated.contentParts[1] as MessageToolCallPart)).toBe(true)
    expect(keepContentPartsThroughToolCall(updated, 'search-1')).toHaveLength(2)
    expect(
      getApprovalTrackingTarget({
        ...toolPart('write-1', 'paused'),
        toolName: 'write_file',
        pauseReason: { type: 'file_mutation_approval', title: 'Write', preview: 'x' },
      })
    ).toBe('file_write')
  })

  it('persists tool calls immediately and text only at the checkpoint boundary', () => {
    expect(shouldPersistStreamingChunk('tool-call', 0, 2_000)).toBe(true)
    expect(shouldPersistStreamingChunk('text-delta', 1_999, 2_000)).toBe(false)
    expect(shouldPersistStreamingChunk('text-delta', 2_000, 2_000)).toBe(true)
  })
})
