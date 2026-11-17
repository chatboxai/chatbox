export interface EncodedFile {
  base64: string
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_FILES = 128

export function workspacePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || /[\\:%\x00-\x1f]/.test(value)) {
    throw new Error('Invalid workspace path')
  }
  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..'))
    throw new Error('Path must stay inside the workspace')
  return value
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

export function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0 || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
    throw new Error('Invalid or oversized base64 file')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  if ((value.length / 4) * 3 - padding > MAX_FILE_BYTES) throw new Error('Invalid or oversized base64 file')
  for (let index = 0; index < value.length - padding; index++) {
    const code = value.charCodeAt(index)
    if (
      !(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 ||
        code === 47
      )
    ) {
      throw new Error('Invalid or oversized base64 file')
    }
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

export class WorkerFiles {
  private readonly entries = new Map<string, Uint8Array>()
  private readonly changed = new Set<string>()

  constructor(files: Record<string, EncodedFile>) {
    if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > MAX_FILES) {
      throw new Error('Invalid workspace files')
    }
    for (const [path, file] of Object.entries(files)) this.store(path, decodeBase64(file?.base64))
  }

  read(path: unknown): Uint8Array {
    const normalized = workspacePath(path)
    const bytes = this.entries.get(normalized)
    if (!bytes) throw new Error(`File not found: ${normalized}`)
    return bytes
  }

  write(path: unknown, bytes: Uint8Array): void {
    const normalized = workspacePath(path)
    if (normalized.startsWith('input/') || normalized.startsWith('artifacts/'))
      throw new Error('Input and artifact files are read-only')
    this.store(normalized, bytes)
    this.changed.add(normalized)
  }

  private store(path: unknown, bytes: Uint8Array): void {
    const normalized = workspacePath(path)
    if (bytes.length > MAX_FILE_BYTES) throw new Error('File exceeds 10 MiB limit')
    if (!this.entries.has(normalized) && this.entries.size >= MAX_FILES)
      throw new Error('Workspace file count limit reached')
    let total = bytes.length
    for (const [name, content] of this.entries) if (name !== normalized) total += content.length
    if (total > MAX_TOTAL_BYTES) throw new Error('Workspace exceeds 20 MiB limit')
    this.entries.set(normalized, bytes)
  }

  list(): string[] {
    return [...this.entries.keys()].sort()
  }

  serialize(): Record<string, EncodedFile> {
    return Object.fromEntries([...this.changed].map((path) => [path, { base64: encodeBase64(this.read(path)) }]))
  }
}
