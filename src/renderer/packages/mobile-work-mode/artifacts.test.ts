// @vitest-environment jsdom

import type { WorkArtifact } from '@shared/work-artifacts'
import { describe, expect, it, vi } from 'vitest'
import { localWorkPreviewDocument, readLocalWorkArtifact, shareLocalWorkArtifact } from './artifacts'

const mocks = vi.hoisted(() => ({ getBlob: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), share: vi.fn() }))
vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: { get: mocks.getBlob } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: mocks.writeFile, deleteFile: mocks.deleteFile },
  Directory: { Cache: 'CACHE' },
}))
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }))
const artifact: WorkArtifact = {
  path: 'artifacts/one/report.html',
  name: 'report.html',
  mimeType: 'text/html',
  size: 10,
  storageKey: 'file:work:raw',
}
describe('local work artifacts', () => {
  it('restores delivered file bytes from backup blob references', async () => {
    mocks.getBlob.mockResolvedValue('data:text/html;base64,aGVsbG8=')
    expect(await readLocalWorkArtifact('session', artifact)).toBe('aGVsbG8=')
  })
  it('rejects traversal and invalid base64', async () => {
    await expect(readLocalWorkArtifact('session', { ...artifact, path: 'artifacts/../private' })).rejects.toThrow()
    mocks.getBlob.mockResolvedValue('data:text/html;base64,%%%%')
    await expect(readLocalWorkArtifact('session', artifact)).rejects.toThrow()
  })
  it('applies network and native isolation to static preview documents', () => {
    const html = localWorkPreviewDocument(btoa('<h1>Preview</h1>'))
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("frame-src 'none'")
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).toContain('&lt;h1&gt;Preview&lt;/h1&gt;')
  })
  it('shares a cache file and removes it after the native share sheet completes', async () => {
    mocks.writeFile.mockResolvedValue({ uri: 'file://cache/report.html' })
    mocks.share.mockResolvedValue({})
    mocks.deleteFile.mockResolvedValue({})
    await shareLocalWorkArtifact(artifact, 'aGVsbG8=')
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file://cache/report.html'] }))
    expect(mocks.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ directory: 'CACHE', path: expect.stringMatching(/^work-exports\/[^/]+\/report.html$/) })
    )
  })
})
