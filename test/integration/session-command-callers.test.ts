import { ChatMessageService, ChatSendPreflightInvalidatedError } from '@chatbox/core/application/chat'
import { SessionWriteConflictError } from '@chatbox/core/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drivers, message, setupRows, source, type Driver } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})
async function setup(driver: Driver) {
  const original = { ...source(), messages: [message('prompt')] }
  const h = await setupRows(driver, original)
  cleanup.push(h.dispose)
  const generation = vi.fn(async () => {})
  let id = 0
  const chat = (beforeSend?: () => Promise<number | void>) =>
    new ChatMessageService({
      sessions: h.service,
      generation: { orchestrate: generation },
      beforeSend,
      createId: () => `new-${++id}`,
      now: () => 100,
    })
  return { ...h, original, generation, chat }
}

describe.each(drivers)('send commands on %s', (driver) => {
  it('appends exactly one durable turn and returns only its header', async () => {
    const h = await setup(driver)
    const snapshot = vi.spyOn(h.rows, 'readSnapshot')
    const command = vi.spyOn(h.repository, 'executeSessionCommand')
    const persisted = vi.fn()
    const result = await h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    expect(result.session.id).toBe('s')
    expect(result.session).not.toHaveProperty('messages')
    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0][1].type).toBe('append')
    expect(snapshot).not.toHaveBeenCalled()
    expect(persisted).toHaveBeenCalledOnce()
    expect(h.generation).toHaveBeenCalledOnce()
    expect((await h.activeMessages()).map((m) => m.id)).toEqual(['prompt', 'new-1', 'new-2'])
  })

  it.each(['text', 'attachment', 'model', 'thread', 'name'] as const)(
    'rejects an unacknowledged %s change during preparation',
    async (change) => {
      const h = await setup(driver)
      const before = async () => {
        if (change === 'text')
          await h.service.updateMessage('s', 'prompt', { contentParts: [{ type: 'text', text: 'Edited' }] })
        if (change === 'attachment')
          await h.service.updateMessage('s', 'prompt', {
            files: [{ id: 'f', name: 'f.txt', fileType: 'text/plain', storageKey: 'f' }],
          })
        if (change === 'model')
          await h.service.updateSessionHeader('s', { settings: { ...h.original.settings, modelId: 'other' } })
        if (change === 'name') await h.service.updateSessionHeader('s', { name: 'Renamed' })
        if (change === 'thread')
          await h.service.executeStructureCommand('s', {
            action: 'thread-create',
            archiveId: 'archive',
            now: 2,
            systemMessageId: 'system',
            defaultSystemPrompt: '',
          })
      }
      const persisted = vi.fn()
      await expect(
        h.chat(before).sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
      ).rejects.toBeInstanceOf(ChatSendPreflightInvalidatedError)
      expect(persisted).not.toHaveBeenCalled()
      expect(h.generation).not.toHaveBeenCalled()
      expect(await h.readMessage('new-1')).toBeUndefined()
    }
  )

  it('accepts the revision returned by an intentional preparation command', async () => {
    const h = await setup(driver)
    const before = async () => {
      await h.service.updateSessionHeader('s', { name: 'Prepared' })
      return (await h.repository.getSessionHeader('s'))!.revision
    }
    await h.chat(before).sendExistingSession('s', { input: { text: 'Next' } })
    expect(h.generation).toHaveBeenCalledOnce()
    expect((await h.activeMessages()).map((m) => m.id)).toEqual(['prompt', 'new-1', 'new-2'])
  })

  it('rejects a concurrent writer that wins immediately before the append transaction', async () => {
    const h = await setup(driver)
    const other = h.createRepository()
    const execute = h.repository.executeSessionCommand.bind(h.repository)
    vi.spyOn(h.repository, 'executeSessionCommand').mockImplementationOnce(async (id, command, revision) => {
      await other.executeSessionCommand(id, {
        type: 'update',
        messageId: 'prompt',
        updater: { contentParts: [{ type: 'text', text: 'Concurrent' }] },
      })
      return execute(id, command, revision)
    })
    await expect(h.chat().sendExistingSession('s', { input: { text: 'Next' } })).rejects.toBeInstanceOf(
      ChatSendPreflightInvalidatedError
    )
    expect(await h.readMessage('new-1')).toBeUndefined()
    expect(h.generation).not.toHaveBeenCalled()
  })

  it('notifies and generates once after a durable append despite a metadata conflict', async () => {
    const h = await setup(driver)
    await h.service.updateSessionHeader('s', { name: 'Prepared' })
    const update = vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new SessionWriteConflictError('s', 1, 2))
    const persisted = vi.fn()
    await h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    expect(persisted).toHaveBeenCalledOnce()
    expect(h.generation).toHaveBeenCalledOnce()
    expect(await h.readMessage('new-2')).toMatchObject({ generating: true })
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2), { timeout: 2000 })
  })

  it('does not notify or generate when the row transaction fails', async () => {
    const h = await setup(driver)
    const failure = new Error('content failed')
    vi.spyOn(h.rows, 'applyDiff').mockRejectedValueOnce(failure)
    const persisted = vi.fn()
    await expect(
      h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    ).rejects.toBe(failure)
    expect(persisted).not.toHaveBeenCalled()
    expect(h.generation).not.toHaveBeenCalled()
    expect((await h.activeMessages()).map((m) => m.id)).toEqual(['prompt'])
  })

  it('starts the durable reply even when navigation feedback rejects', async () => {
    const h = await setup(driver)
    const failure = new Error('feedback failed')
    await expect(
      h
        .chat()
        .sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: vi.fn().mockRejectedValue(failure) })
    ).rejects.toBe(failure)
    expect(h.generation).toHaveBeenCalledOnce()
    expect(await h.readMessage('new-2')).toBeDefined()
  })

  it.each([false, true])('settles rejected generation without replacing terminal content (%s)', async (terminal) => {
    const h = await setup(driver)
    const failure = new Error('generation setup failed')
    h.generation.mockImplementationOnce(async () => {
      if (terminal)
        await h.service.updateMessage('s', 'new-2', {
          generating: false,
          contentParts: [{ type: 'text', text: 'Complete' }],
        })
      throw failure
    })
    await expect(h.chat().sendExistingSession('s', { input: { text: 'Next' } })).rejects.toBe(failure)
    const reply = await h.readMessage('new-2')
    expect(reply?.generating).toBe(false)
    if (terminal) {
      expect(reply?.contentParts).toEqual([{ type: 'text', text: 'Complete' }])
      expect(reply?.error).toBeUndefined()
    } else expect(reply?.error).toBe(failure.message)
  })

  it('edits only the addressed message through a row command', async () => {
    const h = await setup(driver)
    const command = vi.spyOn(h.repository, 'executeSessionCommand')
    await h.chat().editMessage('s', 'prompt', [{ type: 'text', text: 'Edited' }])
    expect(command).toHaveBeenCalledOnce()
    expect(command.mock.calls[0][1]).toMatchObject({ type: 'update', messageId: 'prompt' })
    expect((await h.readMessage('prompt'))?.contentParts).toEqual([{ type: 'text', text: 'Edited' }])
  })
})
