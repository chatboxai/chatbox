import { describe, expect, it } from 'vitest'
import { isPreviewableWorkArtifact, workArtifactBadgeLabel, workArtifactKind } from './work-artifacts'

describe('work artifact presentation', () => {
  it('classifies files by extension', () => {
    expect(workArtifactKind('artifacts/run/2026-Q3-复盘-final.HTML')).toBe('web')
    expect(workArtifactKind('数据明细.xlsx')).toBe('spreadsheet')
    expect(workArtifactKind('cover.png')).toBe('image')
    expect(workArtifactKind('notes.md')).toBe('document')
    expect(workArtifactKind('README')).toBe('other')
    expect(workArtifactKind('.env')).toBe('other')
  })

  it('labels the badge only with short extensions', () => {
    expect(workArtifactBadgeLabel('report.html')).toBe('HTML')
    expect(workArtifactBadgeLabel('archive.tar.gz')).toBe('GZ')
    expect(workArtifactBadgeLabel('diagram.drawio')).toBe('')
    expect(workArtifactBadgeLabel('README')).toBe('')
  })

  it('previews only HTML files', () => {
    expect(isPreviewableWorkArtifact({ path: 'artifacts/run/index.htm' })).toBe(true)
    expect(isPreviewableWorkArtifact({ path: 'artifacts/run/data.csv' })).toBe(false)
  })
})
