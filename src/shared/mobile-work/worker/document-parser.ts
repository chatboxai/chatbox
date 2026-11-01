import { MAX_PARSED_DOCUMENT_TEXT, type ParsedLocalDocument } from '../document-parser'

/** Extract content only; scripts and document generation are not initialized. */
export async function parseLocalDocument(name: string, bytes: Uint8Array): Promise<ParsedLocalDocument> {
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Document exceeds the 10 MB local parsing limit')
  let text: string
  if (/\.docx$/i.test(name)) {
    const { readWordText } = await import('./office-text')
    text = readWordText(bytes, true).text
  } else if (/\.pptx$/i.test(name)) {
    const { readPresentationText } = await import('./office-text')
    text = readPresentationText(bytes, true)
      .slides.map((slide) => `Slide ${slide.slide}\n${slide.text}`)
      .join('\n\n')
  } else if (/\.xlsx$/i.test(name)) {
    const { readSpreadsheet } = await import('./spreadsheet-reader')
    const workbook = await readSpreadsheet(bytes)
    text = workbook.sheets
      .map((sheet) => `Sheet: ${sheet.name}\n${sheet.rows.map((row) => JSON.stringify(row)).join('\n')}`)
      .join('\n\n')
  } else throw new Error('Local document parsing supports DOCX, XLSX, and PPTX')
  const truncated = text.length > MAX_PARSED_DOCUMENT_TEXT
  return { text: text.slice(0, MAX_PARSED_DOCUMENT_TEXT), truncated }
}
