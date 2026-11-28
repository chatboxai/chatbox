import {
  type CloudSyncPayload,
  type SyncBaseline,
  syncSelectionKey,
  type WebDavConfigurationInput,
  type WebDavFileIdentity,
} from '../../shared/sync'
import { decodeCloudEnvelope, encodeCloudEnvelope, readCloudEnvelope, readCloudEnvelopeText } from './cloud-envelope'
import type { WebDavConfiguration } from './types'

const collection = 'ChatAny/'
const filename = 'ChatAny-Sync-v1.json'
const requestTimeoutMs = 120_000

export function normalizeWebDavConfiguration(
  input: WebDavConfigurationInput,
  previous?: WebDavConfiguration
): WebDavConfiguration {
  let url: URL
  try {
    url = new URL(input.url.trim())
  } catch {
    throw new Error('webdav_invalid_url')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('webdav_invalid_url')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  const username = input.username.trim()
  const savedPassword = previous?.url === url.href && previous.username === username ? previous.password : ''
  const password = input.password ?? savedPassword
  if (username.includes(':') || (!username && password)) throw new Error('webdav_invalid_credentials')
  return { url: url.href, username, password }
}

async function request(config: WebDavConfiguration, path: string, options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers)
  if (config.username) {
    headers.set(
      'Authorization',
      `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`
    )
  }
  try {
    const response = await fetch(new URL(path, config.url), {
      ...options,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {})
      throw new Error('webdav_redirect')
    }
    return response
  } catch (error) {
    if (error instanceof Error && error.message === 'webdav_redirect') throw error
    throw new Error('webdav_network_error')
  }
}

async function requireStatus(response: Response, ...expected: number[]): Promise<void> {
  await response.body?.cancel().catch(() => {})
  if (expected.includes(response.status)) return
  if (response.status === 401 || response.status === 403) throw new Error('webdav_access_denied')
  throw new Error(`webdav_http_error:${response.status}`)
}

export async function testWebDavConnection(config: WebDavConfiguration): Promise<void> {
  const response = await request(config, '', { method: 'PROPFIND', headers: { Depth: '0' } })
  await requireStatus(response, 207)
}

function isMissing(response: Response): boolean {
  return response.status === 404 || response.status === 410
}

async function isMissingAfterConflict(config: WebDavConfiguration): Promise<boolean> {
  // Some servers return 409 for GET when a parent collection is missing.
  for (const path of [collection, collection + filename]) {
    const probe = await request(config, path, { method: 'PROPFIND', headers: { Depth: '0' } })
    if (isMissing(probe)) {
      await probe.body?.cancel().catch(() => {})
      return true
    }
    await requireStatus(probe, 207)
  }
  return false
}

function strongEtag(value?: string | null): string | undefined {
  if (value && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)) return value
}

async function getWebDavBackup(config: WebDavConfiguration): Promise<Response | undefined> {
  // Proxies can weaken ETags for compressed representations. Use the unencoded representation for If-Match.
  const response = await request(config, collection + filename, {
    method: 'GET',
    headers: { 'Accept-Encoding': 'identity' },
  })
  if (isMissing(response)) {
    await response.body?.cancel().catch(() => {})
    return
  }
  if (response.status === 409) {
    await response.body?.cancel().catch(() => {})
    if (await isMissingAfterConflict(config)) return
    throw new Error('webdav_http_error:409')
  }
  if (response.status !== 200) await requireStatus(response, 200)
  return response
}

export async function downloadWebDav(
  config: WebDavConfiguration,
  token?: string
): Promise<{ payload: CloudSyncPayload; identity: WebDavFileIdentity } | undefined> {
  const response = await getWebDavBackup(config)
  if (!response) return
  return {
    payload: await readCloudEnvelope(response, token),
    identity: { service: 'webdav', etag: strongEtag(response.headers.get('etag')) },
  }
}

export async function uploadWebDav(
  config: WebDavConfiguration & { baseline?: SyncBaseline },
  payload: CloudSyncPayload,
  expected: WebDavFileIdentity | undefined,
  encrypt: boolean,
  token?: string
): Promise<{ conflict: boolean }> {
  let etag = strongEtag(expected?.etag)
  let previousBody: string | undefined
  const body = encodeCloudEnvelope(payload, encrypt, token)
  if (expected && !etag) {
    const baseline = config.baseline
    if (
      !baseline?.cloudRevision ||
      payload.parentRevision !== baseline.cloudRevision ||
      !baseline.localFingerprint ||
      !baseline.selectionKey ||
      (baseline.localFingerprint === payload.contentFingerprint &&
        baseline.selectionKey === syncSelectionKey(payload.selection))
    ) {
      throw new Error('webdav_missing_etag')
    }

    const current = await getWebDavBackup(config)
    if (!current) return { conflict: true }
    const currentBody = await readCloudEnvelopeText(current)
    if (decodeCloudEnvelope(currentBody, token).revision !== baseline.cloudRevision) return { conflict: true }

    etag = strongEtag(current.headers.get('etag'))
    if (!etag) previousBody = currentBody
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (etag) headers.set('If-Match', etag)
  else headers.set('If-None-Match', '*')
  const put = (content: string) => request(config, collection + filename, { method: 'PUT', headers, body: content })
  try {
    if (previousBody !== undefined) {
      const deleted = await request(config, collection + filename, { method: 'DELETE' })
      if (isMissing(deleted) || deleted.status === 412) {
        await deleted.body?.cancel().catch(() => {})
        return { conflict: true }
      }
      if (deleted.status !== 200 && deleted.status !== 204) previousBody = undefined
      await requireStatus(deleted, 200, 204)
    }
    let response = await put(body)
    if (!expected && (response.status === 404 || response.status === 409)) {
      await response.body?.cancel().catch(() => {})
      await requireStatus(await request(config, collection, { method: 'MKCOL' }), 201, 405)
      response = await put(body)
    }
    if (response.status === 412 || (etag && isMissing(response))) {
      await response.body?.cancel().catch(() => {})
      return { conflict: true }
    }
    await requireStatus(response, 200, 201, 204)
    return { conflict: false }
  } catch (error) {
    if (previousBody !== undefined) {
      // Keep the original envelope and use the same create-only condition for recovery.
      await put(previousBody)
        .then((response) => response.body?.cancel())
        .catch(() => {})
    }
    throw error
  }
}
