import type { BackupBusinessRecord, BackupManifest } from './types'

type Global = Extract<BackupBusinessRecord, { type: 'global' }>
export const CONFIG_PATHS = ['settings.json', 'copilots.json', 'session-settings.json'] as const
export type ConfigPath = (typeof CONFIG_PATHS)[number]
export const SHARED_CONFIG_GROUPS = {
  'chat-session-settings': 'sessions',
  'picture-session-settings': 'sessions',
  'session-folders': 'sessions',
  'agent-soul': 'settings',
  'agent-memories': 'settings',
  'copilot-memories': 'copilots',
  'copilot-memory-owners': 'copilots',
  'copilot-memory-state-tokens': 'copilots',
} as const

export function isConfigPath(path: string): path is ConfigPath {
  return CONFIG_PATHS.includes(path as ConfigPath)
}

/** Canonical portable filenames; the row itself retains the unencoded identity. */
export function backupSessionPath(id: string): string {
  let encoded = encodeURIComponent(id).replace(
    /[.!'()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`
  )
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(encoded))
    encoded = `%${encoded.charCodeAt(0).toString(16).toUpperCase()}${encoded.slice(1)}`
  if (!encoded || encoded.length > 200) throw new Error('Backup conversation ID exceeds the portable filename limit')
  return `sessions/${encoded}.jsonl`
}

export function backupSessionId(path: string): string {
  const match = /^sessions\/([^/]+)\.jsonl$/.exec(path)
  if (!match) throw new Error('Invalid backup conversation path')
  const id = decodeURIComponent(match[1])
  if (backupSessionPath(id) !== path) throw new Error('Backup conversation path is not canonically encoded')
  return id
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}
export const RESOURCE_PATH_PATTERN = /^resources\/\d{6}\.[a-z0-9]{1,10}$/
export function backupResourcePath(index: number, mimeType: string): string {
  const mime = mimeType.split(';', 1)[0].trim().toLowerCase()
  const extension = Object.hasOwn(MIME_EXTENSIONS, mime) ? MIME_EXTENSIONS[mime] : 'bin'
  return `resources/${String(index).padStart(6, '0')}.${extension}`
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Backup configuration must be an object')
  return value as Record<string, unknown>
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Backup configuration collection must be an array')
  return value
}
function itemId(value: unknown): string {
  const id = object(value).id
  if (typeof id !== 'string' || !id) throw new Error('Backup configuration item ID is missing')
  return id
}
const row = (category: Global['category'], id: string, value: unknown): Global => ({
  type: 'global',
  category,
  id,
  value,
})

/** One bounded global snapshot, projected into the three configuration files. */
export class BackupConfigurations {
  private settings: unknown
  private readonly copilots: unknown[] = []
  private readonly shared: Record<string, unknown> = Object.create(null)
  constructor(private readonly selection: BackupManifest['selection']) {
    if (selection.settings) this.shared['agent-memories'] = []
    if (selection.copilots) {
      this.shared['copilot-memories'] = Object.create(null)
      this.shared['copilot-memory-owners'] = []
      this.shared['copilot-memory-state-tokens'] = []
    }
    if (selection.sessions) this.shared['session-folders'] = []
  }
  add(record: Global): void {
    switch (record.category) {
      case 'settings':
        this.settings = object(record.value)
        break
      case 'copilot':
        this.copilots.push(record.value)
        break
      case 'session-settings':
        if (record.id !== 'chat-session-settings' && record.id !== 'picture-session-settings')
          throw new Error('Unknown shared conversation settings key')
        this.shared[record.id] = record.value
        break
      case 'soul':
        this.shared['agent-soul'] = record.value
        break
      case 'folder':
        list(this.shared['session-folders']).push(record.value)
        break
      case 'global-memory':
        list(this.shared['agent-memories']).push(record.value)
        break
      case 'copilot-memory':
        object(this.shared['copilot-memories'])[record.id] = record.value
        break
      case 'memory-identities': {
        const key = record.id.startsWith('owner:')
          ? 'copilot-memory-owners'
          : record.id.startsWith('token:')
            ? 'copilot-memory-state-tokens'
            : undefined
        if (!key) throw new Error('Unknown backup memory identity')
        list(this.shared[key]).push(record.value)
        break
      }
    }
  }
  *files(): Iterable<{ path: ConfigPath; value: unknown }> {
    if (this.selection.settings) {
      if (this.settings === undefined) throw new Error('Backup settings are missing')
      yield { path: 'settings.json', value: this.settings }
    }
    if (this.selection.copilots) yield { path: 'copilots.json', value: this.copilots }
    if (Object.keys(this.shared).length) yield { path: 'session-settings.json', value: this.shared }
  }
}

/** The presence of each key, including an empty collection, defines its restore scope. */
export function configurationKeys(path: ConfigPath, value: unknown, selection: BackupManifest['selection']): string[] {
  if (path === 'settings.json') {
    if (!selection.settings) throw new Error('Backup settings are outside the selected categories')
    object(value)
    return ['settings']
  }
  if (path === 'copilots.json') {
    if (!selection.copilots) throw new Error('Backup copilots are outside the selected categories')
    list(value)
    return ['myCopilots']
  }
  return Object.keys(object(value)).map((key) => {
    const group = SHARED_CONFIG_GROUPS[key as keyof typeof SHARED_CONFIG_GROUPS]
    if (!Object.hasOwn(SHARED_CONFIG_GROUPS, key) || !selection[group])
      throw new Error('Backup shared configuration key is unknown or outside the selected categories')
    return key
  })
}

export function* configurationRecords(path: ConfigPath, value: unknown): Iterable<Global> {
  if (path === 'settings.json') {
    yield row('settings', 'settings', value)
    return
  }
  if (path === 'copilots.json') {
    for (const item of list(value)) yield row('copilot', itemId(item), item)
    return
  }
  for (const [key, entry] of Object.entries(object(value))) {
    if (key === 'chat-session-settings' || key === 'picture-session-settings') yield row('session-settings', key, entry)
    else if (key === 'agent-soul') yield row('soul', key, entry)
    else if (key === 'copilot-memories') {
      for (const [id, memories] of Object.entries(object(entry))) yield row('copilot-memory', id, list(memories))
    } else {
      const category =
        key === 'session-folders' ? 'folder' : key === 'agent-memories' ? 'global-memory' : 'memory-identities'
      const prefix = key === 'copilot-memory-owners' ? 'owner:' : key === 'copilot-memory-state-tokens' ? 'token:' : ''
      for (const item of list(entry)) yield row(category, `${prefix}${itemId(item)}`, item)
    }
  }
}
