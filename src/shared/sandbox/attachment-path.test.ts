import { describe, expect, test } from 'vitest'
import {
  SANDBOX_ATTACHMENT_DIR,
  sandboxAttachmentFingerprint,
  sandboxAttachmentIdentity,
  sandboxAttachmentParsedRelPath,
  sandboxAttachmentRelPath,
  sanitizeSandboxAttachmentFileName,
  toSandboxSeedAttachment,
} from './attachment-path'

describe('sandbox attachment paths', () => {
  test('identity prefers the raw blob, then the parsed blob, then the file id', () => {
    expect(sandboxAttachmentIdentity({ rawStorageKey: 'raw', storageKey: 'parsed', id: 'id' })).toBe('raw')
    expect(sandboxAttachmentIdentity({ storageKey: 'parsed', id: 'id' })).toBe('parsed')
    expect(sandboxAttachmentIdentity({ id: 'id' })).toBe('id')
    expect(sandboxAttachmentIdentity({})).toBe('')
  })

  test('fingerprint is stable and differs across identities', () => {
    expect(sandboxAttachmentFingerprint('raw-a')).toBe(sandboxAttachmentFingerprint('raw-a'))
    expect(sandboxAttachmentFingerprint('raw-a')).not.toBe(sandboxAttachmentFingerprint('raw-b'))
    expect(sandboxAttachmentFingerprint('raw-a')).toMatch(/^[0-9a-f]{12}$/)
  })

  test('same display name maps to distinct destinations per identity', () => {
    const a = sandboxAttachmentRelPath('report.html', 'raw-a')
    const b = sandboxAttachmentRelPath('report.html', 'raw-b')
    expect(a).toMatch(new RegExp(`^${SANDBOX_ATTACHMENT_DIR}/[0-9a-f]{12}/report\\.html$`))
    expect(b).toMatch(new RegExp(`^${SANDBOX_ATTACHMENT_DIR}/[0-9a-f]{12}/report\\.html$`))
    expect(a).not.toBe(b)
    expect(sandboxAttachmentParsedRelPath(a)).toBe(`${a}_parsed.txt`)
  })

  test('falls back to the basename when there is no identity', () => {
    expect(sandboxAttachmentRelPath('report.html', '')).toBe('report.html')
  })

  test('strips path segments and control characters from the display name', () => {
    expect(sanitizeSandboxAttachmentFileName('foo/../report.html')).toBe('report.html')
    expect(sanitizeSandboxAttachmentFileName('dir\\report.html')).toBe('report.html')
    expect(sanitizeSandboxAttachmentFileName('..\n')).toBe('file')
    expect(sandboxAttachmentRelPath('docs/budget.xlsx', 'key-1')).toBe(
      `${SANDBOX_ATTACHMENT_DIR}/${sandboxAttachmentFingerprint('key-1')}/budget.xlsx`
    )
  })

  test('toSandboxSeedAttachment fills a missing storage key', () => {
    expect(toSandboxSeedAttachment({ name: 'a.txt', id: 'id-1' })).toEqual({
      name: 'a.txt',
      storageKey: '',
      rawStorageKey: undefined,
      id: 'id-1',
    })
  })
})
