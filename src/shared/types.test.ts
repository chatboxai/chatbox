import { describe, expect, it } from 'vitest'
import {
  copyMessageForksWithMapping,
  copyMessagesWithMapping,
  copyThreads,
  createMessage,
  MessageSchema,
} from './types'
import type { CompactionPoint, SessionThread } from './types/session'

describe('copyMessagesWithMapping', () => {
  it('should return messages with new IDs and mapping', () => {
    const messages = [createMessage('user', 'Hello'), createMessage('assistant', 'Hi')]
    const { messages: newMessages, idMapping } = copyMessagesWithMapping(messages)

    expect(newMessages).toHaveLength(2)
    expect(idMapping.size).toBe(2)
    expect(idMapping.get(messages[0].id)).toBe(newMessages[0].id)
    expect(idMapping.get(messages[1].id)).toBe(newMessages[1].id)
    expect(newMessages[0].id).not.toBe(messages[0].id)
    expect(newMessages[1].id).not.toBe(messages[1].id)
  })

  it('should preserve message content and role', () => {
    const messages = [createMessage('user', 'Hello'), createMessage('assistant', 'Hi there')]
    const { messages: newMessages } = copyMessagesWithMapping(messages)

    expect(newMessages[0].role).toBe('user')
    const part0 = newMessages[0].contentParts[0]
    if (part0.type === 'text') {
      expect(part0.text).toBe('Hello')
    }
    expect(newMessages[1].role).toBe('assistant')
    const part1 = newMessages[1].contentParts[0]
    if (part1.type === 'text') {
      expect(part1.text).toBe('Hi there')
    }
  })

  it('should handle empty messages array', () => {
    const { messages, idMapping } = copyMessagesWithMapping([])
    expect(messages).toHaveLength(0)
    expect(idMapping.size).toBe(0)
  })

  it('should preserve timestamp on copied messages', () => {
    const msg = createMessage('user', 'Test')
    const originalTimestamp = msg.timestamp
    const { messages: newMessages } = copyMessagesWithMapping([msg])

    expect(newMessages[0].timestamp).toBe(originalTimestamp)
  })
})

describe('MessageSchema', () => {
  it('drops the removed legacy cancel projection', () => {
    const parsed = MessageSchema.parse({
      id: 'legacy-message',
      role: 'assistant',
      contentParts: [],
      cancel: () => undefined,
    })

    expect('cancel' in parsed).toBe(false)
  })
})

