import { Button, Flex, Stack, Text, Group, FileInput, Badge, Progress, Alert, ActionIcon } from '@mantine/core'
import { IconFileText, IconUpload, IconX, IconCheck } from '@tabler/icons-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'

interface ParsedDocument {
    id: string
    name: string
    type: string
    size: number
    content: string
    status: 'parsing' | 'done' | 'error'
    error?: string
}

interface DocumentParserProps {
    onDocumentsParsed: (docs: { name: string; content: string }[]) => void
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentParser({ onDocumentsParsed }: DocumentParserProps) {
    const { t } = useTranslation()
    const [documents, setDocuments] = useState<ParsedDocument[]>([])
    const [error, setError] = useState<string | null>(null)

    const parseFile = useCallback(async (file: File): Promise<ParsedDocument> => {
        const doc: ParsedDocument = {
            id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name, type: file.type, size: file.size, content: '', status: 'parsing',
        }
        try {
            doc.content = await file.text()
            doc.status = 'done'
        } catch (e: any) {
            doc.status = 'error'
            doc.error = e.message || 'Failed to parse file'
        }
        return doc
    }, [])

    const handleFileUpload = useCallback(async (files: File[]) => {
        setError(null)
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                setError(t('File {{name}} is too large (max 10MB)', { name: file.name }))
                continue
            }
            const doc = await parseFile(file)
            setDocuments(prev => [...prev, doc])
        }
    }, [parseFile, t])

    const handleRemove = useCallback((id: string) => {
        setDocuments(prev => prev.filter(d => d.id !== id))
    }, [])

    const handleSendToAgent = useCallback(() => {
        const parsed = documents.filter(d => d.status === 'done').map(d => ({ name: d.name, content: d.content }))
        if (parsed.length === 0) { setError(t('No parsed documents to send')); return }
        onDocumentsParsed(parsed)
        setDocuments([])
    }, [documents, onDocumentsParsed, t])

    const doneCount = documents.filter(d => d.status === 'done').length

    return (
        <Stack gap="md">
            <Flex justify="space-between" align="center">
                <Flex align="center" gap="xs">
                    <ScalableIcon icon={IconFileText} size={18} />
                    <Text fw={600}>{t('Document Parser')}</Text>
                    {doneCount > 0 && <Badge size="sm" variant="light">{doneCount}</Badge>}
                </Flex>
            </Flex>
            <Text size="sm" c="chatbox-secondary">
                {t('Upload documents to parse and send as context to the connected agent. Supports text, markdown, JSON, CSV, and HTML files.')}
            </Text>
            <FileInput placeholder={t('Click to select files or drag & drop')}
                leftSection={<ScalableIcon icon={IconUpload} size={16} />}
                multiple accept=".txt,.md,.json,.csv,.html,.htm" onChange={handleFileUpload} clearable />
            {error && <Alert color="red" variant="light" onClose={() => setError(null)} withCloseButton>{error}</Alert>}
            {documents.length > 0 && (
                <Stack gap="xs">
                    {documents.map((doc) => (
                        <Flex key={doc.id} justify="space-between" align="center" p="xs"
                            style={{ border: '1px solid var(--mantine-color-chatbox-border-secondary)', borderRadius: 4 }}>
                            <Flex align="center" gap="sm" style={{ flex: 1, minWidth: 0 }}>
                                <ScalableIcon icon={IconFileText} size={16} />
                                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                                    <Text size="sm" truncate>{doc.name}</Text>
                                    <Text size="xs" c="chatbox-tertiary">
                                        {formatFileSize(doc.size)}
                                        {doc.status === 'done' && ` • ${doc.content.length.toLocaleString()} chars`}
                                    </Text>
                                </Stack>
                                {doc.status === 'parsing' && <Progress size="xs" value={100} animated style={{ width: 60 }} />}
                                {doc.status === 'done' && <ScalableIcon icon={IconCheck} size={16} color="var(--mantine-color-green-filled)" />}
                                {doc.status === 'error' && <Text size="xs" color="red">{doc.error}</Text>}
                            </Flex>
                            <ActionIcon variant="subtle" color="red" size="sm" onClick={() => handleRemove(doc.id)}>
                                <ScalableIcon icon={IconX} size={14} />
                            </ActionIcon>
                        </Flex>
                    ))}
                    <Group justify="flex-end">
                        <Button variant="light" size="compact-sm" disabled={doneCount === 0} onClick={handleSendToAgent}>
                            {t('Send to Agent')} ({doneCount})
                        </Button>
                    </Group>
                </Stack>
            )}
        </Stack>
    )
}
