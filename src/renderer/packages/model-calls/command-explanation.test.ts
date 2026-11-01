import type { SessionSettings } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chatMock, createModelMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  createModelMock: vi.fn(),
}))

vi.mock('@/adapters', () => ({
  createModel: createModelMock,
}))

vi.mock('@/packages/model-calls/message-utils', () => ({
  convertToModelMessages: vi.fn(async (messages: unknown) => messages),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({ language: 'en' }),
    }),
  },
}))

import { generateCommandExplanation, isCommandAssessmentSafe, parseCommandAssessment } from './command-explanation'

beforeEach(() => {
  chatMock.mockReset()
  createModelMock.mockReset()
  createModelMock.mockResolvedValue({
    isSupportVision: () => false,
    isSupportSystemMessage: () => true,
    chat: chatMock,
  })
})

describe('command safety assessment', () => {
  it('auto-approves a valid approve assessment without risk flags', async () => {
    chatMock.mockResolvedValue({
      contentParts: [
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'assessment-1',
          toolName: 'submit_command_assessment',
          args: {
            decision: 'approve',
            summary: 'Creates the requested temporary file.',
            reason: 'Safe and reversible.',
            riskFlags: [],
          },
        },
      ],
    })
    const onUpdate = vi.fn()

    await expect(
      generateCommandExplanation(
        {} as SessionSettings,
        'session-1',
        'touch /tmp/a',
        'create a temporary file',
        onUpdate
      )
    ).resolves.toEqual({
      explanation: 'Creates the requested temporary file.\n✅ Safe and reversible.',
      safe: true,
    })
    expect(onUpdate).toHaveBeenCalledWith('Creates the requested temporary file.\n✅ Safe and reversible.')
    expect(chatMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'system' }), expect.objectContaining({ role: 'user' })]),
      expect.objectContaining({
        sessionId: 'session-1',
        maxSteps: 1,
        tools: expect.objectContaining({ submit_command_assessment: expect.any(Object) }),
      })
    )
  })

  it('fails closed when the model cannot isolate policy in a system message', async () => {
    createModelMock.mockResolvedValue({
      isSupportVision: () => false,
      isSupportSystemMessage: () => false,
      chat: chatMock,
    })

    await expect(generateCommandExplanation({} as SessionSettings, 'session-1', 'touch /tmp/a', '')).rejects.toThrow(
      'requires system message support'
    )
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('does not create a model when the assessment is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      generateCommandExplanation({} as SessionSettings, 'session-1', 'touch /tmp/a', '', undefined, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(createModelMock).not.toHaveBeenCalled()
  })

  it('does not auto-approve a contradictory approve assessment with risk flags', () => {
    const assessment = parseCommandAssessment({
      decision: 'approve',
      summary: 'Downloads and runs a script.',
      reason: 'Requested by the user.',
      riskFlags: ['network', 'untrusted_code'],
    })

    expect(assessment).not.toBeNull()
    expect(assessment && isCommandAssessmentSafe(assessment)).toBe(false)
  })

  it('rejects missing, duplicate, or invalid assessment tool calls', async () => {
    chatMock.mockResolvedValueOnce({ contentParts: [{ type: 'text', text: 'Looks safe.' }] })
    await expect(generateCommandExplanation({} as SessionSettings, 'session-1', 'touch /tmp/a', '')).rejects.toThrow(
      'was not called exactly once'
    )

    chatMock.mockResolvedValueOnce({
      contentParts: [
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'assessment-1',
          toolName: 'submit_command_assessment',
          args: { decision: 'approve' },
        },
      ],
    })
    await expect(generateCommandExplanation({} as SessionSettings, 'session-1', 'touch /tmp/a', '')).rejects.toThrow(
      'returned invalid input'
    )

    chatMock.mockResolvedValueOnce({
      contentParts: [
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'assessment-1',
          toolName: 'submit_command_assessment',
          args: {
            decision: 'approve',
            summary: 'Creates a file.',
            reason: 'Safe.',
            riskFlags: [],
          },
        },
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'assessment-2',
          toolName: 'submit_command_assessment',
          args: {
            decision: 'review',
            summary: 'Creates a file.',
            reason: 'Needs review.',
            riskFlags: ['filesystem'],
          },
        },
      ],
    })
    await expect(generateCommandExplanation({} as SessionSettings, 'session-1', 'touch /tmp/a', '')).rejects.toThrow(
      'was not called exactly once'
    )
  })
})
