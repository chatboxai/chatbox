import { describe, expect, it, vi } from 'vitest'
import { findMessageLocation } from '../../session/message-forks'
import type { Message, Session } from '../../types'
import { type SaveAndResendDependencies, type SaveAndResendRequest, saveAndResendMessage } from './save-and-resend'

const text = (value: string): Message['contentParts'] => [{ type: 'text', text: value }]
const user: Message = { id: 'user', role: 'user', contentParts: text('original'), tokenCount: 99 }
const answer: Message = { id: 'answer', role: 'assistant', contentParts: text('old answer') }
const baseSession = (): Session => ({
  id: 'session',
  name: 'Conversation',
  type: 'chat',
  settings: { provider: 'openai', modelId: 'model' },
  messages: [{ id: 'system', role: 'system', contentParts: text('instructions') }, user, answer],
})

function setup(
  options: { session?: Session; fail?: 'write' | 'metadata'; beforeWrite?: (value: Session) => Session } = {}
) {
  let session = options.session ?? baseSession()
  let sequence = 0
  const orchestrate = vi.fn<SaveAndResendDependencies['generation']['orchestrate']>().mockResolvedValue(undefined)
  const dependencies: SaveAndResendDependencies = {
    sessions: {
      getSession: async () => session,
      updateSessionWithMessages: async (_id, updater, writeOptions) => {
        if (options.fail === 'write') throw new Error('disk full')
        if (options.beforeWrite) session = options.beforeWrite(session)
        const next = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
        if (!next) throw new Error('Session update was empty')
        session = next
        writeOptions?.onFullSessionPersisted?.(session)
        if (options.fail === 'metadata') throw new Error('metadata failed')
        return session
      },
    },
    generation: { orchestrate },
    createId: () => `new-${++sequence}`,
    now: () => 100,
  }
  const onPersisted = vi.fn()
  const request: SaveAndResendRequest = {
    sessionId: session.id,
    messageId: user.id,
    contentParts: text('edited'),
    expectedContentParts: user.contentParts,
    onPersisted,
  }
  return { dependencies, request, orchestrate, onPersisted, session: () => session }
}

function find(session: Session, id: string) {
  const location = findMessageLocation(session, id)
  return location?.list[location.index]
}

describe('saveAndResendMessage', () => {
  it('versions the prompt and reply in one write before starting generation', async () => {
    const test = setup()
    await saveAndResendMessage(test.dependencies, test.request)
    const session = test.session()
    expect(session.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(session.messages[1].id).not.toBe(user.id)
    expect(session.messages[1].contentParts).toEqual(text('edited'))
    expect(session.messages[1].tokenCount).toBeUndefined()
    expect(find(session, user.id)?.contentParts).toEqual(text('original'))
    expect(find(session, answer.id)?.contentParts).toEqual(text('old answer'))
    expect(test.onPersisted).toHaveBeenCalledOnce()
    expect(test.orchestrate).toHaveBeenCalledWith(session.id, session.messages[2], { operationType: 'regenerate' })
  })

  it('preserves attachments on the original and edited prompt', async () => {
    const session = baseSession()
    session.messages[1] = { ...user, contentParts: [...user.contentParts, { type: 'image', storageKey: 'image' }] }
    const test = setup({ session })
    test.request.expectedContentParts = session.messages[1].contentParts
    test.request.contentParts = [...text('edited'), { type: 'image', storageKey: 'image' }]
    await saveAndResendMessage(test.dependencies, test.request)
    expect(test.session().messages[1].contentParts[1]).toEqual({ type: 'image', storageKey: 'image' })
    expect(find(test.session(), user.id)?.contentParts[1]).toEqual({ type: 'image', storageKey: 'image' })
  })

  it('keeps the existing first-message pivot convention without dropping its old tail', async () => {
    const test = setup({ session: { ...baseSession(), messages: [user, answer] } })
    await saveAndResendMessage(test.dependencies, test.request)
    expect(test.session().messages[0].id).toBe(user.id)
    expect(test.session().messages[0].contentParts).toEqual(text('edited'))
    expect(find(test.session(), answer.id)?.contentParts).toEqual(answer.contentParts)
  })

  it('leaves the editor draft and history untouched when storage rejects the write', async () => {
    const test = setup({ fail: 'write' })
    await expect(saveAndResendMessage(test.dependencies, test.request)).rejects.toThrow('disk full')
    expect(test.session()).toEqual(baseSession())
    expect(test.request.contentParts).toEqual(text('edited'))
    expect(test.onPersisted).not.toHaveBeenCalled()
    expect(test.orchestrate).not.toHaveBeenCalled()
  })

  it('dispatches a durable edit once even when only metadata persistence fails', async () => {
    const test = setup({ fail: 'metadata' })
    await saveAndResendMessage(test.dependencies, test.request)
    expect(find(test.session(), user.id)?.contentParts).toEqual(text('original'))
    expect(test.onPersisted).toHaveBeenCalledOnce()
    expect(test.orchestrate).toHaveBeenCalledOnce()
  })

  it('rejects an edit changed after the initial read without overwriting it', async () => {
    const test = setup({
      beforeWrite: (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === user.id ? { ...message, contentParts: text('concurrent edit') } : message
        ),
      }),
    })
    await expect(saveAndResendMessage(test.dependencies, test.request)).rejects.toThrow('changed while editing')
    expect(find(test.session(), user.id)?.contentParts).toEqual(text('concurrent edit'))
    expect(test.onPersisted).not.toHaveBeenCalled()
    expect(test.orchestrate).not.toHaveBeenCalled()
  })

  it('blocks compaction and preparing placeholders', async () => {
    const compacting = setup()
    compacting.dependencies.getRuntimeState = () => ({ compactionRunning: true })
    await expect(saveAndResendMessage(compacting.dependencies, compacting.request)).rejects.toThrow('compaction')
    const generating = setup({ session: { ...baseSession(), messages: [user, { ...answer, generating: true }] } })
    await expect(saveAndResendMessage(generating.dependencies, generating.request)).rejects.toThrow('generating')
    expect(compacting.orchestrate).not.toHaveBeenCalled()
    expect(generating.orchestrate).not.toHaveBeenCalled()
  })

  it('does not allow an assistant target or an empty edited text', async () => {
    const test = setup()
    await expect(saveAndResendMessage(test.dependencies, { ...test.request, messageId: answer.id })).rejects.toThrow(
      'user message'
    )
    await expect(
      saveAndResendMessage(test.dependencies, { ...test.request, contentParts: text('  ') })
    ).rejects.toThrow('Enter a message')
    expect(test.orchestrate).not.toHaveBeenCalled()
  })

  it('still dispatches if navigation feedback throws after persistence', async () => {
    const test = setup()
    test.request.onPersisted = () => {
      throw new Error('navigation failed')
    }
    await expect(saveAndResendMessage(test.dependencies, test.request)).rejects.toThrow('navigation failed')
    expect(test.orchestrate).toHaveBeenCalledOnce()
    expect(find(test.session(), user.id)?.contentParts).toEqual(text('original'))
  })
})
