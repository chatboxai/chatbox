import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sanitizeFilename from 'sanitize-filename'

const MAX_CHUNK = 64 * 1024
interface Lease {
  owner: number
  file: FileHandle
  path: string
  target?: string
  bytes: number
  closed?: boolean
}
/** Native handles are scoped to their requesting renderer; partial output never replaces a saved backup. */
export class BackupFiles {
  private leases = new Map<string, Lease>()
  constructor(private readonly blobDirectory: string) {}
  private get(owner: number, token: string) {
    const value = this.leases.get(token)
    if (!value || value.owner !== owner) throw new Error('Invalid backup file handle')
    return value
  }
  private blobPath(key: string) {
    const name = sanitizeFilename(key)
    if (!name || name === '.' || name === '..') throw new Error('Invalid backup resource key')
    return join(this.blobDirectory, name)
  }
  async create(owner: number, target: string) {
    const token = randomUUID()
    const path = join(dirname(target), `.chatbox-backup-${token}.partial`)
    const file = await open(path, 'wx')
    this.leases.set(token, { owner, file, path, target, bytes: 0 })
    return token
  }
  async openBlob(owner: number, key: string) {
    const path = this.blobPath(key)
    let file: FileHandle
    try {
      file = await open(path, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const size = (await file.stat()).size
    const token = randomUUID()
    this.leases.set(token, { owner, file, path, bytes: 0 })
    return { token, size }
  }
  async createBlob(owner: number, key: string) {
    await mkdir(this.blobDirectory, { recursive: true })
    const path = this.blobPath(key)
    const file = await open(path, 'wx')
    const token = randomUUID()
    // A blob is only published by its eventual session/settings reference.
    this.leases.set(token, { owner, file, path, target: path, bytes: 0 })
    return token
  }
  async read(owner: number, token: string, offset: number, length: number) {
    const lease = this.get(owner, token)
    if (
      lease.target ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_CHUNK
    )
      throw new Error('Invalid backup read')
    const data = new Uint8Array(length)
    const { bytesRead } = await lease.file.read(data, 0, length, offset)
    return data.subarray(0, bytesRead)
  }
  async write(owner: number, token: string, data: Uint8Array) {
    const lease = this.get(owner, token)
    if (
      !lease.target ||
      !(data instanceof Uint8Array) ||
      data.byteLength > MAX_CHUNK ||
      lease.bytes + data.byteLength > 4 * 1024 ** 3
    )
      throw new Error('Backup write exceeds budget')
    let offset = 0
    while (offset < data.length) {
      const { bytesWritten } = await lease.file.write(data, offset, data.length - offset)
      if (!bytesWritten) throw new Error('Backup file write made no progress')
      offset += bytesWritten
    }
    lease.bytes += data.byteLength
  }
  async finish(owner: number, token: string, commit: boolean) {
    const lease = this.get(owner, token)
    if (commit && lease.target) await lease.file.sync()
    if (!lease.closed) {
      await lease.file.close()
      lease.closed = true
    }
    if (lease.target) {
      if (commit && lease.target !== lease.path) await rename(lease.path, lease.target)
      else if (!commit) await unlink(lease.path)
    }
    this.leases.delete(token)
  }
  async closeOwner(owner: number) {
    for (const [token, lease] of this.leases)
      if (lease.owner === owner) await this.finish(owner, token, false).catch(() => {})
  }
}
