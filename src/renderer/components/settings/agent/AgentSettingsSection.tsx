import { Stack, Text, Divider } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { AgentList, type ConnectedAgent } from '@/components/settings/agent/AgentList'

interface AgentSettingsSectionProps {
    agents: ConnectedAgent[]
    onAgentsChange: (agents: ConnectedAgent[]) => void
}

export function AgentSettingsSection({ agents, onAgentsChange }: AgentSettingsSectionProps) {
    const { t } = useTranslation()

    const handleAdd = (agent: ConnectedAgent) => onAgentsChange([...agents, agent])
    const handleRemove = (id: string) => onAgentsChange(agents.filter(a => a.id !== id))
    const handleToggle = (id: string, enabled: boolean) => onAgentsChange(agents.map(a => a.id === id ? { ...a, enabled } : a))

    return (
        <Stack gap="lg">
            <Stack gap="xs">
                <Text size="lg" fw={600}>{t('Agent Integration')}</Text>
                <Text size="sm" c="chatbox-secondary">
                    {t('Connect third-party AI agents and assistants that expose an OpenAI-compatible API. Supports Hermes, OpenClaw, LangChain agents, and any other compatible service.')}
                </Text>
            </Stack>
            <AgentList agents={agents} onAdd={handleAdd} onRemove={handleRemove} onToggle={handleToggle} />
            <Divider />
            <Stack gap="xs">
                <Text size="sm" fw={500}>{t('Supported Agent Frameworks')}</Text>
                <Text size="xs" c="chatbox-tertiary">
                    {t('Any agent that exposes an OpenAI-compatible /v1/chat/completions endpoint can be connected. This includes:')}
                </Text>
                <Stack gap={2} pl="md">
                    <Text size="xs" c="chatbox-secondary">• Hermes — Tool-calling agent framework</Text>
                    <Text size="xs" c="chatbox-secondary">• OpenClaw — Open-source AI assistant</Text>
                    <Text size="xs" c="chatbox-secondary">• LangChain agents — Via LangServe or custom endpoints</Text>
                    <Text size="xs" c="chatbox-secondary">• AutoGPT / AgentGPT — With API adapter</Text>
                    <Text size="xs" c="chatbox-secondary">• Any custom agent with OpenAI-compatible API</Text>
                </Stack>
            </Stack>
        </Stack>
    )
}