describe('copyThreads with compactionPoints', () => {
  it('should map compactionPoints IDs correctly', () => {
    const msg1 = createMessage('user', 'Hello')
    const msg2 = createMessage('assistant', 'Summary')

    const compactionPoint: CompactionPoint = {
      summaryMessageId: msg2.id,
      boundaryMessageId: msg1.id,
      createdAt: Date.now(),
    }

    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [msg1, msg2],
      createdAt: Date.now(),
      compactionPoints: [compactionPoint],
    }

    const newThreads = copyThreads([thread])!
    const newThread = newThreads[0]

    expect(newThread.compactionPoints).toHaveLength(1)
    const newCp = newThread.compactionPoints![0]

    const newMessageIds = new Set(newThread.messages.map((m) => m.id))
    expect(newMessageIds.has(newCp.summaryMessageId)).toBe(true)
    expect(newMessageIds.has(newCp.boundaryMessageId)).toBe(true)

    expect(newCp.summaryMessageId).not.toBe(compactionPoint.summaryMessageId)
    expect(newCp.boundaryMessageId).not.toBe(compactionPoint.boundaryMessageId)
  })

  it('should preserve compactionPoint createdAt timestamp', () => {
    const msg1 = createMessage('user', 'Hello')
    const msg2 = createMessage('assistant', 'Summary')
    const cpCreatedAt = Date.now() - 10000

    const compactionPoint: CompactionPoint = {
      summaryMessageId: msg2.id,
      boundaryMessageId: msg1.id,
      createdAt: cpCreatedAt,
    }

    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [msg1, msg2],
      createdAt: Date.now(),
      compactionPoints: [compactionPoint],
    }

    const newThreads = copyThreads([thread])!
    const newCp = newThreads[0].compactionPoints![0]

    expect(newCp.createdAt).toBe(cpCreatedAt)
  })

  it('should handle threads without compactionPoints', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [createMessage('user', 'Hello')],
      createdAt: Date.now(),
    }

    const newThreads = copyThreads([thread])!
    expect(newThreads[0].compactionPoints).toBeUndefined()
  })

  it('should skip compactionPoints with unmapped IDs', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [createMessage('user', 'Hello')],
      createdAt: Date.now(),
      compactionPoints: [
        {
          summaryMessageId: 'non-existent-id',
          boundaryMessageId: 'another-non-existent-id',
          createdAt: Date.now(),
        },
      ],
    }

    const newThreads = copyThreads([thread])!
    // All ids unmapped → the point is dropped entirely (undefined, not []).
    expect(newThreads[0].compactionPoints).toBeUndefined()
  })

  it('should handle mixed valid and invalid compactionPoints', () => {
    const msg1 = createMessage('user', 'Hello')
    const msg2 = createMessage('assistant', 'Summary')

    const validCp: CompactionPoint = {
      summaryMessageId: msg2.id,
      boundaryMessageId: msg1.id,
      createdAt: Date.now(),
    }

    const invalidCp: CompactionPoint = {
      summaryMessageId: 'non-existent-id',
      boundaryMessageId: 'another-non-existent-id',
      createdAt: Date.now(),
    }

    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [msg1, msg2],
      createdAt: Date.now(),
      compactionPoints: [validCp, invalidCp],
    }

    const newThreads = copyThreads([thread])!
    expect(newThreads[0].compactionPoints).toHaveLength(1)
    expect(newThreads[0].compactionPoints![0].summaryMessageId).not.toBe(validCp.summaryMessageId)
  })

  it('should return undefined for undefined source', () => {
    const result = copyThreads(undefined)
    expect(result).toBeUndefined()
  })

  it('should generate new thread IDs', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [createMessage('user', 'Hello')],
      createdAt: Date.now(),
    }

    const newThreads = copyThreads([thread])!
    expect(newThreads[0].id).not.toBe(thread.id)
  })

  it('should update thread createdAt to current time', () => {
    const oldTime = Date.now() - 100000
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [createMessage('user', 'Hello')],
      createdAt: oldTime,
    }

    const beforeCopy = Date.now()
    const newThreads = copyThreads([thread])!
    const afterCopy = Date.now()

    expect(newThreads[0].createdAt).toBeGreaterThanOrEqual(beforeCopy)
    expect(newThreads[0].createdAt).toBeLessThanOrEqual(afterCopy)
  })

  it('should preserve thread name', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'My Important Thread',
      messages: [createMessage('user', 'Hello')],
      createdAt: Date.now(),
    }

    const newThreads = copyThreads([thread])!
    expect(newThreads[0].name).toBe('My Important Thread')
  })

  it('should handle multiple threads', () => {
    const thread1: SessionThread = {
      id: 'thread-1',
      name: 'Thread 1',
      messages: [createMessage('user', 'Hello')],
      createdAt: Date.now(),
    }

    const thread2: SessionThread = {
      id: 'thread-2',
      name: 'Thread 2',
      messages: [createMessage('user', 'Hi')],
      createdAt: Date.now(),
    }

    const newThreads = copyThreads([thread1, thread2])!
    expect(newThreads).toHaveLength(2)
    expect(newThreads[0].id).not.toBe(thread1.id)
    expect(newThreads[1].id).not.toBe(thread2.id)
    expect(newThreads[0].name).toBe('Thread 1')
    expect(newThreads[1].name).toBe('Thread 2')
  })

  it('should handle empty threads array', () => {
    const newThreads = copyThreads([])!
    expect(newThreads).toHaveLength(0)
  })

  it('should handle compactionPoint with only one message', () => {
    const msg1 = createMessage('user', 'Hello')

    const compactionPoint: CompactionPoint = {
      summaryMessageId: msg1.id,
      boundaryMessageId: msg1.id,
      createdAt: Date.now(),
    }

    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [msg1],
      createdAt: Date.now(),
      compactionPoints: [compactionPoint],
    }

    const newThreads = copyThreads([thread])!
    expect(newThreads[0].compactionPoints).toHaveLength(1)
    const newCp = newThreads[0].compactionPoints![0]
    expect(newCp.summaryMessageId).toBe(newCp.boundaryMessageId)
  })

  it('should handle multiple compactionPoints', () => {
    const msg1 = createMessage('user', 'Hello')
    const msg2 = createMessage('assistant', 'Summary 1')
    const msg3 = createMessage('user', 'Follow up')
    const msg4 = createMessage('assistant', 'Summary 2')

    const cp1: CompactionPoint = {
      summaryMessageId: msg2.id,
      boundaryMessageId: msg1.id,
      createdAt: Date.now() - 5000,
    }

    const cp2: CompactionPoint = {
      summaryMessageId: msg4.id,
      boundaryMessageId: msg3.id,
      createdAt: Date.now(),
    }

    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [msg1, msg2, msg3, msg4],
      createdAt: Date.now(),
      compactionPoints: [cp1, cp2],
    }

    const newThreads = copyThreads([thread])!
    expect(newThreads[0].compactionPoints).toHaveLength(2)

    const newCps = newThreads[0].compactionPoints!
    const newMessageIds = new Set(newThreads[0].messages.map((m) => m.id))

    expect(newMessageIds.has(newCps[0].summaryMessageId)).toBe(true)
    expect(newMessageIds.has(newCps[0].boundaryMessageId)).toBe(true)
    expect(newMessageIds.has(newCps[1].summaryMessageId)).toBe(true)
    expect(newMessageIds.has(newCps[1].boundaryMessageId)).toBe(true)
  })

  it('should use external idMapping when provided', () => {
    const sessionMsg = createMessage('user', 'Session message')
    const threadMsg = createMessage('assistant', 'Thread message')

    const externalMapping = new Map<string, string>()
    const newSessionMsgId = 'new-session-msg-id'
    externalMapping.set(sessionMsg.id, newSessionMsgId)

    const compactionPoint: CompactionPoint = {
      summaryMessageId: threadMsg.id,
      boundaryMessageId: sessionMsg.id,
      createdAt: Date.now(),
    }

    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Test Thread',
      messages: [threadMsg],
      createdAt: Date.now(),
      compactionPoints: [compactionPoint],
    }

    const newThreads = copyThreads([thread], externalMapping)!
    const newThread = newThreads[0]
    const newCp = newThread.compactionPoints![0]

    expect(newCp.boundaryMessageId).toBe(newSessionMsgId)
    const threadMsgMapping = newThread.messages.find((m) => m.role === 'assistant')
    expect(newCp.summaryMessageId).toBe(threadMsgMapping?.id)
  })
})

