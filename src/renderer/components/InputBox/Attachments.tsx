import NiceModal from '@ebay/nice-modal-react'
import { Text, Tooltip } from '@mantine/core'
import { CodedError } from '@shared/models/errors'
import type { SessionAttachmentIndexingStage } from '@shared/types'
import { AlertCircle, CheckCircle, Eye, Link, Link2, Loader2, RotateCw, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isSessionAttachmentRagAuthError,
  isSessionAttachmentRagIndexingError,
  SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR,
} from '@/stores/sessionHelpers'
import MiniButton from '../common/MiniButton'
import FileIcon from '../FileIcon'
import { ImageInStorage } from '../Image'

// 根据错误码获取翻译后的错误消息
function getTranslatedErrorMessage(errorCode: string | undefined, t: (key: string) => string): string | undefined {
  if (!errorCode) return undefined
  if (isSessionAttachmentRagAuthError(errorCode)) {
    return t(
      'Large-file chat indexing is not available in this local-only build. Use Knowledge Base or a smaller file.'
    )
  }
  if (isSessionAttachmentRagIndexingError(errorCode)) {
    return t(
      'Large file indexing failed. Remove this file and try uploading it again. If the problem continues, use a smaller file or Knowledge Base.'
    )
  }
  if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR) {
    return t('This attachment is too large for chat attachments. Please upload it through Knowledge Base instead.')
  }
  if (errorCode === SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR) {
    return t(
      'This document contains too much text for chat attachments. Please upload it through Knowledge Base instead.'
    )
  }
  if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR) {
    return t('Large file Q&A requires a model with tool use support. Switch to a compatible model or remove this file.')
  }
  const errorDetail = CodedError.codeNameMap[errorCode]
  if (errorDetail) {
    // 使用 i18nKey 进行翻译，去掉其中的 HTML 标签以便在 Tooltip 中显示纯文本
    const translated = t(errorDetail.i18nKey)
    // 移除 HTML/JSX 标签，只保留纯文本
    return translated.replace(/<[^>]*>/g, '')
  }
  return t('Processing failed')
}

function getErrorStatusLabel(errorCode: string | undefined, t: (key: string) => string): string {
  if (errorCode === SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR) {
    return t('Too much text')
  }
  if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR) {
    return t('Too large')
  }
  if (isSessionAttachmentRagAuthError(errorCode)) {
    return t('Unavailable')
  }
  if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR) {
    return t('Switch model')
  }
  if (isSessionAttachmentRagIndexingError(errorCode)) {
    return t('Indexing failed')
  }
  return t('Processing failed')
}

export function ImageMiniCard(props: { storageKey: string; onDelete: () => void }) {
  const { storageKey, onDelete } = props
  return (
    <div
      key={storageKey}
      className="w-[100px] h-[100px] p-1 m-1 inline-flex items-center justify-center
                                bg-white shadow-sm rounded-md border-solid border-gray-400/20
                                hover:shadow-lg hover:cursor-pointer hover:scale-105 transition-all duration-200
                                group/image-mini-card"
    >
      <ImageInStorage storageKey={storageKey} />
      {onDelete && (
        <MiniButton
          className="hidden group-hover/image-mini-card:inline-block
                    absolute top-0 right-0 m-1 p-1 rounded-full shadow-lg bg-white/90 dark:bg-gray-800/90 text-red-500 hover:bg-white dark:hover:bg-gray-800"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size="22" strokeWidth={2} />
        </MiniButton>
      )}
    </div>
  )
}

