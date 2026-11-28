import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadCloud } from './baidu-cloud'

const cloudPath = '/apps/ChatAny/ChatAny-Sync-v1.json'
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('Baidu cloud upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses overwrite mode for both upload creation stages', async () => {
    const rtypes: string[] = []
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = url.searchParams.get('method')
      if (method === 'list') return response({ errno: 0, list: [] })
      if (method === 'precreate') {
        rtypes.push(new URLSearchParams(String(init?.body)).get('rtype') || '')
        return response({ errno: 0, uploadid: 'upload-id' })
      }
      if (method === 'upload') return response({ errno: 0, md5: 'uploaded-part' })
      if (method === 'create') {
        rtypes.push(new URLSearchParams(String(init?.body)).get('rtype') || '')
        return response({ errno: 0, fs_id: 42, path: cloudPath, md5: 'file-md5', server_mtime: 1 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadCloud(
      'access-token',
      {
        revision: 'revision-1',
        deviceId: 'device-1',
        updatedAt: 1,
        selection: { sessions: true, settings: true, copilots: true, credentials: false },
        contentFingerprint: 'fingerprint',
        backup: Uint8Array.from([1, 2, 3]),
      },
      undefined,
      false
    )

    expect(result.conflict).toBe(false)
    expect(rtypes).toEqual(['3', '3'])
  })
})
