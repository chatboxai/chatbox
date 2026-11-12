import { SessionRowConflictError } from '../ports/session-row-store'
import type { SessionRowStorePort, SessionThreadPageCursor } from '../ports/session-row-store'
import type { SessionKnownMessageMetadata, SessionMessageRelationsCursor } from '../ports/session-row-relations'
import type {
  SessionForkOptionsPage,
  SessionForkOptionsRequest,
  SessionRowRepositoryPort,
  SessionHeaderRead,
} from '../ports/session-row-repository'
import type { Message, SessionHeader } from '../types/session'
import type { ThreadRow } from '../session/session-tree/types'

/** The formatter consumes each message before requesting the next payload. */
export interface ExportableThread {
  name: string
  messages: AsyncIterable<Message> | Iterable<Message>
}

type ExportRows = Pick<
  SessionRowStorePort,
  'readCommit' | 'readThreadSummariesPage' | 'readThreadState' | 'readMessageRelationsPage' | 'readMessages'
>
type ExportSessions = Pick<SessionRowRepositoryPort, 'getSessionHeader' | 'readSessionForkOptionsPage'>
type Branch = SessionForkOptionsPage['branches'][number]
type Choices = ReadonlyMap<string, string | null>

export interface ExportFork {
  pivotId: string
  branchPointId: string
  createdAt: number
  position: number
  branches: AsyncIterable<Branch>
}

export class SessionChatExport {
  readonly header: SessionHeader
  readonly revision: number
  readonly activeThreadId: string
  private constructor(
    private readonly rows: ExportRows,
    private readonly sessions: ExportSessions,
    read: SessionHeaderRead
  ) {
    this.header = read.header
    this.revision = read.revision
    this.activeThreadId = read.activeThreadId
  }

  static async open(rows: ExportRows, sessions: ExportSessions, sessionId: string): Promise<SessionChatExport | null> {
    const read = await sessions.getSessionHeader(sessionId)
    return read ? new SessionChatExport(rows, sessions, read) : null
  }

  async assertCurrent(): Promise<void> {
    const commit = await this.rows.readCommit(this.header.id)
    if (commit?.revision !== this.revision)
      throw new SessionRowConflictError(this.header.id, this.revision, commit?.revision ?? null)
  }

