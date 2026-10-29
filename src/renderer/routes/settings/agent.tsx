import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CopilotMemoriesSection, MemoriesSection, SoulEditor } from '@/components/settings/agent-persona'
import { SettingSwitchRow, SettingsListItem, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
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
    <SettingsPage
      title={showAgentSettings ? t('Agent') : t('Memory')}
      description={showAgentSettings ? t('Configure default agent behavior, its Soul, and its memories.') : undefined}
    >
      <SettingsSection title={t('Behavior')}>
        {showAgentSettings && (
          <SettingSwitchRow
            id="smart-switching"
            label={t('Smart Switching')}
            description={t('Suggest Work Mode on the first message.')}
            checked={smartSwitchingDefault}
            onChange={setAgentModeSmartSwitchingDefault}
          />
        )}
        <SettingSwitchRow
          id="memory"
          label={t('Memory')}
          description={t(
            'Save facts from conversations and recall them in new chats. Works in both Chat and Work Mode.'
          )}
          checked={memoryEnabled}
          onChange={(checked) => setSettings({ memoryEnabled: checked })}
        />
      </SettingsSection>

      {showAgentSettings && (
        <SettingsSection
          title="Soul"
          description={t(
            'Soul defines who your agent is — persona, tone, and boundaries. It replaces per-session system prompts in agent mode and is loaded when an agent session starts.'
          )}
        >
          <SettingsListItem className="!block">
            <SoulEditor />
          </SettingsListItem>
        </SettingsSection>
      )}

      <MemoriesSection />

      <CopilotMemoriesSection />
    </SettingsPage>
  )
}
