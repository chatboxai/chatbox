import { z } from 'zod'
import type { MessageRow, SessionRowRecord, ThreadRow } from '../../session/session-tree/types'
import type { Message, MessageContentParts } from '../../types'
import { isAbortError, throwIfAborted } from '../../utils/abort'

const id = z.number().int().nonnegative()
const sourceMessage = z.object({
  id,
  parent_id: id.nullable(),
  role: z.enum(['USER', 'ASSISTANT']),
  status: z.string(),
  inserted_at: z.string(),
  fragments: z.array(z.unknown()),
})
export const sourceSession = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  pinned: z.boolean(),
  current_message_id: id,
  inserted_at: z.string(),
  updated_at: z.string(),
  messages: z.array(sourceMessage),
})
const fileSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  file_size: z.number().nonnegative(),
  is_image: z.boolean(),
  export_path: z.string().nullable(),
})
export type SourceFile = z.infer<typeof fileSchema>
export interface ImportedSource {
  title: string
  url: string
  snippet?: string
}
export const sourcesSchema = z.array(
  z.object({
    title: z.string(),
    url: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
    snippet: z.string().optional(),
  })
)
const fragmentSchema = z.object({ type: z.string() }).passthrough()
const contentSchema = z.object({ content: z.string() })
export interface ConversionIssue {
  code: string
  detail?: string
}
export interface ConvertOptions {
  sessionId: string
  importedAt: number
  resolveImage(file: SourceFile): Promise<string | null>
  issue(issue: ConversionIssue): void
  failureLabel: string
  signal?: AbortSignal
  model?: { provider?: string; modelId?: string }
}
const webUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
const timestamp = (value: string) => {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('Invalid message timestamp')
  return parsed
}

async function convertMessage(source: z.infer<typeof sourceMessage>, options: ConvertOptions): Promise<Message> {
  const parts: MessageContentParts = []
  const sources = new Map<string, ImportedSource>()
  let template = ''
  const addSource = (value: unknown) => {
    const parsed = z
      .object({
        url: z.unknown().optional(),
        source_page_url: z.unknown().optional(),
        title: z.string().nullable().optional(),
        snippet: z.string().nullable().optional(),
      })
      .safeParse(value)
    if (!parsed.success) return
    const entry = parsed.data,
      url = entry.url ?? entry.source_page_url
    if (webUrl(url))
      sources.set(url, { url, title: entry.title || url, ...(entry.snippet ? { snippet: entry.snippet } : {}) })
  }
  for (const value of source.fragments) {
    throwIfAborted(options.signal)
    const parsed = fragmentSchema.safeParse(value)
    if (!parsed.success) {
      options.issue({ code: 'invalid-fragment' })
      continue
    }
    const fragment = parsed.data
    if (['REQUEST', 'RESPONSE', 'THINK', 'TEMPLATE_RESPONSE', 'TIP', 'CONTENT_RISK'].includes(fragment.type)) {
      const content = contentSchema.safeParse(fragment)
      if (!content.success) {
        options.issue({ code: 'invalid-fragment' })
        continue
      }
      if (fragment.type === 'TEMPLATE_RESPONSE') template += content.data.content
      else if (fragment.type === 'THINK')
        parts.push({
          type: 'reasoning',
          text: content.data.content,
          ...(typeof fragment.elapsed_secs === 'number' && fragment.elapsed_secs >= 0
            ? { duration: fragment.elapsed_secs * 1000 }
            : {}),
        })
      else
        parts.push({
          type: ['TIP', 'CONTENT_RISK'].includes(fragment.type) ? 'info' : 'text',
          text: content.data.content,
        })
    } else if (fragment.type === 'FILE') {
      for (const raw of Array.isArray(fragment.files) ? fragment.files : []) {
        const file = fileSchema.safeParse(raw)
        if (!file.success) {
          options.issue({ code: 'invalid-attachment' })
          continue
        }
        let key: string | null = null
        try {
          key = file.data.is_image ? await options.resolveImage(file.data) : null
        } catch (error) {
          if (options.signal?.aborted || isAbortError(error)) throw error
        }
        if (key) parts.push({ type: 'image', storageKey: key })
        else {
          parts.push({ type: 'info', text: file.data.file_name, values: { kind: 'deepseek-missing-attachment' } })
          options.issue({ code: 'missing-attachment', detail: file.data.file_name })
        }
      }
    } else if (['TOOL_SEARCH', 'TOOL_IMAGE_SEARCH', 'READ_LINK'].includes(fragment.type)) {
      for (const entry of Array.isArray(fragment.results) ? fragment.results : []) addSource(entry)
    } else if (fragment.type === 'TOOL_OPEN') addSource(fragment)
    else if (fragment.type === 'PARTIAL_FILE_READ' && typeof fragment.ratio === 'number')
      parts.push({ type: 'info', text: String(fragment.ratio), values: { kind: 'deepseek-partial-file' } })
    else options.issue({ code: 'unsupported-fragment', detail: fragment.type })
  }
  if (sources.size)
    parts.push({
      type: 'info',
      text: 'References',
      values: { kind: 'deepseek-sources', sources: [...sources.values()] },
    })
  const failed = !['FINISHED', 'INCOMPLETE', 'WIP'].includes(source.status)
  if (template) parts.push({ type: 'info', text: template })
  return {
    id: `${options.sessionId}:${source.id}`,
    role: source.role === 'USER' ? 'user' : 'assistant',
    timestamp: timestamp(source.inserted_at),
    contentParts: parts,
    ...(failed
      ? {
          error:
            template ||
            parts
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n') ||
            options.failureLabel,
        }
      : {}),
  }
}

