import type { BackupResourceRecord, BackupWorkspace } from '@chatbox/core/backup-v3'
import type { ByteSink, ClosableByteSource } from '@chatbox/core/io'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererBackupResources } from './backup-resources'

const platform = vi.hoisted(() => ({
  type: 'web',
  resourceFiles: null as { open: (key: string) => Promise<ClosableByteSource | null> } | null,
  getStoreBlob: vi.fn<(key: string) => Promise<string | null>>(),
  setStoreBlob: vi.fn<(key: string, value: string) => Promise<void>>(),
  delStoreBlob: vi.fn<(key: string) => Promise<void>>(),
}))
vi.mock('@/platform', () => ({ default: platform }))
const encode = (value: string) => new TextEncoder().encode(value)
function combine(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
function source(bytes: Uint8Array): ClosableByteSource {
  return {
    size: bytes.length,
    readBytes: async (offset, length) => bytes.slice(offset, offset + length),
    close: async () => {},
  }
}
class Workspace implements BackupWorkspace {
  files = new Map<string, Uint8Array>()
  overrides = new Map<string, ClosableByteSource>()
  async createFile(name: string): Promise<ByteSink> {
    const parts: Uint8Array[] = []
    return {
      write: async (bytes) => {
        parts.push(bytes.slice())
      },
      close: async () => {
        this.files.set(name, combine(parts))
      },
      abort: async () => {
        this.files.delete(name)
      },
    }
  }
  async openFile(name: string) {
    const override = this.overrides.get(name)
    if (override) return override
    const bytes = this.files.get(name)
    if (!bytes) throw new Error('missing file')
    return source(bytes)
  }
  async put() {
    return true
  }
  async get() {
    return null
  }
  async *entries(): AsyncIterable<{ key: string; value: string }> {}
  async dispose() {
    this.files.clear()
  }
}
const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  vi.clearAllMocks()
  platform.type = 'web'
  platform.resourceFiles = null
  platform.getStoreBlob.mockImplementation(async (key) => values.get(key) ?? null)
  platform.setStoreBlob.mockImplementation(async (key, value) => {
    values.set(key, value)
  })
  platform.delStoreBlob.mockImplementation(async (key) => {
    values.delete(key)
  })
})
afterEach(() => vi.unstubAllGlobals())
const descriptor = (key: string, size: number): BackupResourceRecord => ({
  type: 'resource',
  resourceId: key,
  path: 'resources/000000.bin',
  mimeType: 'image/webp',
  contentType: 'binary',
  size,
})
async function read(source: ClosableByteSource) {
  const parts: Uint8Array[] = []
  try {
    if (source.chunks) for await (const bytes of source.chunks()) parts.push(bytes)
    else parts.push(await source.readBytes!(0, source.size))
    return combine(parts)
  } finally {
    await source.close()
  }
}

describe('renderer backup resources', () => {
  it('normalizes existing binary data URLs in chunks without altering resource keys', async () => {
    const bytes = new Uint8Array(65539)
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
    values.set('resource:one', `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`)
    const resources = createRendererBackupResources(new Workspace()),
      opened = await resources.open('resource:one')
    expect(opened).toMatchObject({ mimeType: 'image/png', contentType: 'binary' })
    expect(opened?.source.size).toBe(bytes.length)
    expect(await read(opened!.source)).toEqual(bytes)
    expect(platform.getStoreBlob).toHaveBeenCalledExactlyOnceWith('resource:one')
  })
  it('publishes the original key without reading old content and keeps it during cleanup', async () => {
    const workspace = new Workspace(),
      resources = createRendererBackupResources(workspace),
      bytes = new Uint8Array([1, 2, 3, 4, 5])
    values.set('same', 'old text')
    values.set('other', 'unrelated')
    const stage = await resources.stage('job', descriptor('same', bytes.length))
    await stage.write(bytes.subarray(0, 1))
    await stage.write(bytes.subarray(1, 4))
    await stage.write(bytes.subarray(4))
    await stage.close()
    expect(platform.getStoreBlob).not.toHaveBeenCalled()
    expect(values.get('same')).toBe('old text')
    await resources.publish('job', 'same')
    expect(values.get('same')).toBe(`data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`)
    await resources.cleanup('job')
    expect(platform.getStoreBlob).not.toHaveBeenCalled()
    expect(values.get('same')).toBe(`data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`)
    expect(values.get('other')).toBe('unrelated')
  })
  it('preserves Unicode text after temporary resource cleanup', async () => {
    const resources = createRendererBackupResources(new Workspace()),
      bytes = encode('🌍汉字\ntext')
    const stage = await resources.stage('job', {
      ...descriptor('new', bytes.length),
      contentType: 'text',
      mimeType: 'text/plain',
    })
    await stage.write(bytes.subarray(0, 2))
    await stage.write(bytes.subarray(2))
    await stage.close()
    await resources.publish('job', 'new')
    expect(values.get('new')).toBe('🌍汉字\ntext')
    await resources.cleanup('job')
    expect(values.get('new')).toBe('🌍汉字\ntext')
  })
  it('rejects invalid UTF-8 before changing a live text resource', async () => {
    const workspace = new Workspace(),
      resources = createRendererBackupResources(workspace)
    workspace.files.set('resource:key', new Uint8Array([255]))
    values.set('key', 'old')
    await expect(resources.publish('job', 'key')).rejects.toThrow()
    expect(values.get('key')).toBe('old')
  })
  it('closes a stored file rejected by the string adapter size budget', async () => {
    const workspace = new Workspace(),
      close = vi.fn(async () => {})
    workspace.overrides.set('resource:large', {
      size: 65 * 1024 * 1024,
      readBytes: async () => {
        throw new Error('must not read')
      },
      close,
    })
    await expect(createRendererBackupResources(workspace).publish('job', 'large')).rejects.toThrow('size budget')
    expect(close).toHaveBeenCalledOnce()
  })
  it('aborts native candidates if writing their initial encoding prefix fails', async () => {
    platform.type = 'desktop'
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'backup-resource:create') return 'candidate'
      if (channel === 'file-transfer:write') throw new Error('disk full')
      if (channel === 'file-transfer:finish') return undefined
      throw new Error(`Unexpected IPC ${channel}:${String(args[0])}`)
    })
    vi.stubGlobal('window', { electronAPI: { invoke } })
    await expect(createRendererBackupResources(new Workspace()).stage('job', descriptor('key', 1))).rejects.toThrow(
      'disk full'
    )
    expect(invoke).toHaveBeenCalledWith('file-transfer:finish', 'candidate', false)
  })
})
