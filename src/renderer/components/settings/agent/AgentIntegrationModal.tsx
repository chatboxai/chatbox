import { Button, Flex, Stack, Text, TextInput, Textarea, Switch, Select, Group, Badge, Alert, ActionIcon } from '@mantine/core'
import { IconRobot, IconPlus, IconTrash } from '@tabler/icons-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'

interface AgentPreset {
    id: string
    name: string
    description: string
    endpoint: string
    defaultModel?: string
    supportsTools?: boolean
}

const BUILTIN_AGENT_PRESETS: AgentPreset[] = [
    {
        id: 'hermes',
        name: 'Hermes Agent',
        description: 'Open-source AI agent framework with tool calling support',
        endpoint: 'http://localhost:8080/v1',
        defaultModel: 'hermes',
        supportsTools: true,
    },
    {
        id: 'openclaw',
        name: 'OpenClaw',
        description: 'Open-source AI assistant with extensible tool ecosystem',
        endpoint: 'http://localhost:3000/v1',
        defaultModel: 'openclaw',
        supportsTools: true,
    },
    {
        id: 'openai-compatible',
        name: 'Generic OpenAI-compatible',
        description: 'Any service implementing the OpenAI API format',
        endpoint: 'http://localhost:8080/v1',
        supportsTools: true,
    },
]

interface AgentIntegrationModalProps {
    opened: boolean
    onClose: () => void
    onAddProvider: (config: {
        name: string
        apiKey: string
        endpoint: string
        modelId: string
        modelName: string
        systemPrompt?: string
        headers?: Record<string, string>
        supportsTools?: boolean
    }) => void
}

