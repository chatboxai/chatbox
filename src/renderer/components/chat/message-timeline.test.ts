import type { MessageContentParts } from '@shared/types'
import { describe, expect, test } from 'vitest'
import { createCollapsedDisplayGroups, createMessageTimelineLayout } from './message-timeline'

const reasoning = { type: 'reasoning' as const, text: 'Private reasoning' }
const answer = { type: 'text' as const, text: 'Final answer' }

describe('createMessageTimelineLayout', () => {
  test('preserves v1.21 rendering order for non-streaming text followed by reasoning', () => {
    const contentParts: MessageContentParts = [answer, reasoning]

    const result = createMessageTimelineLayout(contentParts, false)

    expect(result.orderedContentParts).toBe(contentParts)
    expect(result.groupedContentParts).toEqual([answer, { type: 'step_group', parts: [reasoning] }])
  })

  test('keeps correctly ordered streaming reasoning responses unchanged', () => {
    const contentParts: MessageContentParts = [reasoning, answer]

    const result = createMessageTimelineLayout(contentParts, true)

    expect(result.orderedContentParts).toBe(contentParts)
    expect(result.groupedContentParts).toEqual([{ type: 'step_group', parts: [reasoning] }, answer])
  })

  test('does not reinterpret messages without an explicit non-streaming marker', () => {
    const contentParts: MessageContentParts = [answer, reasoning]

    const result = createMessageTimelineLayout(contentParts, undefined)

    expect(result.orderedContentParts).toBe(contentParts)
    expect(result.groupedContentParts).toEqual([{ type: 'step_group', parts: [answer, reasoning] }])
  })

  test('keeps tool calls as ordering boundaries', () => {
    const toolCall = {
      type: 'tool-call' as const,
      state: 'result' as const,
      toolCallId: 'tool-1',
      toolName: 'search',
      args: {},
      result: 'done',
    }
    const contentParts: MessageContentParts = [answer, toolCall, reasoning]

    const result = createMessageTimelineLayout(contentParts, false)

    expect(result.orderedContentParts).toBe(contentParts)
    expect(result.groupedContentParts).toEqual([{ type: 'step_group', parts: [answer, toolCall, reasoning] }])
  })

  test('keeps alternating multi-step content in its original order', () => {
    const reasoning2 = { type: 'reasoning' as const, text: 'Second reasoning' }
    const answer2 = { type: 'text' as const, text: 'Second answer' }
    const contentParts: MessageContentParts = [reasoning, answer, reasoning2, answer2]

    const result = createMessageTimelineLayout(contentParts, false)

    expect(result.orderedContentParts).toBe(contentParts)
    expect(result.groupedContentParts).toEqual([
      { type: 'step_group', parts: [reasoning, answer, reasoning2] },
      answer2,
    ])
  })

  test('keeps multiple text and reasoning parts in their original order', () => {
    const reasoning2 = { type: 'reasoning' as const, text: 'Second reasoning' }
    const answer2 = { type: 'text' as const, text: 'Second answer' }
    const contentParts: MessageContentParts = [answer, reasoning, answer2, reasoning2]

    const result = createMessageTimelineLayout(contentParts, false)

    expect(result.orderedContentParts).toBe(contentParts)
  })

  test('hides protocol-only parts from the visible timeline', () => {
    const toolCall = {
      type: 'tool-call' as const,
      state: 'result' as const,
      toolCallId: 'tool-1',
      toolName: 'lookup',
      args: {},
      result: { value: 'found' },
    }
    const contentParts: MessageContentParts = [
      {
        type: 'reasoning',
        text: '',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
        protocolOnly: true,
      },
      { type: 'text', text: '', protocolOnly: true },
      {
        type: 'reasoning',
        text: '',
        providerMetadata: { anthropic: { redactedData: 'encrypted' } },
        protocolOnly: true,
      },
      toolCall,
    ]

    const result = createMessageTimelineLayout(contentParts, true)

    expect(result.orderedContentParts).toEqual([toolCall])
    expect(result.lastStepIndex).toBe(0)
    expect(result.groupedContentParts).toEqual([{ type: 'step_group', parts: [toolCall] }])
  })
})

const imageToolCall = {
  type: 'tool-call' as const,
  state: 'result' as const,
  toolCallId: 'tool-image',
  toolName: 'chatbox_cli',
  args: {},
  result: {
    ok: true,
    command: 'image generate',
    accepted: true,
    background: true,
    recordId: 'record-1',
    status: 'pending',
    startedAt: 1,
    wait: { mode: 'callback', managedBy: 'chatbox', modelShouldPoll: false },
  },
}

describe('createCollapsedDisplayGroups', () => {
  test('keeps image parts emitted before the last step', () => {
    const image = { type: 'image' as const, storageKey: 'img-1' }
    const contentParts: MessageContentParts = [image, reasoning, answer]

    const { orderedContentParts, lastStepIndex } = createMessageTimelineLayout(contentParts, true)

    expect(createCollapsedDisplayGroups(orderedContentParts, lastStepIndex)).toEqual([image, answer])
  })

  test('hides process steps, including image generation tool calls shown as artifacts', () => {
    const contentParts: MessageContentParts = [imageToolCall, answer]

    const { orderedContentParts, lastStepIndex } = createMessageTimelineLayout(contentParts, true)

    expect(createCollapsedDisplayGroups(orderedContentParts, lastStepIndex)).toEqual([answer])
  })

  test('falls back to the last step when the message ends on one', () => {
    const image = { type: 'image' as const, storageKey: 'img-1' }
    const contentParts: MessageContentParts = [image, reasoning]

    const { orderedContentParts, lastStepIndex } = createMessageTimelineLayout(contentParts, true)

    expect(createCollapsedDisplayGroups(orderedContentParts, lastStepIndex)).toEqual([
      image,
      { type: 'step_group', parts: [reasoning] },
    ])
  })
})
