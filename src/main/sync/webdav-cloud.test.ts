import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import type { CloudSyncPayload } from '../../shared/sync'
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

it('creates and updates an encrypted file at the fixed path using conditional writes', async () => {
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
      response.setHeader('ETag', etag)
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
