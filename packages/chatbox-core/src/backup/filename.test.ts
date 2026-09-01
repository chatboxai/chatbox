import { describe, expect, it } from 'vitest'
import { getBackupFilename } from './filename'

describe('getBackupFilename', () => {
  it('uses the local calendar date in the Web-compatible filename', () => {
    expect(getBackupFilename(new Date(2026, 7, 20, 23, 59, 59))).toBe('chatbox-backup-2026-8-20.zip')
  })
})
