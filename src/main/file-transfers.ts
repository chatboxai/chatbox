import { randomUUID } from 'node:crypto'
import { link, mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises'
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
  exclusive?: boolean
  published?: boolean
}
/** Native handles belong to their requesting renderer; partial output never replaces a saved file. */
export class FileTransfers {
  private leases = new Map<string, Lease>()
  private ownerEpochs = new Map<number, number>()
  constructor(private readonly resourceDirectory: string) {}
  private get(owner: number, token: string) {
    const value = this.leases.get(token)
    if (!value || value.owner !== owner) throw new Error('Invalid file transfer handle')
    return value
  }
  private resourcePath(key: string) {
    if (typeof key !== 'string') throw new Error('Invalid resource key')
    const name = sanitizeFilename(key)
    if (!name || name === '.' || name === '..') throw new Error('Invalid resource key')
    return join(this.resourceDirectory, name)
  }
  private ownerEpoch(owner: number): number {
    return this.ownerEpochs.get(owner) ?? 0
  }
  private async retainLease(token: string, lease: Lease, epoch: number): Promise<void> {
    this.leases.set(token, lease)
    if (epoch !== this.ownerEpoch(lease.owner)) {
      await this.finish(lease.owner, token, false).catch(() => undefined)
      throw new Error('File transfer owner has closed')
    }
  }
  async create(owner: number, target: string, epoch = this.ownerEpoch(owner)) {
    const token = randomUUID()
    const path = join(dirname(target), `.chatbox-transfer-${token}.partial`)
    const file = await open(path, 'wx')
    await this.retainLease(token, { owner, file, path, target, bytes: 0 }, epoch)
    return token
  }
  async openResource(owner: number, key: string) {
    const epoch = this.ownerEpoch(owner)
    const path = this.resourcePath(key)
    let file: FileHandle
    try {
      file = await open(path, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      const size = (await file.stat()).size
      const token = randomUUID()
      await this.retainLease(token, { owner, file, path, bytes: 0 }, epoch)
      return { token, size }
    } catch (error) {
      await file.close().catch(() => undefined)
      throw error
    }
  }
  async createResource(owner: number, key: string) {
    const epoch = this.ownerEpoch(owner)
    await mkdir(this.resourceDirectory, { recursive: true })
    const target = this.resourcePath(key)
    const token = await this.create(owner, target, epoch)
    this.get(owner, token).exclusive = true
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
      throw new Error('Invalid file transfer read')
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
      throw new Error('File transfer write exceeds budget')
    let offset = 0
    while (offset < data.length) {
      const { bytesWritten } = await lease.file.write(data, offset, data.length - offset)
      if (!bytesWritten) throw new Error('File write made no progress')
      offset += bytesWritten
    }
    lease.bytes += data.byteLength
  }
  async finish(owner: number, token: string, commit: boolean) {
    const lease = this.get(owner, token)
    if (!lease.closed) {
      if (commit && lease.target) await lease.file.sync()
      await lease.file.close()
      lease.closed = true
    }
    if (lease.target) {
      if (commit && !lease.published) {
        if (lease.exclusive) await link(lease.path, lease.target)
        else await rename(lease.path, lease.target)
        lease.published = true
      }
      if (!lease.published || lease.exclusive) {
        try {
          await unlink(lease.path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            // Published output is complete; retain the temporary name for cleanup retry.
            if (lease.published && commit) return
            throw error
          }
        }
      }
    }
    this.leases.delete(token)
  }
  async closeOwner(owner: number) {
    this.ownerEpochs.set(owner, this.ownerEpoch(owner) + 1)
    for (const [token, lease] of this.leases)
      if (lease.owner === owner) await this.finish(owner, token, false).catch(() => {})
  }
}
