import { ApiError } from '@shared/models/errors'
import { ofetch } from 'ofetch'
import platform from '@/platform'
import { authInfoStore } from '@/stores/authInfoStore'
import { settingsStore } from '@/stores/settingsStore'
import { handleMobileRequest } from '@/utils/mobile-request'

export { VibedropEmailRequiredError } from './vibedrop-errors'

// VibeDrop publishing API. The client publishes HTML artifacts directly to
// VibeDrop using a per-user key obtained from chatbox-backend
// (see issueVibedropKey in remote.ts). Replaces the old anonymous EdgeOne flow.
const VIBEDROP_API_ORIGIN = 'https://api.vibedrop.cc'
// User-facing dashboard for managing published sites.
export const VIBEDROP_MANAGE_URL = 'https://app.vibedrop.cc'

export type VibedropVisibility = 'unlisted' | 'public'

export interface PublishToVibedropParams {
  html: string
  vdKey: string
  title?: string
  visibility: VibedropVisibility
  // When set, updates an existing owned site (same URL) instead of creating one.
  slug?: string | null
}

export interface VibedropSite {
  slug: string
  url: string
  visibility: VibedropVisibility
}

export interface VibedropPublication extends VibedropSite {
  uniqueId?: string
  updatedAt: number
}

/** VibeDrop rejected the key (revoked/invalid) — caller should clear cache and re-issue. */
export class VibedropAuthError extends Error {}
/** An update targeted a slug the current key no longer owns. */
export class VibedropSlugNotOwnedError extends Error {}

interface InlinePublishResponse {
  site?: { slug: string; url: string; visibility: VibedropVisibility }
  error?: { code?: string; message?: string }
}

function safeJson(raw: string | undefined): InlinePublishResponse | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as InlinePublishResponse
  } catch {
    return null
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  bearer: string
): Promise<{ status: number; json: InlinePublishResponse | null }> {
  if (platform.type === 'mobile') {
    const headers = new Headers({ 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` })
    // handleMobileRequest THROWS an ApiError on non-2xx (carrying status + body)
    // rather than returning a Response, so recover status/body from the error to
    // keep the same status-based error classification as the desktop path.
    try {
      const response = await handleMobileRequest(url, 'POST', headers, JSON.stringify(body))
      const json = (await response.json().catch(() => null)) as InlinePublishResponse | null
      return { status: response.status, json }
    } catch (e) {
      if (e instanceof ApiError && typeof e.statusCode === 'number') {
        return { status: e.statusCode, json: safeJson(e.responseBody) }
      }
      throw e
    }
  }
  const response = await ofetch.raw<InlinePublishResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body,
    ignoreResponseError: true,
  })
  return { status: response.status, json: response._data ?? null }
}

export async function publishToVibedrop(params: PublishToVibedropParams): Promise<VibedropSite> {
  const { html, vdKey, title, visibility, slug } = params
  if (!html?.trim()) {
    throw new Error('HTML content is empty, nothing to publish.')
  }

  const body: Record<string, unknown> = { html, visibility }
  if (title) body.title = title
  if (slug) body.slug = slug

  const { status, json } = await postJson(`${VIBEDROP_API_ORIGIN}/v1/sites/inline`, body, vdKey)

  if (status === 401 || status === 403) {
    throw new VibedropAuthError(json?.error?.message || 'VibeDrop authorization failed')
  }
  if (status === 404 && json?.error?.code === 'slug_not_owned') {
    throw new VibedropSlugNotOwnedError('slug no longer owned')
  }
  if (status >= 400 || !json?.site?.url) {
    throw new Error(json?.error?.message || `Failed to publish to VibeDrop (status ${status})`)
  }

  return { slug: json.site.slug, url: json.site.url, visibility: json.site.visibility }
}

// ===== client-side caches (settings-persisted) =====

// Decodes the email claim from the current account's JWT access token. Used to
// bind the cached publish key to an account so it is never reused across
// accounts (e.g. after switching login without an explicit logout).
function currentAccountEmail(): string | null {
  const token = authInfoStore.getState().accessToken
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.email === 'string' && json.email ? json.email.toLowerCase() : null
  } catch {
    return null
  }
}

export function getCachedVibedropKey(): string | undefined {
  const cached = settingsStore.getState().vibedropPublishKey
  if (!cached?.key) return undefined
  const email = currentAccountEmail()
  // Only reuse the key for the account it was issued for.
  if (!email || cached.email !== email) return undefined
  return cached.key
}

export function setCachedVibedropKey(key: string): void {
  const email = currentAccountEmail()
  if (!email) return
  settingsStore.setState({ vibedropPublishKey: { email, key } })
}

export function clearCachedVibedropKey(): void {
  settingsStore.setState({ vibedropPublishKey: undefined })
}

// Maps a code block's stable uniqueId → its published slug, so re-publishing the
// same artifact updates the same VibeDrop site (stable URL) instead of creating
// a new one.
export function getStoredSlug(uniqueId: string | undefined): string | undefined {
  if (!uniqueId) return undefined
  return settingsStore.getState().vibedropSlugs?.[uniqueId]
}

export function setStoredSlug(uniqueId: string | undefined, slug: string): void {
  if (!uniqueId) return
  settingsStore.setState((state) => ({
    vibedropSlugs: { ...(state.vibedropSlugs || {}), [uniqueId]: slug },
  }))
}

export function getSessionVibedropPublications(sessionId: string | undefined): VibedropPublication[] {
  if (!sessionId || sessionId === 'new') return []
  return settingsStore.getState().vibedropSessionPublications?.[sessionId] || []
}

export function recordSessionVibedropPublication(
  sessionId: string | undefined,
  uniqueId: string | undefined,
  site: VibedropSite
): void {
  if (!sessionId || sessionId === 'new') return
  settingsStore.setState((state) => {
    const current = state.vibedropSessionPublications?.[sessionId] || []
    const publication: VibedropPublication = {
      ...site,
      uniqueId,
      updatedAt: Date.now(),
    }
    return {
      vibedropSessionPublications: {
        ...(state.vibedropSessionPublications || {}),
        [sessionId]: [publication, ...current.filter((item) => item.slug !== site.slug)].slice(0, 20),
      },
    }
  })
}
