import { isPdfFilePath } from '@shared/file-extensions'
import {
  LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR,
  NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES,
} from '@shared/file-parse-errors'
import { throwIfWorkAborted } from '@shared/mobile-work/abort'
import {
  isLocalDocument,
  isWorkDocument,
  MAX_PARSED_DOCUMENT_TEXT,
  type ParsedLocalDocument,
  type WorkDocumentParser,
} from '@shared/mobile-work/document-parser'
import { MAX_WORKSPACE_FILE_BYTES } from '@shared/mobile-work/workspace-path'
import i18n from '@/i18n'
import { parsePdfFileLocally } from '@/packages/pdf-parser'
import { uploadAndParseUserFile } from '@/packages/remote'
import * as settingActions from '@/stores/settingActions'
import { confirmWorkAction } from './confirmation'
import { capacitorExecution } from './execution-service'

function boundText(text: string): ParsedLocalDocument {
  return { text: text.slice(0, MAX_PARSED_DOCUMENT_TEXT), truncated: text.length > MAX_PARSED_DOCUMENT_TEXT }
}

function fileSizeError(): Error {
  return new Error(String(i18n.t('Work Mode attachments must be {{limit}} or smaller.', { limit: '10 MB' })))
}

function workspaceDocument(name: string, base64: string): File {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  if (bytes.length > MAX_WORKSPACE_FILE_BYTES) throw fileSizeError()
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  const filename =
    name
      .replace(/^input\/[a-f0-9]{1,80}-/i, '')
      .split('/')
      .pop() ?? name
  return new File([bytes], filename, { type: types[extension] })
}

export const capacitorDocumentParser: WorkDocumentParser = {
  async parse(name, base64, signal) {
    throwIfWorkAborted(signal)
    if (!isWorkDocument(name))
      throw new Error(
        String(
          i18n.t(
            'Document parsing supports PDF, Word (.doc/.docx), Excel (.xls/.xlsx), and PowerPoint (.ppt/.pptx) files.'
          )
        )
      )
    const file = workspaceDocument(name, base64)
    try {
      const parsed = isLocalDocument(name)
        ? await capacitorExecution.parseDocument(name, base64, signal)
        : isPdfFilePath(name)
          ? boundText(await parsePdfFileLocally(file, { signal, failOnPageError: true }))
          : undefined
      throwIfWorkAborted(signal)
      if (parsed?.text.trim()) return parsed
    } catch (error) {
      throwIfWorkAborted(signal)
      if (error instanceof Error && NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES.has(error.message)) {
        if (error.message === LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR)
          throw new Error(
            String(
              i18n.t(
                'This PDF is password-protected, so its content cannot be read. Remove the password and upload it again.'
              )
            )
          )
        throw fileSizeError()
      }
    }

    const licenseKey = settingActions.getLicenseKey()
    if (!licenseKey)
      throw new Error(String(i18n.t('Sign in to Chatbox AI or activate a license to use cloud document parsing.')))
    const allowed = await confirmWorkAction(
      {
        title: i18n.t('Cloud document parsing'),
        message: i18n.t(
          'Upload the original file "{{filename}}" to Chatbox AI for document parsing? This consumes compute points. The extracted text will be available to the model in this conversation.',
          { filename: file.name }
        ),
        confirmText: String(i18n.t('Upload and parse')),
        cancelText: String(i18n.t('Cancel')),
      },
      signal
    )
    throwIfWorkAborted(signal)
    if (!allowed)
      throw new Error(String(i18n.t('Cloud document parsing was declined. The file has not been uploaded.')))
    const text = await uploadAndParseUserFile(licenseKey, file, signal)
    throwIfWorkAborted(signal)
    if (!text.trim()) throw new Error(String(i18n.t('No readable text was found in this file.')))
    return boundText(text)
  },
}