export function AgentIntegrationModal({ opened, onClose, onAddProvider }: AgentIntegrationModalProps) {
    const { t } = useTranslation()
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
    const [agentName, setAgentName] = useState('')
    const [endpoint, setEndpoint] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [modelId, setModelId] = useState('')
    const [systemPrompt, setSystemPrompt] = useState('')
    const [customHeaders, setCustomHeaders] = useState<Array<{ key: string; value: string }>>([])
    const [supportsTools, setSupportsTools] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const handlePresetSelect = useCallback((presetId: string | null) => {
        setSelectedPreset(presetId)
        const preset = BUILTIN_AGENT_PRESETS.find(p => p.id === presetId)
        if (preset) {
            setAgentName(preset.name)
            setEndpoint(preset.endpoint)
            setModelId(preset.defaultModel || '')
            setSupportsTools(preset.supportsTools ?? true)
        }
    }, [])

    const handleAdd = useCallback(() => {
        setError(null)
        if (!agentName.trim()) { setError(t('Agent name is required')); return }
        if (!endpoint.trim()) { setError(t('API endpoint is required')); return }
        if (!modelId.trim()) { setError(t('Model ID is required')); return }
        try { new URL(endpoint) } catch { setError(t('Invalid endpoint URL')); return }

        const headers: Record<string, string> = {}
        for (const h of customHeaders) {
            if (h.key.trim() && h.value.trim()) headers[h.key.trim()] = h.value.trim()
        }

        onAddProvider({
            name: agentName.trim(),
            apiKey: apiKey.trim(),
            endpoint: endpoint.trim(),
            modelId: modelId.trim(),
            modelName: agentName.trim(),
            systemPrompt: systemPrompt.trim() || undefined,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            supportsTools,
        })

        setSelectedPreset(null); setAgentName(''); setEndpoint(''); setApiKey('')
        setModelId(''); setSystemPrompt(''); setCustomHeaders([]); setSupportsTools(true)
        onClose()
    }, [agentName, endpoint, apiKey, modelId, systemPrompt, customHeaders, supportsTools, onAddProvider, onClose, t])

    const handleClose = useCallback(() => {
        setSelectedPreset(null); setAgentName(''); setEndpoint(''); setApiKey('')
        setModelId(''); setSystemPrompt(''); setCustomHeaders([]); setSupportsTools(true)
        setError(null); onClose()
    }, [onClose])

    return (
        <AdaptiveModal opened={opened} onClose={handleClose} title={
            <Flex align="center" gap="xs">
                <ScalableIcon icon={IconRobot} size={20} />
                <Text fw={600}>{t('Connect Agent')}</Text>
            </Flex>
        } centered size="lg">
            <Stack gap="md">
                <Text size="sm" c="chatbox-secondary">
                    {t('Connect a third-party AI agent that exposes an OpenAI-compatible API (e.g., Hermes, OpenClaw, or any compatible service).')}
                </Text>

                <Select
                    label={t('Quick Preset')}
                    placeholder={t('Choose a preset or configure manually')}
                    data={BUILTIN_AGENT_PRESETS.map(p => ({ value: p.id, label: `${p.name} — ${p.description}` }))}
                    value={selectedPreset}
                    onChange={handlePresetSelect}
                    clearable searchable
                />

                <TextInput label={t('Agent Name')} placeholder={t('e.g. Hermes Agent, My Custom Agent')}
                    value={agentName} onChange={(e) => setAgentName(e.currentTarget.value)} required />

                <TextInput label={t('API Endpoint')} placeholder="http://localhost:8080/v1"
                    value={endpoint} onChange={(e) => setEndpoint(e.currentTarget.value)} required
                    description={t("The base URL of the agent's OpenAI-compatible API")} />

                <TextInput label={t('API Key')} placeholder={t('Optional — leave empty if not required')}
                    value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} type="password" />

                <TextInput label={t('Model ID')} placeholder={t('e.g. hermes, gpt-4, agent-model')}
                    value={modelId} onChange={(e) => setModelId(e.currentTarget.value)} required
                    description={t('The model identifier to use in API requests')} />

                <Textarea label={t('System Prompt')} placeholder={t('Optional — default system prompt for this agent')}
                    value={systemPrompt} onChange={(e) => setSystemPrompt(e.currentTarget.value)} minRows={3} maxRows={8} />

                <Switch label={t('Supports Tool Calling')}
                    description={t('Enable if this agent supports function/tool calling')}
                    checked={supportsTools} onChange={(e) => setSupportsTools(e.currentTarget.checked)} />

                <Stack gap="xs">
                    <Flex justify="space-between" align="center">
                        <Text size="sm" fw={500}>{t('Custom Headers')}</Text>
                        <Button variant="subtle" size="compact-xs"
                            leftSection={<ScalableIcon icon={IconPlus} size={12} />}
                            onClick={() => setCustomHeaders(prev => [...prev, { key: '', value: '' }])}>
                            {t('Add')}
                        </Button>
                    </Flex>
                    {customHeaders.map((header, index) => (
                        <Flex key={index} gap="xs" align="center">
                            <TextInput placeholder="Header-Name" value={header.key}
                                onChange={(e) => setCustomHeaders(prev => prev.map((h, i) => i === index ? { ...h, key: e.currentTarget.value } : h))}
                                size="xs" style={{ flex: 1 }} />
                            <TextInput placeholder="value" value={header.value}
                                onChange={(e) => setCustomHeaders(prev => prev.map((h, i) => i === index ? { ...h, value: e.currentTarget.value } : h))}
                                size="xs" style={{ flex: 2 }} />
                            <ActionIcon variant="subtle" color="red" size="sm"
                                onClick={() => setCustomHeaders(prev => prev.filter((_, i) => i !== index))}>
                                <ScalableIcon icon={IconTrash} size={14} />
                            </ActionIcon>
                        </Flex>
                    ))}
                    {customHeaders.length === 0 && (
                        <Text size="xs" c="chatbox-tertiary">{t('No custom headers configured')}</Text>
                    )}
                </Stack>

                {error && <Alert color="red" variant="light">{error}</Alert>}

                <Group justify="flex-end">
                    <Button variant="default" onClick={handleClose}>{t('Cancel')}</Button>
                    <Button onClick={handleAdd} leftSection={<ScalableIcon icon={IconRobot} size={16} />}>
                        {t('Connect Agent')}
                    </Button>
                </Group>
            </Stack>
        </AdaptiveModal>
    )
}
