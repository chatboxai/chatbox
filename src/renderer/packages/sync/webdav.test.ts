import { describe, expect, it, vi } from 'vitest'
import {
  buildBasicAuthHeader,
  executeWebDAVRequest,
  joinWebDAVUrl,
  requestWebDAV,
  validateWebDAVRequestTarget,
} from './webdav'

describe('WebDAV helpers', () => {
  it('joins a base collection URL and sync-relative path without duplicate slashes', () => {
    expect(joinWebDAVUrl('https://dav.example.com/remote.php/dav/files/me/', '/ChatboxSync/v1/snapshot.json.enc')).toBe(
      'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc'
    )
  })

  it('builds a basic auth header from username and password', () => {
    expect(buildBasicAuthHeader('alice', 'app-password')).toBe(`Basic ${btoa('alice:app-password')}`)
  })

  it('encodes basic auth credentials as UTF-8 before base64 encoding', () => {
    expect(buildBasicAuthHeader('用户', '密钥')).toBe(`Basic ${Buffer.from('用户:密钥', 'utf8').toString('base64')}`)
  })

  it('routes requests through the platform WebDAV request method', async () => {
    const webdavRequest = vi.fn(async () => ({
      status: 200,
      headers: { etag: '"abc"' },
      body: 'ok',
    }))

    const result = await requestWebDAV(
      {
        webdavRequest,
      },
      'https://dav.example.com/',
      {
        url: 'https://dav.example.com/ChatboxSync/v1/snapshot.json.enc',
        method: 'PUT',
        headers: { Authorization: 'Basic abc' },
        body: 'payload',
      }
    )

    expect(webdavRequest).toHaveBeenCalledWith(
      {
        url: 'https://dav.example.com/ChatboxSync/v1/snapshot.json.enc',
        method: 'PUT',
        headers: { Authorization: 'Basic abc' },
        body: 'payload',
      },
      'https://dav.example.com/'
    )
    expect(result.body).toBe('ok')
  })

  it('rejects WebDAV requests outside the fixed sync paths and methods', () => {
    const baseUrl = 'https://dav.example.com/remote.php/dav/files/me/'

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc',
        method: 'GET',
      })
    ).not.toThrow()

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc',
        method: 'PUT',
        headers: { 'If-Match': '"abc"', 'If-None-Match': '*' },
        body: 'payload',
      })
    ).not.toThrow()

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: 'https://dav.example.com/remote.php/dav/files/me/other.json',
        method: 'GET',
      })
    ).toThrow(/not allowed/i)

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc',
        method: 'DELETE',
      })
    ).toThrow(/not allowed/i)

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc?target=other',
        method: 'GET',
      })
    ).toThrow(/not allowed/i)

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc',
        method: 'GET',
        headers: { 'X-Forwarded-Host': 'internal' },
      })
    ).toThrow(/not allowed/i)

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc',
        method: 'GET',
        body: 'unexpected',
      })
    ).toThrow(/not allowed/i)
  })

  it('rejects malformed runtime request payloads before transport', () => {
    const baseUrl = 'https://dav.example.com/remote.php/dav/files/me/'
    const url = 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc'

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url: new URL(url) as unknown as string,
        method: 'GET',
      })
    ).toThrow(/not allowed/i)

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url,
        method: 'GET',
        headers: { Authorization: 123 as unknown as string },
      })
    ).toThrow(/not allowed/i)

    expect(() =>
      validateWebDAVRequestTarget(baseUrl, {
        url,
        method: 'PUT',
        body: { payload: true } as unknown as string,
      })
    ).toThrow(/not allowed/i)

    expect(() =>
      validateWebDAVRequestTarget(`${baseUrl}?token=secret`, {
        url,
        method: 'GET',
      })
    ).toThrow(/not allowed/i)
  })

  it('executes WebDAV requests with redirect rejection through the provided transport', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200, headers: { ETag: '"abc"' } }))

    const result = await executeWebDAVRequest(
      'https://dav.example.com/remote.php/dav/files/me/',
      {
        url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc',
        method: 'GET',
        headers: { Authorization: 'Basic abc' },
      },
      fetchImpl
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc'),
      {
        method: 'GET',
        headers: { Authorization: 'Basic abc' },
        body: undefined,
        redirect: 'error',
      }
    )
    expect(result.status).toBe(200)
    expect(result.headers.etag).toBe('"abc"')
    expect(result.body).toBe('ok')
  })

  it('rejects WebDAV redirects even if the transport returns a redirect response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('', {
          status: 302,
          headers: { Location: 'https://internal.example.test/' },
        })
    )

    await expect(
      executeWebDAVRequest(
        'https://dav.example.com/remote.php/dav/files/me/',
        {
          url: 'https://dav.example.com/remote.php/dav/files/me/ChatboxSync/v1/snapshot.json.enc',
          method: 'GET',
          headers: { Authorization: 'Basic abc' },
        },
        fetchImpl
      )
    ).rejects.toThrow(/redirect/i)
  })
})