export function FileMiniCard(props: {
  name: string
  fileType: string
  onDelete: () => void
  status?: 'processing' | 'completed' | 'error'
  statusText?: string
  progressValue?: number
  isTakingLong?: boolean
  errorMessage?: string
  onErrorClick?: () => void
  onPreviewClick?: () => void
}) {
  const {
    name,
    onDelete,
    status,
    statusText,
    progressValue,
    isTakingLong,
    errorMessage,
    onErrorClick,
    onPreviewClick,
  } = props
  const { t } = useTranslation()

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (status === 'error' && onErrorClick) {
      onErrorClick()
      return
    }
    if (onPreviewClick) {
      onPreviewClick()
    }
  }

  // 获取翻译后的错误消息
  const translatedError = getTranslatedErrorMessage(errorMessage, t)
  const displayedStatusText = status === 'error' ? getErrorStatusLabel(errorMessage, t) : statusText
  const clampedProgressValue =
    typeof progressValue === 'number' ? Math.max(0, Math.min(100, Math.round(progressValue))) : undefined

  return (
    <div
      className="w-[132px] h-[108px] px-2.5 pt-2 pb-3 m-1 inline-flex items-center justify-center
                                bg-white shadow-sm rounded-md border-solid border-gray-400/20
                                hover:shadow-lg hover:cursor-pointer hover:scale-105 transition-all duration-200
                                group/file-mini-card relative"
      onClick={handleClick}
    >
      <Tooltip
        multiline
        maw={300}
        label={
          status === 'error' && translatedError
            ? translatedError
            : onPreviewClick
              ? t('Click to view parsed content')
              : name
        }
      >
        <div className="flex flex-col justify-center items-center min-w-0 w-full">
          <FileIcon filename={name} className="w-8 h-8 text-black mb-1" />
          <Text truncate className="w-full px-1 text-black text-center" style={{ fontSize: 12, lineHeight: 1.25 }}>
            {name}
          </Text>
          {displayedStatusText && (
            <div className="mt-1 flex items-center justify-center gap-1 w-full min-w-0">
              {status === 'processing' && <Loader2 size="12" className="animate-spin text-blue-500 shrink-0" />}
              <Text
                truncate
                className={
                  status === 'error'
                    ? 'min-w-0 text-red-500 text-center'
                    : isTakingLong
                      ? 'min-w-0 text-amber-600 text-center'
                      : 'min-w-0 text-gray-500 text-center'
                }
                style={{ fontSize: 11, lineHeight: 1.2 }}
              >
                {displayedStatusText}
              </Text>
            </div>
          )}
        </div>
      </Tooltip>

      {/* Status indicator */}
      {status && (
        <div className="absolute top-1.5 left-1.5">
          {status === 'processing' && !statusText && <Loader2 size="16" className="animate-spin text-blue-500" />}
          {status === 'completed' && <CheckCircle size="16" className="text-green-500" />}
          {status === 'error' && <AlertCircle size="16" className="text-red-500" />}
        </div>
      )}
      {status === 'processing' && clampedProgressValue !== undefined && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-blue-100 rounded-b-md overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${clampedProgressValue}%` }} />
        </div>
      )}

      {onDelete && (
        <MiniButton
          className="hidden group-hover/file-mini-card:inline-block
                    absolute top-0 right-0 m-1 p-1 rounded-full shadow-lg text-red-500"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size="18" strokeWidth={2} />
        </MiniButton>
      )}
    </div>
  )
}

function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function getFileTypeLabel(filename: string, fileType?: string): string {
  const ext = filename.split('.').pop()?.toUpperCase()
  if (ext) return ext
  if (fileType) return fileType.split('/').pop()?.toUpperCase() || fileType
  return ''
}

function getIndexingStageLabel(stage: SessionAttachmentIndexingStage | undefined, t: (key: string) => string) {
  switch (stage) {
    case 'queued':
      return t('Queued')
    case 'chunking':
      return t('Preparing')
    case 'embedding':
      return t('Indexing')
    case 'finalizing':
      return t('Finishing')
    case 'ready':
      return t('Indexed')
    default:
      return t('Indexing')
  }
}

function getProgressValue(embeddedChunks?: number, totalChunks?: number): number | undefined {
  if (!totalChunks || totalChunks <= 0 || embeddedChunks === undefined) return undefined
  return Math.max(0, Math.min(100, Math.round((embeddedChunks / totalChunks) * 100)))
}

function isTakingLong(processingStartedAt?: number): boolean {
  return !!processingStartedAt && Date.now() - processingStartedAt > 30000
}

export function MessageAttachment(props: {
  label: string
  filename?: string
  url?: string
  storageKey?: string
  fileType?: string
  byteLength?: number
  ragMode?: 'inline' | 'session-retrieval'
  sessionAttachmentAvailability?: 'allowed' | 'blocked'
  sessionAttachmentIndexStatus?: 'pending' | 'indexing' | 'ready' | 'failed'
  sessionAttachmentBlockedReason?: string
  sessionAttachmentStatus?: 'pending' | 'indexing' | 'ready' | 'failed'
  sessionAttachmentChunkCount?: number
  sessionAttachmentTotalChunks?: number
  sessionAttachmentEmbeddedChunks?: number
  sessionAttachmentIndexingStage?: SessionAttachmentIndexingStage
  sessionAttachmentProcessingStartedAt?: number
  sessionAttachmentError?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  const {
    label,
    filename,
    url,
    storageKey,
    fileType,
    byteLength,
    ragMode,
    sessionAttachmentAvailability,
    sessionAttachmentIndexStatus,
    sessionAttachmentBlockedReason,
    sessionAttachmentStatus,
    sessionAttachmentChunkCount,
    sessionAttachmentTotalChunks,
    sessionAttachmentEmbeddedChunks,
    sessionAttachmentIndexingStage,
    sessionAttachmentProcessingStartedAt,
    sessionAttachmentError,
    onRetry,
    retrying,
  } = props
  const { t } = useTranslation()

  const handleClick = async () => {
    if (storageKey) {
      let title: string
      if (filename) {
        title = `${t('File Content')}: ${filename}`
      } else if (url) {
        const truncatedUrl = url.length > 50 ? `${url.slice(0, 50)}...` : url
        title = `${t('Link Content')}: ${truncatedUrl}`
      } else {
        title = t('Content')
      }
      await NiceModal.show('content-viewer', { title, storageKey })
    }
  }

  const isClickable = !!storageKey
  const typeLabel = filename ? getFileTypeLabel(filename, fileType) : ''
  const sizeLabel = formatFileSize(byteLength)
  const effectiveAvailability = sessionAttachmentAvailability ?? 'allowed'
  const effectiveIndexStatus = sessionAttachmentIndexStatus ?? sessionAttachmentStatus
  const progressValue = getProgressValue(sessionAttachmentEmbeddedChunks, sessionAttachmentTotalChunks)
  const takingLong = effectiveIndexStatus !== 'ready' && isTakingLong(sessionAttachmentProcessingStartedAt)
  const progressLabel =
    progressValue !== undefined
      ? `${getIndexingStageLabel(sessionAttachmentIndexingStage, t)} · ${sessionAttachmentEmbeddedChunks}/${sessionAttachmentTotalChunks} ${t(
          'chunks'
        )} (${progressValue}%)`
      : getIndexingStageLabel(sessionAttachmentIndexingStage, t)
  const activeProgressLabel = takingLong
    ? progressValue !== undefined
      ? `${t('Still indexing')} · ${progressLabel}`
      : t('Still indexing')
    : progressLabel
  const ragStatusLabel =
    ragMode === 'session-retrieval'
      ? effectiveAvailability === 'blocked'
        ? t('Unavailable')
        : effectiveIndexStatus === 'ready'
          ? sessionAttachmentChunkCount && sessionAttachmentChunkCount > 0
            ? t('Indexed · {{count}} chunks', { count: sessionAttachmentChunkCount })
            : t('Indexed')
          : effectiveIndexStatus === 'failed'
            ? t('Indexing failed')
            : activeProgressLabel
      : ''
  const subtitle = [typeLabel, sizeLabel, ragStatusLabel].filter(Boolean).join(' · ')
  const showStatus = ragMode === 'session-retrieval'
  const tooltipTitle =
    showStatus && effectiveAvailability === 'blocked' && sessionAttachmentBlockedReason
      ? `${label}\n${sessionAttachmentBlockedReason}`
      : showStatus && effectiveIndexStatus === 'failed' && sessionAttachmentError
        ? `${label}\n${sessionAttachmentError}`
        : isClickable
          ? t('Click to view parsed content')
          : label

  return (
    <Tooltip multiline maw={300} label={tooltipTitle}>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 min-w-0 overflow-hidden
            relative
            rounded-md
            bg-workspaice-background-secondary
            ${isClickable ? 'cursor-pointer hover:bg-workspaice-background-secondary-hover transition-colors' : ''}`}
        onClick={handleClick}
      >
        <div className="flex-none w-7 h-7 rounded-md bg-workspaice-background-primary flex items-center justify-center">
          {filename && <FileIcon filename={filename} className="w-4 h-4" />}
          {url && !filename && <Link2 className="w-4 h-4 text-workspaice-secondary" strokeWidth={1.5} />}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <Text truncate className="text-xs leading-tight" style={{ fontSize: 12, lineHeight: 1.25 }}>
            {label}
          </Text>
          {subtitle && (
            <Text truncate className="text-workspaice-tertiary" style={{ fontSize: 10, lineHeight: 1.4 }}>
              {subtitle}
            </Text>
          )}
        </div>
        {showStatus &&
          effectiveAvailability !== 'blocked' &&
          effectiveIndexStatus !== 'ready' &&
          effectiveIndexStatus !== 'failed' &&
          progressValue !== undefined && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-workspaice-background-tertiary overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${progressValue}%` }} />
            </div>
          )}
        {showStatus && effectiveAvailability === 'blocked' && (
          <AlertCircle className="flex-none w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
        )}
        {showStatus && effectiveAvailability !== 'blocked' && effectiveIndexStatus === 'indexing' && (
          <Loader2 className="flex-none w-3.5 h-3.5 text-blue-500 animate-spin" strokeWidth={1.5} />
        )}
        {showStatus && effectiveAvailability !== 'blocked' && effectiveIndexStatus === 'pending' && (
          <Loader2 className="flex-none w-3.5 h-3.5 text-blue-500 animate-spin" strokeWidth={1.5} />
        )}
        {showStatus && effectiveAvailability !== 'blocked' && effectiveIndexStatus === 'ready' && (
          <CheckCircle className="flex-none w-3.5 h-3.5 text-green-500" strokeWidth={1.5} />
        )}
        {showStatus && effectiveAvailability !== 'blocked' && effectiveIndexStatus === 'failed' && (
          <AlertCircle className="flex-none w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
        )}
        {showStatus && effectiveAvailability !== 'blocked' && effectiveIndexStatus === 'failed' && onRetry && (
          <MiniButton
            className="flex-none p-0.5 rounded text-workspaice-tertiary hover:text-workspaice-secondary"
            onClick={(e) => {
              e.stopPropagation()
              onRetry()
            }}
          >
            {retrying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <RotateCw className="w-3.5 h-3.5" strokeWidth={1.5} />
            )}
          </MiniButton>
        )}
        {isClickable && (
          <Eye
            className="flex-none w-3.5 h-3.5 text-workspaice-tertiary opacity-0 group-hover/attachment:opacity-100 transition-opacity"
            strokeWidth={1.5}
          />
        )}
      </div>
    </Tooltip>
  )
}

export function LinkMiniCard(props: {
  url: string
  onDelete: () => void
  status?: 'processing' | 'completed' | 'error'
  errorMessage?: string
  onErrorClick?: () => void
}) {
  const { url, onDelete, status, errorMessage, onErrorClick } = props
  const { t } = useTranslation()
  const label = url.replace(/^https?:\/\//, '')

  const handleClick = () => {
    if (status === 'error' && onErrorClick) {
      onErrorClick()
    }
  }

  // 获取翻译后的错误消息
  const translatedError = getTranslatedErrorMessage(errorMessage, t)

  return (
    <div
      className="w-[100px] h-[100px] p-1 m-1 inline-flex items-center justify-center
                                bg-white shadow-sm rounded-md border-solid border-gray-400/20
                                hover:shadow-lg hover:cursor-pointer hover:scale-105 transition-all duration-200
                                group/file-mini-card relative"
      onClick={handleClick}
    >
      <Tooltip multiline maw={300} label={status === 'error' && translatedError ? translatedError : url}>
        <div className="flex flex-col justify-center items-center">
          <Link className="w-8 h-8 text-black" strokeWidth={1} />
          <Text truncate className="w-20 pt-1 text-black text-center" style={{ fontSize: 10, lineHeight: 1.5 }}>
            {label}
          </Text>
        </div>
      </Tooltip>

      {/* Status indicator */}
      {status && (
        <div className="absolute bottom-1 left-1">
          {status === 'processing' && <Loader2 size="16" className="animate-spin text-blue-500" />}
          {status === 'completed' && <CheckCircle size="16" className="text-green-500" />}
          {status === 'error' && <AlertCircle size="16" className="text-red-500" />}
        </div>
      )}

      {onDelete && (
        <MiniButton
          className="hidden group-hover/file-mini-card:inline-block
                    absolute top-0 right-0 m-1 p-1 rounded-full shadow-lg text-red-500"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size="18" strokeWidth={2} />
        </MiniButton>
      )}
    </div>
  )
}
