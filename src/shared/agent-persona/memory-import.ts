export const MEMORY_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024
export const LOCAL_MEMORY_IMPORT_MAX_CANDIDATES = 200

export type LocalMemorySource = 'claude' | 'codex'

export interface LocalMemoryCandidate {
  id: string
  source: LocalMemorySource
  displayPath: string
  content: string
}

export interface LocalMemoryScanResult {
  candidates: LocalMemoryCandidate[]
  skippedFiles: number
}

export type MemoryImportError = 'invalid-json' | 'chat-history-not-supported' | 'no-supported-entries'

export type MemoryImportParseResult = { ok: true; entries: string[] } | { ok: false; error: MemoryImportError }

function uniqueEntries(entries: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function parseMarkdownOrText(fileName: string, source: string): string[] {
  let content = source.replace(/\r\n?/g, '\n')
  if (/^memory_summary\.md$/i.test(fileName)) {
    content = content.split(/^##\s+What's in Memory\s*$/im, 1)[0]
    content = content.replace(/^v\d+\s*\n/i, '')
  }
  content = content
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const entries: string[] = []
  let current = ''
  const flush = () => {
    if (current.trim()) entries.push(current.trim())
    current = ''
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      flush()
      continue
    }
    const listItem = trimmed.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/)
    if (listItem) {
      flush()
      current = listItem[1]
      continue
    }
    const text = trimmed.replace(/^>\s?/, '')
    current = current ? `${current} ${text}` : text
  }
  flush()
  return uniqueEntries(entries)
}

function looksLikeChatHistory(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      ('mapping' in item || ('title' in item && ('create_time' in item || 'update_time' in item)))
  )
}

function entryText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return null
  for (const key of ['content', 'text', 'memory']) {
    const candidate = Reflect.get(value, key)
    if (typeof candidate === 'string') return candidate
  }
  return null
}

function parseJson(source: string): MemoryImportParseResult {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }

  if (looksLikeChatHistory(value)) {
    return { ok: false, error: 'chat-history-not-supported' }
  }

  let candidates: unknown[] | null = Array.isArray(value) ? value : null
  if (!candidates && typeof value === 'object' && value !== null) {
    for (const key of ['memories', 'memoryItems', 'memory_items', 'items', 'data']) {
      const candidate = Reflect.get(value, key)
      if (Array.isArray(candidate)) {
        candidates = candidate
        break
      }
    }
    if (!candidates) {
      const single = entryText(value)
      if (single) candidates = [single]
    }
  }

  if (!candidates || looksLikeChatHistory(candidates)) {
    return {
      ok: false,
      error: looksLikeChatHistory(candidates) ? 'chat-history-not-supported' : 'no-supported-entries',
    }
  }

  const entries = uniqueEntries(candidates.map(entryText).filter((entry): entry is string => entry !== null))
  return entries.length > 0 ? { ok: true, entries } : { ok: false, error: 'no-supported-entries' }
}

export function parseMemoryImport(fileName: string, source: string): MemoryImportParseResult {
  if (/\.json$/i.test(fileName)) return parseJson(source)
  const entries = parseMarkdownOrText(fileName, source)
  return entries.length > 0 ? { ok: true, entries } : { ok: false, error: 'no-supported-entries' }
}
