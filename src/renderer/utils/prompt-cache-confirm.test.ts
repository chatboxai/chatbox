import { beforeEach, describe, expect, it, vi } from 'vitest'

const { showModalMock, tMock, uiState } = vi.hoisted(() => ({
  showModalMock: vi.fn(),
  tMock: vi.fn((key: string) => key),
  uiState: {
    promptCacheBreakConfirmDismissed: {} as Record<string, boolean>,
  },
}))

vi.mock('@ebay/nice-modal-react', () => ({ default: { show: showModalMock } }))
vi.mock('@/i18n', () => ({ default: { t: tMock } }))
vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => uiState,
    setState: (update: (state: typeof uiState) => Partial<typeof uiState>) => {
      Object.assign(uiState, update(uiState))
    },
  },
}))

import zhHans from '@/i18n/locales/zh-Hans/translation.json'
import {
  confirmModelSwitchIfNeeded,
  confirmPromptCacheBreakingAction,
  dismissPromptCacheBreakConfirm,
  evaluatePromptCacheDeleteContext,
  getPromptCacheBreakCopy,
  isPromptCacheBreakConfirmDismissed,
  isPromptCacheConfirmAccepted,
  selectPromptCachePolicyContext,
} from './prompt-cache-confirm'

describe('getPromptCacheBreakCopy', () => {
  it('explains the cache miss for deleting an earlier message', () => {
    expect(getPromptCacheBreakCopy('delete-historical-message')).toEqual({
      title: 'Delete this message?',
      message:
        'This conversation already has cached context. Deleting an earlier message will invalidate that cache, so the next reply may cost more and take longer.',
      confirmText: 'Delete',
      dontShowAgainText: "Don't show again",
    })
  })

  it('explains the cache miss for switching models', () => {
    expect(getPromptCacheBreakCopy('switch-model')).toEqual({
      title: 'Switch models?',
      message:
        'This conversation already has cached context. Switching models will invalidate that cache, so the next reply may cost more and take longer.',
      confirmText: 'Switch',
      dontShowAgainText: "Don't show again",
    })
  })

  it('localizes cache-break confirmation copy for Chinese', () => {
    const zh = zhHans
    const copy = getPromptCacheBreakCopy('delete-historical-message')
    expect(copy.title).toBe('Delete this message?')
    expect(copy.message).toBe(
      'This conversation already has cached context. Deleting an earlier message will invalidate that cache, so the next reply may cost more and take longer.'
    )
    expect(zh['Delete this message?']).toBe('删除这条消息？')
    expect(
      zh[
        'This conversation already has cached context. Deleting an earlier message will invalidate that cache, so the next reply may cost more and take longer.'
      ]
    ).toBe('这段对话已经有缓存上下文。删除较早的消息会使缓存失效，下一次回复可能更贵、也更慢。')
    expect(zh["Don't show again"]).toBe('不再提示')
    expect(zh['Switch models?']).toBe('切换模型？')
    expect(zh['Deleting this summary will restore original messages to context calculation.']).toBe(
      '删除此摘要将恢复到压缩前的状态'
    )
  })
})

describe('isPromptCacheConfirmAccepted', () => {
  it('accepts a boolean confirm and a dont-show-again payload', () => {
    expect(isPromptCacheConfirmAccepted(true)).toBe(true)
    expect(isPromptCacheConfirmAccepted({ confirmed: true, dontShowAgain: false })).toBe(true)
    expect(isPromptCacheConfirmAccepted({ confirmed: true, dontShowAgain: true })).toBe(true)
    expect(isPromptCacheConfirmAccepted(false)).toBe(false)
    expect(isPromptCacheConfirmAccepted(undefined)).toBe(false)
  })
})

