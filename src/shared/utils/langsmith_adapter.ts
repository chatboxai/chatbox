const SECRET_KEY_PATTERN = /(token|secret|password|credential|cookie|authorization|api[_-]?key|refresh)/i
const MAX_STRING_LENGTH = 600
const MAX_ARRAY_ITEMS = 12
const MAX_OBJECT_ENTRIES = 24

export type LangSmithRunType = 'chain' | 'llm' | 'tool' | 'retriever'

export interface LangSmithRunStartInput {
  name: string
  runType?: LangSmithRunType
  parentRunId?: string
  projectName?: string
  inputs?: Record<string, unknown>
  metadata?: Record<string, unknown>
  tags?: string[]
}

export interface LangSmithRunEndInput {
  outputs?: Record<string, unknown>
  error?: string
  metadata?: Record<string, unknown>
}

export interface LangSmithRunHandle {
  runId: string
  end(result?: LangSmithRunEndInput): Promise<void>
}

export interface LangSmithAdapter {
  enabled: boolean
  startRun(input: LangSmithRunStartInput): Promise<LangSmithRunHandle>
  recordEvent(input: LangSmithRunStartInput & LangSmithRunEndInput): Promise<void>
}

export interface LangSmithTraceContext {
  name?: string
  parentRunId?: string
  metadata?: Record<string, unknown>
  tags?: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncateString(value: string) {
  if (value.length <= MAX_STRING_LENGTH) {
    return value
  }

  return `${value.slice(0, MAX_STRING_LENGTH - 1)}…`
}

function shouldRedactKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (['totaltokens', 'inputtokens', 'outputtokens', 'maxtokens', 'maxoutputtokens'].includes(normalized)) {
    return false
  }

  return SECRET_KEY_PATTERN.test(key)
}

function sanitizeLangSmithValue(value: unknown, keyPath: string[] = []): unknown {
  const currentKey = keyPath.at(-1) ?? ''

  if (currentKey && shouldRedactKey(currentKey)) {
    return '[redacted]'
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return '[redacted-data-url]'
    }
    return truncateString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }

  if (value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item, index) => sanitizeLangSmithValue(item, [...keyPath, String(index)]))
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_ENTRIES)
        .map(([key, nestedValue]) => [key, sanitizeLangSmithValue(nestedValue, [...keyPath, key])])
    )
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  return truncateString(String(value))
}

export function sanitizeLangSmithRecord(record?: Record<string, unknown>) {
  if (!record) {
    return undefined
  }

  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, sanitizeLangSmithValue(value, [key])]))
}

export function getLangSmithErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function createNoopLangSmithAdapter(): LangSmithAdapter {
  return {
    enabled: false,
    async startRun(_input) {
      return {
        runId: crypto.randomUUID(),
        async end(_result) {},
      }
    },
    async recordEvent(_input) {},
  }
}
