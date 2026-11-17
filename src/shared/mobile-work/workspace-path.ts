export const MAX_WORKSPACE_BYTES = 20 * 1024 * 1024
export const MAX_WORKSPACE_FILES = 128
export const MAX_WORKSPACE_FILE_BYTES = 10 * 1024 * 1024

export function workspacePath(path: string): string {
  if (!path || path.length > 240 || /[\\:%\u0000-\u001f]/.test(path) || path.startsWith('/')) {
    throw new Error('Use a relative workspace path')
  }
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid workspace path')
  return parts.join('/')
}

export function sessionDirectoryName(sessionId: string): string {
  if (!sessionId || sessionId.length > 128) throw new Error('Invalid session identity')
  return Array.from(new TextEncoder().encode(sessionId), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface WorkspaceFile {
  base64: string
}
export type WorkspaceFiles = Record<string, WorkspaceFile>

export function validateWorkspaceFiles(files: WorkspaceFiles): void {
  const entries = Object.entries(files)
  if (entries.length > MAX_WORKSPACE_FILES) throw new Error('Workspace has too many files')
  let bytes = 0
  for (const [path, file] of entries) {
    workspacePath(path)
    if (
      !file ||
      typeof file.base64 !== 'string' ||
      file.base64.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(file.base64) ||
      !/^[^=]*={0,2}$/.test(file.base64)
    ) {
      throw new Error('Invalid file encoding')
    }
    const fileBytes =
      (file.base64.length * 3) / 4 - (file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0)
    bytes += fileBytes
    if (fileBytes > MAX_WORKSPACE_FILE_BYTES) throw new Error('File exceeds the 10 MB execution limit')
    if (bytes > MAX_WORKSPACE_BYTES) throw new Error('Workspace exceeds the 20 MB execution limit')
  }
}

export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToText(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)))
}