describe('confirmPromptCacheBreakingAction', () => {
  beforeEach(() => {
    showModalMock.mockReset()
    uiState.promptCacheBreakConfirmDismissed = {}
  })

  it('resolves true only when the user confirms', async () => {
    showModalMock.mockResolvedValueOnce(true)
    await expect(confirmPromptCacheBreakingAction('switch-model')).resolves.toBe(true)
    expect(showModalMock).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({
        title: 'Switch models?',
        confirmText: 'Switch',
        dontShowAgainText: "Don't show again",
        danger: false,
      })
    )
    expect(uiState.promptCacheBreakConfirmDismissed).toEqual({})
  })

  it('treats cancel and dismiss as a refusal', async () => {
    showModalMock.mockResolvedValueOnce(false)
    await expect(confirmPromptCacheBreakingAction('delete-historical-message')).resolves.toBe(false)
    showModalMock.mockResolvedValueOnce(undefined)
    await expect(confirmPromptCacheBreakingAction('delete-historical-message')).resolves.toBe(false)
  })

  it('skips the dialog after the user dismissed that action', async () => {
    uiState.promptCacheBreakConfirmDismissed = { 'delete-historical-message': true }
    await expect(confirmPromptCacheBreakingAction('delete-historical-message')).resolves.toBe(true)
    expect(showModalMock).not.toHaveBeenCalled()
  })

  it('still asks for a different action after one scene is dismissed', async () => {
    uiState.promptCacheBreakConfirmDismissed = { 'delete-historical-message': true }
    showModalMock.mockResolvedValueOnce(false)
    await expect(confirmPromptCacheBreakingAction('switch-model')).resolves.toBe(false)
    expect(showModalMock).toHaveBeenCalledOnce()
  })

  it('persists only the confirmed action when dont-show-again is checked', async () => {
    showModalMock.mockResolvedValueOnce({ confirmed: true, dontShowAgain: true })
    await expect(confirmPromptCacheBreakingAction('switch-model')).resolves.toBe(true)
    expect(uiState.promptCacheBreakConfirmDismissed).toEqual({ 'switch-model': true })
  })

  it('does not persist the preference when the checkbox is left unchecked', async () => {
    showModalMock.mockResolvedValueOnce({ confirmed: true, dontShowAgain: false })
    await expect(confirmPromptCacheBreakingAction('delete-historical-message')).resolves.toBe(true)
    expect(uiState.promptCacheBreakConfirmDismissed).toEqual({})
  })
})

describe('prompt cache confirm preference helpers', () => {
  beforeEach(() => {
    uiState.promptCacheBreakConfirmDismissed = {}
  })

  it('reads and writes a per-action uiStore preference', () => {
    expect(isPromptCacheBreakConfirmDismissed('delete-summary')).toBe(false)
    dismissPromptCacheBreakConfirm('delete-summary')
    expect(isPromptCacheBreakConfirmDismissed('delete-summary')).toBe(true)
    expect(isPromptCacheBreakConfirmDismissed('switch-model')).toBe(false)
  })
})

describe('confirmModelSwitchIfNeeded', () => {
  beforeEach(() => {
    showModalMock.mockReset()
    uiState.promptCacheBreakConfirmDismissed = {}
  })

  it('skips the dialog on a new session and in chat mode', async () => {
    const longAssistant = {
      id: 'a1',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(4000) }],
    }
    await expect(confirmModelSwitchIfNeeded('work', [longAssistant], true)).resolves.toBe(true)
    await expect(confirmModelSwitchIfNeeded('chat', [longAssistant], false)).resolves.toBe(true)
    expect(showModalMock).not.toHaveBeenCalled()
  })

  it('asks before switching models in a long work-mode chat', async () => {
    showModalMock.mockResolvedValueOnce(false)
    const longAssistant = {
      id: 'a1',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(4000) }],
    }
    await expect(confirmModelSwitchIfNeeded('work', [longAssistant], false)).resolves.toBe(false)
    expect(showModalMock).toHaveBeenCalledOnce()
  })

  it('keeps the warning once a long first request starts streaming', async () => {
    showModalMock.mockResolvedValueOnce(false)
    const longUser = {
      id: 'u1',
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(4000) }],
    }
    const generatingAssistant = {
      id: 'a1',
      role: 'assistant' as const,
      generating: true,
      contentParts: [{ type: 'text' as const, text: 'partial' }],
    }

    await expect(confirmModelSwitchIfNeeded('work', [longUser, generatingAssistant], false)).resolves.toBe(false)
    expect(showModalMock).toHaveBeenCalledOnce()
  })

  it('ignores long history outside the configured context window', async () => {
    const oldLongAssistant = {
      id: 'a-old',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(4000) }],
    }
    const recentUser = {
      id: 'u-recent',
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: 'question' }],
    }
    const recentAssistant = {
      id: 'a-recent',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'answer' }],
    }

    await expect(
      confirmModelSwitchIfNeeded('work', [oldLongAssistant, recentUser, recentAssistant], false, {
        maxContextMessageCount: 1,
      })
    ).resolves.toBe(true)
    expect(showModalMock).not.toHaveBeenCalled()
  })

  it('skips the dialog when model-switch prompts are dismissed', async () => {
    uiState.promptCacheBreakConfirmDismissed = { 'switch-model': true }
    const longAssistant = {
      id: 'a1',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(4000) }],
    }
    await expect(confirmModelSwitchIfNeeded('work', [longAssistant], false)).resolves.toBe(true)
    expect(showModalMock).not.toHaveBeenCalled()
  })
})

