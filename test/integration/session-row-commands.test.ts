import { SessionRowConflictError, SessionWriteConflictError, type SessionHeader } from '@chatbox/core/ports'
import { SESSION_TOKEN_CACHE_VERSION } from '@chatbox/core/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drivers, message, setupRows, source } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})

describe.each(drivers)('row command persistence on %s', (driver) => {
  it.each([false, true])('applies sequential commands using durable rows (forks=%s)', async (forks) => {
    const input = {
      ...source(),
      threads: [{ id: 'archive', name: 'Earlier', createdAt: 1, messages: [message('archived')] }],
      ...(forks
        ? {
            messageForksHash: {
              prompt: {
                position: 0,
                createdAt: 1,
                lists: [
                  { id: 'selected', messages: [] },
                  { id: 'alternate', messages: [message('alternate-answer', 'assistant')] },
                ],
              },
            },
          }
        : {}),
    }
    const h = await setupRows(driver, input)
    cleanup.push(h.dispose)
    const snapshot = vi.spyOn(h.rows, 'readSnapshot')
    await h.service.insertMessages('s', [message('next'), message('reply', 'assistant')])
    await h.service.updateMessage('s', 'reply', { contentParts: [{ type: 'text', text: 'Persisted' }] })
    await h.service.updateSessionHeader('s', { name: 'Renamed' })
    const fresh = h.createRepository()
    expect((await fresh.getSessionHeader('s'))?.header.name).toBe('Renamed')
    expect(
      (await fresh.readSessionMessages({ sessionId: 's', messageIds: ['reply'] }))?.messages[0].contentParts
    ).toEqual([{ type: 'text', text: 'Persisted' }])
    expect((await h.activeMessages()).map((m) => m.id)).toEqual(['prompt', 'answer', 'next', 'reply'])
    expect(await h.readMessage('archived')).toEqual(input.threads[0].messages[0])
    if (forks) expect(await h.readMessage('alternate-answer')).toBeDefined()
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('passes only header fields to functional metadata commands', async () => {
    const h = await setupRows(driver)
    cleanup.push(h.dispose)
    const updater = vi.fn((current: SessionHeader | null | undefined) => {
      if (!current) throw new Error('Missing header')
      expect(current).not.toHaveProperty('messages')
      expect(current).not.toHaveProperty('threads')
      expect(current).not.toHaveProperty('messageForksHash')
      return { ...current, name: 'Functional' }
    })
    await h.repository.executeSessionCommand('s', { type: 'header', updater })
    expect(updater).toHaveBeenCalledOnce()
    expect((await h.repository.getSessionHeader('s'))?.header.name).toBe('Functional')
  })

  it('normalizes imported message bodies at the row input boundary', async () => {
    const h = await setupRows(driver, {
      ...source(),
      messages: [{ ...message('old'), contentParts: [], content: 'Imported legacy text' }],
    })
    cleanup.push(h.dispose)
    expect((await h.readMessage('old'))?.contentParts).toEqual([{ type: 'text', text: 'Imported legacy text' }])
    await h.service.updateMessage('s', 'old', { model: 'Model' })
    expect((await h.readMessage('old'))?.contentParts).toEqual([{ type: 'text', text: 'Imported legacy text' }])
    expect((await h.repository.getSessionHeader('s'))?.revision).toBeGreaterThan(0)
  })

  it('repairs duplicate identities before the first row publication', async () => {
    const h = await setupRows(driver, { ...source(), messages: [message('duplicate'), message('duplicate')] })
    cleanup.push(h.dispose)
    const rows = await h.activeMessages()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((m) => m.id)).size).toBe(2)
    await h.service.insertMessage('s', message('next'))
    expect((await h.activeMessages()).map((m) => m.id)).toContain('next')
    expect((await h.rows.readCommit('s'))?.record).toMatchObject({ rowFormatVersion: 3, rowAuthority: 1 })
  })

  it('rejects stale command revisions without changing messages', async () => {
    const h = await setupRows(driver)
    cleanup.push(h.dispose)
    const revision = (await h.repository.getSessionHeader('s'))!.revision
    await h.service.updateSessionHeader('s', { name: 'Later' })
    await expect(
      h.repository.executeSessionCommand('s', { type: 'append', messages: [message('stale')] }, revision)
    ).rejects.toBeInstanceOf(SessionWriteConflictError)
    expect(await h.readMessage('stale')).toBeUndefined()
    await expect(
      h.repository.readSessionMessages({ sessionId: 's', messageIds: ['prompt'], expectedRevision: revision })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
  })

  it('observes external commits through point and context reads without retaining a baseline', async () => {
    const h = await setupRows(driver)
    cleanup.push(h.dispose)
    const before = await h.repository.getSessionContextSource({ sessionId: 's' })
    const other = h.createRepository()
    await other.executeSessionCommand('s', {
      type: 'update',
      messageId: 'prompt',
      updater: { contentParts: [{ type: 'text', text: 'External' }] },
    })
    const after = await h.repository.getSessionContextSource({ sessionId: 's' })
    expect(after?.revision).toBeGreaterThan(before!.revision!)
    expect(after?.candidateMessages[0].contentParts).toEqual([{ type: 'text', text: 'External' }])
    expect((await h.readMessage('prompt'))?.contentParts).toEqual([{ type: 'text', text: 'External' }])
  })

  it.each([100, 1000, 10000])('updates a tail without reading %i historical bodies', async (count) => {
    const h = await setupRows(driver, {
      ...source(),
      messages: Array.from({ length: count }, (_, i) => message(`m${i}`)),
    })
    cleanup.push(h.dispose)
    const snapshot = vi.spyOn(h.rows, 'readSnapshot')
    const transcript = vi.spyOn(h.rows, 'readTranscriptWindow')
    const bodies = vi.spyOn(h.rows, 'readMessages')
    await h.service.updateMessage('s', `m${count - 1}`, { contentParts: [{ type: 'text', text: 'Updated' }] })
    expect(snapshot).not.toHaveBeenCalled()
    expect(transcript).not.toHaveBeenCalled()
    expect(bodies.mock.calls.flatMap(([request]) => request.messageIds).every((id) => id === `m${count - 1}`)).toBe(
      true
    )
    expect((await h.readMessage(`m${count - 1}`))?.contentParts).toEqual([{ type: 'text', text: 'Updated' }])
  })

  it('uses bounded independent token inputs without changing the transcript', async () => {
    const h = await setupRows(driver)
    cleanup.push(h.dispose)
    const window = await h.openWindow()
    const visible = window.getSnapshot().rows
    const plan = await h.repository.createSessionTokenPlan({ sessionId: 's', maxContextMessageCount: 20 })
    expect(plan).not.toBeNull()
    const page = await h.repository.readSessionTokenPage({
      plan: plan!,
      offset: 0,
      limit: 1,
      cacheKey: `${SESSION_TOKEN_CACHE_VERSION}:default:0:0`,
      maxBytes: 2048,
    })
    expect(page.messages.length).toBeLessThanOrEqual(1)
    expect(window.getSnapshot().rows).toBe(visible)
    expect(visible.every((row) => row.message.tokenCountMap === undefined)).toBe(true)
  })
})
