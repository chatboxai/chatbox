import { Button, Flex, Stack, Text, Group, ActionIcon, Tooltip, Badge, Collapse } from '@mantine/core'
import { IconRobot, IconPlus, IconTrash, IconChevronDown, IconChevronRight, IconPlug } from '@tabler/icons-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { AgentIntegrationModal } from './AgentIntegrationModal'

export interface ConnectedAgent {
    id: string
    name: string
    endpoint: string
    modelId: string
    apiKey?: string
    systemPrompt?: string
    headers?: Record<string, string>
    supportsTools?: boolean
    enabled?: boolean
}

interface AgentListProps {
    agents: ConnectedAgent[]
    onAdd: (agent: ConnectedAgent) => void
    onRemove: (id: string) => void
    onToggle: (id: string, enabled: boolean) => void
}

export function AgentList({ agents, onAdd, onRemove, onToggle }: AgentListProps) {
    const { t } = useTranslation()
    const [showAddModal, setShowAddModal] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const handleAdd = useCallback((config: {
        name: string; apiKey: string; endpoint: string; modelId: string
        modelName: string; systemPrompt?: string; headers?: Record<string, string>; supportsTools?: boolean
    }) => {
        onAdd({
            id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: config.name, endpoint: config.endpoint, modelId: config.modelId,
            apiKey: config.apiKey || undefined, systemPrompt: config.systemPrompt,
            headers: config.headers, supportsTools: config.supportsTools, enabled: true,
        })
    }, [onAdd])

    return (
        <Stack gap="md">
            <Flex justify="space-between" align="center">
                <Flex align="center" gap="xs">
                    <ScalableIcon icon={IconRobot} size={18} />
                    <Text fw={600}>{t('Connected Agents')}</Text>
                    {agents.length > 0 && <Badge size="sm" variant="light">{agents.length}</Badge>}
                </Flex>
                <Button variant="light" size="compact-sm"
                    leftSection={<ScalableIcon icon={IconPlus} size={14} />}
                    onClick={() => setShowAddModal(true)}>
                    {t('Connect Agent')}
                </Button>
            </Flex>

            <Text size="sm" c="chatbox-secondary">
                {t('Connect third-party AI agents (Hermes, OpenClaw, etc.) that expose an OpenAI-compatible API.')}
            </Text>

            {agents.length === 0 ? (
                <Flex direction="column" align="center" justify="center" py="xl" gap="md"
                    style={{ border: '1px dashed var(--mantine-color-chatbox-border-primary)', borderRadius: 8 }}>
                    <ScalableIcon icon={IconPlug} size={32} color="var(--mantine-color-chatbox-tertiary)" />
                    <Text size="sm" c="chatbox-tertiary">{t('No agents connected yet')}</Text>
                    <Button variant="light" size="compact-sm"
                        leftSection={<ScalableIcon icon={IconPlus} size={14} />}
                        onClick={() => setShowAddModal(true)}>
                        {t('Connect Your First Agent')}
                    </Button>
                </Flex>
            ) : (
                <Stack gap="xs">
                    {agents.map((agent) => {
                        const isExpanded = expandedId === agent.id
                        return (
                            <Stack key={agent.id} gap={0}
                                style={{ border: '1px solid var(--mantine-color-chatbox-border-primary)', borderRadius: 8, overflow: 'hidden' }}>
                                <Flex justify="space-between" align="center" p="sm"
                                    style={{ cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : agent.id)}>
                                    <Flex align="center" gap="sm">
                                        <ScalableIcon icon={isExpanded ? IconChevronDown : IconChevronRight} size={16}
                                            color="var(--mantine-color-chatbox-tertiary)" />
                                        <ScalableIcon icon={IconRobot} size={18} />
                                        <Stack gap={0}>
                                            <Text size="sm" fw={500}>{agent.name}</Text>
                                            <Text size="xs" c="chatbox-tertiary" style={{ fontFamily: 'monospace' }}>{agent.modelId}</Text>
                                        </Stack>
                                    </Flex>
                                    <Flex align="center" gap="xs">
                                        {agent.supportsTools && <Badge size="xs" variant="light" color="green">Tools</Badge>}
                                        <Badge size="xs" variant="light" color={agent.enabled ? 'blue' : 'gray'}>
                                            {agent.enabled ? t('Active') : t('Disabled')}
                                        </Badge>
                                        <Tooltip label={t('Remove')}>
                                            <ActionIcon variant="subtle" color="red" size="sm"
                                                onClick={(e) => { e.stopPropagation(); onRemove(agent.id) }}>
                                                <ScalableIcon icon={IconTrash} size={14} />
                                            </ActionIcon>
                                        </Tooltip>
                                    </Flex>
                                </Flex>
                                <Collapse in={isExpanded}>
                                    <Stack gap="xs" px="sm" pb="sm"
                                        style={{ borderTop: '1px solid var(--mantine-color-chatbox-border-secondary)' }}>
                                        <Flex gap="md" pt="sm">
                                            <Text size="xs" fw={500} w={80} c="chatbox-secondary">{t('Endpoint')}:</Text>
                                            <Text size="xs" style={{ fontFamily: 'monospace' }}>{agent.endpoint}</Text>
                                        </Flex>
                                        <Flex gap="md">
                                            <Text size="xs" fw={500} w={80} c="chatbox-secondary">{t('Model')}:</Text>
                                            <Text size="xs" style={{ fontFamily: 'monospace' }}>{agent.modelId}</Text>
                                        </Flex>
                                        {agent.systemPrompt && (
                                            <Flex gap="md">
                                                <Text size="xs" fw={500} w={80} c="chatbox-secondary">{t('System Prompt')}:</Text>
                                                <Text size="xs" lineClamp={3}>{agent.systemPrompt}</Text>
                                            </Flex>
                                        )}
                                    </Stack>
                                </Collapse>
                            </Stack>
                        )
                    })}
                </Stack>
            )}

            <AgentIntegrationModal opened={showAddModal} onClose={() => setShowAddModal(false)} onAddProvider={handleAdd} />
        </Stack>
    )
}
