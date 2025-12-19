import { Center, Code, Group, Loader, Paper, ScrollArea, Stack, Text } from '@mantine/core'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeBaseFile } from 'src/shared/types'
import platform from '@/platform'
import { Modal } from '../Overlay'

interface FileChunk {
  fileId: number
  filename: string
  chunkIndex: number
  text: string
}

interface ChunksPreviewModalProps {
  opened: boolean
  onClose: () => void
  file: KnowledgeBaseFile | null
  knowledgeBaseId?: number
  maxChunks?: number
}

const ChunksPreviewModal: React.FC<ChunksPreviewModalProps> = ({
  opened,
  onClose,
  file,
  knowledgeBaseId,
  maxChunks = 5,
}) => {
  const { t } = useTranslation()
  const [chunks, setChunks] = useState<FileChunk[]>([])
  const [loading, setLoading] = useState(false)

  const knowledgeBaseController = React.useMemo(() => {
    return platform.getKnowledgeBaseController()
  }, [])

  // Load chunks when modal opens and file is selected
  useEffect(() => {
    if (!opened || !file || !knowledgeBaseId) {
      setChunks([])
      return
    }

    const loadChunks = async () => {
      setLoading(true)
      setChunks([])

      try {
        // Load specified number of chunks
        const chunkIndices = Array.from({ length: Math.min(maxChunks, file.chunk_count || 0) }, (_, index) => ({
          fileId: file.id,
          chunkIndex: index,
        }))

        const chunksData = await knowledgeBaseController.readFileChunks(knowledgeBaseId, chunkIndices)
        setChunks(chunksData)
      } catch (error) {
        console.error('Failed to load chunks preview:', error)
      } finally {
        setLoading(false)
      }
    }

    loadChunks()
  }, [opened, file, knowledgeBaseId, maxChunks, knowledgeBaseController])

  return (
    <Modal opened={opened} onClose={onClose} title={t('File Chunks Preview')} size="lg" centered>
      {file && (
        <Stack gap="md">
          <Group gap="xs">
            <Text fw={500}>{file.filename}</Text>
            <Text size="sm" c="dimmed">
              ({t('Showing first {{count}} chunks', { count: maxChunks })})
            </Text>
          </Group>

          {loading ? (
            <Center py="xl">
              <Group gap="xs">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  {t('Loading chunks...')}
                </Text>
              </Group>
            </Center>
          ) : chunks.length > 0 ? (
            <ScrollArea h={400}>
              <Stack gap="sm">
                {chunks.map((chunk) => (
                  <ChunkCard key={`${chunk.fileId}-${chunk.chunkIndex}`} chunk={chunk} />
                ))}
              </Stack>
            </ScrollArea>
          ) : (
            <Center py="xl">
              <Text size="sm" c="dimmed">
                {t(
                  'No chunks available. Try converting the file to a text format before adding it to the knowledge base.'
                )}
              </Text>
            </Center>
          )}
        </Stack>
      )}
    </Modal>
  )
}

interface ChunkCardProps {
  chunk: FileChunk
}

const ChunkCard: React.FC<ChunkCardProps> = ({ chunk }) => {
  const { t } = useTranslation()

  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={500} size="sm">
            {t('Chunk')} {chunk.chunkIndex}
          </Text>
          <Text size="xs" c="dimmed">
            {chunk.text.length} {t('characters')}
          </Text>
        </Group>
        <Code
          block
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: '12px',
            maxHeight: '150px',
            overflow: 'auto',
          }}
        >
          {chunk.text.length > 300 ? `${chunk.text.substring(0, 300)}...` : chunk.text}
        </Code>
      </Stack>
    </Paper>
  )
}

export default ChunksPreviewModal
