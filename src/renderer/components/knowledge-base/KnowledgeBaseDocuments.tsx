import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Collapse,
  Flex,
  Group,
  Loader,
  Paper,
  Pill,
  Progress,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core'
import {
  KNOWLEDGE_BASE_MAX_FILE_SIZE,
  KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL,
  KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE_LABEL,
  KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR,
} from '@shared/knowledge-base'
import type { FileMeta, KnowledgeBase } from '@shared/types'
import { formatFileSize } from '@shared/utils'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconExclamationCircle,
  IconFile,
  IconLoader,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { bucketPlausibleCount } from '@/analytics/plausible'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useKnowledgeBaseFiles, useKnowledgeBaseFilesActions, useKnowledgeBaseFilesCount } from '@/hooks/knowledge-base'
import { useChunksPreview } from '@/hooks/useChunksPreview'
import { toastError } from '@/packages/toast'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { trackEvent } from '@/utils/track'
import ChunksPreviewModal from './ChunksPreviewModal'
import { KnowledgeBaseFileErrorButton } from './KnowledgeBaseFileErrorButton'
import { isChatboxAIParserLicenseRequired } from './knowledge-base-file-error'
import { RemoteRetryModal } from './RemoteRetryModal'

interface KnowledgeBaseDocumentsProps {
  knowledgeBase: KnowledgeBase | null
}

interface RejectedFile {
  name: string
  size: number
}