describe('selectPromptCachePolicyContext', () => {
  it('uses compaction selection while preserving in-flight request evidence', () => {
    const boundary = {
      id: 'a-boundary',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'old answer' }],
    }
    const summary = {
      id: 'summary',
      role: 'assistant' as const,
      isSummary: true,
      contentParts: [{ type: 'text' as const, text: 'summary' }],
    }
    const generatingAssistant = {
      id: 'a-generating',
      role: 'assistant' as const,
      generating: true,
      contentParts: [{ type: 'text' as const, text: 'partial' }],
    }

    const context = selectPromptCachePolicyContext([boundary, summary, generatingAssistant], {
      compactionPoints: [
        {
          boundaryMessageId: boundary.id,
          summaryMessageId: summary.id,
          createdAt: 1,
        },
      ],
    })

    expect(context.messages.map((message) => message.id)).toEqual([summary.id])
    expect(context.hasStartedAssistantRequest).toBe(true)
  })

  it('excludes queued turns that have not reached the provider', () => {
    const firstUser = {
      id: 'u1',
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: 'short request' }],
    }
    const generatingAssistant = {
      id: 'a1',
      role: 'assistant' as const,
      generating: true,
      contentParts: [{ type: 'text' as const, text: 'partial' }],
    }
    const queuedUser = {
      id: 'u2',
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(4000) }],
    }

    const context = selectPromptCachePolicyContext([firstUser, generatingAssistant, queuedUser])

    expect(context.messages.map((message) => message.id)).toEqual([firstUser.id])
    expect(context.hasStartedAssistantRequest).toBe(true)
  })

  it('does not use assistants outside the selected context as request evidence', () => {
    const oldAssistant = {
      id: 'a-old',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'old answer' }],
    }
    const latestUser = {
      id: 'u-latest',
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(4000) }],
    }

    const context = selectPromptCachePolicyContext([oldAssistant, latestUser], {
      maxContextMessageCount: 0,
    })

    expect(context.messages.map((message) => message.id)).toEqual([latestUser.id])
    expect(context.hasStartedAssistantRequest).toBe(false)
  })
})

describe('evaluatePromptCacheDeleteContext', () => {
  it('distinguishes filtered failures from compaction boundaries', () => {
    const failedReply = {
      id: 'a-failed',
      role: 'assistant' as const,
      error: 'request failed',
      contentParts: [{ type: 'text' as const, text: 'failed' }],
    }
    const boundary = {
      id: 'a-boundary',
      role: 'assistant' as const,
      contentParts: [{ type: 'text' as const, text: 'old answer' }],
    }
    const summary = {
      id: 'summary',
      role: 'assistant' as const,
      isSummary: true,
      contentParts: [{ type: 'text' as const, text: 'summary' }],
    }
    const recentUser = {
      id: 'u-recent',
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: 'recent question' }],
    }
    const messages = [failedReply, boundary, summary, recentUser]
    const options = {
      compactionPoints: [
        {
          boundaryMessageId: boundary.id,
          summaryMessageId: summary.id,
          createdAt: 1,
        },
      ],
    }

    expect(evaluatePromptCacheDeleteContext(messages, failedReply.id, options).deletionChangesContext).toBe(false)
    expect(evaluatePromptCacheDeleteContext(messages, boundary.id, options).deletionChangesContext).toBe(true)
  })
})
