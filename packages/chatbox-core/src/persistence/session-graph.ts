import type { Message, MessageRole, Session, SessionThread, SessionType } from '../types'

export const SESSION_GRAPH_SCHEMA_VERSION = 1
export const ACTIVE_SESSION_THREAD_KEY = 'active'

export interface SessionGraphCodecOptions {
  interruptedAt?: number
}

export interface PersistedSessionHeader {
  version: typeof SESSION_GRAPH_SCHEMA_VERSION
  id: string
  type?: SessionType
  name: string
  starred?: boolean
  hidden?: boolean
  archivedAt?: number
  copilotId?: string
  assistantAvatarKey?: string
  picUrl?: string
  backgroundImage?: Session['backgroundImage']
  settings?: Session['settings']
  threadName?: string
  threadsDefined: boolean
  forksDefined: boolean
  compactionPoints?: Session['compactionPoints']
  extra: Record<string, unknown>
}

export interface PersistedThreadRow {
  key: string
  threadId: string | null
  kind: 'active' | 'archived'
  position: number
  name: string
  createdAt: number
  compactionPoints?: SessionThread['compactionPoints']
  sessionPromptContextSnapshot?: SessionThread['sessionPromptContextSnapshot']
  extra: Record<string, unknown>
}

export interface PersistedMessageRow {
  threadKey: string
  id: string
  parentMessageId: string | null
  sequence: number
  role: MessageRole
  createdAt: number | null
  updatedAt: number | null
  payload: Record<string, unknown>
}

export interface PersistedForkRow {
  pivotMessageId: string
  position: number
  createdAt: number
  extra: Record<string, unknown>
}

export interface PersistedForkBranchRow {
  pivotMessageId: string
  branchId: string
  sequence: number
  extra: Record<string, unknown>
}

export interface PersistedForkMessageRow {
  pivotMessageId: string
  branchId: string
  id: string
  parentMessageId: string | null
  sequence: number
  role: MessageRole
  createdAt: number | null
  updatedAt: number | null
  payload: Record<string, unknown>
}

export interface PersistedSessionGraph {
  header: PersistedSessionHeader
  threads: PersistedThreadRow[]
  messages: PersistedMessageRow[]
  forks: PersistedForkRow[]
  forkBranches: PersistedForkBranchRow[]
  forkMessages: PersistedForkMessageRow[]
}

export class SessionGraphCodecError extends Error {
  readonly name = 'SessionGraphCodecError'

  constructor(
    message: string,
    readonly graph: unknown,
    readonly cause?: unknown
  ) {
    super(message)
  }
}

const sessionKeys = [
  'id',
  'type',
  'name',
  'picUrl',
  'messages',
  'starred',
  'hidden',
  'archivedAt',
  'copilotId',
  'assistantAvatarKey',
  'backgroundImage',
  'settings',
  'threads',
  'threadName',
  'messageForksHash',
  'compactionPoints',
] as const

const threadKeys = ['id', 'name', 'messages', 'createdAt', 'compactionPoints', 'sessionPromptContextSnapshot'] as const
const messageKeys = ['id', 'role', 'timestamp', 'updatedAt'] as const
const forkKeys = ['position', 'lists', 'createdAt'] as const
const branchKeys = ['id', 'messages'] as const

function cloneJson<T>(value: T): T {
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => (typeof item === 'function' ? undefined : item))
    if (serialized === undefined) return undefined as T
    return JSON.parse(serialized) as T
  } catch (error) {
    throw new SessionGraphCodecError('Session graph contains a non-JSON persistence value', value, error)
  }
}

function omitKeys(value: object, keys: readonly string[]): Record<string, unknown> {
  const record = { ...value } as Record<string, unknown>
  for (const key of keys) delete record[key]
  return cloneJson(record)
}

function archiveThreadKey(threadId: string): string {
  return `archived:${encodeURIComponent(threadId)}`
}

function projectMessage(message: Message, interruptedAt?: number): Message {
  const persisted = cloneJson(message)
  if (!persisted.generating) return persisted

  const stoppedAt = interruptedAt ?? persisted.updatedAt ?? persisted.timestamp ?? Date.now()
  return {
    ...persisted,
    generating: false,
    contentParts: persisted.contentParts.map((part) =>
      part.type === 'tool-call' && part.state === 'call'
        ? {
            ...part,
            state: 'error',
            pauseReason: undefined,
            resultStorageKey: undefined,
            result: { error: 'Tool execution was interrupted before its result was persisted.' },
            duration: part.startTime === undefined ? undefined : Math.max(0, stoppedAt - part.startTime),
          }
        : part
    ),
  }
}

