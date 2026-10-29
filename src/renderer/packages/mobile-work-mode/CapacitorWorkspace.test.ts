import { Directory, type FilesystemPlugin } from '@capacitor/filesystem'
import { textToBase64 } from '@shared/mobile-work/workspace-path'
import { describe, expect, it, vi } from 'vitest'
import { CapacitorWorkspace } from './CapacitorWorkspace'

function fixture() {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const key = (path: string, directory: Directory) => `${directory}/${path.replace(/\/$/, '')}`
  const filesystem = {
    rmdir: vi.fn(async ({ path, directory }: { path: string; directory: Directory }) => {
      const root = key(path, directory)
      for (const name of files.keys()) if (name.startsWith(`${root}/`)) files.delete(name)
      for (const name of dirs) if (name === root || name.startsWith(`${root}/`)) dirs.delete(name)
    }),
    mkdir: vi.fn(async ({ path, directory }: { path: string; directory: Directory }) => {
      dirs.add(key(path, directory))
    }),
    stat: vi.fn(async ({ path, directory }: { path: string; directory: Directory }) => {
      const full = key(path, directory)
      if (dirs.has(full)) return { type: 'directory', size: 0 }
      const data = files.get(full)
      if (data === undefined) throw new Error('Missing file')
      return { type: 'file', size: atob(data).length }
    }),
    readdir: vi.fn(async ({ path, directory }: { path: string; directory: Directory }) => {
      const prefix = `${key(path, directory)}/`
      const entries = new Map<string, { name: string; type: 'file' | 'directory'; size: number }>()
      for (const [name, data] of files) {
        if (!name.startsWith(prefix)) continue
        const relative = name.slice(prefix.length)
        const first = relative.split('/')[0]
        entries.set(first, {
          name: first,
          type: relative.includes('/') ? 'directory' : 'file',
          size: relative.includes('/') ? 0 : atob(data).length,
        })
      }
      return { files: [...entries.values()] }
    }),
    readFile: vi.fn(async ({ path, directory }: { path: string; directory: Directory }) => ({
      data: files.get(key(path, directory)),
    })),
    writeFile: vi.fn(async ({ path, directory, data }: { path: string; directory: Directory; data: string }) => {
      files.set(key(path, directory), data)
      return { uri: `file:///${path}` }
    }),
    getUri: vi.fn(async ({ path, directory }: { path: string; directory: Directory }) => ({
      uri: `file:///${key(path, directory)}`,
    })),
    deleteFile: vi.fn(async ({ path, directory }: { path: string; directory: Directory }) => {
      files.delete(key(path, directory))
    }),
  }
  return { files, filesystem, workspace: new CapacitorWorkspace(filesystem as unknown as FilesystemPlugin) }
}

describe('Capacitor local workspace', () => {
  it('removes all session files and rejects stale writes while preserving other sessions', async () => {
    const { workspace, filesystem, files } = fixture()
    await workspace.write('deleted', 'input/data.csv', textToBase64('input'))
    await workspace.write('deleted', 'output.txt', textToBase64('output'))
    await workspace.deliver('deleted', 'output.txt')
    await workspace.write('kept', 'output.txt', textToBase64('keep'))
    await workspace.remove('deleted')
    expect(files.size).toBe(1)
    expect(await workspace.readText('kept', 'output.txt')).toBe('keep')
    await expect(workspace.write('deleted', 'late.txt', textToBase64('late'))).rejects.toThrow('deleted')
    await expect(workspace.snapshot('deleted')).rejects.toThrow('deleted')
    expect(filesystem.rmdir).toHaveBeenCalledWith(expect.objectContaining({ recursive: true }))
    workspace.reopen('deleted')
    await expect(workspace.snapshot('deleted')).resolves.toEqual({})
  })

  it('waits for an in-flight native write before removing its directory', async () => {
    const { workspace, filesystem, files } = fixture()
    let finishWrite!: () => void
    const gate = new Promise<void>((resolve) => {
      finishWrite = resolve
    })
    const nativeWrite = filesystem.writeFile.getMockImplementation()!
    filesystem.writeFile.mockImplementationOnce(async (options) => {
      await gate
      return nativeWrite(options)
    })
    const writing = workspace.write('session', 'output.txt', textToBase64('output'))
    await vi.waitFor(() => expect(filesystem.writeFile).toHaveBeenCalled())
    const deleting = workspace.remove('session')
    expect(filesystem.rmdir).not.toHaveBeenCalled()
    finishWrite()
    await Promise.all([writing, deleting])
    expect(files.size).toBe(0)
  })

  it('treats only native missing-directory errors as successful cleanup', async () => {
    const { workspace, filesystem } = fixture()
    filesystem.rmdir.mockRejectedValueOnce({ code: 'OS-PLUG-FILE-0008' })
    await expect(workspace.remove('missing')).resolves.toBeUndefined()
    const error = new Error('Disk failure')
    filesystem.rmdir.mockRejectedValueOnce(error)
    await expect(workspace.remove('failed')).rejects.toBe(error)
  })

  it('keeps input files in snapshots and excludes durable artifacts', async () => {
    const { workspace } = fixture()
    await workspace.write('session', 'input/data.csv', textToBase64('a,b'))
    await workspace.write('session', 'result.txt', textToBase64('report'))
    const artifact = await workspace.deliver('session', 'result.txt')
    expect(await workspace.snapshot('session')).toEqual({
      'input/data.csv': { base64: textToBase64('a,b') },
      'result.txt': { base64: textToBase64('report') },
    })
    expect(await workspace.readText('session', artifact.path)).toBe('report')
  })

  it('rejects protected paths and traversal before any native write', async () => {
    const { workspace, filesystem } = fixture()
    for (const path of ['input/file.txt', 'artifacts/file.txt', '../file.txt']) {
      await expect(
        workspace.commit('session', { [path]: { base64: textToBase64('new') } }, new AbortController().signal)
      ).rejects.toThrow()
    }
    expect(filesystem.writeFile).not.toHaveBeenCalled()
  })

  it('rejects an aborted commit without modifying files', async () => {
    const { workspace, filesystem } = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(
      workspace.commit('session', { 'output.txt': { base64: textToBase64('new') } }, controller.signal)
    ).rejects.toThrow()
    expect(filesystem.writeFile).not.toHaveBeenCalled()
  })

  it('delivers a self-contained HTML snapshot which survives source edits', async () => {
    const { workspace } = fixture()
    await workspace.write(
      'session',
      'site/index.html',
      textToBase64('<html><head><link rel="stylesheet" href="style.css"></head><body>Report</body></html>')
    )
    await workspace.write('session', 'site/style.css', textToBase64('body{color:red}'))
    const artifact = await workspace.deliver('session', 'site/index.html')
    await workspace.write('session', 'site/style.css', textToBase64('body{color:blue}'))
    expect(await workspace.readText('session', artifact.path)).toContain('color:red')
    expect(artifact.mimeType).toBe('text/html')
  })

  it('exports only local images through Cache and supports cleanup', async () => {
    const { workspace, filesystem } = fixture()
    await workspace.write('session', 'chart.png', btoa('image'))
    const exported = await workspace.preparePhotoExport('session', 'chart.png')
    expect(exported.uri).toContain(Directory.Cache)
    expect(filesystem.writeFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ directory: Directory.Cache, data: btoa('image') })
    )
    await exported.cleanup()
    expect(filesystem.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ directory: Directory.Cache }))
    await expect(workspace.preparePhotoExport('session', '../chart.png')).rejects.toThrow()
  })
})
