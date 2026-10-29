export interface ParsedLocalDocument {
  text: string
  truncated: boolean
}

export interface WorkDocumentParser {
  parse(name: string, base64: string, signal: AbortSignal): Promise<ParsedLocalDocument>
}

export const WORK_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

export function isWorkDocument(name: string): boolean {
  return WORK_DOCUMENT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
}

export function isLocalDocument(name: string): boolean {
  return /\.(docx|xlsx|pptx)$/i.test(name)
}

export const MAX_PARSED_DOCUMENT_TEXT = 100_000
