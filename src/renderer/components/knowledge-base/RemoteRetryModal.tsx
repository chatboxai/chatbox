import { Alert, Button, Flex, Group, ScrollArea, Stack, Text } from '@mantine/core'
import type { KnowledgeBaseFile } from '@shared/types'
import { formatFileSize } from '@shared/utils'
import { IconAlertTriangle, IconFile, IconInfoCircle, IconRefresh } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Modal } from '@/components/layout/Overlay'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { toastError } from '@/packages/toast'
import platform from '@/platform'
import { KnowledgeBaseFileErrorButton } from './KnowledgeBaseFileErrorButton'
import {
  canRetryKnowledgeBaseFileWithServer,
  getKnowledgeBaseFileErrorLabel,
  isChatboxAIParserLicenseRequired,
} from './knowledge-base-file-error'

interface RemoteRetryModalProps {
  opened: boolean
  onClose: () => void
  failedFiles: KnowledgeBaseFile[]
  onSuccess: () => void
}

export function RemoteRetryModal({ opened, onClose, failedFiles, onSuccess }: RemoteRetryModalProps) {
  const { t } = useTranslation()
  const [retryingIds, setRetryingIds] = useState<number[]>([])
  const [retryingAll, setRetryingAll] = useState(false)

  const remoteRetryableFiles = useMemo(() => failedFiles.filter(canRetryKnowledgeBaseFileWithServer), [failedFiles])

  const handleRetry = async (fileId: number, filename: string) => {
    setRetryingIds((prev) => [...prev, fileId])
    try {
      const controller = platform.getKnowledgeBaseController()
      await controller.retryFile(fileId, true) // useRemoteParsing = true
      toast.success(t('File {{filename}} queued for server parsing', { filename }))
      onSuccess()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      toastError(t('Failed to retry {{filename}}: {{error}}', { filename, error: errorMessage }))
    } finally {
      setRetryingIds((prev) => prev.filter((id) => id !== fileId))
    }
  }

  const handleRetryAll = async () => {
    setRetryingAll(true)
    try {
      const controller = platform.getKnowledgeBaseController()
      const results = await Promise.allSettled(remoteRetryableFiles.map((f) => controller.retryFile(f.id, true)))

      const successCount = results.filter((r) => r.status === 'fulfilled').length
      const failCount = results.filter((r) => r.status === 'rejected').length

      if (successCount > 0) {
        toast.success(t('{{count}} file(s) queued for server parsing', { count: successCount }))
      }
      if (failCount > 0) {
        toastError(t('{{count}} file(s) failed to queue', { count: failCount }))
      }

      onSuccess()
      onClose()
    } finally {
      setRetryingAll(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t('Retry with Server Parsing')} size="lg" centered>
      <Stack gap="md">
        {/* Warning alert */}
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
          {t('Server parsing will consume compute credits. Please be cautious with large files.')}
        </Alert>

        {/* Action bar */}
        <Group justify="flex-end">
          <Button
            leftSection={<IconRefresh size={14} />}
            onClick={handleRetryAll}
            loading={retryingAll}
            disabled={remoteRetryableFiles.length === 0}
          >
            {t('Retry All')} ({remoteRetryableFiles.length})
          </Button>
        </Group>

        {/* File list */}
        <ScrollArea h={300}>
          <Stack gap="xs">
            {failedFiles.map((file) => {
              const isRetryable = canRetryKnowledgeBaseFileWithServer(file)
              const isLicenseError = isChatboxAIParserLicenseRequired(file.error)
              return (
                <Flex
                  key={file.id}
                  justify="space-between"
                  align="center"
                  p="xs"
                  className="rounded-lg"
                  bg="var(--mantine-color-gray-0)"
                >
                  <Flex gap="sm" align="center" style={{ flex: 1, minWidth: 0 }}>
                    <IconFile size={16} className="flex-shrink-0" />
                    <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
                      {file.filename}
                    </Text>
                    <Text size="xs" c="dimmed" className="flex-shrink-0">
                      {formatFileSize(file.file_size)}
                    </Text>
                    {/* Error info tooltip */}
                    {file.error && (
                      <Tooltip
                        label={
                          isLicenseError
                            ? t('Sign in needed')
                            : getKnowledgeBaseFileErrorLabel(file.error, (key, options) =>
                                String(options ? t(key, { limit: options.limit }) : t(key))
                              )
                        }
                        multiline
                        w={300}
                        withArrow
                        position="top"
                      >
                        {isLicenseError ? (
                          <KnowledgeBaseFileErrorButton
                            errorCode={file.error}
                            fileName={file.filename}
                            label={t('Sign in needed')}
                          >
                            <IconInfoCircle size={14} color="var(--mantine-color-red-6)" />
                          </KnowledgeBaseFileErrorButton>
                        ) : (
                          <IconInfoCircle
                            size={14}
                            color="var(--mantine-color-red-6)"
                            className="flex-shrink-0 cursor-help"
                          />
                        )}
                      </Tooltip>
                    )}
                  </Flex>
                  {!isRetryable ? (
                    <Text size="xs" c="dimmed" ml="sm">
                      {t('No retry available')}
                    </Text>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      ml="sm"
                      onClick={() => handleRetry(file.id, file.filename)}
                      loading={retryingIds.includes(file.id)}
                      disabled={retryingAll}
                    >
                      {t('Retry')}
                    </Button>
                  )}
                </Flex>
              )
            })}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
  )
}
