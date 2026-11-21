import { createHash } from 'node:crypto'
import type { BaiduFileIdentity, CloudSyncPayload } from '../../shared/sync'
import { encodeCloudEnvelope, readCloudEnvelope } from './cloud-envelope'

const cloudDirectory = '/apps/ChatAny'
const cloudFilename = 'ChatAny-Sync-v1.json'
const cloudPath = `${cloudDirectory}/${cloudFilename}`
const chunkSize = 4 * 1024 * 1024
const overwriteRtype = '3'
const requestTimeoutMs = 120_000

function fetchCloud(url: URL, options?: RequestInit): Promise<Response> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMs) })
}

interface BaiduFile {
  fs_id: number
  path: string
  server_filename: string
  size: number
  server_mtime?: number
  md5?: string
  dlink?: string
}
interface BaiduResponse {
  errno?: number
  errmsg?: string
  list?: BaiduFile[]
  uploadid?: string
  block_list?: string[]
  fs_id?: number
  path?: string
  md5?: string
  server_mtime?: number
  dlink?: string
  [key: string]: unknown
}

function endpoint(base: string, params: Record<string, string>) {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}
async function json(response: Response): Promise<BaiduResponse> {
  const value = (await response.json()) as BaiduResponse
  if (!response.ok || (typeof value.errno === 'number' && value.errno !== 0)) {
    const error = new Error('baidu_api_error') as Error & { errno?: number }
    error.errno = value.errno
    throw error
  }
  return value
}
async function listCloudDirectory(accessToken: string): Promise<BaiduFile[] | undefined> {
  try {
    const response = await fetchCloud(
      endpoint('https://pan.baidu.com/rest/2.0/xpan/file', {
        method: 'list',
        access_token: accessToken,
        dir: cloudDirectory,
        start: '0',
        limit: '1000',
        order: 'name',
        desc: '0',
        web: '0',
        folder: '0',
        showempty: '0',
      })
    )
    return (await json(response)).list || []
  } catch (error) {
    if ((error as Error & { errno?: number }).errno === -9) return undefined
    throw error
  }
}
async function list(accessToken: string): Promise<BaiduFile | undefined> {
  const files = await listCloudDirectory(accessToken)
  return files?.find((entry) => entry.path === cloudPath || entry.server_filename === cloudFilename)
}
async function ensureCloudDirectory(accessToken: string): Promise<void> {
  if (await listCloudDirectory(accessToken)) return
  const body = new URLSearchParams({ path: cloudDirectory, size: '0', isdir: '1', block_list: '[]' })
  await json(
    await fetchCloud(
      endpoint('https://pan.baidu.com/rest/2.0/xpan/file', {
        method: 'create',
        access_token: accessToken,
      }),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }
    )
  )
}
function identity(file: BaiduFile): BaiduFileIdentity {
  return { service: 'baidu-netdisk', fsId: file.fs_id, md5: file.md5, serverMtime: file.server_mtime }
}
export async function cloudIdentity(accessToken: string): Promise<BaiduFileIdentity | undefined> {
  const file = await list(accessToken)
  return file ? identity(file) : undefined
}
export async function downloadCloud(
  accessToken: string,
  token?: string
): Promise<{ payload: CloudSyncPayload; identity: BaiduFileIdentity } | undefined> {
  const file = await list(accessToken)
  if (!file) return undefined
  const metaResponse = await fetchCloud(
    endpoint('https://pan.baidu.com/rest/2.0/xpan/multimedia', {
      method: 'filemetas',
      access_token: accessToken,
      fsids: JSON.stringify([file.fs_id]),
      dlink: '1',
      extra: '1',
      thumb: '0',
      needmedia: '0',
      detail: '0',
      extra_info: '0',
    })
  )
  const meta = await json(metaResponse)
  const dlink = meta.list?.[0]?.dlink
  if (!dlink) throw new Error('baidu_download_link_missing')
  const downloadUrl = endpoint(dlink, { access_token: accessToken })
  if (downloadUrl.protocol !== 'https:' || !/(^|\.)(baidu\.com|baidupcs\.com)$/.test(downloadUrl.hostname)) {
    throw new Error('baidu_download_link_invalid')
  }
  const response = await fetchCloud(downloadUrl, { headers: { 'User-Agent': 'pan.baidu.com' } })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error('baidu_download_failed')
  }
  const payload = await readCloudEnvelope(response, token)
  return { payload, identity: identity(meta.list?.[0] || file) }
}
function sameIdentity(a?: BaiduFileIdentity, b?: BaiduFileIdentity) {
  if (!a || !b) return a === b
  return (
    a.fsId === b.fsId &&
    (!a.md5 || !b.md5 || a.md5 === b.md5) &&
    (!a.serverMtime || !b.serverMtime || a.serverMtime === b.serverMtime)
  )
}
export async function uploadCloud(
  accessToken: string,
  payload: CloudSyncPayload,
  expected: BaiduFileIdentity | undefined,
  encrypt: boolean,
  token?: string
): Promise<{ conflict: boolean; identity?: BaiduFileIdentity }> {
  const current = await cloudIdentity(accessToken)
  if (!sameIdentity(current, expected)) return { conflict: true, identity: current }
  await ensureCloudDirectory(accessToken)
  const bytes = Buffer.from(encodeCloudEnvelope(payload, encrypt, token))
  const chunks: Buffer[] = []
  const hashes: string[] = []
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))
    chunks.push(chunk)
    hashes.push(createHash('md5').update(new Uint8Array(chunk)).digest('hex'))
  }
  const preBody = new URLSearchParams({
    path: cloudPath,
    size: String(bytes.length),
    isdir: '0',
    autoinit: '1',
    rtype: overwriteRtype,
    block_list: JSON.stringify(hashes),
  })
  const pre = await json(
    await fetchCloud(
      endpoint('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'precreate', access_token: accessToken }),
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: preBody }
    )
  )
  if (!pre.uploadid) throw new Error('baidu_upload_id_missing')
  for (let index = 0; index < chunks.length; index += 1) {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(chunks[index])]), 'blob')
    await json(
      await fetchCloud(
        endpoint('https://d.pcs.baidu.com/rest/2.0/pcs/superfile2', {
          method: 'upload',
          type: 'tmpfile',
          access_token: accessToken,
          path: cloudPath,
          uploadid: pre.uploadid,
          partseq: String(index),
        }),
        { method: 'POST', body: form }
      )
    )
  }
  const createBody = new URLSearchParams({
    path: cloudPath,
    size: String(bytes.length),
    isdir: '0',
    rtype: overwriteRtype,
    uploadid: pre.uploadid,
    block_list: JSON.stringify(hashes),
  })
  const created = await json(
    await fetchCloud(
      endpoint('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'create', access_token: accessToken }),
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: createBody }
    )
  )
  if (created.path && created.path !== cloudPath) throw new Error('baidu_overwrite_returned_unexpected_path')
  return {
    conflict: false,
    identity: {
      service: 'baidu-netdisk',
      fsId: Number(created.fs_id),
      md5: created.md5 as string | undefined,
      serverMtime: created.server_mtime as number | undefined,
    },
  }
}
