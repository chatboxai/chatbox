import NiceModal from '@ebay/nice-modal-react'
import { Typography } from '@mui/material'
import { CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR } from '@shared/file-parse-errors'
import type { SessionAttachmentIndexingStage } from '@shared/types'
import { IconPlayerPlay } from '@tabler/icons-react'
import { AlertCircle, CheckCircle, Eye, Link2, Loader2, RotateCw, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import platform from '@/platform'
import {
  isSessionAttachmentRagAuthError,
  isSessionAttachmentRagIndexingError,
  SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR,
} from '@/stores/sessionHelpers'
import { getFileParseErrorI18nKey } from '@/utils/file-parse-error'
import MiniButton from '../common/MiniButton'
import FileIcon from '../FileIcon'
import { ImageInStorage } from '../Image'

export type AttachmentRecoveryAction = 'continue' | 'retry'

// 根据错误码获取翻译后的错误消息
function getTranslatedErrorMessage(
  errorCode: string | undefined,
  t: (key: string) => string,
  recoveryAction?: AttachmentRecoveryAction
): string | undefined {
  if (!errorCode) return undefined
  if (isSessionAttachmentRagAuthError(errorCode)) {
    return t('This large file needs Chatbox AI to finish indexing. Sign in to Chatbox AI, then retry this file.')
  }
  if (isSessionAttachmentRagIndexingError(errorCode)) {
    return recoveryAction
      ? `${t('Indexing failed')}. ${t(recoveryAction === 'continue' ? 'Continue' : 'Retry')}`
      : t('Indexing failed')
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
  const errorI18nKey = getFileParseErrorI18nKey(errorCode, platform.isDesktopLike)
  if (errorI18nKey) {
    // 使用 i18nKey 进行翻译，去掉其中的 HTML 标签以便在 Tooltip 中显示纯文本
    const translated = t(errorI18nKey)
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
    return t('Sign in needed')
  }
  if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR) {
    return t('Switch model')
  }
  if (isSessionAttachmentRagIndexingError(errorCode)) {
    return t('Indexing failed')
  }
  if (errorCode === CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR) {
    return t('Sign in needed')
  }
  if (errorCode === 'license_key_required') {
    return t('License needed')
  }
  return t('Processing failed')
}

export function ImageMiniCard(props: { storageKey: string; onDelete: () => void }) {
  const { storageKey, onDelete } = props
  return (
    <div
      key={storageKey}
      className="w-[100px] h-[100px] p-1 m-1 inline-flex items-center justify-center
                                bg-white shadow-sm rounded-lg border-solid border-gray-400/20
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
  parserType?: string
  progressValue?: number
  isTakingLong?: boolean
  errorMessage?: string
  onErrorClick?: () => void
  onPreviewClick?: () => void
  recoveryAction?: AttachmentRecoveryAction
  onRecover?: () => void
  recovering?: boolean
}) {
  const {
    name,
    onDelete,
    status,
    statusText,
    parserType,
    progressValue,
    isTakingLong,
    errorMessage,
    onErrorClick,
    onPreviewClick,
    recoveryAction,
    onRecover,
    recovering,
  } = props
  const { t } = useTranslation()
  const recoveryTranslationKey = recoveryAction === 'continue' ? 'Continue' : 'Retry'
  const recoveryLabel = recoveryAction ? (t(recoveryTranslationKey) ?? recoveryTranslationKey) : undefined

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
  const translatedError = getTranslatedErrorMessage(errorMessage, t, recoveryAction)
  // 解析完成后展示解析结果和点数消耗提示；处理中/错误时优先展示状态文案
  const miniCardParserLabel = getParserDisplayName(parserType, t)
  const parserCostLabel = getParserCostLabel(parserType, t)
  const parserLabel = [miniCardParserLabel, parserCostLabel].filter(Boolean).join('\n')
  const displayedStatusText =
    status === 'error'
      ? (statusText ?? getErrorStatusLabel(errorMessage, t))
      : (statusText ?? (status === 'completed' ? parserLabel : undefined))
  const clampedProgressValue =
    typeof progressValue === 'number' ? Math.max(0, Math.min(100, Math.round(progressValue))) : undefined
  const statusTextContent = displayedStatusText ? (
    <Typography
      component="span"
      className={
        status === 'error'
          ? 'min-w-0 text-red-500 text-center'
          : isTakingLong
            ? 'min-w-0 text-amber-600 text-center'
            : 'min-w-0 text-gray-500 text-center'
      }
      sx={{
        fontSize: '11px',
        lineHeight: 1.15,
        whiteSpace: 'pre-line',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
      }}
    >
      {displayedStatusText}
    </Typography>
  ) : null

  return (
    <div
      className="w-[132px] h-[108px] px-2.5 pt-2 pb-3 m-1 inline-flex items-center justify-center
                                bg-white shadow-sm rounded-lg border-solid border-gray-400/20
                                hover:shadow-lg hover:cursor-pointer hover:scale-105 transition-all duration-200
                                group/file-mini-card relative"
      onClick={handleClick}
    >
      <Tooltip
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
          <Typography className="w-full px-1 text-black text-center" noWrap sx={{ fontSize: '12px', lineHeight: 1.25 }}>
            {name}
          </Typography>
          {displayedStatusText && (
            <div className="mt-1 flex items-center justify-center gap-1 w-full min-w-0">
              {status === 'processing' && <Loader2 size="12" className="animate-spin text-blue-500 shrink-0" />}
              {status === 'error' && onErrorClick ? (
                <button
                  type="button"
                  aria-label={`${name}: ${displayedStatusText}`}
                  className="min-w-0 cursor-pointer border-0 bg-transparent p-0"
                  onClick={(event) => {
                    event.stopPropagation()
                    onErrorClick()
                  }}
                >
                  {statusTextContent}
                </button>
              ) : (
                statusTextContent
              )}
              {status === 'error' && recoveryAction && onRecover && (
                <MiniButton
                  className="flex-none !w-5 !h-5 !p-0.5 text-blue-600 hover:text-blue-700"
                  disabled={recovering}
                  tooltipTitle={recoveryLabel}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRecover()
                  }}
                >
                  {recovering ? (
                    <Loader2 aria-label={recoveryLabel} className="w-3.5 h-3.5 animate-spin" />
                  ) : recoveryAction === 'continue' ? (
                    <IconPlayerPlay aria-label={recoveryLabel} className="w-3.5 h-3.5" />
                  ) : (
                    <RotateCw aria-label={recoveryLabel} className="w-3.5 h-3.5" />
                  )}
                </MiniButton>
              )}
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

// 展示文档使用的解析器和点数消耗提示。
// 'sandbox-raw'（Agent 模式原文件）、'none' 及未知值不展示。
export function getParserDisplayName(
  parserType: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string | undefined {
  switch (parserType) {
    case 'local':
      return t('Parser: Local')
    case 'chatbox-ai':
      return t('Parser: {{parser}}', { parser: 'Chatbox AI' })
    case 'mineru':
      return t('Parser: {{parser}}', { parser: 'MinerU' })
    default:
      return undefined
  }
}

function getParserCostLabel(
  parserType: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string | undefined {
  switch (parserType) {
    case 'local':
      return t('No points consumed')
    default:
      return undefined
  }
}

export function getParserTypeLabel(
  parserType: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string | undefined {
  const parserName = getParserDisplayName(parserType, t)
  const costLabel = getParserCostLabel(parserType, t)
  return [parserName, costLabel].filter(Boolean).join(' · ') || undefined
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
  parserType?: string
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
  recoveryAction?: AttachmentRecoveryAction
  onRecover?: () => void
  recovering?: boolean
}) {
  const {
    label,
    filename,
    url,
    storageKey,
    fileType,
    byteLength,
    parserType,
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
    recoveryAction,
    onRecover,
    recovering,
  } = props
  const { t } = useTranslation()
  const recoveryTranslationKey = recoveryAction === 'continue' ? 'Continue' : 'Retry'
  const recoveryLabel = recoveryAction ? (t(recoveryTranslationKey) ?? recoveryTranslationKey) : undefined

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
      // 预览窗口展示完整的解析器与索引状态信息
      const metadata: Array<{ label?: string; value: string }> = []
      if (parserLabel) metadata.push({ value: parserLabel })
      if (ragStatusLabel) metadata.push({ label: String(t('Status')), value: String(ragStatusLabel) })
      await NiceModal.show('content-viewer', {
        title,
        storageKey,
        metadata: metadata.length ? metadata : undefined,
      })
    }
  }

  const isClickable = !!storageKey
  const typeLabel = filename ? getFileTypeLabel(filename, fileType) : ''
  const sizeLabel = formatFileSize(byteLength)
  const parserLabel = filename ? getParserTypeLabel(parserType, t) : undefined
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
            ? progressValue !== undefined && (sessionAttachmentEmbeddedChunks ?? 0) > 0
              ? `${t('Indexing failed')} · ${sessionAttachmentEmbeddedChunks}/${sessionAttachmentTotalChunks} ${t('chunks')}`
              : t('Indexing failed')
            : activeProgressLabel
      : ''
  const showStatus = ragMode === 'session-retrieval'
  // 有索引标识（session-retrieval）时，副标题让位给索引状态，避免拥挤/截断；
  // 完整的解析器与索引信息改在点击后的预览窗口展示。
  const subtitle = [typeLabel, sizeLabel, showStatus ? undefined : parserLabel, ragStatusLabel]
    .filter(Boolean)
    .join(' · ')
  const tooltipTitle =
    showStatus && effectiveAvailability === 'blocked' && sessionAttachmentBlockedReason
      ? `${label}\n${sessionAttachmentBlockedReason}`
      : showStatus && effectiveIndexStatus === 'failed' && sessionAttachmentError
        ? `${label}\n${sessionAttachmentError}`
        : isClickable
          ? t('Click to view parsed content')
          : label

  return (
    <Tooltip label={tooltipTitle}>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 min-w-0 overflow-hidden
            relative
            rounded-lg
            bg-chatbox-background-secondary
            ${isClickable ? 'cursor-pointer hover:bg-chatbox-background-secondary-hover transition-colors' : ''}`}
        onClick={handleClick}
      >
        <div className="flex-none w-7 h-7 rounded-lg bg-chatbox-background-primary flex items-center justify-center">
          {filename && <FileIcon filename={filename} className="w-4 h-4" />}
          {url && !filename && <Link2 className="w-4 h-4 text-chatbox-secondary" strokeWidth={1.5} />}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <Typography className="text-xs leading-tight truncate" noWrap>
            {label}
          </Typography>
          {subtitle && (
            <Typography className="text-chatbox-tertiary" noWrap sx={{ fontSize: '10px', lineHeight: 1.4 }}>
              {subtitle}
            </Typography>
          )}
        </div>
        {showStatus &&
          effectiveAvailability !== 'blocked' &&
          effectiveIndexStatus !== 'ready' &&
          effectiveIndexStatus !== 'failed' &&
          progressValue !== undefined && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-chatbox-background-tertiary overflow-hidden">
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
        {showStatus &&
          effectiveAvailability !== 'blocked' &&
          effectiveIndexStatus === 'failed' &&
          recoveryAction &&
          onRecover && (
            <MiniButton
              className="flex-none p-0.5 rounded text-chatbox-tertiary hover:text-chatbox-secondary"
              disabled={recovering}
              tooltipTitle={recoveryLabel}
              onClick={(e) => {
                e.stopPropagation()
                onRecover()
              }}
            >
              {recovering ? (
                <Loader2 aria-label={recoveryLabel} className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
              ) : recoveryAction === 'continue' ? (
                <IconPlayerPlay aria-label={recoveryLabel} className="w-3.5 h-3.5" stroke={1.5} />
              ) : (
                <RotateCw aria-label={recoveryLabel} className="w-3.5 h-3.5" strokeWidth={1.5} />
              )}
            </MiniButton>
          )}
        {isClickable && (
          <Eye
            className="flex-none w-3.5 h-3.5 text-chatbox-tertiary opacity-0 group-hover/attachment:opacity-100 transition-opacity"
            strokeWidth={1.5}
          />
        )}
      </div>
    </Tooltip>
  )
}
