import { describe, expect, test } from 'vitest'
import {
  ATTACHMENT_SEED_MANIFEST_NAME,
  classifyAttachmentSeedWrite,
  isAttachmentSeedManifestName,
  normalizeAttachmentSeedKey,
  parseAttachmentSeedManifest,
} from './attachment-seed'

describe('attachment seed helpers', () => {
  test('recognizes the seed manifest name, including Windows stream aliases', () => {
    expect(isAttachmentSeedManifestName(ATTACHMENT_SEED_MANIFEST_NAME)).toBe(true)
    expect(isAttachmentSeedManifestName(`${ATTACHMENT_SEED_MANIFEST_NAME}::$DATA`)).toBe(true)
    expect(isAttachmentSeedManifestName('report.html')).toBe(false)
  })

  test('parses a valid manifest and drops traversal or non-string entries', () => {
    expect(
      parseAttachmentSeedManifest(
        JSON.stringify({
          'report.html': 'blob-1',
          '../escape': 'blob-2',
          [ATTACHMENT_SEED_MANIFEST_NAME]: 'blob-3',
          nested: 4,
        })
      )
    ).toEqual({ 'report.html': 'blob-1' })
    expect(parseAttachmentSeedManifest('not-json')).toEqual({})
    expect(parseAttachmentSeedManifest('[]')).toEqual({})
  })

  test('keeps an existing sandbox file and relocates a different same-named upload', () => {
    expect(classifyAttachmentSeedWrite(false, undefined, 'blob-1')).toBe('write')
    expect(classifyAttachmentSeedWrite(true, 'blob-1', 'blob-1')).toBe('skip')
    expect(classifyAttachmentSeedWrite(true, undefined, 'blob-1')).toBe('reconcile')
    expect(classifyAttachmentSeedWrite(true, 'blob-old', 'blob-new')).toBe('relocate')
  })

  test('normalizes manifest keys per host filesystem semantics', () => {
    const posix = { caseInsensitive: false, stripTrailingDotsAndSpaces: false }
    const macOs = { caseInsensitive: true, stripTrailingDotsAndSpaces: false }
    const windows = { caseInsensitive: true, stripTrailingDotsAndSpaces: true }
    expect(normalizeAttachmentSeedKey('Report.TXT', posix)).toBe('Report.TXT')
    expect(normalizeAttachmentSeedKey('Report.TXT', macOs)).toBe('report.txt')
    expect(normalizeAttachmentSeedKey('dir.Name/Report.txt. ', windows)).toBe('dir.name/report.txt')
    expect(normalizeAttachmentSeedKey('report.txt.', posix)).toBe('report.txt.')
  })
})
