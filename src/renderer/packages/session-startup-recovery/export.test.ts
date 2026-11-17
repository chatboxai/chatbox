import { beforeEach, expect, it, vi } from 'vitest'
import { exportPreMigrationSession } from './export'
const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  readExportCommit: vi.fn(),
  getStoreValue: vi.fn(),
  exportTextFile: vi.fn(),
}))
vi.mock('@/platform', () => ({
  default: {
    getSessionRowStore: () => mocks,
    getStoreValue: mocks.getStoreValue,
    exporter: { exportTextFile: mocks.exportTextFile },
  },
}))
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { session: (id: string) => `session:${id}` } }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.readExportCommit.mockResolvedValue(null)
})
it('exports invalid legacy data intact without migration or schema validation', async () => {
  const source = { id: 's', name: 'Original', messages: [{ id: 'm', unexpected: 'preserve me' }], extension: 42 }
  mocks.getStoreValue.mockResolvedValue(source)
  await expect(exportPreMigrationSession('s')).resolves.toBe('exported')
  expect(mocks.getStoreValue).toHaveBeenCalledWith('session:s')
  expect(mocks.exportTextFile).toHaveBeenCalledWith('chatbox-recovery-s.json', JSON.stringify(source, null, 2))
})
it('does not export stale input when rows are authoritative', async () => {
  mocks.readExportCommit.mockResolvedValue({ revision: 2 })
  await expect(exportPreMigrationSession('s')).resolves.toBe('unavailable')
  expect(mocks.getStoreValue).not.toHaveBeenCalled()
  expect(mocks.exportTextFile).not.toHaveBeenCalled()
})
it('does not export input published while the record was being read', async () => {
  mocks.readExportCommit.mockResolvedValueOnce(null).mockResolvedValueOnce({ revision: 1 })
  mocks.getStoreValue.mockResolvedValue({ id: 's' })
  await expect(exportPreMigrationSession('s')).resolves.toBe('unavailable')
  expect(mocks.exportTextFile).not.toHaveBeenCalled()
})
it.each([null, 'invalid', { id: 'another-session' }])('reports unavailable source: %j', async (source) => {
  mocks.getStoreValue.mockResolvedValue(source)
  await expect(exportPreMigrationSession('s')).resolves.toBe('unavailable')
  expect(mocks.exportTextFile).not.toHaveBeenCalled()
})
it('propagates read and export failures', async () => {
  mocks.getStoreValue.mockRejectedValueOnce(new Error('read failed'))
  await expect(exportPreMigrationSession('s')).rejects.toThrow('read failed')
  mocks.getStoreValue.mockResolvedValue({ id: 's' })
  mocks.exportTextFile.mockRejectedValue(new Error('save failed'))
  await expect(exportPreMigrationSession('s')).rejects.toThrow('save failed')
})
