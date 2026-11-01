import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sanitizeFilename from 'sanitize-filename'

/** Native candidates live outside the normal resource directory and its GC. */
export class BackupResourceFiles {
  constructor(private readonly userData: string) {}
  private directory(jobId: string) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(jobId)) throw new Error('Invalid backup job identity')
    return join(this.userData, 'backup-jobs', jobId)
  }
  private path(jobId: string, key: string) {
    if (typeof key !== 'string' || !key || key.length > 8192) throw new Error('Invalid resource key')
    return join(this.directory(jobId), `${createHash('sha256').update(key).digest('hex')}.candidate`)
  }
  private target(key: string) {
    if (typeof key !== 'string') throw new Error('Invalid resource key')
    const name = sanitizeFilename(key)
    if (!name || name === '.' || name === '..') throw new Error('Invalid resource key')
    return join(this.userData, 'chatbox-blobs', name)
  }
  async candidate(jobId: string, key: string): Promise<string> {
    const path = this.path(jobId, key)
    await mkdir(this.directory(jobId), { recursive: true })
    const targetIdentity = createHash('sha256').update(this.target(key)).digest('hex')
    const ownership = join(this.directory(jobId), `${targetIdentity}.target`)
    try {
      await writeFile(ownership, key, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if ((await readFile(ownership, 'utf8')) !== key) throw new Error('Resource keys share the same storage path')
    }
    return path
  }
  async publish(jobId: string, key: string): Promise<void> {
    await mkdir(join(this.userData, 'chatbox-blobs'), { recursive: true })
    await rename(this.path(jobId, key), this.target(key))
  }
  cleanup(jobId: string): Promise<void> {
    return rm(this.directory(jobId), { recursive: true, force: true })
  }
}