describe('copyMessageForksWithMapping', () => {
  it('should copy reachable fork entries and remap nested fork ids', () => {
    const pivot = createMessage('user', 'pivot')
    const current = createMessage('assistant', 'current')
    const branchPivot = createMessage('assistant', 'branch pivot')
    const branchTail = createMessage('assistant', 'branch tail')
    const nestedAlternative = createMessage('assistant', 'nested alternative')
    const unrelated = createMessage('user', 'unrelated')

    const { messages: copiedMessages, idMapping } = copyMessagesWithMapping([pivot, current])
    const { messageForksHash: copiedForks, idMapping: fullIdMapping } = copyMessageForksWithMapping(
      {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-current', messages: [] },
            { id: 'list-branch', messages: [branchPivot, branchTail] },
          ],
          createdAt: 1,
        },
        [branchPivot.id]: {
          position: 0,
          lists: [
            { id: 'nested-current', messages: [] },
            { id: 'nested-branch', messages: [nestedAlternative] },
          ],
          createdAt: 2,
        },
        [unrelated.id]: {
          position: 0,
          lists: [{ id: 'unrelated-list', messages: [createMessage('assistant', 'ignored')] }],
          createdAt: 3,
        },
      },
      idMapping
    )

    expect(copiedForks).toBeDefined()
    const copiedPivotId = copiedMessages[0].id
    const copiedPivotFork = copiedForks?.[copiedPivotId]
    expect(copiedPivotFork).toBeDefined()
    expect(copiedPivotFork?.lists[1].id).not.toBe('list-branch')

    const copiedBranchPivot = copiedPivotFork?.lists[1].messages[0]
    expect(copiedBranchPivot).toBeDefined()
    expect(copiedBranchPivot?.id).not.toBe(branchPivot.id)

    const copiedNestedFork = copiedForks?.[copiedBranchPivot!.id]
    expect(copiedNestedFork).toBeDefined()
    expect(copiedNestedFork?.lists[1].messages[0].id).not.toBe(nestedAlternative.id)
    expect(copiedForks?.[unrelated.id]).toBeUndefined()
    // The returned mapping covers messages copied inside fork lists, so
    // compaction points anchored in inactive branches can be remapped.
    expect(fullIdMapping.get(branchTail.id)).toBe(copiedPivotFork?.lists[1].messages[1].id)
    expect(fullIdMapping.get(nestedAlternative.id)).toBe(copiedNestedFork?.lists[1].messages[0].id)
  })

  it('should return undefined when no fork ids can be mapped', () => {
    const { messageForksHash: result } = copyMessageForksWithMapping(
      {
        original: {
          position: 0,
          lists: [{ id: 'list', messages: [createMessage('assistant', 'ignored')] }],
          createdAt: 1,
        },
      },
      new Map([['other', 'copied-other']])
    )

    expect(result).toBeUndefined()
  })

  it('should reuse existing ids for pre-mapped fork list messages', () => {
    const pivot = createMessage('user', 'pivot')
    const alreadyMapped = createMessage('assistant', 'already mapped')
    const mappedChildId = 'mapped-child-id'

    const { messageForksHash: copiedForks } = copyMessageForksWithMapping(
      {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-current', messages: [] },
            { id: 'list-branch', messages: [alreadyMapped] },
          ],
          createdAt: 1,
        },
      },
      new Map([
        [pivot.id, 'mapped-pivot-id'],
        [alreadyMapped.id, mappedChildId],
      ])
    )

    expect(copiedForks?.['mapped-pivot-id']?.lists[1].messages[0].id).toBe(mappedChildId)
  })
})
