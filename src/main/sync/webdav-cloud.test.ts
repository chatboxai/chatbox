import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import type { CloudSyncPayload } from '../../shared/sync'
import { decodeCloudEnvelope, encodeCloudEnvelope } from './cloud-envelope'
import { downloadWebDav, normalizeWebDavConfiguration, testWebDavConnection, uploadWebDav } from './webdav-cloud'

const payload: CloudSyncPayload = {
  revision: 'first',
  deviceId: 'device',
  updatedAt: 1,
  contentFingerprint: 'first-fingerprint',
  selection: { sessions: true, settings: true, copilots: false, credentials: false },
  backup: Uint8Array.of(0, 128, 255),
}
const input = { url: 'https://example.test/remote/dav', username: 'test-account', password: ' app-password ' }
const config = normalizeWebDavConfiguration(input)

afterEach(() => vi.unstubAllGlobals())

it('normalizes the endpoint and reuses a saved password only for the same account', () => {
  expect(config.url).toBe('https://example.test/remote/dav/')
  expect(config.password).toBe(' app-password ')
  expect(normalizeWebDavConfiguration({ ...input, password: undefined }, config)).toEqual(config)
  expect(normalizeWebDavConfiguration({ ...input, username: 'another', password: undefined }, config).password).toBe('')
  expect(() => normalizeWebDavConfiguration({ ...input, url: 'https://name:pass@example.test/dav' })).toThrow(
    'webdav_invalid_url'
  )
})