/** External-format conversion only; no application session snapshot is read or cached. */
export async function convertDeepSeekSession(input: unknown, options: ConvertOptions) {
  const source = sourceSession.parse(input)
  const sorted = [...source.messages].sort((a, b) => a.id - b.id)
  const children = new Map<number | null, number[]>()
  const byId = new Map(sorted.map((message) => [message.id, message]))
  if (byId.size !== sorted.length) throw new Error('Duplicate message ID')
  for (const message of sorted) {
    const parent = message.parent_id === null ? undefined : byId.get(message.parent_id)
    if (
      message.parent_id === null
        ? message.role !== 'USER'
        : !parent || parent.id >= message.id || parent.role === message.role
    )
      throw new Error('Invalid conversation branch')
    const group = children.get(message.parent_id) ?? []
    group.push(message.id)
    children.set(message.parent_id, group)
  }
  const roots = children.get(null) ?? []
  if (sorted.length && !byId.has(source.current_message_id)) throw new Error('Current message is missing')
  const active = new Map<number, number | null>()
  for (const message of sorted) active.set(message.id, children.get(message.id)?.at(-1) ?? null)
  let root = source.current_message_id
  if (sorted.length) {
    active.set(root, null)
    let cursor = byId.get(root)
    while (cursor?.parent_id !== null && cursor) {
      active.set(cursor.parent_id, cursor.id)
      root = cursor.parent_id
      cursor = byId.get(root)
    }
  }
  const localId = (value: number) => `${options.sessionId}:${value}`
  const commonRoot = `${options.sessionId}:root`
  const record: SessionRowRecord = {
    id: options.sessionId,
    name: source.title || '',
    type: 'chat',
    starred: source.pinned,
    activeThreadId: options.sessionId,
    storageFormat: 'rows',
    rowFormatVersion: 3,
    rowAuthority: 1,
    settings: { ...options.model, agentMode: { value: 'off', locked: false, lockReason: null } },
  }
  const thread: ThreadRow = {
    sessionId: record.id,
    threadId: record.activeThreadId,
    threadOrder: -1,
    name: null,
    createdAt: options.importedAt,
    rootMessageId: sorted.length ? (roots.length > 1 ? commonRoot : localId(root)) : null,
    activeLeafMessageId: sorted.length ? localId(source.current_message_id) : null,
    compactionPoints: [],
  }
  const rows: MessageRow[] = []
  const toRow = (
    message: Message,
    parentMessageId: string | null,
    activeChildId: string | null,
    siblingOrder: number
  ): MessageRow => ({
    sessionId: record.id,
    threadId: record.activeThreadId,
    messageId: message.id,
    parentMessageId,
    activeChildId,
    siblingOrder,
    kind: 'message',
    status: 'settled',
    createdAt: message.timestamp ?? options.importedAt,
    updatedAt: message.timestamp ?? options.importedAt,
    branchId: null,
    message,
  })
  if (roots.length > 1) rows.push(toRow({ id: commonRoot, role: 'system', contentParts: [] }, null, localId(root), 0))
  for (const message of sorted)
    rows.push(
      toRow(
        await convertMessage(message, options),
        message.parent_id === null ? (roots.length > 1 ? commonRoot : null) : localId(message.parent_id),
        active.get(message.id) === null ? null : localId(active.get(message.id)!),
        children.get(message.parent_id)!.indexOf(message.id)
      )
    )
  const rowsById = new Map(rows.map((row) => [row.messageId, row]))
  for (const point of rows) {
    const group =
      point.messageId === commonRoot ? roots : (children.get(Number(point.messageId.slice(record.id.length + 1))) ?? [])
    if (group.length < 2) continue
    point.forkPivotId = point.messageId
    point.forkCreatedAt = options.importedAt
    for (const child of group) rowsById.get(localId(child))!.branchId = `fork_list_${localId(child)}`
    if (point.activeChildId === null) {
      point.pendingBranchId = `fork_list_${point.messageId}:empty`
      point.pendingBranchOrder = group.length
    }
  }
  return { record, thread, rows, sourceMessageCount: sorted.length }
}
