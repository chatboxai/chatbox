import { describe, expect, it, vi } from 'vitest'
import type { Message, Session } from '../../types/session'
import { getSessionMessageTokenizationDigest, type SessionMessageDerivedPatch } from './message-derived-data'
import { applySessionDerivedPatches } from './session-derived-data'

function message(id: string): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text: id }] }
}
function patch(message: Message, tokens = 10, calculatedAt = 100): SessionMessageDerivedPatch {
  return {
    messageId: message.id,
    text: [
      { tokenizerType: 'default', sourceDigest: getSessionMessageTokenizationDigest(message), tokens, calculatedAt },
    ],
  }
}

describe('complete cached session derived replay', () => {
  it('walks a thousand-message snapshot once for a batch and preserves unrelated references', () => {
    const messages = Array.from({ length: 1000 }, (_, index) => message(`m${index}`))
    const session: Session = { id: 's', name: 's', type: 'chat', messages }
    const patches = messages.filter((_, index) => index % 10 === 0).map((message) => patch(message))
    const idRead = vi.fn(() => 'm999')
    Object.defineProperty(messages[999], 'id', { get: idRead, enumerable: true })
    const result = applySessionDerivedPatches(session, patches)
    expect(idRead).toHaveBeenCalledTimes(1)
    expect(result.patches).toHaveLength(100)
    expect(result.session.messages[0].tokenCountMap?.default).toBe(10)
    expect(result.session.messages[999]).toBe(messages[999])
    expect(result.session.messages[0].contentParts).toBe(messages[0].contentParts)
  })

  it('replays ordered patches across active, archived and saved fork messages', () => {
    const active = message('active'),
      archived = message('archived'),
      forked = message('forked')
    const session: Session = {
      id: 's',
      name: 's',
      type: 'chat',
      messages: [active],
      threads: [{ id: 't', name: 't', createdAt: 1, messages: [archived] }],
      messageForksHash: { active: { position: 0, createdAt: 1, lists: [{ id: 'f', messages: [forked] }] } },
    }
    const result = applySessionDerivedPatches(session, [patch(forked), patch(active, 20, 120), patch(active, 0, 90)])
    expect(result.patches.map((patch) => patch.messageId)).toEqual(['forked', 'active'])
    expect(result.session.messages[0].tokenCountMap?.default).toBe(20)
    expect(result.session.messageForksHash?.active.lists[0].messages[0].tokenCountMap?.default).toBe(10)
    expect(result.session.threads).toBe(session.threads)
    const noChange = applySessionDerivedPatches(result.session, [patch(active, 0, 90)])
    expect(noChange.session).toBe(result.session)
    expect(noChange.patches).toEqual([])
    const threadResult = applySessionDerivedPatches(session, [patch(archived)])
    expect(threadResult.session.messages).toBe(session.messages)
    expect(threadResult.session.messageForksHash).toBe(session.messageForksHash)
    expect(threadResult.session.threads?.[0].messages[0].tokenCountMap?.default).toBe(10)
  })
})
