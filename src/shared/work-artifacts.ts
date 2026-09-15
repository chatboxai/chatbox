import type { Message } from './types'

export interface WorkArtifact {
  path: string
  name: string
  mimeType: string
  size: number
  storageKey?: string
}

export function getWorkArtifacts(part: Message['contentParts'][number]): WorkArtifact[] {
  if (part.type !== 'tool-call' || part.toolName !== 'create_download' || part.state !== 'result') return []
  const result = part.result
  if (!result || typeof result !== 'object' || !('artifacts' in result) || !Array.isArray(result.artifacts)) return []
  return result.artifacts
    .slice(0, 20)
    .filter((item): item is WorkArtifact =>
      Boolean(
        item &&
          typeof item === 'object' &&
          typeof item.path === 'string' &&
          item.path.startsWith('artifacts/') &&
          typeof item.name === 'string' &&
          typeof item.mimeType === 'string' &&
          typeof item.size === 'number' &&
          Number.isFinite(item.size) &&
          item.size >= 0 &&
          (item.storageKey === undefined || typeof item.storageKey === 'string')
      )
    )
}

/** Media types used when exporting local work files to the OS or a preview. */
export function workArtifactMimeType(name: string): string {
  const types: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return types[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

export type WorkArtifactKind = 'web' | 'spreadsheet' | 'image' | 'document' | 'other'

const workArtifactKinds: Record<string, WorkArtifactKind> = {
  html: 'web',
  htm: 'web',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  svg: 'image',
  heic: 'image',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  ppt: 'document',
  pptx: 'document',
  md: 'document',
  txt: 'document',
}

function workArtifactExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

export function workArtifactKind(fileName: string): WorkArtifactKind {
  return workArtifactKinds[workArtifactExtension(fileName)] ?? 'other'
}

/** Short uppercase extension shown in the file badge; empty when the name has no badge-sized extension. */
export function workArtifactBadgeLabel(fileName: string): string {
  const extension = workArtifactExtension(fileName)
  return /^[a-z0-9]{1,4}$/.test(extension) ? extension.toUpperCase() : ''
}

/** HTML files open in the in-app preview; every other file is saved or shared. */
export function isPreviewableWorkArtifact(artifact: Pick<WorkArtifact, 'path'>): boolean {
  return workArtifactKind(artifact.path) === 'web'
}

export function formatArtifactSize(bytes: number, locale?: string): string {
  const size = Math.max(0, bytes)
  const unit = size >= 1024 * 1024 ? 'MB' : size >= 1024 ? 'KB' : 'B'
  const value = unit === 'MB' ? size / (1024 * 1024) : unit === 'KB' ? size / 1024 : size
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'B' ? 0 : 1 }).format(value)} ${unit}`
}
