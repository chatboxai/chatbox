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
  it('keeps info parts visible and exports app lifecycle summaries as first-class text', async () => {
    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      contentParts: [
        { type: 'text', text: 'Visible text' },
        { type: 'info', text: 'Host status note' },
        {
          type: 'app',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'instance-1',
          lifecycle: 'active',
          summary: 'Restored the active story draft and preserved the exportable checkpoint.',
        },
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
    expect(markdown).toContain('Restored the active story draft and preserved the exportable checkpoint.')

    expect(text).toContain('Visible text')
    expect(text).toContain('Host status note')
    expect(text).toContain('Restored the active story draft and preserved the exportable checkpoint.')

    expect(html).toContain('Visible text')
    expect(html).toContain('Host status note')
    expect(html).toContain('Restored the active story draft and preserved the exportable checkpoint.')
  })
})
