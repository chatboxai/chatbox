// @vitest-environment jsdom

import type { Message, Session, SessionThread } from '@shared/types'
import { createMessage } from '@shared/types'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { openSessionChatExport } from '@chatbox/core/utils/chat-export'
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

  const applicationSession: Session = {
    id: 'session',
    name: 'Nested forks',
    messages: [outerPivot, outerSummary, outerActive],
    messageForksHash: forks,
  }
  const repository = new InMemorySessionRepository()
  await repository.seedSession(applicationSession)
  const source = await openSessionChatExport(repository.rowStore, repository, applicationSession.id)
  if (!source) throw new Error('Export source missing')
  const html = await formatChatAsInteractiveHtml(source, false)
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  const { document } = dom.window
  const pageText = () => document.getElementById('chatbox-export-root')?.textContent ?? ''
  const clickFork = async (forkId: string, direction: 'next' | 'prev') => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[data-fork-id="${forkId}"][data-fork-action="${direction}"]`
    )
    expect(button).not.toBeNull()
    button?.click()
    const result = await repository.executeSessionCommand(applicationSession.id, {
      type: 'structure',
      operation: { action: 'fork-switch', pivotId: forkId, target: direction },
    })
    expect(result.delta.structureResult?.applied).toBe(true)
    const window = await repository.readSessionTranscriptWindow({
      sessionId: applicationSession.id,
      origin: 'head',
      limit: 50,
    })
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'), (element) => element.dataset.messageId)
    ).toEqual(window?.messages.map((row) => row.messageId))
  }

  expect(document.querySelectorAll('.chatbox-export-message')).toHaveLength(3)
  expect(
    Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'), (element) => element.dataset.messageId)
  ).toEqual(applicationSession.messages.map((message) => message.id))
  expect(pageText()).toContain('outer active')
  expect(pageText()).toContain('outer summary')
  expect(pageText()).not.toContain('inner active')

  await clickFork(outerPivot.id, 'next')
  expect(pageText()).not.toContain('outer active')
  expect(pageText()).toContain('outer summary')
  expect(pageText()).toContain('inner active')

  await clickFork(innerPivot.id, 'next')
  expect(pageText()).not.toContain('inner active')
  expect(pageText()).toContain('inner saved')

  await clickFork(outerPivot.id, 'prev')
  expect(pageText()).toContain('outer active')
  expect(pageText()).not.toContain('inner saved')

  await clickFork(outerPivot.id, 'next')
  expect(pageText()).toContain('inner saved')
  expect(pageText()).not.toContain('inner active')
  dom.window.close()
})

test('both HTML formats use the session title for an unnamed active thread', async () => {
  const repository = new InMemorySessionRepository()
  await repository.seedSession({
    id: 'unnamed',
    name: 'Session title',
    threadName: '',
    messages: [message('hello', 'user', 'Hello')],
  })
  const source = await openSessionChatExport(repository.rowStore, repository, 'unnamed')
  if (!source) throw new Error('Export source missing')
  const ordinary = new JSDOM(await formatChatAsHtml(source.header.name, source.formattedThreads(false)))
  const interactive = new JSDOM(await formatChatAsInteractiveHtml(source, false), { runScripts: 'dangerously' })
  expect(ordinary.window.document.querySelector('h2')?.textContent).toBe('1. Session title')
  expect(interactive.window.document.querySelector('h2')?.textContent).toBe('1. Session title')
  ordinary.window.close()
  interactive.window.close()
})