const KnowledgeBaseDocuments: React.FC<KnowledgeBaseDocumentsProps> = ({ knowledgeBase }) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [showScrollIndicator, setShowScrollIndicator] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showUploadArea, setShowUploadArea] = useState(false)
  const [showRemoteRetryModal, setShowRemoteRetryModal] = useState(false)
  const [sizeRejectedFiles, setSizeRejectedFiles] = useState<RejectedFile[]>([])

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const globalDocumentParserType = useSettingsStore((state) => state.extension?.documentParser?.type)

  // Chunks preview hook
  const chunksPreview = useChunksPreview()

  // Fetch files data using react-query
  const {
    data: filesData,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useKnowledgeBaseFiles(knowledgeBase?.id || null)

  const { data: filesCount = 0, refetch: refetchCount } = useKnowledgeBaseFilesCount(knowledgeBase?.id || null)
  const { invalidateFiles } = useKnowledgeBaseFilesActions()

  // Flatten all pages of files into a single array
  const allFiles = useMemo(() => {
    return filesData?.pages.flatMap((page) => page.files) || []
  }, [filesData])

  // Real-time polling for file status updates
  useEffect(() => {
    if (!knowledgeBase?.id || allFiles.length === 0) return

    // Check if there are any files being processed
    const hasProcessingFiles = allFiles.some(
      (file) => file.status === 'pending' || file.status === 'processing' || file.status === 'paused'
    )

    if (!hasProcessingFiles) return

    // Poll every 2 seconds when there are processing files
    const pollInterval = setInterval(() => {
      refetch()
      refetchCount()
    }, 2000)

    return () => clearInterval(pollInterval)
  }, [knowledgeBase?.id, allFiles, refetch, refetchCount])

  // Failed files for remote retry feature
  const failedFiles = useMemo(() => allFiles.filter((file) => file.status === 'failed'), [allFiles])

  // Parser types that should NOT show the "use Chatbox AI" suggestion when they fail
  const PARSER_NO_SUGGESTION_LIST: string[] = ['mineru', 'chatbox-ai']

  // Check if we should show the Chatbox AI suggestion for failed files
  // Show suggestion only if there are failed files that are NOT in the exception list
  const shouldShowChatboxAISuggestion = useMemo(() => {
    if (failedFiles.length === 0) return false
    // Check if any failed file used a parser that should show the suggestion
    return failedFiles.some(
      (file) =>
        file.error !== KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR &&
        !PARSER_NO_SUGGESTION_LIST.includes(file.parser_type || 'local')
    )
  }, [failedFiles])

  // MIME type correction for Windows compatibility
  const correctMimeType = useCallback((file: File): FileMeta => {
    const filename = file.name.toLowerCase()
    let mimeType = file.type

    // If MIME type is empty or incorrect, infer from file extension
    if (!mimeType || mimeType === '') {
      if (filename.endsWith('.md') || filename.endsWith('.markdown')) {
        mimeType = 'text/markdown'
      } else if (filename.endsWith('.txt')) {
        mimeType = 'text/plain'
      } else if (filename.endsWith('.pdf')) {
        mimeType = 'application/pdf'
      } else if (filename.endsWith('.doc')) {
        mimeType = 'application/msword'
      } else if (filename.endsWith('.docx')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      } else if (filename.endsWith('.rtf')) {
        mimeType = 'application/rtf'
      } else if (filename.endsWith('.csv')) {
        mimeType = 'text/csv'
      } else if (filename.endsWith('.epub')) {
        mimeType = 'application/epub+zip'
      } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
        mimeType = 'image/jpeg'
      } else if (filename.endsWith('.png')) {
        mimeType = 'image/png'
      } else if (filename.endsWith('.gif')) {
        mimeType = 'image/gif'
      } else if (filename.endsWith('.webp')) {
        mimeType = 'image/webp'
      } else if (filename.endsWith('.bmp')) {
        mimeType = 'image/bmp'
      } else {
        // Default to text/plain for unknown text-like files
        mimeType = 'text/plain'
      }
    }

    const filePath = platform.getLocalFilePath(file)

    return {
      name: file.name,
      path: filePath,
      type: mimeType,
      size: file.size,
    }
  }, [])

  // Calculate height for exactly 5 document items (each item ~60px + gaps)
  const maxHeight = 5 * 60 // 5 items * 60px

  // Handle scroll position change
  const handleScrollPositionChange = useCallback((_position: { x: number; y: number }) => {
    setShowScrollIndicator(true)
  }, [])

  const handleScrollToBottom = useCallback(() => {
    setShowScrollIndicator(false)
    fetchNextPage()
  }, [fetchNextPage])

  // Update scroll indicator when documents change
  useEffect(() => {
    setShowScrollIndicator(allFiles.length > 5)
  }, [allFiles.length])

  // Get supported file types
  const getSupportedFileTypes = useCallback(() => {
    const effectiveParserType = knowledgeBase?.documentParser?.type || globalDocumentParserType || 'local'
    const isLocalParser = effectiveParserType === 'local'

    const baseDocumentTypes = ['.pdf', '.docx', '.txt', '.md', '.rtf', '.pptx', '.xlsx', '.csv', '.epub']
    const extendedDocumentTypes = ['.doc', '.ppt', '.xls']
    const documentTypes = isLocalParser ? baseDocumentTypes : [...baseDocumentTypes, ...extendedDocumentTypes]
    const imageTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

    // Add MIME types for better Windows compatibility
    const baseDocumentMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'application/rtf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/epub+zip',
    ]
    const extendedDocumentMimeTypes = [
      'application/msword',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-excel',
    ]
    const documentMimeTypes = isLocalParser
      ? baseDocumentMimeTypes
      : [...baseDocumentMimeTypes, ...extendedDocumentMimeTypes]
    const imageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']

    const hasVisionModel = knowledgeBase?.visionModel && knowledgeBase.visionModel.trim() !== ''

    // Combine file extensions and MIME types for better compatibility
    const allDocumentTypes = [...documentTypes, ...documentMimeTypes]
    const allImageTypes = hasVisionModel ? [...imageTypes, ...imageMimeTypes] : []
    const allTypes = [...allDocumentTypes, ...allImageTypes]

    return {
      accept: allTypes.join(','),
      display: hasVisionModel ? [...documentTypes, ...imageTypes] : documentTypes,
    }
  }, [knowledgeBase?.documentParser?.type, knowledgeBase?.visionModel, globalDocumentParserType])

  // Handle file upload (shared logic)
  const uploadFiles = useCallback(
    async (files: FileList) => {
      if (!knowledgeBase?.id || !files.length) return

      try {
        const knowledgeBaseController = platform.getKnowledgeBaseController()
        const oversizedFiles = Array.from(files)
          .filter((file) => file.size > KNOWLEDGE_BASE_MAX_FILE_SIZE)
          .map((file) => ({ name: file.name, size: file.size }))
        const uploadableFiles = Array.from(files).filter((file) => file.size <= KNOWLEDGE_BASE_MAX_FILE_SIZE)

        if (oversizedFiles.length > 0) {
          setSizeRejectedFiles(oversizedFiles)
          toastError(
            t('{{count}} file(s) exceed the {{limit}} knowledge base upload limit.', {
              count: oversizedFiles.length,
              limit: KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL,
            })
          )
        } else {
          setSizeRejectedFiles([])
        }

        if (uploadableFiles.length === 0) {
          return
        }

        // Process and correct MIME types for all files
        const correctedFiles: FileMeta[] = []
        for (const file of uploadableFiles) {
          const correctedFile = correctMimeType(file)
          correctedFiles.push(correctedFile)
        }

        // Upload all files using allSettled to allow partial successes
        const uploadResults = await Promise.allSettled(
          correctedFiles.map(async (file) => {
            await knowledgeBaseController.uploadFile(knowledgeBase.id, file)
            return file
          })
        )

        // Count successes and failures
        const successfulUploads = uploadResults.filter((result) => result.status === 'fulfilled')
        const failedUploads = uploadResults.filter((result) => result.status === 'rejected')

        // Log individual failures
        uploadResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const fileName = correctedFiles[index]?.name || 'Unknown file'
            console.error(`[Upload] Failed to upload file ${fileName}:`, result.reason)
            toastError(
              t('Failed to upload {{filename}}: {{error}}', {
                filename: fileName,
                error: (result.reason as Error)?.message || 'Unknown error',
              })
            )
          }
        })

        // Provide appropriate user feedback
        const blockedUploadCount = failedUploads.length + oversizedFiles.length

        if (successfulUploads.length > 0 && blockedUploadCount === 0) {
          toast.success(t('Successfully uploaded {{count}} file(s)', { count: successfulUploads.length }))
        } else if (successfulUploads.length > 0 && blockedUploadCount > 0) {
          toast.success(
            t('Successfully uploaded {{success}} of {{total}} file(s). {{failed}} file(s) failed.', {
              success: successfulUploads.length,
              total: files.length,
              failed: blockedUploadCount,
            })
          )
        } else if (blockedUploadCount === files.length) {
          // Don't show additional error toast here since individual errors were already shown
        }

        // Track successful uploads only
        if (successfulUploads.length > 0) {
          const uploadedFileTypes = new Set(correctedFiles.map((file) => file.type || 'unknown'))
          trackEvent('knowledge_base_document_added', {
            file_count: bucketPlausibleCount(successfulUploads.length),
            attempted_file_count: bucketPlausibleCount(files.length),
            failed_file_count: bucketPlausibleCount(blockedUploadCount),
            file_type_count: bucketPlausibleCount(uploadedFileTypes.size),
          })

          // Immediately refresh the data to show the new files
          await Promise.all([refetch(), refetchCount()])

          // Also invalidate cache for other components
          invalidateFiles(knowledgeBase.id)

          // Auto-expand to show the uploaded files (only if not already expanded)
          if (!isExpanded) {
            setIsExpanded(true)
          }
        }
      } catch (error) {
        console.error('[Upload] Upload operation failed:', error)
        toastError(
          t('Upload failed: {{error}}', {
            error: (error as Error)?.message || 'Unknown error',
          })
        )
      }
    },
    [knowledgeBase?.id, correctMimeType, refetch, refetchCount, invalidateFiles, isExpanded, t]
  )

  // Validate file type against supported types
  const validateFileType = useCallback(
    (file: File): boolean => {
      const supportedTypes = getSupportedFileTypes()
      const fileName = file.name.toLowerCase()
      const fileType = file.type.toLowerCase()

      // Get supported extensions and MIME types
      const acceptableTypes = supportedTypes.accept.toLowerCase().split(',')

      // Check file extension
      const hasValidExtension = acceptableTypes.some((type) => {
        if (type.startsWith('.')) {
          return fileName.endsWith(type)
        }
        return false
      })

      // Check MIME type
      const hasValidMimeType = acceptableTypes.some((type) => {
        if (type.includes('/')) {
          return fileType === type.trim()
        }
        return false
      })

      return hasValidExtension || hasValidMimeType
    },
    [getSupportedFileTypes]
  )

  // Handle drag and drop events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only hide drag over state if we're leaving the drop zone completely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const files = e.dataTransfer.files
      if (files.length === 0) {
        toast.warning(t('No files were dropped'))
        return
      }

      // Filter files by supported types
      const validFiles: File[] = []
      const invalidFiles: File[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (validateFileType(file)) {
          validFiles.push(file)
        } else {
          invalidFiles.push(file)
        }
      }

      // Show warning for invalid files
      if (invalidFiles.length > 0) {
        const invalidFileNames = invalidFiles.map((f) => f.name).join(', ')
        const supportedTypes = getSupportedFileTypes()
        toastError(
          t('{{count}} file(s) not supported: {{files}}. Supported formats: {{formats}}', {
            count: invalidFiles.length,
            files: invalidFileNames,
            formats: supportedTypes.display.join(', '),
          })
        )
      }

      // Upload valid files if any
      if (validFiles.length > 0) {
        // Create a proper FileList-like object
        const fileListLike = Object.assign(validFiles, {
          item: (index: number) => validFiles[index] || null,
        }) as unknown as FileList

        await uploadFiles(fileListLike)
      }
    },
    [uploadFiles, validateFileType, getSupportedFileTypes, t]
  )

  // Handle file deletion
  const handleDeleteFile = useCallback(
    async (fileId: number) => {
      try {
        const knowledgeBaseController = platform.getKnowledgeBaseController()
        await knowledgeBaseController.deleteFile(fileId)
        if (knowledgeBase?.id) {
          invalidateFiles(knowledgeBase.id)
        }
      } catch (error) {
        console.error('Failed to delete file:', error)
      }
    },
    [knowledgeBase?.id, invalidateFiles]
  )

  // Handle file retry
  const handleRetryFile = useCallback(
    async (fileId: number, useRemoteParsing = false) => {
      try {
        const knowledgeBaseController = platform.getKnowledgeBaseController()
        await knowledgeBaseController.retryFile(fileId, useRemoteParsing)
        if (knowledgeBase?.id) {
          // Refresh data to show updated status
          refetch()
          refetchCount()
          invalidateFiles(knowledgeBase.id)
        }
      } catch (error) {
        console.error('Failed to retry file:', error)
      }
    },
    [knowledgeBase?.id, refetch, refetchCount, invalidateFiles]
  )

  // Handle file pause
  const handlePauseFile = useCallback(
    async (fileId: number) => {
      try {
        const knowledgeBaseController = platform.getKnowledgeBaseController()
        await knowledgeBaseController.pauseFile(fileId)
        if (knowledgeBase?.id) {
          // Refresh data to show updated status
          refetch()
          refetchCount()
          invalidateFiles(knowledgeBase.id)
        }
      } catch (error) {
        console.error('Failed to pause file:', error)
      }
    },
    [knowledgeBase?.id, refetch, refetchCount, invalidateFiles]
  )

  // Handle file resume
  const handleResumeFile = useCallback(
    async (fileId: number) => {
      try {
        const knowledgeBaseController = platform.getKnowledgeBaseController()
        await knowledgeBaseController.resumeFile(fileId)
        if (knowledgeBase?.id) {
          // Refresh data to show updated status
          refetch()
          refetchCount()
          invalidateFiles(knowledgeBase.id)
        }
      } catch (error) {
        console.error('Failed to resume file:', error)
      }
    },
    [knowledgeBase?.id, refetch, refetchCount, invalidateFiles]
  )

  // Format date
  const formatDate = (timestamp: number): string => {
    try {
      if (!timestamp || Number.isNaN(timestamp)) {
        return 'Unknown date'
      }
      const date = new Date(timestamp)
      if (Number.isNaN(date.getTime())) {
        return 'Invalid date'
      }

      // Use local time and format
      const now = new Date()
      const isToday = date.toDateString() === now.toDateString()
      const isThisYear = date.getFullYear() === now.getFullYear()

      if (isToday) {
        // Show time only for today
        return date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      } else if (isThisYear) {
        // Show month/day + time for this year
        return (
          date.toLocaleDateString([], {
            month: '2-digit',
            day: '2-digit',
          }) +
          ' ' +
          date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        )
      } else {
        // Show full date for other years
        return (
          date.toLocaleDateString([], {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
          }) +
          ' ' +
          date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        )
      }
    } catch (error) {
      console.error('Error formatting date:', timestamp, error)
      return 'Invalid date'
    }
  }

  const getStatusIcon = (status: string, error?: string, parserType?: string, fileName?: string) => {
    switch (status) {
      case 'completed':
      case 'done':
        return <IconCircleCheck size={16} color="var(--chatbox-tint-success)" />
      case 'processing':
        return (
          <IconLoader size={16} color="var(--chatbox-tint-warning)" style={{ animation: 'spin 1s linear infinite' }} />
        )
      case 'pending':
        return <IconLoader size={16} color="var(--chatbox-tint-gray)" />
      case 'paused':
        return <IconPlayerPause size={16} color="var(--chatbox-tint-warning)" />
      case 'failed': {
        const isParsedContentTooLarge = error === KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR
        const isLicenseError = isChatboxAIParserLicenseRequired(error)
        // Determine label based on actual parser type used
        const getParserLabel = () => {
          if (isParsedContentTooLarge) {
            return t('Too much text')
          }
          switch (parserType) {
            case 'mineru':
              return t('MinerU parse failed')
            case 'chatbox-ai':
              return t('Chatbox AI parse failed')
            default:
              return t('Local parse failed')
          }
        }
        const errorLabel = isParsedContentTooLarge
          ? t('Parsed document content must be {{limit}} or smaller.', {
              limit: KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE_LABEL,
            })
          : isLicenseError
            ? t('Sign in needed')
            : error || t('Processing failed')
        const isRemoteParser = parserType === 'mineru' || parserType === 'chatbox-ai'
        const statusPill = (
          <Pill size="xs" c={isRemoteParser ? 'orange' : 'gray'} className="cursor-help">
            {isLicenseError ? t('Sign in needed') : getParserLabel()}
          </Pill>
        )
        return (
          <Flex gap={4} align="center">
            <Tooltip label={errorLabel} multiline w={300} withArrow position="top">
              {isLicenseError && error && fileName ? (
                <KnowledgeBaseFileErrorButton errorCode={error} fileName={fileName} label={t('Sign in needed')}>
                  {statusPill}
                </KnowledgeBaseFileErrorButton>
              ) : (
                statusPill
              )}
            </Tooltip>
          </Flex>
        )
      }
      default:
        return null
    }
  }

  // Get progress percentage for display
  const getProgressPercentage = (chunkCount: number, totalChunks: number): number => {
    if (totalChunks === 0) return 0
    return Math.round((chunkCount / totalChunks) * 100)
  }

  // Handle file upload via button
  const handleAddFile = useCallback(() => {
    if (!knowledgeBase?.id) return

    // Toggle upload area visibility
    setShowUploadArea(!showUploadArea)
    if (!showUploadArea) {
      setIsExpanded(true)
    }
  }, [knowledgeBase?.id, showUploadArea])

  // Handle file selection via file dialog
  const handleFileDialog = useCallback(() => {
    if (!knowledgeBase?.id) return

    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      const { accept } = getSupportedFileTypes()
      input.accept = accept

      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files
        if (!files || !files.length) return

        await uploadFiles(files)
      }

      // Add a small delay for better Windows compatibility
      setTimeout(() => {
        input.click()
      }, 10)
    } catch (error) {
      console.error('Failed to upload file:', error)
      toastError(
        t('Failed to open file dialog: {{error}}', {
          error: (error as Error)?.message || 'Unknown error',
        })
      )
    }
  }, [knowledgeBase?.id, getSupportedFileTypes, uploadFiles, t])

  const supportedTypes = getSupportedFileTypes()

  return (
    <Stack>
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>

      {/* Documents Section */}
      <Box>
        <Paper withBorder radius="lg" p={0}>
          {/* Documents Header */}
          <Group
            align="center"
            justify="space-between"
            px="sm"
            py="2px"
            style={{
              cursor: 'pointer',
              borderBottom: '1px solid var(--chatbox-border-secondary-hover)',
            }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <Group>
              {isExpanded ? (
                <IconChevronDown size={16} color="var(--chatbox-tint-gray)" />
              ) : (
                <IconChevronRight size={16} color="var(--chatbox-tint-gray)" />
              )}
              <Text size="sm" fw={600} className="text-chatbox-tint-primary">
                {t('Documents')}
              </Text>
              <Pill
                size="xs"
                bg={
                  filesCount > 0
                    ? 'var(--chatbox-background-brand-secondary)'
                    : 'var(--chatbox-background-gray-secondary)'
                }
                c={filesCount > 0 ? 'var(--chatbox-tint-brand)' : 'var(--chatbox-tint-gray)'}
                fz="xs"
              >
                {filesCount}
              </Pill>
            </Group>
            <Button
              variant="subtle"
              color="var(--chatbox-tint-primary)"
              size="xs"
              fw={600}
              leftSection={showUploadArea ? <IconCheck size={14} /> : <IconPlus size={14} />}
              onClick={(e) => {
                e.stopPropagation()
                handleAddFile()
              }}
            >
              {showUploadArea ? t('Done') : t('Add File')}
            </Button>
          </Group>

          <Collapse in={isExpanded}>
            {/* Drag and Drop Upload Area */}
            {showUploadArea && (
              <Box
                p="md"
                style={{
                  borderBottom: allFiles.length > 0 ? '1px solid var(--chatbox-tint-gray)' : 'none',
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <Paper
                  withBorder
                  p="lg"
                  radius="lg"
                  style={{
                    border: isDragOver
                      ? '2px dashed var(--chatbox-border-brand)'
                      : '2px dashed var(--chatbox-border-primary)',
                    backgroundColor: isDragOver
                      ? 'var(--chatbox-background-brand-secondary)'
                      : 'var(--chatbox-background-gray-secondary)',
                    transition: 'all 0.2s ease',
                    cursor: 'pointer',
                  }}
                  onClick={handleFileDialog}
                >
                  <Stack align="center" gap="sm">
                    <IconUpload
                      size={32}
                      color={isDragOver ? 'var(--chatbox-tint-brand)' : 'var(--chatbox-tint-gray)'}
                    />
                    <Text size="sm" fw={500} ta="center" c={isDragOver ? 'blue' : 'dimmed'}>
                      {isDragOver ? t('Drop files here') : t('Drag and drop files here, or click to browse')}
                    </Text>
                    <Text size="xs" c="dimmed" ta="center" mt={-4}>
                      {t('Supported formats')}: {supportedTypes.display.join(', ')}
                    </Text>
                    <Text size="xs" c="dimmed" ta="center" mt={-8}>
                      {t('Maximum file size')}: {KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL}
                    </Text>
                  </Stack>
                </Paper>
                {sizeRejectedFiles.length > 0 && (
                  <Alert
                    mt="sm"
                    variant="light"
                    color="red"
                    icon={<IconExclamationCircle size={18} />}
                    title={t('Some files were not uploaded')}
                    styles={{
                      root: {
                        border: '1px solid var(--chatbox-border-primary)',
                        borderLeft: '3px solid var(--chatbox-tint-error)',
                        background: 'var(--chatbox-background-primary)',
                      },
                    }}
                  >
                    <Stack gap={6}>
                      <Text size="sm">
                        {t('Knowledge Base documents must be {{limit}} or smaller.', {
                          limit: KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL,
                        })}
                      </Text>
                      <Stack gap={4}>
                        {sizeRejectedFiles.slice(0, 3).map((file) => (
                          <Group key={`${file.name}-${file.size}`} justify="space-between" gap="sm" wrap="nowrap">
                            <Text size="xs" lineClamp={1} style={{ minWidth: 0 }}>
                              {file.name}
                            </Text>
                            <Text size="xs" c="dimmed" className="shrink-0">
                              {formatFileSize(file.size)}
                            </Text>
                          </Group>
                        ))}
                        {sizeRejectedFiles.length > 3 && (
                          <Text size="xs" c="dimmed">
                            {t('And {{count}} more file(s).', { count: sizeRejectedFiles.length - 3 })}
                          </Text>
                        )}
                      </Stack>
                    </Stack>
                  </Alert>
                )}
              </Box>
            )}

            {/* Failed files banner - show Chatbox AI suggestion only for local parser failures */}
            {shouldShowChatboxAISuggestion && (
              <Alert variant="light" color="yellow" p="sm">
                <Flex gap="xs" align="center" justify="space-between">
                  <Flex gap="xs" align="center" style={{ flex: 1 }}>
                    <Text size="sm">{t('{{count}} file(s) failed to parse', { count: failedFiles.length })}</Text>
                  </Flex>
                  <Stack gap={4} align="flex-end" className="flex-shrink-0">
                    <Button size="xs" variant="light" onClick={() => setShowRemoteRetryModal(true)}>
                      {t('Use server parsing')}
                    </Button>
                    <Tooltip
                      label={t(
                        'If you have never had a license before, you can claim it after logging in on the official website.'
                      )}
                      withArrow
                      multiline
                      maw={240}
                      position="bottom-end"
                      styles={{
                        tooltip: {
                          backgroundColor: 'rgba(0, 0, 0, 0.75)',
                          backdropFilter: 'blur(4px)',
                        },
                      }}
                    >
                      <Text
                        size="xs"
                        c="dimmed"
                        className="cursor-pointer hover:text-blue-500 transition-colors"
                        onClick={() => {
                          trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                            pageName: JK_PAGE_NAMES.SETTING_PAGE,
                            content: 'kb_error',
                          })
                          platform.openLink('https://chatboxai.app/login')
                        }}
                      >
                        {t('Free trial available')} →
                      </Text>
                    </Tooltip>
                  </Stack>
                </Flex>
              </Alert>
            )}

            {/* Scrollable Document List with Scroll Indicator */}
            {allFiles.length > 0 && (
              <Box style={{ position: 'relative' }}>
                <ScrollArea
                  ref={scrollAreaRef}
                  h={maxHeight}
                  type="scroll"
                  onScrollPositionChange={handleScrollPositionChange}
                  onBottomReached={handleScrollToBottom}
                >
                  <Stack gap={0}>
                    {allFiles.map((doc, index) => (
                      <Box key={doc.id}>
                        <Group
                          px="md"
                          py="sm"
                          justify="space-between"
                          align="center"
                          style={{
                            minHeight: 60,
                            borderBottom: index < allFiles.length - 1 ? '1px solid var(--paper-border-color)' : 'none',
                          }}
                        >
                          <Group gap="sm" align="center" style={{ flex: 1 }}>
                            <IconFile size={20} color="var(--chatbox-tint-brand)" />
                            <Box style={{ flex: 1 }}>
                              <Text size="sm" fw={500} lineClamp={1}>
                                {doc.filename}
                              </Text>
                              <Group gap="md" mt={2}>
                                <Text size="xs" c="dimmed">
                                  {formatDate(doc.createdAt)}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {formatFileSize(doc.file_size)}
                                </Text>
                                {doc.status === 'done' && (
                                  <>
                                    <Text
                                      size="xs"
                                      c="dimmed"
                                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        chunksPreview.openPreview(doc)
                                      }}
                                    >
                                      {doc.chunk_count} {t('chunks')}
                                    </Text>
                                    {doc.parser_type && (
                                      <Pill size="xs" c="dimmed">
                                        {doc.parser_type === 'chatbox-ai'
                                          ? 'Chatbox AI'
                                          : doc.parser_type === 'mineru'
                                            ? 'MinerU'
                                            : 'Local'}
                                      </Pill>
                                    )}
                                  </>
                                )}
                                {(doc.status === 'processing' || doc.status === 'paused') && doc.total_chunks > 0 && (
                                  <Box style={{ flex: 1, minWidth: 100 }}>
                                    <Group gap="xs" align="center">
                                      <Text
                                        size="xs"
                                        c="dimmed"
                                        style={{ cursor: 'pointer' }}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          chunksPreview.openPreview(doc)
                                        }}
                                      >
                                        {doc.chunk_count}/{doc.total_chunks} {t('chunks')} (
                                        {getProgressPercentage(doc.chunk_count, doc.total_chunks)}%)
                                      </Text>
                                    </Group>
                                    <Progress
                                      value={getProgressPercentage(doc.chunk_count, doc.total_chunks)}
                                      size="xs"
                                      mt={2}
                                      color={doc.status === 'processing' ? 'blue' : 'orange'}
                                      radius="lg"
                                    />
                                  </Box>
                                )}
                              </Group>
                            </Box>
                          </Group>

                          <Group gap="sm" align="center">
                            {doc.status === 'failed' ? (
                              getStatusIcon(doc.status, doc.error, doc.parser_type, doc.filename)
                            ) : (
                              <Center w={20} h={20}>
                                {getStatusIcon(doc.status, doc.error, doc.parser_type, doc.filename)}
                              </Center>
                            )}
                            {doc.status === 'failed' && doc.error !== KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR && (
                              <ActionIcon
                                variant="subtle"
                                color="blue"
                                size="sm"
                                onClick={() => handleRetryFile(doc.id, isChatboxAIParserLicenseRequired(doc.error))}
                                title={
                                  isChatboxAIParserLicenseRequired(doc.error)
                                    ? t('Retry with server parsing')
                                    : t('Retry locally')
                                }
                              >
                                <IconRefresh size={14} />
                              </ActionIcon>
                            )}
                            {doc.status === 'processing' && (
                              <ActionIcon
                                variant="subtle"
                                color="orange"
                                size="sm"
                                onClick={() => handlePauseFile(doc.id)}
                                title={t('Pause')}
                              >
                                <IconPlayerPause size={14} />
                              </ActionIcon>
                            )}
                            {doc.status === 'paused' && (
                              <ActionIcon
                                variant="subtle"
                                color="green"
                                size="sm"
                                onClick={() => handleResumeFile(doc.id)}
                                title={t('Resume')}
                              >
                                <IconPlayerPlay size={14} />
                              </ActionIcon>
                            )}
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              onClick={() => handleDeleteFile(doc.id)}
                              disabled={doc.status === 'processing'}
                              title={t('Delete')}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        </Group>
                      </Box>
                    ))}

                    {/* Loading indicator for next page */}
                    {isFetchingNextPage && (
                      <Center p="md">
                        <Loader size="sm" />
                      </Center>
                    )}
                  </Stack>
                </ScrollArea>

                {/* Scroll Indicator Mask */}
                {showScrollIndicator && (
                  <Box
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 30,
                      background: 'linear-gradient(transparent, var(--chatbox-background-body))',
                      pointerEvents: 'none',
                      zIndex: 1,
                    }}
                  />
                )}
              </Box>
            )}
            {/* Empty state or loading */}
            {isLoading && (
              <Center p="xl">
                <Loader size="lg" />
              </Center>
            )}
            {!isLoading && allFiles.length === 0 && (
              <Box p="xl">
                <Stack align="center" gap="sm">
                  <IconFile size={48} color="var(--chatbox-tint-placeholder)" />
                  <Text size="sm" c="dimmed" ta="center">
                    {t('No documents yet')}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center">
                    {t('Upload your first document to get started')}
                  </Text>
                </Stack>
              </Box>
            )}
          </Collapse>
        </Paper>
      </Box>

      {/* Chunks Preview Modal */}
      <ChunksPreviewModal
        opened={chunksPreview.isOpen}
        onClose={chunksPreview.closePreview}
        file={chunksPreview.selectedFile}
        knowledgeBaseId={knowledgeBase?.id}
      />

      {/* Remote Retry Modal */}
      <RemoteRetryModal
        opened={showRemoteRetryModal}
        onClose={() => setShowRemoteRetryModal(false)}
        failedFiles={failedFiles}
        onSuccess={() => {
          refetch()
          refetchCount()
        }}
      />
    </Stack>
  )
}

export default KnowledgeBaseDocuments