function encodeMessages(messages: Message[], threadKey: string, interruptedAt?: number): PersistedMessageRow[] {
  return messages.map((source, sequence) => {
    const message = projectMessage(source, interruptedAt)
    return {
      threadKey,
      id: message.id,
      parentMessageId: sequence === 0 ? null : (messages[sequence - 1]?.id ?? null),
      sequence,
      role: message.role,
      createdAt: message.timestamp ?? null,
      updatedAt: message.updatedAt ?? null,
      payload: omitKeys(message, messageKeys),
    }
  })
}

function decodeMessage(row: Pick<PersistedMessageRow, 'id' | 'role' | 'createdAt' | 'updatedAt' | 'payload'>): Message {
  return cloneJson({
    ...row.payload,
    id: row.id,
    role: row.role,
    ...(row.createdAt === null ? {} : { timestamp: row.createdAt }),
    ...(row.updatedAt === null ? {} : { updatedAt: row.updatedAt }),
  }) as Message
}

function orderedMessages<T extends PersistedMessageRow | PersistedForkMessageRow>(
  rows: T[],
  graph: PersistedSessionGraph,
  owner: string
): Message[] {
  const sorted = [...rows].sort((left, right) => left.sequence - right.sequence)
  const seen = new Set<string>()
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]
    if (!row || row.sequence !== index) {
      throw new SessionGraphCodecError(`Corrupt message sequence for ${owner}`, graph)
    }
    if (seen.has(row.id)) throw new SessionGraphCodecError(`Duplicate message id ${row.id} for ${owner}`, graph)
    seen.add(row.id)
    const expectedParent = index === 0 ? null : (sorted[index - 1]?.id ?? null)
    if (row.parentMessageId !== expectedParent) {
      throw new SessionGraphCodecError(`Corrupt message parent for ${row.id} in ${owner}`, graph)
    }
  }
  return sorted.map(decodeMessage)
}

// biome-ignore lint/complexity/noStaticOnlyClass: A named codec namespace keeps encode/decode call sites explicit.
export class SessionGraphCodec {
  static encode(session: Session, options: SessionGraphCodecOptions = {}): PersistedSessionGraph {
    const threadKeysSeen = new Set<string>([ACTIVE_SESSION_THREAD_KEY])
    const threads: PersistedThreadRow[] = [
      {
        key: ACTIVE_SESSION_THREAD_KEY,
        threadId: null,
        kind: 'active',
        position: 0,
        name: session.threadName ?? session.name,
        createdAt: session.messages[0]?.timestamp ?? 0,
        compactionPoints: cloneJson(session.compactionPoints),
        extra: {},
      },
    ]
    const messages = encodeMessages(session.messages, ACTIVE_SESSION_THREAD_KEY, options.interruptedAt)

    for (const [position, thread] of (session.threads ?? []).entries()) {
      const key = archiveThreadKey(thread.id)
      if (threadKeysSeen.has(key)) {
        throw new SessionGraphCodecError(`Duplicate archived thread id: ${thread.id}`, session)
      }
      threadKeysSeen.add(key)
      threads.push({
        key,
        threadId: thread.id,
        kind: 'archived',
        position,
        name: thread.name,
        createdAt: thread.createdAt,
        compactionPoints: cloneJson(thread.compactionPoints),
        sessionPromptContextSnapshot: cloneJson(thread.sessionPromptContextSnapshot),
        extra: omitKeys(thread, threadKeys),
      })
      messages.push(...encodeMessages(thread.messages, key, options.interruptedAt))
    }

    const forks: PersistedForkRow[] = []
    const forkBranches: PersistedForkBranchRow[] = []
    const forkMessages: PersistedForkMessageRow[] = []
    for (const [pivotMessageId, fork] of Object.entries(session.messageForksHash ?? {})) {
      forks.push({
        pivotMessageId,
        position: fork.position,
        createdAt: fork.createdAt,
        extra: omitKeys(fork, forkKeys),
      })
      for (const [sequence, branch] of fork.lists.entries()) {
        forkBranches.push({
          pivotMessageId,
          branchId: branch.id,
          sequence,
          extra: omitKeys(branch, branchKeys),
        })
        for (const row of encodeMessages(branch.messages, ACTIVE_SESSION_THREAD_KEY, options.interruptedAt)) {
          forkMessages.push({
            pivotMessageId,
            branchId: branch.id,
            id: row.id,
            parentMessageId: row.parentMessageId,
            sequence: row.sequence,
            role: row.role,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            payload: row.payload,
          })
        }
      }
    }

    return {
      header: {
        version: SESSION_GRAPH_SCHEMA_VERSION,
        id: session.id,
        type: session.type,
        name: session.name,
        starred: session.starred,
        hidden: session.hidden,
        archivedAt: session.archivedAt,
        copilotId: session.copilotId,
        assistantAvatarKey: session.assistantAvatarKey,
        picUrl: session.picUrl,
        backgroundImage: cloneJson(session.backgroundImage),
        settings: cloneJson(session.settings),
        threadName: session.threadName,
        threadsDefined: session.threads !== undefined,
        forksDefined: session.messageForksHash !== undefined,
        compactionPoints: cloneJson(session.compactionPoints),
        extra: omitKeys(session, sessionKeys),
      },
      threads,
      messages,
      forks,
      forkBranches,
      forkMessages,
    }
  }

