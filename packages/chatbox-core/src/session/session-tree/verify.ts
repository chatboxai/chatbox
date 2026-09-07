import type { Message, Session } from '../../types/session'
import { decodeSessionTree } from './decode'
import { type EncodeSessionTreeOptions, encodeSessionTree } from './encode'
import type { SessionTree } from './types'
import { validateSessionTree } from './validate'

export type VerifySessionTreeRoundTripResult = { ok: true; tree: SessionTree } | { ok: false; reason: string }

const STRUCTURAL_SESSION_KEYS = ['messages', 'threads', 'threadName', 'messageForksHash', 'compactionPoints']

function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined)
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }
    return left.every((item, index) => deepEqual(item, right[index]))
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = definedKeys(leftRecord)
  if (leftKeys.length !== definedKeys(rightRecord).length) {
    return false
  }
  return leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]))
}

function compareMessages(label: string, expected: Message[], actual: Message[]): string | null {
  if (expected.length !== actual.length) {
    return `${label} holds ${actual.length} messages, expected ${expected.length}`
  }
  for (const [index, message] of expected.entries()) {
    if (message.id !== actual[index].id) {
      return `${label} message #${index} is ${actual[index].id}, expected ${message.id}`
    }
    if (!deepEqual(message, actual[index])) {
      return `${label} message ${message.id} differs`
    }
  }
  return null
}

function compareSessionRecords(expected: Session, actual: Session): string | null {
  const expectedRecord = expected as unknown as Record<string, unknown>
  const actualRecord = actual as unknown as Record<string, unknown>
  const keys = new Set(
    [...definedKeys(expectedRecord), ...definedKeys(actualRecord)].filter(
      (key) => !STRUCTURAL_SESSION_KEYS.includes(key)
    )
  )
  for (const key of keys) {
    if (!deepEqual(expectedRecord[key], actualRecord[key])) {
      return `session field ${key} differs`
    }
  }
  return null
}

function compareForks(expected: Session, actual: Session): string | null {
  const expectedForks = expected.messageForksHash ?? {}
  const actualForks = actual.messageForksHash ?? {}
  const expectedPivots = Object.keys(expectedForks).sort()
  const actualPivots = Object.keys(actualForks).sort()
  if (!deepEqual(expectedPivots, actualPivots)) {
    return `fork pivots are ${actualPivots.join(', ') || 'none'}, expected ${expectedPivots.join(', ') || 'none'}`
  }
  for (const pivotId of expectedPivots) {
    const expectedFork = expectedForks[pivotId]
    const actualFork = actualForks[pivotId]
    if (expectedFork.position !== actualFork.position) {
      return `fork ${pivotId} has position ${actualFork.position}, expected ${expectedFork.position}`
    }
    if (expectedFork.createdAt !== actualFork.createdAt) {
      return `fork ${pivotId} was created at ${actualFork.createdAt}, expected ${expectedFork.createdAt}`
    }
    if (expectedFork.lists.length !== actualFork.lists.length) {
      return `fork ${pivotId} has ${actualFork.lists.length} branches, expected ${expectedFork.lists.length}`
    }
    for (const [index, list] of expectedFork.lists.entries()) {
      const difference = compareMessages(
        `fork ${pivotId} branch #${index}`,
        list.messages,
        actualFork.lists[index].messages
      )
      if (difference) {
        return difference
      }
    }
  }
  return null
}

function compareThreads(expected: Session, actual: Session): string | null {
  const expectedThreads = expected.threads ?? []
  const actualThreads = actual.threads ?? []
  if (expectedThreads.length !== actualThreads.length) {
    return `session holds ${actualThreads.length} archived threads, expected ${expectedThreads.length}`
  }
  for (const [index, thread] of expectedThreads.entries()) {
    const other = actualThreads[index]
    if (thread.id !== other.id) {
      return `archived thread #${index} is ${other.id}, expected ${thread.id}`
    }
    if (thread.name !== other.name) {
      return `archived thread ${thread.id} is named ${other.name}, expected ${thread.name}`
    }
    if (thread.createdAt !== other.createdAt) {
      return `archived thread ${thread.id} was created at ${other.createdAt}, expected ${thread.createdAt}`
    }
    if (!deepEqual(thread.compactionPoints ?? [], other.compactionPoints ?? [])) {
      return `archived thread ${thread.id} compaction points differ`
    }
    if (!deepEqual(thread.sessionPromptContextSnapshot, other.sessionPromptContextSnapshot)) {
      return `archived thread ${thread.id} prompt context snapshot differs`
    }
    const difference = compareMessages(`archived thread ${thread.id}`, thread.messages, other.messages)
    if (difference) {
      return difference
    }
  }
  return null
}

function compareSessions(expected: Session, actual: Session): string | null {
  const activeMessages = compareMessages('active thread', expected.messages, actual.messages)
  if (activeMessages) {
    return activeMessages
  }
  if (expected.threadName !== actual.threadName) {
    return 'active thread name differs'
  }
  if (!deepEqual(expected.compactionPoints ?? [], actual.compactionPoints ?? [])) {
    return 'active thread compaction points differ'
  }
  return compareThreads(expected, actual) ?? compareForks(expected, actual) ?? compareSessionRecords(expected, actual)
}

/**
 * Normalize, encode, validate, decode and compare. Fork list ids are excluded
 * from the comparison because decode regenerates them for branches whose head
 * carries none.
 */
export function verifySessionTreeRoundTrip(
  session: Session,
  options: EncodeSessionTreeOptions
): VerifySessionTreeRoundTripResult {
  const encoded = encodeSessionTree(session, options)
  if (!encoded.ok) {
    return encoded
  }
  const validation = validateSessionTree(encoded.tree)
  if (!validation.ok) {
    return validation
  }
  const decoded = decodeSessionTree(encoded.tree)
  if (!decoded.ok) {
    return decoded
  }
  const difference = compareSessions(encoded.normalized, decoded.session)
  if (difference) {
    return { ok: false, reason: difference }
  }
  return { ok: true, tree: encoded.tree }
}
