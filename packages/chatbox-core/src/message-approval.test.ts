import { describe, expect, it } from 'vitest'
import { isApprovalPauseReason, listPendingApprovalToolCalls, listPendingPauseInteractions } from './message-approval'
import type { Message, MessageToolCallPart } from './types'

type TestMessage = Pick<Message, 'id' | 'contentParts'>

function makeToolCallPart(overrides: Partial<MessageToolCallPart>): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'paused',
    toolCallId: 'tc-1',
    toolName: 'user_exec',
    ...overrides,
  }
}

describe('isApprovalPauseReason', () => {
  it('accepts the four approval pause types and rejects the rest', () => {
    expect(isApprovalPauseReason({ type: 'user_exec_approval', command: 'ls' })).toBe(true)
    expect(isApprovalPauseReason({ type: 'file_mutation_approval', title: 'Edit', preview: '' })).toBe(true)
    expect(
      isApprovalPauseReason({ type: 'app_action_approval', action: 'image.generate', title: 'Generate', preview: '' })
    ).toBe(true)
    expect(
      isApprovalPauseReason({
        type: 'command_escalation_approval',
        command: 'git status',
        retryOf: 'tc-failed',
        justification: 'The sandbox cannot read the repository metadata.',
        workdir: '/workspace/project',
      })
    ).toBe(true)
    expect(isApprovalPauseReason({ type: 'tool_call_limit', maxToolCalls: 25 })).toBe(false)
    expect(isApprovalPauseReason(undefined)).toBe(false)
  })
})

describe('listPendingApprovalToolCalls', () => {
  it('collects approval-paused tool calls with message ids in order', () => {
    const messages: TestMessage[] = [
      {
        id: 'm1',
        contentParts: [
          { type: 'text', text: 'hello' },
          makeToolCallPart({
            toolCallId: 'tc-1',
            pauseReason: { type: 'user_exec_approval', command: 'rm -rf build' },
          }),
        ],
      },
      {
        id: 'm2',
        contentParts: [
          makeToolCallPart({
            toolCallId: 'tc-2',
            toolName: 'edit_file',
            pauseReason: { type: 'file_mutation_approval', title: 'Edit config', preview: '- a\n+ b' },
          }),
        ],
      },
    ]
    expect(listPendingApprovalToolCalls(messages)).toEqual([
      {
        messageId: 'm1',
        toolCallId: 'tc-1',
        pauseReason: { type: 'user_exec_approval', command: 'rm -rf build' },
      },
      {
        messageId: 'm2',
        toolCallId: 'tc-2',
        pauseReason: { type: 'file_mutation_approval', title: 'Edit config', preview: '- a\n+ b' },
      },
    ])
  })

  it('ignores non-approval pauses and settled tool calls', () => {
    const messages: TestMessage[] = [
      {
        id: 'm1',
        contentParts: [
          makeToolCallPart({ pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 } }),
          makeToolCallPart({ toolCallId: 'tc-2', state: 'result' }),
          makeToolCallPart({ toolCallId: 'tc-3', pauseReason: undefined }),
        ],
      },
    ]
    expect(listPendingApprovalToolCalls(messages)).toEqual([])
  })

  it('caches per messages-array identity', () => {
    const messages: TestMessage[] = [
      {
        id: 'm1',
        contentParts: [makeToolCallPart({ pauseReason: { type: 'user_exec_approval', command: 'ls' } })],
      },
    ]
    expect(listPendingApprovalToolCalls(messages)).toBe(listPendingApprovalToolCalls(messages))
  })
})

describe('listPendingPauseInteractions', () => {
  it('collects approvals per call and limit pauses once per batch, in message order', () => {
    const messages: TestMessage[] = [
      {
        id: 'm1',
        contentParts: [
          makeToolCallPart({
            toolCallId: 'tc-1',
            pauseReason: { type: 'user_exec_approval', command: 'rm -rf build' },
          }),
          makeToolCallPart({
            toolCallId: 'tc-2',
            stepIndex: 4,
            pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
          }),
          makeToolCallPart({
            toolCallId: 'tc-3',
            stepIndex: 4,
            pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
          }),
        ],
      },
      {
        id: 'm2',
        contentParts: [
          makeToolCallPart({
            toolCallId: 'tc-4',
            toolName: 'edit_file',
            pauseReason: { type: 'file_mutation_approval', title: 'Edit config', preview: '- a\n+ b' },
          }),
        ],
      },
    ]
    expect(listPendingPauseInteractions(messages)).toEqual([
      {
        kind: 'approval',
        messageId: 'm1',
        toolCallId: 'tc-1',
        pauseReason: { type: 'user_exec_approval', command: 'rm -rf build' },
      },
      { kind: 'tool_call_limit', messageId: 'm1', toolCallId: 'tc-2', maxToolCalls: 25 },
      {
        kind: 'approval',
        messageId: 'm2',
        toolCallId: 'tc-4',
        pauseReason: { type: 'file_mutation_approval', title: 'Edit config', preview: '- a\n+ b' },
      },
    ])
  })

  it('collapses every limit-paused part of a message into one interaction, matching batch resume', () => {
    // The service's findPausedToolCallLimitBatch resumes/stops all limit-paused
    // parts of the message regardless of stepIndex, so the bar must surface them
    // as a single decision — including legacy parts without a stepIndex.
    const messages: TestMessage[] = [
      {
        id: 'm1',
        contentParts: [
          makeToolCallPart({ toolCallId: 'tc-1', pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 } }),
          makeToolCallPart({ toolCallId: 'tc-2', pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 } }),
          makeToolCallPart({
            toolCallId: 'tc-3',
            stepIndex: 7,
            pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
          }),
        ],
      },
      {
        id: 'm2',
        contentParts: [
          makeToolCallPart({ toolCallId: 'tc-4', pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 } }),
        ],
      },
    ]
    expect(listPendingPauseInteractions(messages).map((entry) => entry.toolCallId)).toEqual(['tc-1', 'tc-4'])
  })

  it('ignores settled tool calls and caches per messages-array identity', () => {
    const messages: TestMessage[] = [
      {
        id: 'm1',
        contentParts: [
          makeToolCallPart({ toolCallId: 'tc-1', state: 'result' }),
          makeToolCallPart({ toolCallId: 'tc-2', state: 'paused', pauseReason: undefined }),
        ],
      },
    ]
    expect(listPendingPauseInteractions(messages)).toEqual([])
    expect(listPendingPauseInteractions(messages)).toBe(listPendingPauseInteractions(messages))
  })
})
