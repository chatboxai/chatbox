// Regression test for src/main/store-node.ts setStoreBlob / delStoreBlob.
//
// Verifies that fs-extra permission failures (EACCES on ensureDir, EACCES on remove)
// surface as actionable errors with the original errno preserved as `cause`, instead of
// crossing the IPC boundary as an opaque "An object could not be cloned" error.
//
// Note: this is the first test in src/main/. The vitest config (vitest.config.ts L13)
// already includes `src/**/*.{test,spec}.{ts,tsx}` so no config change is needed.
// We mock 'electron' (app.getPath) and 'fs-extra' so the test does not require an
// Electron runtime or actual filesystem access.

import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `/tmp/chatbox-test-userdata/${name}`,
  },
  powerMonitor: {
    on: vi.fn(),
  },
}))

vi.mock('fs-extra', () => {
  const mock = {
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
    remove: vi.fn(),
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readFileSync: vi.fn(),
    copy: vi.fn(),
    copySync: vi.fn(),
  }
  return { ...mock, default: mock }
})

vi.mock('./util', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('store-node blob storage', () => {
  let storeNode: typeof import('./store-node.js')
  let fs: typeof import('fs-extra')

  beforeEach(async () => {
    vi.resetModules()
    fs = (await import('fs-extra')) as unknown as typeof import('fs-extra')
    storeNode = await import('./store-node.js')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('setStoreBlob', () => {
    it('writes successfully when the userData dir is writable', async () => {
      ;(fs.ensureDir as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
      ;(fs.writeFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)

      await expect(storeNode.setStoreBlob('parseFile-abc', 'hello world')).resolves.toBeUndefined()

      expect(fs.ensureDir).toHaveBeenCalledWith(
        path.resolve('/tmp/chatbox-test-userdata/userData', 'chatbox-blobs')
      )
      expect(fs.writeFile).toHaveBeenCalled()
    })

    it('surfaces EACCES from ensureDir as a permission error with cause preserved', async () => {
      const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      ;(fs.ensureDir as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(eacces)

      await expect(storeNode.setStoreBlob('parseFile-abc', 'x')).rejects.toThrow(
        /permission denied.*chatbox userData directory is writable/i
      )
      // The original errno error must be preserved as `cause` so the renderer's
      // Sentry handler reports the actionable detail (code=EACCES + path).
      try {
        await storeNode.setStoreBlob('parseFile-abc', 'x')
      } catch (e) {
        expect((e as Error & { cause?: { code?: string } }).cause?.code).toBe('EACCES')
      }
    })

    it('surfaces EROFS (read-only filesystem) the same way', async () => {
      const erofs = Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' })
      ;(fs.ensureDir as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(erofs)

      await expect(storeNode.setStoreBlob('k', 'v')).rejects.toThrow(/permission denied/i)
    })

    it('rethrows non-permission errors unchanged', async () => {
      const enospc = Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
      ;(fs.ensureDir as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
      ;(fs.writeFile as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(enospc)

      await expect(storeNode.setStoreBlob('k', 'v')).rejects.toBe(enospc)
    })
  })

  describe('delStoreBlob', () => {
    it('returns silently when the file does not exist (existing behaviour preserved)', async () => {
      ;(fs.pathExists as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)

      await expect(storeNode.delStoreBlob('missing')).resolves.toBeUndefined()
      expect(fs.remove).not.toHaveBeenCalled()
    })

    it('swallows ENOENT from remove (race between pathExists and remove)', async () => {
      ;(fs.pathExists as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      ;(fs.remove as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(enoent)

      await expect(storeNode.delStoreBlob('vanished')).resolves.toBeUndefined()
    })

    it('rethrows EACCES so callers can surface a permission failure', async () => {
      ;(fs.pathExists as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      ;(fs.remove as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(eacces)

      await expect(storeNode.delStoreBlob('locked')).rejects.toBe(eacces)
    })
  })
})