  static decode(graph: PersistedSessionGraph): Session {
    try {
      if (graph.header.version !== SESSION_GRAPH_SCHEMA_VERSION) {
        throw new SessionGraphCodecError(`Unsupported session graph version: ${String(graph.header.version)}`, graph)
      }
      const active = graph.threads.find((thread) => thread.key === ACTIVE_SESSION_THREAD_KEY)
      if (!active || active.kind !== 'active') {
        throw new SessionGraphCodecError('Session graph is missing its active thread', graph)
      }

      const archivedRows = graph.threads
        .filter((thread) => thread.kind === 'archived')
        .sort((left, right) => left.position - right.position)
      const archivedThreads: SessionThread[] = archivedRows.map((thread) => {
        if (!thread.threadId) throw new SessionGraphCodecError('Archived thread is missing its id', graph)
        return cloneJson({
          ...thread.extra,
          id: thread.threadId,
          name: thread.name,
          messages: orderedMessages(
            graph.messages.filter((message) => message.threadKey === thread.key),
            graph,
            `thread ${thread.threadId}`
          ),
          createdAt: thread.createdAt,
          ...(thread.compactionPoints === undefined ? {} : { compactionPoints: thread.compactionPoints }),
          ...(thread.sessionPromptContextSnapshot === undefined
            ? {}
            : { sessionPromptContextSnapshot: thread.sessionPromptContextSnapshot }),
        }) as SessionThread
      })

      const messageForksHash: NonNullable<Session['messageForksHash']> = {}
      for (const fork of graph.forks) {
        const branches = graph.forkBranches
          .filter((branch) => branch.pivotMessageId === fork.pivotMessageId)
          .sort((left, right) => left.sequence - right.sequence)
        messageForksHash[fork.pivotMessageId] = cloneJson({
          ...fork.extra,
          position: fork.position,
          createdAt: fork.createdAt,
          lists: branches.map((branch, sequence) => {
            if (branch.sequence !== sequence) {
              throw new SessionGraphCodecError(`Corrupt fork branch sequence for ${fork.pivotMessageId}`, graph)
            }
            return {
              ...branch.extra,
              id: branch.branchId,
              messages: orderedMessages(
                graph.forkMessages.filter(
                  (message) => message.pivotMessageId === fork.pivotMessageId && message.branchId === branch.branchId
                ),
                graph,
                `fork ${fork.pivotMessageId}/${branch.branchId}`
              ),
            }
          }),
        })
      }

      return cloneJson({
        ...graph.header.extra,
        id: graph.header.id,
        name: graph.header.name,
        messages: orderedMessages(
          graph.messages.filter((message) => message.threadKey === ACTIVE_SESSION_THREAD_KEY),
          graph,
          `session ${graph.header.id}`
        ),
        ...(graph.header.type === undefined ? {} : { type: graph.header.type }),
        ...(graph.header.picUrl === undefined ? {} : { picUrl: graph.header.picUrl }),
        ...(graph.header.starred === undefined ? {} : { starred: graph.header.starred }),
        ...(graph.header.hidden === undefined ? {} : { hidden: graph.header.hidden }),
        ...(graph.header.archivedAt === undefined ? {} : { archivedAt: graph.header.archivedAt }),
        ...(graph.header.copilotId === undefined ? {} : { copilotId: graph.header.copilotId }),
        ...(graph.header.assistantAvatarKey === undefined
          ? {}
          : { assistantAvatarKey: graph.header.assistantAvatarKey }),
        ...(graph.header.backgroundImage === undefined ? {} : { backgroundImage: graph.header.backgroundImage }),
        ...(graph.header.settings === undefined ? {} : { settings: graph.header.settings }),
        ...(graph.header.threadName === undefined ? {} : { threadName: graph.header.threadName }),
        ...(graph.header.threadsDefined ? { threads: archivedThreads } : {}),
        ...(graph.header.forksDefined ? { messageForksHash } : {}),
        ...(graph.header.compactionPoints === undefined ? {} : { compactionPoints: graph.header.compactionPoints }),
      }) as Session
    } catch (error) {
      if (error instanceof SessionGraphCodecError) throw error
      throw new SessionGraphCodecError('Failed to decode persisted session graph', graph, error)
    }
  }

  static persistableProjection(session: Session, options: SessionGraphCodecOptions = {}): Session {
    return SessionGraphCodec.decode(SessionGraphCodec.encode(session, options))
  }
}