  async *threads(includeArchived: boolean): AsyncGenerator<ThreadRow> {
    const identities: Array<{ threadId: string; threadOrder: number }> = []
    if (includeArchived) {
      let cursor: SessionThreadPageCursor | undefined
      do {
        const page = await this.rows.readThreadSummariesPage({ sessionId: this.header.id, limit: 100, cursor })
        if (page?.revision !== this.revision)
          throw new SessionRowConflictError(this.header.id, this.revision, page?.revision ?? null)
        identities.push(...page.threads.map(({ threadId, threadOrder }) => ({ threadId, threadOrder })))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      identities.sort(
        (a, b) => (a.threadOrder < 0 ? Infinity : a.threadOrder) - (b.threadOrder < 0 ? Infinity : b.threadOrder)
      )
    } else identities.push({ threadId: this.activeThreadId, threadOrder: -1 })
    for (const { threadId } of identities) {
      const read = await this.rows.readThreadState({
        sessionId: this.header.id,
        threadId,
        expectedRevision: this.revision,
      })
      if (!read || read.status !== 'ready') throw new Error('Export thread metadata is unavailable')
      yield read.thread
    }
  }

  async *path(
    thread: ThreadRow,
    start = thread.rootMessageId,
    choices: Choices = new Map()
  ): AsyncGenerator<SessionKnownMessageMetadata> {
    let next: string | null = start
    while (next !== null) {
      const origin = next
      let cursor: SessionMessageRelationsCursor | undefined
      let replaced = false
      do {
        const page = await this.rows.readMessageRelationsPage({
          sessionId: this.header.id,
          threadId: thread.threadId,
          selector: { kind: 'selected-path', messageId: origin },
          expectedRevision: this.revision,
          limit: 100,
          cursor,
        })
        if (!page || page.status !== 'ready') throw new Error('Export message path is unavailable')
        for (const row of page.rows) {
          yield row
          if (choices.has(row.messageId)) {
            next = choices.get(row.messageId) ?? null
            replaced = true
            break
          }
        }
        if (replaced) break
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      if (!replaced) return
    }
  }

  async *allRows(thread: ThreadRow): AsyncGenerator<SessionKnownMessageMetadata> {
    if (thread.rootMessageId === null) return
    let cursor: SessionMessageRelationsCursor | undefined
    do {
      const page = await this.rows.readMessageRelationsPage({
        sessionId: this.header.id,
        threadId: thread.threadId,
        selector: { kind: 'subtree', rootMessageId: thread.rootMessageId },
        expectedRevision: this.revision,
        limit: 100,
        cursor,
      })
      if (!page || page.status !== 'ready') throw new Error('Export branch metadata is unavailable')
      yield* page.rows
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }

  async message(messageId: string): Promise<Message> {
    const read = await this.rows.readMessages({
      sessionId: this.header.id,
      messageIds: [messageId],
      expectedRevision: this.revision,
    })
    const message = read?.messages[0]?.message
    if (!message || message.id !== messageId) throw new Error('Export message payload is unavailable')
    return message
  }

  async *messages(thread: ThreadRow, start = thread.rootMessageId, choices?: Choices): AsyncGenerator<Message> {
    for await (const row of this.path(thread, start, choices)) yield await this.message(row.messageId)
  }

  async fork(row: SessionKnownMessageMetadata): Promise<ExportFork | null> {
    if (!row.fork) return null
    const read = await this.sessions.readSessionForkOptionsPage({
      sessionId: this.header.id,
      pivotId: row.messageId,
      expectedRevision: this.revision,
      limit: 100,
    })
    if (!read) throw new Error('Export fork metadata is unavailable')
    const source = this
    return {
      pivotId: row.messageId,
      branchPointId: read.branchPointId,
      createdAt: read.createdAt,
      position: row.fork.position,
      branches: (async function* () {
        yield* read.branches
        let cursor: SessionForkOptionsRequest['cursor'] = read.nextCursor ?? undefined
        while (cursor) {
          const page = await source.sessions.readSessionForkOptionsPage({
            sessionId: source.header.id,
            pivotId: row.messageId,
            expectedRevision: source.revision,
            limit: 100,
            cursor,
          })
          if (!page) throw new Error('Export fork continuation is unavailable')
          yield* page.branches
          cursor = page.nextCursor ?? undefined
        }
      })(),
    }
  }

  private async *choices(thread: ThreadRow, selected: Choices = new Map()): AsyncGenerator<Choices> {
    for await (const row of this.path(thread, thread.rootMessageId, selected)) {
      if (!row.fork || selected.has(row.fork.branchPointId)) continue
      const fork = await this.fork(row)
      if (!fork) throw new Error('Export fork projection is unavailable')
      for await (const branch of fork.branches)
        yield* this.choices(thread, new Map(selected).set(fork.branchPointId, branch.firstMessageId))
      return
    }
    yield selected
  }

  threadName(thread: ThreadRow): string {
    return thread.threadId === this.activeThreadId ? thread.name || this.header.name : (thread.name ?? this.header.name)
  }

  async *formattedThreads(includeArchived: boolean, allBranches = false): AsyncGenerator<ExportableThread> {
    for await (const thread of this.threads(includeArchived)) {
      const name = this.threadName(thread)
      if (!allBranches) {
        yield { name, messages: this.messages(thread) }
        continue
      }
      let count = 0
      for await (const _ of this.choices(thread)) count++
      let position = 0
      for await (const choices of this.choices(thread)) {
        position++
        yield {
          name: count > 1 ? `${name} (Branch ${position}/${count})` : name,
          messages: this.messages(thread, thread.rootMessageId, choices),
        }
      }
    }
  }
}

export const openSessionChatExport = SessionChatExport.open

async function jsonMessages(messages: AsyncIterable<Message>): Promise<string> {
  let text = '['
  let separator = ''
  for await (const message of messages) {
    text += separator + JSON.stringify(message)
    separator = ','
  }
  return text + ']'
}

/** External JSON is encoded directly from row paths; payload objects are released one at a time. */
export async function formatSessionAsJson(source: SessionChatExport): Promise<string> {
  let archived = ''
  let active = ''
  let forks = ''
  let compactionPoints = ''
  for await (const thread of source.threads(true)) {
    const messages = await jsonMessages(source.messages(thread))
    if (thread.threadId === source.activeThreadId) {
      active = messages
      if (thread.compactionPoints.length)
        compactionPoints = `,"compactionPoints":${JSON.stringify(thread.compactionPoints)}`
    } else {
      const metadata = JSON.stringify({
        id: thread.threadId,
        name: thread.name,
        createdAt: thread.createdAt,
        ...(thread.compactionPoints.length ? { compactionPoints: thread.compactionPoints } : {}),
        ...(thread.sessionPromptContextSnapshot
          ? { sessionPromptContextSnapshot: thread.sessionPromptContextSnapshot }
          : {}),
      })
      archived += (archived ? ',' : '') + metadata.slice(0, -1) + ',"messages":' + messages + '}'
    }
    for await (const row of source.allRows(thread)) {
      const fork = await source.fork(row)
      if (!fork) continue
      let lists = ''
      for await (const branch of fork.branches) {
        const messages = branch.selected ? '[]' : await jsonMessages(source.messages(thread, branch.firstMessageId))
        lists += (lists ? ',' : '') + `{"id":${JSON.stringify(branch.branchId)},"messages":${messages}}`
      }
      forks +=
        (forks ? ',' : '') +
        `${JSON.stringify(fork.pivotId)}:{"position":${fork.position},"createdAt":${fork.createdAt},"lists":[${lists}]}`
    }
  }
  await source.assertCurrent()
  return (
    JSON.stringify(source.header).slice(0, -1) +
    ',"messages":' +
    active +
    (archived ? ',"threads":[' + archived + ']' : '') +
    (forks ? ',"messageForksHash":{' + forks + '}' : '') +
    compactionPoints +
    '}'
  )
}
