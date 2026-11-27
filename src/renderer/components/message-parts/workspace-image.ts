import { workArtifactMimeType } from '@shared/work-artifacts'

/**
 * Image sources that the mobile WebView cannot load on its own.
 *
 * Models routinely point at files they just wrote in the conversation workspace
 * (`output/chart.png`, `artifacts/run/plot.jpg`, `./notes/figure.webp`). Those are
 * workspace-relative paths, not URLs: the WebView resolves them against
 * `https://localhost/`, which is not where the file lives, so the `<img>` breaks.
 * Such sources must be resolved by reading the workspace file and inlining it as a
 * data URL.
 */

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])

/** Largest workspace image we inline as a data URL (decoded bytes). */
export const MAX_WORKSPACE_IMAGE_BYTES = 20 * 1024 * 1024

function imageExtension(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? ''
  const dot = withoutQuery.lastIndexOf('.')
  return dot > 0 ? withoutQuery.slice(dot + 1).toLowerCase() : ''
}

/** Strip the `./` prefix and collapse duplicate slashes, leaving the workspace-relative path. */
export function normalizeWorkspaceImagePath(src: string): string {
  return src.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/')
}

/**
 * Whether `src` is a workspace-relative image path the app must resolve itself.
 *
 * Deliberately conservative: anything with a URL scheme (`https:`, `data:`, `blob:`,
 * `file:`, `sandbox:`), an absolute path, a protocol-relative `//host` source or a
 * bare fragment is left to the browser exactly as before.
 */
export function isWorkspaceImagePath(src: string | undefined): boolean {
  if (typeof src !== 'string') return false
  const trimmed = src.trim()
  if (!trimmed) return false
  // Any scheme (`https:`, `data:`, `blob:`, `file:`, `capacitor:` …) is a real URL.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return false
  const normalized = normalizeWorkspaceImagePath(trimmed)
  if (!normalized || normalized.split('/').some((segment) => segment === '..')) return false
  return IMAGE_EXTENSIONS.has(imageExtension(normalized))
}

/** Media type for a workspace image, falling back to PNG detection from the base64 body is unnecessary. */
export function workspaceImageMimeType(path: string): string {
  const mimeType = workArtifactMimeType(path)
  return mimeType.startsWith('image/') ? mimeType : 'image/png'
}

/** Decoded byte length of a base64 payload. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

/** Build the data URL the WebView can render from a workspace file's base64 content. */
export function workspaceImageDataUrl(path: string, base64: string): string {
  return `data:${workspaceImageMimeType(path)};base64,${base64}`
}

/**
 * Per-render-pass cache of resolved workspace images.
 *
 * Markdown re-parses on every streaming delta and the message list is virtualized, so
 * the same `![](output/chart.png)` is re-rendered many times; without a cache each
 * re-render would re-read (and re-encode) the whole file.
 */
const resolvedImages = new Map<string, string>()
/**
 * Recently failed paths, so a broken reference is not re-read on every streaming delta.
 *
 * Deliberately short-lived: the same reference can legitimately exist moments later —
 * a user message quoting `![](output/chart.png)` is rendered before the agent has run
 * Python and produced that file, and caching that miss forever would keep the real
 * result hidden for the rest of the session.
 */
const failedImages = new Map<string, number>()
const FAILED_IMAGE_RETRY_MS = 2_000

function cacheKey(sessionId: string, path: string): string {
  return `${sessionId}:${normalizeWorkspaceImagePath(path)}`
}

export function getCachedWorkspaceImage(sessionId: string, path: string): string | undefined {
  return resolvedImages.get(cacheKey(sessionId, path))
}

export function hasFailedWorkspaceImage(sessionId: string, path: string): boolean {
  const key = cacheKey(sessionId, path)
  const failedAt = failedImages.get(key)
  if (failedAt === undefined) return false
  if (Date.now() - failedAt > FAILED_IMAGE_RETRY_MS) {
    failedImages.delete(key)
    return false
  }
  return true
}

export function cacheWorkspaceImage(sessionId: string, path: string, dataUrl: string): void {
  const key = cacheKey(sessionId, path)
  resolvedImages.set(key, dataUrl)
  failedImages.delete(key)
}

export function markWorkspaceImageFailed(sessionId: string, path: string): void {
  failedImages.set(cacheKey(sessionId, path), Date.now())
}

/** Test/reset hook — the caches are process-wide by design. */
export function clearWorkspaceImageCache(): void {
  resolvedImages.clear()
  failedImages.clear()
}
