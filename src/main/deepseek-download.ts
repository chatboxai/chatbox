import { type FileHandle, mkdir, open, rm } from 'node:fs/promises'
import { join } from 'node:path'

interface Download {
  owner: number
  controller: AbortController
  received: number
  total?: number
  directory: string
  file?: FileHandle
  completion?: Promise<void>
}
const LIMIT = 4 * 1024 ** 3

/** Task-owned downloads. Only opaque task identities cross the renderer bridge. */
export class DeepSeekDownloads {
  private jobs = new Map<string, Download>()
  constructor(
    private readonly root: string,
    private readonly fetchFile: (url: string, init?: RequestInit) => Promise<Response>
  ) {}
  private get(owner: number, id: string) {
    const job = this.jobs.get(id)
    if (!job || job.owner !== owner) throw new Error('Download is unavailable')
    return job
  }
  async start(owner: number, id: string, url: string) {
    if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id) || this.jobs.has(id))
      throw new Error('Invalid download task')
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new Error('Please enter an HTTPS download link.')
    const job: Download = { owner, controller: new AbortController(), received: 0, directory: join(this.root, id) }
    this.jobs.set(id, job)
    job.completion = this.download(job, url)
    try {
      await job.completion
      return { size: job.received }
    } catch (error) {
      const cancelled = job.controller.signal.aborted
      await this.close(owner, id)
      throw new Error(
        cancelled
          ? 'Download cancelled.'
          : error instanceof DownloadStatusError
            ? error.message
            : 'Could not download the archive. Please check the link or select a ZIP file.'
      )
    }
  }
  private async download(job: Download, url: string) {
    const response = await this.fetchFile(url, { signal: job.controller.signal, credentials: 'omit' })
    if (!response.ok)
      throw new DownloadStatusError(
        `Download failed (HTTP ${response.status}). Please check whether the link has expired.`
      )
    if (!response.body) throw new Error('Empty download')
    const total = Number(response.headers.get('content-length'))
    if (Number.isFinite(total) && total > 0) job.total = total
    if ((job.total ?? 0) > LIMIT) throw new Error('Archive is too large')
    await mkdir(job.directory, { recursive: true })
    job.file = await open(join(job.directory, 'archive.zip'), 'wx+')
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        job.controller.signal.throwIfAborted()
        if (job.received + value.length > LIMIT) throw new Error('Archive is too large')
        for (let offset = 0; offset < value.length; ) {
          const { bytesWritten } = await job.file.write(value, offset, value.length - offset, job.received)
          if (!bytesWritten) throw new Error('Could not save download')
          offset += bytesWritten
          job.received += bytesWritten
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }
  progress(owner: number, id: string) {
    const job = this.get(owner, id)
    return { received: job.received, total: job.total }
  }
  async read(owner: number, id: string, offset: number, length: number) {
    const job = this.get(owner, id)
    if (
      !job.file ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 65536 ||
      offset + length > job.received
    )
      throw new Error('Invalid download read')
    const bytes = new Uint8Array(length)
    const { bytesRead } = await job.file.read(bytes, 0, length, offset)
    if (bytesRead !== length) throw new Error('Download file changed')
    return bytes
  }
  async close(owner: number, id: string) {
    const job = this.jobs.get(id)
    if (!job || job.owner !== owner) return
    this.jobs.delete(id)
    job.controller.abort()
    await job.completion?.catch(() => {})
    await job.file?.close()
    await rm(job.directory, { recursive: true, force: true })
  }
  async closeOwner(owner: number) {
    for (const [id, job] of this.jobs) if (job.owner === owner) await this.close(owner, id)
  }
}
class DownloadStatusError extends Error {}
