import { describe, expect, it, vi } from 'vitest'
import {
  fetchNativeLicenseInspection,
  fetchNativeLicenseDetail,
  activateNativeLicense,
  deactivateNativeLicense,
  validateNativeLicense,
} from './native-license'

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe('native license client', () => {
  it('activates a license against the injected origin', async () => {
    const fetchFn = mockFetch({ data: { valid: true, instanceId: 'inst-1' } })
    const result = await activateNativeLicense('key-1', 'Android Device', {
      apiOrigin: 'http://10.0.2.2:8092/',
      fetchFn,
    })
    expect(result).toEqual({ valid: true, instanceId: 'inst-1', error: undefined })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://10.0.2.2:8092/api/license/activate')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      licenseKey: 'key-1',
      instanceName: 'Android Device',
    })
  })

  it('returns invalid with the server error message', async () => {
    const fetchFn = mockFetch({ data: { valid: false, instanceId: '', error: 'license expired' } })
    const result = await activateNativeLicense('key-2', 'Device', { fetchFn })
    expect(result.valid).toBe(false)
    expect(result.error).toBe('license expired')
  })

  it('throws on http errors', async () => {
    const fetchFn = mockFetch({ error: 'rate limited' }, false, 429)
    await expect(activateNativeLicense('key', 'Device', { fetchFn })).rejects.toThrow('rate limited')
  })

  it('validates and deactivates', async () => {
    const validateFetch = mockFetch({ data: { valid: true } })
    await expect(validateNativeLicense('key', 'inst', { fetchFn: validateFetch })).resolves.toBe(true)
    const deactivateFetch = mockFetch({})
    await expect(deactivateNativeLicense('key', 'inst', { fetchFn: deactivateFetch })).resolves.toBeUndefined()
    const [url] = (deactivateFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.chatboxai.app/api/license/deactivate')
  })

  it('returns an explicit invalid verdict', async () => {
    const fetchFn = mockFetch({ data: { valid: false } })
    await expect(validateNativeLicense('key', 'inst', { fetchFn })).resolves.toBe(false)
  })

  it('throws (rather than reporting invalid) on an indeterminate 200 response', async () => {
    // A captive portal / proxy returning a 200 with no usable body must NOT be
    // read as "invalid" — the renderer caller would otherwise wipe a valid
    // license. Throwing routes it through the network-error path (license kept).
    const emptyBody = mockFetch({})
    await expect(validateNativeLicense('key', 'inst', { fetchFn: emptyBody })).rejects.toThrow()

    const htmlBody = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON')
      },
    })) as unknown as typeof fetch
    await expect(validateNativeLicense('key', 'inst', { fetchFn: htmlBody })).rejects.toThrow()
  })
})

it('keeps read-only details on all_status and activation validation on realtime', async () => {
  const fetchFn = mockFetch({ data: { status: 'expired' } })
  await fetchNativeLicenseInspection('expired-key', { fetchFn })
  await fetchNativeLicenseDetail('expired-key', { fetchFn })
  expect(fetchFn).toHaveBeenNthCalledWith(
    1,
    'https://api.chatboxai.app/api/license/detail/all_status',
    expect.objectContaining({ headers: { Authorization: 'expired-key' } })
  )
  expect(fetchFn).toHaveBeenNthCalledWith(2, 'https://api.chatboxai.app/api/license/detail/realtime', expect.anything())
})
