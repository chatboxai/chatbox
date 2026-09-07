import type { MessageFile, MessageLink } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'
import * as toastActions from '@/stores/toastActions'
import { MessageAttachment } from '../InputBox/Attachments'

const COLLAPSED_MAX = 4

interface MessageAttachmentGridProps {
  files?: MessageFile[]
  links?: MessageLink[]
  align?: 'start' | 'end'
}

export function MessageAttachmentGrid({ files, links, align = 'start' }: MessageAttachmentGridProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [recoveringIds, setRecoveringIds] = useState<number[]>([])
  const recoveringIdsRef = useRef(new Set<number>())

  const fileItems = files ?? []
  const linkItems = links ?? []
  const sessionAttachmentIds = useMemo(
    () =>
      Array.from(
        new Set(fileItems.flatMap((file) => (file.sessionAttachmentId ? [file.sessionAttachmentId] : [])))
      ).sort((a, b) => a - b),
    [fileItems]
  )
  const { data: sessionAttachments, refetch: refetchSessionAttachments } = useQuery({
    queryKey: ['session-attachment-rag-attachments', ...sessionAttachmentIds],
    queryFn: () => {
      if (!platform.isDesktopLike || sessionAttachmentIds.length === 0) {
        return []
      }
      return platform.getSessionAttachmentRagController().getAttachments(sessionAttachmentIds)
    },
    enabled: platform.isDesktopLike && sessionAttachmentIds.length > 0,
    staleTime: 3000,
    refetchInterval: (query) => {
      const attachments = query.state.data ?? []
      return attachments.some((attachment) => attachment.status === 'pending' || attachment.status === 'indexing')
        ? 3000
        : false
    },
    networkMode: 'always',
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always',
  })
  const attachmentStatusMap = new Map(sessionAttachments?.map((attachment) => [attachment.id, attachment.status]) ?? [])
  const attachmentAvailabilityMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.availability]) ?? []
  )
  const attachmentIndexStatusMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.indexStatus]) ?? []
  )
  const attachmentChunkCountMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.chunkCount ?? 0]) ?? []
  )
  const attachmentTotalChunksMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.totalChunks ?? 0]) ?? []
  )
  const attachmentEmbeddedChunksMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.embeddedChunks ?? 0]) ?? []
  )
  const attachmentIndexingStageMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.indexingStage]) ?? []
  )
  const attachmentProcessingStartedAtMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.processingStartedAt]) ?? []
  )
  const attachmentErrorMap = new Map(sessionAttachments?.map((attachment) => [attachment.id, attachment.error]) ?? [])
  const attachmentResumableMap = new Map(
    sessionAttachments?.map((attachment) => [attachment.id, attachment.resumable]) ?? []
  )
  const totalCount = fileItems.length + linkItems.length

  if (totalCount === 0) return null

  const shouldCollapse = totalCount > COLLAPSED_MAX
  const visibleFileCount = shouldCollapse && !expanded ? Math.min(fileItems.length, COLLAPSED_MAX) : fileItems.length
  const remainingSlots = shouldCollapse && !expanded ? COLLAPSED_MAX - visibleFileCount : linkItems.length
  const visibleLinkCount = Math.max(0, Math.min(linkItems.length, remainingSlots))
  const visibleTotalCount = visibleFileCount + visibleLinkCount
  const shouldRightAlignLastItem = align === 'end' && visibleTotalCount % 2 === 1 && visibleTotalCount > 1

  const recoverAttachment = async (attachmentId: number) => {
    if (!platform.isDesktopLike || recoveringIdsRef.current.has(attachmentId)) {
      return
    }
    recoveringIdsRef.current.add(attachmentId)
    setRecoveringIds((prev) => [...prev, attachmentId])
    try {
      await platform.getSessionAttachmentRagController().retryAttachment(attachmentId)
      toastActions.add(t('Queued'))
      await refetchSessionAttachments()
    } catch (error) {
      toastActions.add(`${t('Failed')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      recoveringIdsRef.current.delete(attachmentId)
      setRecoveringIds((prev) => prev.filter((id) => id !== attachmentId))
    }
  }

  return (
    <div className={align === 'end' ? 'mt-1 mb-1 max-w-[500px] w-fit ml-auto' : 'mt-1 mb-1 max-w-[500px]'}>
      <div
        className={['grid gap-1.5', align === 'end' && visibleTotalCount === 1 ? 'grid-cols-1' : 'grid-cols-2'].join(
          ' '
        )}
      >
        {fileItems.slice(0, visibleFileCount).map((file, index) => {
          const attachmentId = file.sessionAttachmentId
          const attachmentStatus = attachmentId
            ? (attachmentStatusMap.get(attachmentId) ?? file.sessionAttachmentStatus)
            : file.sessionAttachmentStatus
          const resumable = attachmentId ? attachmentResumableMap.get(attachmentId) : undefined
          const recoveryAction =
            attachmentStatus === 'failed' && resumable !== undefined ? (resumable ? 'continue' : 'retry') : undefined
          return (
            <div
              key={file.id}
              className={[
                'group/attachment min-w-0 overflow-hidden',
                shouldRightAlignLastItem && index === visibleTotalCount - 1 ? 'col-start-2' : '',
              ].join(' ')}
            >
              <MessageAttachment
                label={file.name}
                filename={file.name}
                fileType={file.fileType}
                byteLength={file.byteLength}
                parserType={file.parserType}
                storageKey={file.storageKey}
                ragMode={file.ragMode}
                sessionAttachmentAvailability={
                  file.sessionAttachmentId
                    ? (attachmentAvailabilityMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentAvailability)
                    : file.sessionAttachmentAvailability
                }
                sessionAttachmentIndexStatus={
                  file.sessionAttachmentId
                    ? (attachmentIndexStatusMap.get(file.sessionAttachmentId) ??
                      file.sessionAttachmentIndexStatus ??
                      file.sessionAttachmentStatus)
                    : (file.sessionAttachmentIndexStatus ?? file.sessionAttachmentStatus)
                }
                sessionAttachmentBlockedReason={file.sessionAttachmentBlockedReason}
                sessionAttachmentStatus={
                  file.sessionAttachmentId
                    ? (attachmentStatusMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentStatus)
                    : file.sessionAttachmentStatus
                }
                sessionAttachmentChunkCount={
                  file.sessionAttachmentId ? attachmentChunkCountMap.get(file.sessionAttachmentId) : undefined
                }
                sessionAttachmentTotalChunks={
                  file.sessionAttachmentId
                    ? (attachmentTotalChunksMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentTotalChunks)
                    : file.sessionAttachmentTotalChunks
                }
                sessionAttachmentEmbeddedChunks={
                  file.sessionAttachmentId
                    ? (attachmentEmbeddedChunksMap.get(file.sessionAttachmentId) ??
                      file.sessionAttachmentEmbeddedChunks)
                    : file.sessionAttachmentEmbeddedChunks
                }
                sessionAttachmentIndexingStage={
                  file.sessionAttachmentId
                    ? (attachmentIndexingStageMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentIndexingStage)
                    : file.sessionAttachmentIndexingStage
                }
                sessionAttachmentProcessingStartedAt={
                  file.sessionAttachmentId ? attachmentProcessingStartedAtMap.get(file.sessionAttachmentId) : undefined
                }
                sessionAttachmentError={
                  file.sessionAttachmentId ? attachmentErrorMap.get(file.sessionAttachmentId) : undefined
                }
                recoveryAction={recoveryAction}
                onRecover={attachmentId && recoveryAction ? () => recoverAttachment(attachmentId) : undefined}
                recovering={attachmentId ? recoveringIds.includes(attachmentId) : false}
              />
            </div>
          )
        })}
        {linkItems.slice(0, visibleLinkCount).map((link, index) => {
          const overallIndex = visibleFileCount + index
          return (
            <div
              key={link.id}
              className={[
                'group/attachment min-w-0 overflow-hidden',
                shouldRightAlignLastItem && overallIndex === visibleTotalCount - 1 ? 'col-start-2' : '',
              ].join(' ')}
            >
              <MessageAttachment
                label={link.title}
                url={link.url}
                byteLength={link.byteLength}
                storageKey={link.storageKey}
              />
            </div>
          )
        })}
      </div>
      {shouldCollapse && (
        <button
          type="button"
          className="flex items-center gap-1 mt-1 ml-auto px-2 py-0.5 text-xs text-chatbox-tertiary hover:text-chatbox-secondary bg-transparent border-0 cursor-pointer transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              {t('Collapse attachments')}
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              {t('Show all attachments')} ({totalCount})
            </>
          )}
        </button>
      )}
    </div>
  )
}
