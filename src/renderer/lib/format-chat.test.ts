import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Message, SessionThread } from '../../shared/types'

vi.mock('@/components/Markdown', async () => {
  const ReactModule = await import('react')
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children),
    BlockCodeCollapsedStateProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  }
})

import { formatChatAsHtml, formatChatAsMarkdown, formatChatAsTxt } from './format-chat'

describe('format chat exports', () => {
  it('keeps info parts visible and renders a fallback label for future structured parts', async () => {
    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      contentParts: [
        { type: 'text', text: 'Visible text' },
        { type: 'info', text: 'Host status note' },
        {
          type: 'app',
          appId: 'story-builder',
          appInstanceId: 'instance-1',
          state: 'active',
        } as never,
      ],
    }

    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Main thread',
      createdAt: 1,
      messages: [message],
    }

    const markdown = formatChatAsMarkdown('Session', [thread])
    const text = formatChatAsTxt('Session', [thread])
    const html = await formatChatAsHtml('Session', [thread])

    expect(markdown).toContain('Visible text')
    expect(markdown).toContain('Host status note')
    expect(markdown).toContain('[app]')

    expect(text).toContain('Visible text')
    expect(text).toContain('Host status note')
    expect(text).toContain('[app]')

    expect(html).toContain('Visible text')
    expect(html).toContain('Host status note')
    expect(html).toContain('[app]')
  })
})
