import {
  ActionIcon,
  Box,
  Button,
  Center,
  Collapse,
  Group,
  Loader,
  Paper,
  Pill,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconFile,
  IconLoader,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { FileMeta, KnowledgeBase } from 'src/shared/types'
import { formatFileSize } from 'src/shared/utils'
import { useKnowledgeBaseFiles, useKnowledgeBaseFilesActions, useKnowledgeBaseFilesCount } from '@/hooks/knowledge-base'
import { useChunksPreview } from '@/hooks/useChunksPreview'
import platform from '@/platform'
import ChunksPreviewModal from './ChunksPreviewModal'

interface KnowledgeBaseDocumentsProps {
  knowledgeBase: KnowledgeBase | null
}

const KnowledgeBaseDocuments: React.FC<KnowledgeBaseDocumentsProps> = ({ knowledgeBase }) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [showScrollIndicator, setShowScrollIndicator] = React.useState(true)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [showUploadArea, setShowUploadArea] = React.useState(false)

  const scrollAreaRef = React.useRef<HTMLDivElement>(null)

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
  const allFiles = React.useMemo(() => {
    return filesData?.pages.flatMap((page) => page.files) || []
  }, [filesData])

  // Real-time polling for file status updates
  React.useEffect(() => {
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

  // MIME type correction for Windows compatibility
  const correctMimeType = React.useCallback((file: File): FileMeta => {
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

      console.log(`[Upload] Corrected MIME type for ${file.name}: "${file.type}" -> "${mimeType}"`)
    }

    return {
      name: file.name,
      path: file.path,
      type: mimeType,
      size: file.size,
    }
  }, [])

  // Calculate height for exactly 5 document items (each item ~60px + gaps)
  const maxHeight = 5 * 60 // 5 items * 60px

  // Handle scroll position change
  const handleScrollPositionChange = React.useCallback((position: { x: number; y: number }) => {
    setShowScrollIndicator(true)
  }, [])

  const handleScrollToBottom = React.useCallback(() => {
    setShowScrollIndicator(false)
    fetchNextPage()
  }, [fetchNextPage])

  // Update scroll indicator when documents change
  React.useEffect(() => {
    setShowScrollIndicator(allFiles.length > 5)
  }, [allFiles.length])

  // Get supported file types
  const getSupportedFileTypes = React.useCallback(() => {
    const documentTypes = [
      '.pdf',
      '.doc',
      '.docx',
      '.txt',
      '.md',
      '.rtf',
      '.ppt',
      '.pptx',
      '.xls',
      '.xlsx',
      '.csv',
      '.epub',
    ]
    const imageTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

    // Add MIME types for better Windows compatibility
    const documentMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'application/rtf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/epub+zip',
    ]
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
  }, [knowledgeBase?.visionModel])

  // Handle file upload (shared logic)
  const uploadFiles = React.useCallback(
    async (files: FileList) => {
      if (!knowledgeBase?.id || !files.length) return

      console.log(`[Upload] Starting upload for ${files.length} files.`)

      try {
        const knowledgeBaseController = platform.getKnowledgeBaseController()

        // Process and correct MIME types for all files
        const correctedFiles: FileMeta[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const correctedFile = correctMimeType(file)
          correctedFiles.push(correctedFile)

          console.log(`[Upload] File ${i + 1}/${files.length}: ${file.name} (${correctedFile.type})`)
        }

        // Upload all files using allSettled to allow partial successes
        const uploadResults = await Promise.allSettled(
          correctedFiles.map(async (file) => {
            console.log(`[Upload] Starting upload for file: ${file.name}`)
            await knowledgeBaseController.uploadFile(knowledgeBase.id, file)
            return file
          })
        )

        // Count successes and failures
        const successfulUploads = uploadResults.filter((result) => result.status === 'fulfilled')
        const failedUploads = uploadResults.filter((result) => result.status === 'rejected')

        // Log individual failures
        failedUploads.forEach((result, index) => {
          if (result.status === 'rejected') {
            const fileName = correctedFiles[uploadResults.indexOf(result)]?.name || 'Unknown file'
            console.error(`[Upload] Failed to upload file ${fileName}:`, result.reason)
            toast.error(
              t('Failed to upload {{filename}}: {{error}}', {
                filename: fileName,
                error: (result.reason as Error)?.message || 'Unknown error',
              })
            )
          }
        })

        // Provide appropriate user feedback
        if (successfulUploads.length > 0 && failedUploads.length === 0) {
          console.log(`[Upload] All files uploaded successfully.`)
          toast.success(t('Successfully uploaded {{count}} file(s)', { count: successfulUploads.length }))
        } else if (successfulUploads.length > 0 && failedUploads.length > 0) {
          console.log(
            `[Upload] Partial success: ${successfulUploads.length} succeeded, ${failedUploads.length} failed.`
          )
          toast.success(
            t('Successfully uploaded {{success}} of {{total}} file(s). {{failed}} file(s) failed.', {
              success: successfulUploads.length,
              total: files.length,
              failed: failedUploads.length,
            })
          )
        } else if (failedUploads.length === files.length) {
          console.log(`[Upload] All files failed to upload.`)
          // Don't show additional error toast here since individual errors were already shown
        }

        // Track successful uploads only
        if (successfulUploads.length > 0) {

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
        toast.error(
          t('Upload failed: {{error}}', {
            error: (error as Error)?.message || 'Unknown error',
          })
        )
      }
    },
    [knowledgeBase?.id, knowledgeBase?.name, correctMimeType, refetch, refetchCount, invalidateFiles, isExpanded, t]
  )

  // Validate file type against supported types
  const validateFileType = React.useCallback(
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
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only hide drag over state if we're leaving the drop zone completely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = React.useCallback(
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
        toast.error(
          t('{{count}} file(s) not supported: {{files}}. Supported formats: {{formats}}', {
            count: invalidFiles.length,
            files: invalidFileNames,
            formats: supportedTypes.display.join(', '),
          })
        )
      }

      // Upload valid files if any
      if (validFiles.length > 0) {
        console.log(`[Upload] Drag & Drop: ${validFiles.length} valid files out of ${files.length} total`)

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
  const handleDeleteFile = React.useCallback(
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
  const handleRetryFile = React.useCallback(
    async (fileId: number) => {
      try {
        const knowledgeBaseController = platform.getKnowledgeBaseController()
        await knowledgeBaseController.retryFile(fileId)
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
  const handlePauseFile = React.useCallback(
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
  const handleResumeFile = React.useCallback(
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

  const getStatusIcon = (status: string, error?: string) => {
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
      case 'failed':
        return (
          <Tooltip
            label={error || t('Processing failed')}
            multiline
            w={300}
            withArrow
            position="top"
            transitionProps={{ duration: 200 }}
          >
            <IconX size={16} color="var(--chatbox-tint-error)" style={{ cursor: 'help' }} />
          </Tooltip>
        )
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
  const handleAddFile = React.useCallback(async () => {
    if (!knowledgeBase?.id) return

    // Toggle upload area visibility
    setShowUploadArea(!showUploadArea)
    if (!showUploadArea) {
      setIsExpanded(true)
    }
  }, [knowledgeBase?.id, showUploadArea])

  // Handle file selection via file dialog
  const handleFileDialog = React.useCallback(async () => {
    if (!knowledgeBase?.id) return

    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      const { accept } = getSupportedFileTypes()
      input.accept = accept

      console.log('[Upload] File dialog accept types:', accept)

      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files
        if (!files || !files.length) return

        console.log('[Upload] Files selected:', files.length)
        await uploadFiles(files)
      }

      // Add a small delay for better Windows compatibility
      setTimeout(() => {
        input.click()
      }, 10)
    } catch (error) {
      console.error('Failed to upload file:', error)
      toast.error(
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
        <Paper withBorder radius="sm" p={0}>
          {/* Documents Header */}
          <Group
            align="center"
            justify="space-between"
            px="sm"
            py="2px"
            style={{
              cursor: 'pointer',
              backgroundColor: 'var(--chatbox-background-secondary)',
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
                  radius="md"
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
                  </Stack>
                </Paper>
              </Box>
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
                                      radius="sm"
                                    />
                                  </Box>
                                )}
                              </Group>
                            </Box>
                          </Group>

                          <Group gap="sm" align="center">
                            <Center w={20} h={20}>
                              {getStatusIcon(doc.status, doc.error)}
                            </Center>
                            {doc.status === 'failed' && (
                              <ActionIcon
                                variant="subtle"
                                color="blue"
                                size="sm"
                                onClick={() => handleRetryFile(doc.id)}
                                title={t('Retry')}
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
    </Stack>
  )
}

export default KnowledgeBaseDocuments
