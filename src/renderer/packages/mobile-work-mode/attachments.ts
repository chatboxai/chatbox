import type { PickedAsset, PreparedAttachment } from '@chatbox/core/application/attachments'
import i18n from '@/i18n'
import { isTextFilePath, textExts } from '@shared/file-extensions'
import { isWorkDocument, WORK_DOCUMENT_EXTENSIONS } from '@shared/mobile-work/document-parser'

export const LOCAL_WORK_ATTACHMENT_ACCEPT = [...textExts, ...WORK_DOCUMENT_EXTENSIONS].join(',')

export const LOCAL_WORK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

export function isLocalWorkAttachment(name: string): boolean {
  return isTextFilePath(name) || isWorkDocument(name)
}

export async function prepareLocalWorkAttachment(
  asset: PickedAsset,
  readDataUrl: () => Promise<string>,
  setBlob: (key: string, value: string) => Promise<void>
): Promise<PreparedAttachment> {
  if (asset.size > LOCAL_WORK_ATTACHMENT_MAX_BYTES)
    throw new Error(String(i18n.t('Work Mode attachments must be {{limit}} or smaller.', { limit: '10 MB' })))
  if (!isLocalWorkAttachment(asset.name))
    throw new Error(
      String(
        i18n.t(
          'Work Mode supports text, PDF, Word (.doc/.docx), Excel (.xls/.xlsx), and PowerPoint (.ppt/.pptx) files.'
        )
      )
    )
  const storageKey = `${asset.id}:local-workspace`
  const rawStorageKey = `${storageKey}_raw`
  const content = `Local workspace file: ${asset.name}`
  await setBlob(rawStorageKey, await readDataUrl())
  await setBlob(storageKey, content)
  return {
    asset,
    storageKey,
    rawStorageKey,
    content,
    parserType: 'local-workspace',
    ragMode: 'inline',
    byteLength: asset.size,
    tokenCountMap: {},
    sessionAttachmentAvailability: 'allowed',
  }
}
