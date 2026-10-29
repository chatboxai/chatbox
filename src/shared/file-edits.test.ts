import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { transformWithEsbuild } from 'vite'
import { describe, expect, it } from 'vitest'
import { compactFileEditSummary, summarizeFileEdit } from './file-edit-summary'
import { applyTextEdits } from './file-edits'

describe('file edits', () => {
  it.each([false, true])(
    'serializes the production-minified matcher independently (keepNames=%s)',
    async (keepNames) => {
      const source = await readFile(new URL('./file-edits.ts', import.meta.url), 'utf8')
      const built = await transformWithEsbuild(source, 'file-edits.ts', {
        format: 'cjs',
        target: 'es2020',
        minify: true,
        keepNames,
      })
      const module = { exports: {} as { applyTextEdits: typeof applyTextEdits } }
      runInNewContext(built.code, { module, exports: module.exports })
      const serialized = module.exports.applyTextEdits.toString()
      for (const edits of [
        [{ search: 'alpha\nbeta', replace: 'one\ntwo' }],
        [
          { search: 'alpha', replace: 'changed' },
          { search: 'missing', replace: '' },
        ],
      ]) {
        const content = '\uFEFFalpha\r\nbeta\r\n'
        expect(runInNewContext(`(${serialized})(content, edits)`, { content, edits })).toEqual(
          applyTextEdits(content, edits)
        )
      }
    }
  )
  it('matches LF input while preserving BOM, mixed untouched endings, and trailing whitespace', () => {
    expect(
      applyTextEdits('\uFEFFkeep  \nalpha\r\nbeta\r\ntail', [{ search: 'alpha\nbeta', replace: 'one\ntwo' }])
    ).toEqual({
      success: true,
      content: '\uFEFFkeep  \none\r\ntwo\r\ntail',
    })
  })
  it('does not normalize indentation, quotes or semantic whitespace', () => {
    for (const search of [' x', '“x”', 'x ']) {
      expect(applyTextEdits('x', [{ search, replace: 'y' }])).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    }
  })
  it('rejects overlapping occurrences and returns bounded candidate locations', () => {
    expect(applyTextEdits('aaa', [{ search: 'aa', replace: 'b' }])).toMatchObject({
      success: false,
      matches: 2,
      candidateLines: [1, 1],
    })
    expect(applyTextEdits('x\n'.repeat(20), [{ search: 'x', replace: 'y' }])).toMatchObject({
      success: false,
      matches: 20,
      candidateLines: [1, 2, 3, 4, 5],
    })
  })
  it('retains sequential semantics and rejects a failing later edit as one operation', () => {
    expect(
      applyTextEdits('a', [
        { search: 'a', replace: 'b' },
        { search: 'b', replace: 'c' },
      ])
    ).toEqual({ success: true, content: 'c' })
    expect(
      applyTextEdits('a', [
        { search: 'a', replace: 'b' },
        { search: 'missing', replace: 'c' },
      ])
    ).toMatchObject({ success: false, editIndex: 2, errorCode: 'NOT_FOUND' })
  })
  it('rejects empty searches even in an empty file', () => {
    expect(applyTextEdits('', [{ search: '', replace: 'x' }])).toMatchObject({
      success: false,
      errorCode: 'INVALID_EDIT',
    })
  })
  it('keeps a no-op byte-for-byte unchanged', () => {
    const content = 'a\r\nb\nc'
    expect(applyTextEdits(content, [{ search: content, replace: content }])).toEqual({ success: true, content })
    expect(summarizeFileEdit(content, content, 1)).toMatchObject({ changed: false, addedLines: 0, removedLines: 0 })
  })
  it('reports the actual final change and bounds long previews', () => {
    const result = summarizeFileEdit('a\nkeep\n', 'c\nkeep\n', 2)
    expect(result).toMatchObject({ changed: true, edits: 2, addedLines: 1, removedLines: 1 })
    expect(result.diff).toContain('-a')
    expect(result.diff).toContain('+c')
    const long = summarizeFileEdit('before\n', `${'x'.repeat(9000)}\n`, 1)
    expect(long.diff?.length).toBeLessThanOrEqual(8000)
    expect(long.diffTruncated).toBe(true)
  })
})

describe('diff input budgets', () => {
  it('skips oversized input before allocating a patch', () => {
    expect(summarizeFileEdit('a'.repeat(1_000_001), 'b', 1)).toEqual({
      success: true,
      changed: true,
      edits: 1,
      diffTruncated: true,
    })
    expect(summarizeFileEdit('a\n'.repeat(20_001), 'b', 1).diff).toBeUndefined()
  })
  it('keeps the last preview line complete when a changed line exceeds the budget', () => {
    const result = summarizeFileEdit('old\n', `${'x'.repeat(9000)}\n`, 1)
    expect(result.diffTruncated).toBe(true)
    expect(result.diff).not.toContain('+x')
    expect(result.diff?.endsWith('\n')).toBe(true)
    expect(result.addedLines).toBe(1)
  })
})

it('keeps model result excerpts smaller than approval previews and marks truncation', () => {
  const result = compactFileEditSummary({ success: true, changed: true, edits: 1, diff: '+line\n'.repeat(400) })
  expect(result.diff?.length).toBeLessThanOrEqual(1200)
  expect(result.diff?.endsWith('\n')).toBe(true)
  expect(result.diffTruncated).toBe(true)
})
