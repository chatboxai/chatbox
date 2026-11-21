import { describe, expect, it } from 'vitest'
import { decideSyncAction } from './strategy'

const baseline = { selectionKey: '1110', localFingerprint: 'local-1', cloudRevision: 'cloud-1' }

describe('sync conflict strategy', () => {
  it('lets an explicit synchronization selection change rebuild the cloud snapshot', () => {
    expect(
      decideSyncAction({ baseline, selectionKey: '1000', localFingerprint: 'local-2', cloudRevision: 'cloud-2' })
    ).toBe('upload-local')
  })

  it('uses the cloud snapshot on first synchronization', () => {
    expect(decideSyncAction({ selectionKey: '1110', localFingerprint: 'local-1', cloudRevision: 'cloud-1' })).toBe(
      'replace-local-from-cloud'
    )
  })

  it('uses cloud data when both sides changed', () => {
    expect(
      decideSyncAction({ baseline, selectionKey: '1110', localFingerprint: 'local-2', cloudRevision: 'cloud-2' })
    ).toBe('replace-local-from-cloud')
  })

  it('uploads a local-only change', () => {
    expect(
      decideSyncAction({ baseline, selectionKey: '1110', localFingerprint: 'local-2', cloudRevision: 'cloud-1' })
    ).toBe('upload-local')
  })

  it('does nothing when neither side changed', () => {
    expect(
      decideSyncAction({ baseline, selectionKey: '1110', localFingerprint: 'local-1', cloudRevision: 'cloud-1' })
    ).toBe('none')
  })
})
