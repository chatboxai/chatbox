import { Button, Flex, Stack, Text, TextInput, Textarea, Alert, Badge, Group, ActionIcon, Tooltip } from '@mantine/core'
import { IconUpload, IconClipboard, IconTrash, IconPlus } from '@tabler/icons-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import type { ProviderModelInfo } from '@shared/types'

interface ParsedModel {
    modelId: string
    name: string
    type: string
    contextWindow?: number
    isDuplicate?: boolean
}

interface BatchImportModelsModalProps {
    opened: boolean
    onClose: () => void
    onImport: (models: ProviderModelInfo[]) => void
    existingModelIds: string[]
}

function parseModelInput(input: string): ParsedModel[] {
    const trimmed = input.trim()
    if (!trimmed) return []

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed)
            const arr = Array.isArray(parsed) ? parsed : [parsed]
            return arr
                .filter((item: any) => item.modelId || item.model_id || item.id || item.name)
                .map((item: any) => ({
                    modelId: (item.modelId || item.model_id || item.id || item.name).trim(),
                    name: item.name || item.displayName || (item.modelId || item.model_id || item.id || '').trim(),
                    type: item.type || 'chat',
                    contextWindow: item.contextWindow || item.context_window || undefined,
                }))
        } catch {}
    }

    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    const models: ParsedModel[] = []
    for (const line of lines) {
        const parts = line.split(',').map(p => p.trim()).filter(p => p.length > 0)
        if (parts.length === 0) continue
        const first = parts[0].toLowerCase()
        if (first === 'modelid' || first === 'model_id' || first === 'name' || first === 'model') continue
        models.push({
            modelId: parts[0],
            name: parts[1] || parts[0],
            type: parts[2] || 'chat',
            contextWindow: parts[3] ? parseInt(parts[3]) : undefined,
        })
    }
    return models
}

