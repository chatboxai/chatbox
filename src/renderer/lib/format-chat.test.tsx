// @vitest-environment jsdom

import { buildSwitchForkPatch } from '@shared/session/message-forks'
import type { Message, Session, SessionThread } from '@shared/types'
import { createMessage } from '@shared/types'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    exporter: { exportByUrl: vi.fn(), exportImageFile: vi.fn() },
  },
}))

import { formatChatAsHtml, formatChatAsInteractiveHtml } from './format-chat'

function message(id: string, role: 'user' | 'assistant', text: string): Message {
  const value = createMessage(role, text)
  value.id = id
  return value
}

test('exports previewable HTML code blocks without interactive controls', async () => {
  const threads: SessionThread[] = [
    {
      id: 'thread-1',
      name: 'Thread',
      createdAt: 0,
      messages: [createMessage('assistant', '```html\n<div>previewable-export</div>\n```')],
    },
  ]

  const html = await formatChatAsHtml('Session', threads)

  expect(html).toContain('previewable-export')
  expect(html).not.toContain('<button')
})

test('interactive HTML renders only the active path and restores nested branch selections', async () => {
  const outerPivot = message('outer-pivot', 'user', 'outer question')
  const outerSummary = message('outer-summary', 'assistant', 'outer summary')
  outerSummary.isSummary = true
  const outerActive = message('outer-active', 'assistant', 'outer active')
  const innerPivot = message('inner-pivot', 'user', 'inner question')
  const innerActive = message('inner-active', 'assistant', 'inner active')
  const innerSaved = message('inner-saved', 'assistant', 'inner saved')
  const forks: NonNullable<Session['messageForksHash']> = {
    [outerPivot.id]: {
      position: 0,
      createdAt: 1,
      lists: [
        { id: 'outer-active-list', messages: [] },
        { id: 'outer-saved-list', messages: [innerPivot, innerActive] },
      ],
    },
    [innerPivot.id]: {
      position: 0,
      createdAt: 2,
      lists: [
        { id: 'inner-active-list', messages: [] },
        { id: 'inner-saved-list', messages: [innerSaved] },
      ],
    },
  }

  const html = await formatChatAsInteractiveHtml(
    'Nested forks',
    [{ name: 'Thread', messages: [outerPivot, outerSummary, outerActive] }],
    forks
  )
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  const { document } = dom.window
  let applicationSession: Session = {
    id: 'session',
    name: 'Nested forks',
    messages: [outerPivot, outerSummary, outerActive],
    messageForksHash: forks,
  }
  const pageText = () => document.getElementById('chatbox-export-root')?.textContent ?? ''
  const clickFork = (forkId: string, direction: 'next' | 'prev') => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[data-fork-id="${forkId}"][data-fork-action="${direction}"]`
    )
    expect(button).not.toBeNull()
    button?.click()
    const patch = buildSwitchForkPatch(applicationSession, forkId, direction)
    expect(patch).not.toBeNull()
    applicationSession = { ...applicationSession, ...patch }
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'), (element) => element.dataset.messageId)
    ).toEqual(applicationSession.messages.map((message) => message.id))
  }

  expect(document.querySelectorAll('.chatbox-export-message')).toHaveLength(3)
  expect(
    Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'), (element) => element.dataset.messageId)
  ).toEqual(applicationSession.messages.map((message) => message.id))
  expect(pageText()).toContain('outer active')
  expect(pageText()).toContain('outer summary')
  expect(pageText()).not.toContain('inner active')

  clickFork(outerPivot.id, 'next')
  expect(pageText()).not.toContain('outer active')
  expect(pageText()).toContain('outer summary')
  expect(pageText()).toContain('inner active')

  clickFork(innerPivot.id, 'next')
  expect(pageText()).not.toContain('inner active')
  expect(pageText()).toContain('inner saved')

  clickFork(outerPivot.id, 'prev')
  expect(pageText()).toContain('outer active')
  expect(pageText()).not.toContain('inner saved')

  clickFork(outerPivot.id, 'next')
  expect(pageText()).toContain('inner saved')
  expect(pageText()).not.toContain('inner active')
  dom.window.close()
})
