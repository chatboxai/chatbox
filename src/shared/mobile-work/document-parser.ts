export interface ParsedLocalDocument {
  text: string
  truncated: boolean
}

export function isLocalDocument(name: string): boolean {
  return /\.(docx|xlsx|pptx)$/i.test(name)
}

export const MAX_PARSED_DOCUMENT_TEXT = 100_000
