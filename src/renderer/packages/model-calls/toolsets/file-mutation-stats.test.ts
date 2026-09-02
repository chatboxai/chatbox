import { describe, expect, it } from 'vitest'
import { buildEditStats, buildWriteStats, getFileMutationDisplayStats } from './file-mutation-stats'

describe('buildEditStats', () => {
  it('counts only changed lines when edits quote surrounding context', () => {
    expect(
      buildEditStats([
        {
          old_text: 'keep\ndrop me\ntail',
          new_text: 'keep\nadded\nmore\ntail',
        },
      ])
    ).toEqual({ mode: 'edit', edits: 1, addedLines: 2, removedLines: 1 })
  })

  it('reports totals across every edit', () => {
    expect(
      buildEditStats([
        { old_text: 'const a = 1', new_text: 'const a = 2' },
        { old_text: 'const b = 1', new_text: 'const b = 2\nconst c = 3' },
      ])
    ).toEqual({ mode: 'edit', edits: 2, addedLines: 3, removedLines: 2 })
  })

  it('counts pure insertions and deletions', () => {
    expect(buildEditStats([{ old_text: 'a\nb', new_text: 'a\nnew\nb' }])).toMatchObject({
      addedLines: 1,
      removedLines: 0,
    })
    expect(buildEditStats([{ old_text: 'a\ngone\nb', new_text: 'a\nb' }])).toMatchObject({
      addedLines: 0,
      removedLines: 1,
    })
  })
})

describe('buildWriteStats', () => {
  it('reports the output line count', () => {
    expect(buildWriteStats('one\ntwo\nthree')).toEqual({ mode: 'write', addedLines: 3, removedLines: 0 })
  })

  it('treats empty content as zero lines', () => {
    expect(buildWriteStats('')).toEqual({ mode: 'write', addedLines: 0, removedLines: 0 })
  })
})

describe('getFileMutationDisplayStats', () => {
  it('derives edit counts from a legacy labeled preview', () => {
    expect(
      getFileMutationDisplayStats({
        title: 'Edit file: /repo/config.ts',
        preview: '# Edit 1\n--- old\nkeep\nold\n+++ new\nkeep\nnew',
      })
    ).toEqual({ mode: 'edit', edits: 1, addedLines: 1, removedLines: 1, approximate: undefined })
  })

  it('derives an approximate write count from a truncated legacy preview', () => {
    expect(
      getFileMutationDisplayStats({
        title: 'Write file: /repo/config.ts',
        preview: 'one\ntwo\n... [truncated]',
      })
    ).toEqual({ mode: 'write', addedLines: 2, removedLines: 0, approximate: true })
  })

  it('prefers persisted stats without examining the legacy preview', () => {
    const stats = { mode: 'edit' as const, edits: 2, addedLines: 3, removedLines: 1 }
    expect(getFileMutationDisplayStats({ title: 'Edit file: x', preview: 'legacy secret', stats })).toEqual(stats)
  })
})
