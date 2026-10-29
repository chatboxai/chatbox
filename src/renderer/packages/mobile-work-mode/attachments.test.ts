import type { PickedAsset } from '@chatbox/core/application/attachments'
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_WORK_ATTACHMENT_MAX_BYTES, prepareLocalWorkAttachment } from './attachments'

const asset: PickedAsset = {
  id: 'file:1',
  name: 'table.xlsx',
  uri: 'table.xlsx',
  size: 10,
  mimeType: 'application/octet-stream',
}

describe('local work attachment preparation', () => {
  it.each([
    'letter.docx',
    'table.xlsx',
    'report.pptx',
    'index.html',
    'sales.csv',
    'report.PDF',
    'letter.doc',
    'table.xls',
    'deck.ppt',
  ])('stores original bytes and a compact reference for %s', async (name) => {
    const read = vi.fn().mockResolvedValue('data:application/octet-stream;base64,YWJj')
    const write = vi.fn().mockResolvedValue(undefined)
    const result = await prepareLocalWorkAttachment({ ...asset, name }, read, write)
    expect(result.rawStorageKey).toBe('file:1:local-workspace_raw')
    expect(result.content).toBe(`Local workspace file: ${name}`)
    expect(result.parserType).toBe('local-workspace')
    expect(write).toHaveBeenCalledWith(result.rawStorageKey, 'data:application/octet-stream;base64,YWJj')
    expect(result.storageKey).not.toBe(asset.id)
  })
  it.each(['archive.zip', 'script.exe'])(
    'rejects unsupported input %s before reading or storing bytes',
    async (name) => {
      const read = vi.fn()
      const write = vi.fn()
      await expect(prepareLocalWorkAttachment({ ...asset, name }, read, write)).rejects.toThrow('Work Mode supports')
      expect(read).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    }
  )
  it('rejects files above the workspace per-file quota', async () => {
    const read = vi.fn()
    await expect(
      prepareLocalWorkAttachment({ ...asset, size: LOCAL_WORK_ATTACHMENT_MAX_BYTES + 1 }, read, vi.fn())
    ).rejects.toThrow('10 MB')
    expect(read).not.toHaveBeenCalled()
  })
})
