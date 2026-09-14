import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readOfficeArchive, readPresentationText, readWordText } from './office-text'

const archive = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))

describe('local Office text reading', () => {
  it('reads Word paragraphs and table text with XML entities decoded', () => {
    const bytes = archive({
      'word/document.xml':
        '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>A &amp; B</w:t></w:r><w:r><w:t>中文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    })
    expect(readWordText(bytes)).toEqual({ text: 'A & B中文\n42' })
  })
  it('preserves tabs and explicit line breaks with alternate XML prefixes', () => {
    const bytes = archive({
      'word/document.xml':
        '<word:document xmlns:word="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><word:body><word:p><word:r><word:t>Name</word:t><word:tab/><word:t>10</word:t><word:br/><word:t>20</word:t></word:r></word:p></word:body></word:document>',
    })
    expect(readWordText(bytes)).toEqual({ text: 'Name\t10\n20' })
  })
  it('uses presentation relationship order, not archive names', () => {
    const bytes = archive({
      'ppt/presentation.xml':
        '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<pkg:Relationships xmlns:pkg="urn:relationships"><pkg:Relationship Id="r1" Target="slides/slide1.xml"/><pkg:Relationship Id="r2" Target="slides/slide2.xml"/></pkg:Relationships>',
      'ppt/slides/slide1.xml': '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>',
    })
    expect(readPresentationText(bytes)).toEqual({
      slides: [
        { slide: 1, text: 'Second' },
        { slide: 2, text: 'First' },
      ],
    })
  })
  it('rejects missing document data and entity declarations', () => {
    expect(() => readWordText(archive({ 'other.xml': '<root/>' }))).toThrow('Missing')
    expect(() =>
      readWordText(archive({ 'word/document.xml': '<!DOCTYPE w [<!ENTITY x SYSTEM "https://example.org">]><w/>' }))
    ).toThrow('unsupported')
  })
  it('bounds expanded entries even when not selected', () => {
    expect(() => readOfficeArchive(archive({ 'unused.xml': 'x'.repeat(16 * 1024 * 1024 + 1) }), () => false)).toThrow(
      'memory limits'
    )
  })
  it('rejects oversized extracted text', () => {
    expect(() =>
      readWordText(
        archive({ 'word/document.xml': `<w:document><w:p><w:t>${'x'.repeat(100001)}</w:t></w:p></w:document>` })
      )
    ).toThrow('100000')
  })
})
