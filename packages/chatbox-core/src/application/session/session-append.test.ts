import { describe, expect, test } from 'vitest'
import { encodeSessionTree } from '../../session/session-tree'
import type { Message, Session } from '../../types/session'
import { isAppendBase, planSessionAppend } from './session-append'

const message = (id: string, index: number): Message => ({
  id,
  role: index % 2 ? 'assistant' : 'user',
  contentParts: [{ type: 'text', text: `中文正文 ${id} ${'内容'.repeat(index * 3)}` }],
  ...(index % 3 ? { timestamp: 100 + index, updatedAt: 200 + index } : {}),
  ...(index % 5 === 1 ? { generating: true } : {}),
})

function encode(session: Session, previousMessages?: Parameters<typeof encodeSessionTree>[1]['previousMessages']) {
  const result = encodeSessionTree(session, { activeThreadId: session.id, now: 1234, previousMessages })
  if (!result.ok) throw new Error(result.reason)
  return result
}

describe('session tail append planning', () => {
  test('base identity proof only ignores separate text token overlays', () => {
    const base: Session = { id: 'base', name: 'Original', messages: [message('one', 1)] }
    const overlay = {
      ...base,
      messages: [{ ...base.messages[0], tokenCountMap: { default: 30 }, tokenCalculatedAt: { default: 42 } }],
    }
    expect(isAppendBase(base, overlay)).toBe(false)
    expect(isAppendBase(base, overlay, true)).toBe(true)
    expect(isAppendBase(base, { ...overlay, name: 'Changed' }, true)).toBe(false)
    expect(isAppendBase(base, { ...overlay, messages: [{ ...overlay.messages[0], generating: false }] }, true)).toBe(
      false
    )
    expect(
      isAppendBase(
        base,
        { ...overlay, messages: [{ ...overlay.messages[0], contentParts: [{ type: 'text', text: 'Edited' }] }] },
        true
      )
    ).toBe(false)
  })

  test('matches complete encoding across randomized active paths, archives, branches and compaction points', () => {
    let seed = 1731
    const random = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % limit
    }
    let planned = 0
    let fallback = 0
    for (let trial = 0; trial < 250; trial++) {
      const messages = Array.from({ length: random(30) }, (_, index) => message(`m-${index}`, index))
      const session: Session = { id: 'session', name: `Case ${trial}`, messages }
      if (random(2))
        session.threads = [{ id: 'archive', name: 'Earlier', createdAt: 1, messages: [message('archived', 3)] }]
      if (messages.length > 5 && random(2)) {
        messages[2] = { ...messages[2], role: 'assistant', isSummary: true }
        session.compactionPoints = [
          { boundaryMessageId: messages[1].id, summaryMessageId: messages[2].id, createdAt: 7 },
        ]
      }
      if (messages.length > 5 && random(3) === 0) {
        const position = random(2)
        session.messageForksHash = {
          [messages[3].id]: {
            position,
            createdAt: 4,
            lists: [0, 1].map((index) => ({
              id: `branch-${index}`,
              messages: index === position ? [] : [message('alternative', 8)],
            })),
          },
        }
      }
      const before = encode(session)
      const additions = Array.from({ length: random(4) + 1 }, (_, index) => message(`new-${index}`, random(20)))
      const next = {
        ...before.normalized,
        name: `Updated ${trial}`,
        messages: [...before.normalized.messages, ...additions],
      }
      const rows = { sessionId: session.id, threads: before.tree.threads, messages: before.tree.messages }
      const plan = planSessionAppend(before.normalized, next, rows)
      if (!plan) {
        fallback += 1
        continue
      }
      planned += 1
      const complete = encode(next, before.tree.messages).tree
      expect(plan.rows.threads, `threads ${trial}`).toEqual(complete.threads)
      expect(plan.rows.messages, `messages ${trial}`).toEqual(complete.messages)
      expect(plan.record, `record ${trial}`).toEqual(complete.session)
      expect(plan.diff.messages.upsert.length).toBe(additions.length + Number(messages.length > 0))
      expect(plan.diff.threads.upsert).toHaveLength(1)
    }
    expect(planned).toBeGreaterThan(150)
    expect(fallback).toBeGreaterThan(0)
  })

  test('falls back for tail forks, summaries, reused ids and edits to existing messages', () => {
    const original: Session = { id: 'session', name: 'Test', messages: [message('a', 0), message('b', 1)] }
    const before = encode(original)
    const rows = { sessionId: original.id, threads: before.tree.threads, messages: before.tree.messages }
    const previous = before.normalized
    const next = { ...previous, messages: [...previous.messages, message('c', 2)] }
    expect(planSessionAppend(previous, { ...next, messages: [...previous.messages, message('a', 2)] }, rows)).toBeNull()
    expect(
      planSessionAppend(
        previous,
        { ...next, messages: [...previous.messages, { ...message('c', 2), isSummary: true }] },
        rows
      )
    ).toBeNull()
    expect(
      planSessionAppend(previous, { ...next, messages: [message('a', 7), ...next.messages.slice(1)] }, rows)
    ).toBeNull()
    const forked = {
      ...previous,
      messageForksHash: {
        b: {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'other', messages: [message('other', 1)] },
            { id: 'active', messages: [] },
          ],
        },
      },
    }
    const fork = encode(forked)
    expect(
      planSessionAppend(
        fork.normalized,
        { ...fork.normalized, messages: [...fork.normalized.messages, message('c', 2)] },
        { ...rows, threads: fork.tree.threads, messages: fork.tree.messages }
      )
    ).toBeNull()
  })
})
