import type { AbortSignalLike } from '../types/adapters'
import type { ChatboxAILicenseDetail } from '../types/settings'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>
type NativeFetch = (input: string, init?: NativeFetchInit) => Promise<Response>

/**
 * Chatbox license client (`/api/license/*`) with injectable origin/fetch/headers.
 * Used directly by the RN mobile shell, and by the renderer through
 * `packages/remote.ts` which injects its retrying `afetch` and Chatbox headers.
 */

export interface NativeLicenseActivationResult {
  valid: boolean
  instanceId: string
  error?: string
}

export interface NativeLicenseRequestOptions {
  apiOrigin?: string
  fetchFn?: NativeFetch
  signal?: AbortSignalLike
  headers?: Record<string, string>
}

const DEFAULT_API_ORIGIN = 'https://api.chatboxai.app'

function resolveOrigin(origin: string | undefined): string {
  return (origin?.trim() || DEFAULT_API_ORIGIN).replace(/\/+$/, '')
}

async function postLicense(
  path: string,
  body: Record<string, string>,
  options: NativeLicenseRequestOptions
): Promise<unknown> {
  const fetchFn = options.fetchFn ?? fetch
  const response = await fetchFn(`${resolveOrigin(options.apiOrigin)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `License request failed with status ${response.status}`
    throw new Error(message)
  }
  return payload
}

export async function activateNativeLicense(
  licenseKey: string,
  instanceName: string,
  options: NativeLicenseRequestOptions = {}
): Promise<NativeLicenseActivationResult> {
  const payload = (await postLicense('/api/license/activate', { licenseKey, instanceName }, options)) as {
    data?: { valid?: boolean; instanceId?: string; error?: string }
  } | null
  const data = payload?.data
  return {
    valid: Boolean(data?.valid),
    instanceId: data?.instanceId ?? '',
    error: data?.error,
  }
}

export async function validateNativeLicense(
  licenseKey: string,
  instanceId: string,
  options: NativeLicenseRequestOptions = {}
): Promise<boolean> {
  const payload = (await postLicense('/api/license/validate', { licenseKey, instanceId }, options)) as {
    data?: { valid?: boolean }
  } | null
  // Only an explicit boolean is authoritative. A garbage 200 response (captive
  // portal / proxy HTML / empty body) must NOT be read as "invalid": the caller
  // (premiumActions.useAutoValidate) clears the user's license on `valid === false`,
  // so an indeterminate response has to throw and be treated like a network error
  // (license kept), matching the old remote.validateLicense which threw on res.json().
  if (typeof payload?.data?.valid !== 'boolean') {
    throw new Error('License validation response was not understood')
  }
  return payload.data.valid
}

export async function deactivateNativeLicense(
  licenseKey: string,
  instanceId: string,
  options: NativeLicenseRequestOptions = {}
): Promise<void> {
  await postLicense('/api/license/deactivate', { licenseKey, instanceId }, options)
}

export interface NativeLicenseDetailResult {
  detail: ChatboxAILicenseDetail | null
  error?: { code?: string; message?: string }
}

type NativeLicenseDetailPayload = { data?: unknown; error?: { code?: string; message?: string } }

/**
 * Web parity (remote.getLicenseDetailRealtime): plan name, quotas and expiry
 * for the activated license, shown on the Chatbox AI settings screen.
 */
export async function fetchNativeLicenseDetail(
  licenseKey: string,
  options: NativeLicenseRequestOptions = {}
): Promise<NativeLicenseDetailResult> {
  return fetchLicenseDetail(licenseKey, options, 'realtime')
}

/** Read-only account details; this result must not activate credentials. */
export function fetchNativeLicenseInspection(licenseKey: string, options: NativeLicenseRequestOptions = {}) {
  return fetchLicenseDetail(licenseKey, options, 'all_status')
}

async function fetchLicenseDetail(
  licenseKey: string,
  options: NativeLicenseRequestOptions,
  endpoint: 'realtime' | 'all_status'
): Promise<NativeLicenseDetailResult> {
  const fetchFn = options.fetchFn ?? fetch
  const response = await fetchFn(`${resolveOrigin(options.apiOrigin)}/api/license/detail/${endpoint}`, {
    headers: { Authorization: licenseKey, ...options.headers },
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  let payload: NativeLicenseDetailPayload | null = null
  try {
    payload = (await response.json()) as NativeLicenseDetailPayload
  } catch {
    payload = null
  }
  if (!response.ok) {
    return { detail: null, error: payload?.error ?? { code: String(response.status) } }
  }
  return { detail: (payload?.data as ChatboxAILicenseDetail) ?? null, error: payload?.error }
}
