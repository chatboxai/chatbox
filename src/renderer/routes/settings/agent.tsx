import { Box, Divider, Flex, Stack, Switch, Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CopilotMemoriesSection, MemoriesSection, SoulEditor } from '@/components/settings/agent-persona'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { featureFlags } from '@/utils/feature-flags'

export const Route = createFileRoute('/settings/agent')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const smartSwitchingDefault = useUIStore((s) => s.agentModeSmartSwitchingDefault)
  const setAgentModeSmartSwitchingDefault = useUIStore((s) => s.setAgentModeSmartSwitchingDefault)
  const memoryEnabled = useSettingsStore((s) => s.memoryEnabled !== false)
  const setSettings = useSettingsStore((s) => s.setSettings)
  // Memory is global and platform-independent; Smart Switching and Soul only mean
  // something where agent mode runs, so the page narrows to memory elsewhere.
  const showAgentSettings = featureFlags.agentMode

  return (
    <Box p="md">
      <Title order={5}>{showAgentSettings ? t('Agent') : t('Memory')}</Title>
      {showAgentSettings && (
        <Text size="sm" c="dimmed" mt="xs">
          {t('Configure default agent behavior, its Soul, and its memories.')}
        </Text>
      )}

      {showAgentSettings && (
        <Flex mt="md" justify="space-between" align="center" gap="md">
          <Stack gap={0}>
            <Text size="sm" fw={500}>
              {t('Smart Switching')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('Suggest Work Mode on the first message.')}
            </Text>
          </Stack>
          <Switch
            checked={smartSwitchingDefault}
            onChange={(event) => setAgentModeSmartSwitchingDefault(event.currentTarget.checked)}
          />
        </Flex>
      )}

      <Flex mt="md" justify="space-between" align="center" gap="md">
        <Stack gap={0}>
          <Text size="sm" fw={500}>
            {t('Memory')}
          </Text>
          <Text size="xs" c="dimmed">
            {t('Save facts from conversations and recall them in new chats. Works in both Chat and Work Mode.')}
          </Text>
        </Stack>
        <Switch
          checked={memoryEnabled}
          onChange={(event) => setSettings({ memoryEnabled: event.currentTarget.checked })}
        />
      </Flex>

      {showAgentSettings && (
        <>
          <Divider my="lg" />

          <Title order={6}>Soul</Title>
          <Text size="sm" c="dimmed" mt="xs">
            {t(
              'Soul defines who your agent is — persona, tone, and boundaries. It replaces per-session system prompts in agent mode and is loaded when an agent session starts.'
            )}
          </Text>
          <Box mt="md">
            <SoulEditor />
          </Box>
        </>
      )}

      <Divider my="lg" />

      <MemoriesSection />

      <CopilotMemoriesSection />
    </Box>
  )
}
