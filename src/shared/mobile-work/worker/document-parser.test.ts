import ExcelJS from 'exceljs'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseLocalDocument } from './document-parser'
import { encodeBase64 } from './files'
import { runRequest } from './runtime'

function docx(text: string) {
  return zipSync({
    'word/document.xml': new TextEncoder().encode(
      `<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
  })
}

describe('local document parsing', () => {
  it('extracts Word text through a parsing job without executing supplied code', async () => {
    const result = await runRequest({
      id: 'parse',
      code: 'throw new Error("must not execute")',
      documentName: 'report.DOCX',
      files: { document: { base64: encodeBase64(docx('Report 42')) } },
    })
    expect(result.result).toEqual({ stdout: '', files: {}, parsed: { text: 'Report 42', truncated: false } })
  })
  it('keeps worksheet boundaries and cached cell values and reports bounded text truncation', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Sales').addRow(['A', 42, { formula: '21*2', result: 42 }])
    workbook.addWorksheet('Details').addRow(['x'.repeat(60000), 'y'.repeat(60000)])
    const parsed = await parseLocalDocument('data.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()))
    expect(parsed.text).toContain('Sheet: Sales\n["A",42,"42"]')
    expect(parsed.text).toContain('Sheet: Details')
    expect(parsed.text.length).toBe(100000)
    expect(parsed.truncated).toBe(true)
  })
  it('truncates long Word and presentation text while preserving small previews', async () => {
    const word = await parseLocalDocument('large.docx', docx('x'.repeat(120000)))
    expect(word).toEqual({ text: 'x'.repeat(100000), truncated: true })
    const slideXml = `<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>${'y'.repeat(120000)}</a:t></a:r></a:p></p:sld>`
    const pptx = zipSync(
      Object.fromEntries(
        Object.entries({
          'ppt/presentation.xml':
            '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
          'ppt/_rels/presentation.xml.rels':
            '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>',
          'ppt/slides/slide1.xml': slideXml,
        }).map(([name, text]) => [name, new TextEncoder().encode(text)])
      )
    )
    const presentation = await parseLocalDocument('large.pptx', pptx)
    expect(presentation.truncated).toBe(true)
    expect(presentation.text).toHaveLength(100000)
    expect(presentation.text.startsWith('Slide 1\n')).toBe(true)
  })
  it('rejects unsupported and malformed documents without network fallback', async () => {
    await expect(parseLocalDocument('data.pdf', new Uint8Array())).rejects.toThrow('DOCX')
    await expect(parseLocalDocument('data.docx', new Uint8Array([0]))).rejects.toThrow('archive')
    await expect(parseLocalDocument('data.docx', new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toThrow('10 MB')
  })
})