it('updates an encrypted file conditionally when encoded downloads would return a weak ETag', async () => {
  const requests: string[] = []
  const auth = `Basic ${Buffer.from('test-account: app-password ').toString('base64')}`
  const collection = '/remote/dav/ChatAny/'
  let directory = false
  let file: string | undefined
  let version = 0
  const server = createServer(async (request, response) => {
    const done = (status: number, body?: string) => {
      response.writeHead(status)
      response.end(body)
    }
    requests.push(`${request.method} ${request.url}`)
    if (request.headers.authorization !== auth) {
      done(401)
      return
    }
    const etag = `"${version}"`
    if (request.method === 'PROPFIND' && request.url === '/remote/dav/' && request.headers.depth === '0') {
      done(207)
      return
    }
    if (request.method === 'PROPFIND' && request.url === collection) {
      done(directory ? 207 : 404)
      return
    }
    if (request.method === 'MKCOL' && request.url === collection) {
      directory = true
      done(201)
      return
    }
    if (request.url !== `${collection}ChatAny-Sync-v1.json`) {
      done(404)
      return
    }
    if (request.method === 'GET') {
      if (!directory) {
        done(409)
        return
      }
      if (file === undefined) {
        done(404)
        return
      }
      response.setHeader('ETag', request.headers['accept-encoding'] === 'identity' ? etag : `W/${etag}`)
      done(200, file)
      return
    }
    if (request.method !== 'PUT') {
      done(405)
      return
    }
    if (!directory) {
      done(409)
      return
    }
    if (file === undefined ? request.headers['if-none-match'] !== '*' : request.headers['if-match'] !== etag) {
      done(412)
      return
    }
    const chunks: Uint8Array[] = []
    for await (const chunk of request) chunks.push(new Uint8Array(chunk))
    const status = file === undefined ? 201 : 204
    file = Buffer.concat(chunks).toString('utf8')
    version++
    done(status)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/remote/dav/`
    const target = { ...config, url }
    await testWebDavConnection(target)
    expect(await downloadWebDav(target)).toBeUndefined()
    expect(requests).toContain(`PROPFIND ${collection}`)
    expect(await uploadWebDav(target, payload, undefined, true, 'sync-token')).toEqual({ conflict: false })
    expect(requests).toContain(`MKCOL ${collection}`)
    expect(file && JSON.parse(file)).toMatchObject({ encrypted: true })
    const downloaded = await downloadWebDav(target, 'sync-token')
    expect(downloaded?.payload).toEqual(payload)
    expect(downloaded?.identity).toEqual({ service: 'webdav', etag: '"1"' })
    await expect(downloadWebDav(target, 'wrong-token')).rejects.toThrow('cloud_decryption_failed')

    const updated = { ...payload, revision: 'second' }
    expect(await uploadWebDav(target, updated, downloaded?.identity, true, 'sync-token')).toEqual({ conflict: false })
    expect(await uploadWebDav(target, payload, downloaded?.identity, false)).toEqual({ conflict: true })
    expect((await downloadWebDav(target, 'sync-token'))?.payload.revision).toBe('second')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it('preserves a GET conflict when WebDAV reports that the file still exists', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(new Response(null, { status: 207 }))
    .mockResolvedValueOnce(new Response(null, { status: 207 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(downloadWebDav(config)).rejects.toThrow('webdav_http_error:409')
  expect(fetchMock.mock.calls.map(([url, options]) => [url.pathname, options.method])).toEqual([
    ['/remote/dav/ChatAny/ChatAny-Sync-v1.json', 'GET'],
    ['/remote/dav/ChatAny/', 'PROPFIND'],
    ['/remote/dav/ChatAny/ChatAny-Sync-v1.json', 'PROPFIND'],
  ])
})

it('does not overwrite without a strong ETag or follow a redirect with credentials', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 301,
      headers: { Location: 'https://elsewhere.test/dav/' },
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  await expect(uploadWebDav(config, payload, { service: 'webdav', etag: 'W/"1"' }, false)).rejects.toThrow(
    'webdav_missing_etag'
  )
  expect(fetchMock).not.toHaveBeenCalled()
  await expect(testWebDavConnection(config)).rejects.toThrow('webdav_redirect')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
})

const existing = { service: 'webdav' as const }
const localUpdate = {
  ...payload,
  revision: 'second',
  parentRevision: payload.revision,
  contentFingerprint: 'second-fingerprint',
}
const syncedConfig = {
  ...config,
  baseline: { cloudRevision: payload.revision, localFingerprint: payload.contentFingerprint, selectionKey: '1100' },
}
const oldBackup = encodeCloudEnvelope(payload, false)

it.each([undefined, 'W/"1"'])('recreates the unchanged cloud revision with ETag %s', async (etag) => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(oldBackup, { headers: etag ? { ETag: etag } : undefined }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(uploadWebDav(syncedConfig, localUpdate, existing, false)).resolves.toEqual({ conflict: false })
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'DELETE', 'PUT'])
  const [deleteUrl] = fetchMock.mock.calls[1]
  expect(deleteUrl.pathname).toBe('/remote/dav/ChatAny/ChatAny-Sync-v1.json')
  const [, write] = fetchMock.mock.calls[2]
  expect(write.headers.get('If-None-Match')).toBe('*')
  expect(decodeCloudEnvelope(write.body)).toEqual(localUpdate)
})

it('rechecks the remote revision before deleting an existing file', async () => {
  const newer = encodeCloudEnvelope({ ...payload, revision: 'another-device' }, false)
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(newer))
  vi.stubGlobal('fetch', fetchMock)

  await expect(uploadWebDav(syncedConfig, localUpdate, existing, false)).resolves.toEqual({ conflict: true })
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET'])
})

it('does not delete the cloud file without evidence of a local update', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  await expect(
    uploadWebDav(syncedConfig, { ...localUpdate, contentFingerprint: payload.contentFingerprint }, existing, false)
  ).rejects.toThrow('webdav_missing_etag')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('uses a recovered strong ETag instead of deleting the remote file', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(oldBackup, { headers: { ETag: '"1"' } }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(uploadWebDav(syncedConfig, localUpdate, existing, false)).resolves.toEqual({ conflict: false })
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'PUT'])
  expect(fetchMock.mock.calls[1][1].headers.get('If-Match')).toBe('"1"')
})

it('attempts to restore the original backup if recreating the file fails', async () => {
  const encryptedBackup = encodeCloudEnvelope(payload, true, 'sync-token')
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(encryptedBackup))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(uploadWebDav(syncedConfig, localUpdate, existing, true, 'sync-token')).rejects.toThrow(
    'webdav_http_error:500'
  )
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'DELETE', 'PUT', 'PUT'])
  const [, recovery] = fetchMock.mock.calls[3]
  expect(recovery.body).toBe(encryptedBackup)
  expect(recovery.headers.get('If-None-Match')).toBe('*')
})

it('attempts recovery when the DELETE response is lost', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(oldBackup))
    .mockRejectedValueOnce(new TypeError('request failed'))
    .mockResolvedValueOnce(new Response(null, { status: 412 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(uploadWebDav(syncedConfig, localUpdate, existing, false)).rejects.toThrow('webdav_network_error')
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'DELETE', 'PUT'])
  const [, recovery] = fetchMock.mock.calls[2]
  expect(recovery.body).toBe(oldBackup)
  expect(recovery.headers.get('If-None-Match')).toBe('*')
})

it('returns a conflict when another device recreates the file first', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(oldBackup))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 412 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(uploadWebDav(syncedConfig, localUpdate, existing, false)).resolves.toEqual({ conflict: true })
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'DELETE', 'PUT'])
})