export function BatchImportModelsModal({ opened, onClose, onImport, existingModelIds }: BatchImportModelsModalProps) {
    const { t } = useTranslation()
    const [input, setInput] = useState('')
    const [parsedModels, setParsedModels] = useState<ParsedModel[]>([])
    const [error, setError] = useState<string | null>(null)

    const handleParse = useCallback(() => {
        setError(null)
        try {
            const models = parseModelInput(input)
            if (models.length === 0) {
                setError(t('No valid models found. Check the format and try again.'))
                return
            }
            const withDupes = models.map(m => ({
                ...m,
                isDuplicate: existingModelIds.includes(m.modelId),
            }))
            setParsedModels(withDupes)
        } catch (e: any) {
            setError(e.message || t('Failed to parse input'))
        }
    }, [input, existingModelIds, t])

    const handleImport = useCallback(() => {
        const newModels = parsedModels
            .filter(m => !m.isDuplicate)
            .map(m => ({
                modelId: m.modelId,
                name: m.name,
                type: m.type as any,
                contextWindow: m.contextWindow,
            }))
        if (newModels.length > 0) {
            onImport(newModels)
        }
        setInput('')
        setParsedModels([])
        setError(null)
        onClose()
    }, [parsedModels, onImport, onClose])

    const handlePaste = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText()
            setInput(text)
        } catch {}
    }, [])

    const handleRemoveParsed = useCallback((index: number) => {
        setParsedModels(prev => prev.filter((_, i) => i !== index))
    }, [])

    const handleReset = useCallback(() => {
        setInput('')
        setParsedModels([])
        setError(null)
    }, [])

    const newModels = parsedModels.filter(m => !m.isDuplicate)

    return (
        <AdaptiveModal
            opened={opened}
            onClose={() => { handleReset(); onClose() }}
            title={t('Batch Import Models')}
            centered
            size="lg"
        >
            <Stack gap="md">
                <Text size="sm" c="chatbox-secondary">
                    {t('Paste model names in JSON, CSV, or plain text format (one per line or comma-separated).')}
                </Text>

                <Flex gap="xs" align="center">
                    <Tooltip label={t('Paste from clipboard')}>
                        <ActionIcon variant="light" onClick={handlePaste}>
                            <ScalableIcon icon={IconClipboard} size={16} />
                        </ActionIcon>
                    </Tooltip>
                    <Text size="xs" c="chatbox-tertiary">
                        {t('Supported: JSON array, CSV (id,name,type), or plain model names')}
                    </Text>
                </Flex>

                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.currentTarget.value)}
                    placeholder={`JSON:\n[{"modelId":"gpt-4o","name":"GPT-4o","type":"chat"}]\n\nCSV:\ngpt-4o,GPT-4o,chat\n\nPlain text:\ngpt-4o\ngpt-4o-mini\nclaude-3-5-sonnet`}
                    minRows={6}
                    maxRows={12}
                    styles={{ input: { fontFamily: 'monospace', fontSize: '13px' } }}
                />

                <Button
                    variant="light"
                    onClick={handleParse}
                    disabled={!input.trim()}
                    leftSection={<ScalableIcon icon={IconUpload} size={16} />}
                    size="compact-sm"
                >
                    {t('Parse & Preview')}
                </Button>

                {error && (
                    <Alert color="red" variant="light">{error}</Alert>
                )}

                {parsedModels.length > 0 && (
                    <>
                        <Group justify="space-between">
                            <Text size="sm" fw={600}>
                                {t('Preview')} ({newModels.length} {t('new')})
                            </Text>
                            <Button variant="subtle" size="compact-xs" onClick={handleReset}>
                                {t('Clear')}
                            </Button>
                        </Group>

                        <Stack gap={4} style={{ maxHeight: 300, overflow: 'auto' }}>
                            {parsedModels.map((model, index) => (
                                <Flex
                                    key={index}
                                    justify="space-between"
                                    align="center"
                                    p="xs"
                                    style={{
                                        borderRadius: 4,
                                        backgroundColor: model.isDuplicate
                                            ? 'var(--mantine-color-yellow-light)'
                                            : 'var(--mantine-color-default-hover)',
                                        opacity: model.isDuplicate ? 0.6 : 1,
                                    }}
                                >
                                    <Flex gap="sm" align="center" style={{ flex: 1, minWidth: 0 }}>
                                        <Text size="sm" style={{ fontFamily: 'monospace' }} truncate>
                                            {model.modelId}
                                        </Text>
                                        {model.name !== model.modelId && (
                                            <Text size="xs" c="chatbox-tertiary" truncate>{model.name}</Text>
                                        )}
                                        <Badge size="xs" variant="light">{model.type}</Badge>
                                        {model.contextWindow && (
                                            <Badge size="xs" variant="outline" color="gray">
                                                {Math.round(model.contextWindow / 1000)}k
                                            </Badge>
                                        )}
                                    </Flex>
                                    <Flex gap="xs" align="center">
                                        {model.isDuplicate ? (
                                            <Badge size="xs" color="yellow">{t('exists')}</Badge>
                                        ) : (
                                            <ActionIcon
                                                variant="subtle"
                                                color="red"
                                                size="sm"
                                                onClick={() => handleRemoveParsed(index)}
                                            >
                                                <ScalableIcon icon={IconTrash} size={14} />
                                            </ActionIcon>
                                        )}
                                    </Flex>
                                </Flex>
                            ))}
                        </Stack>
                    </>
                )}

                <Group justify="flex-end">
                    <Button variant="default" onClick={() => { handleReset(); onClose() }}>
                        {t('Cancel')}
                    </Button>
                    <Button
                        onClick={handleImport}
                        disabled={newModels.length === 0}
                        leftSection={<ScalableIcon icon={IconPlus} size={16} />}
                    >
                        {t('Import')} {newModels.length > 0 ? `${newModels.length}` : ''} {t('Models')}
                    </Button>
                </Group>
            </Stack>
        </AdaptiveModal>
    )
}
