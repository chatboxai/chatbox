import { DEFAULT_COMPACTION_THRESHOLD } from '@chatbox/core/application/token-estimation/math'
import { Button, Collapse, Flex, Slider, Text, Textarea } from '@mantine/core'
import { getDefaultCompactionPrompt } from '@shared/prompts'
import { IconChevronDown } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingRow, SettingSwitchRow, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
import { languageNameMap } from '@/i18n/locales'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/context')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const [promptOpen, setPromptOpen] = useState(settings.compactionPrompt !== undefined)
  const autoCompaction = settings.autoCompaction ?? true
  const threshold = settings.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD

  const strategyHint = useMemo(() => {
    if (threshold <= 0.5) {
      return t('Cost Priority: Compacts early to save tokens, may lose some context')
    }
    if (threshold >= 0.8) {
      return t('Context Priority: Preserves more context, uses more tokens')
    }
    return t('Balanced: Good balance between cost and context preservation')
  }, [threshold, t])

  return (
    <SettingsPage
      title={t('Context & Compaction')}
      description={t("Summarize long conversations so they stay within the model's context window.")}
    >
      <SettingsSection>
        <SettingSwitchRow
          id="auto-compaction"
          label={t('Auto Compaction')}
          description={t(
            'When enabled, conversations will be automatically summarized to manage context window usage.'
          )}
          checked={autoCompaction}
          onChange={(checked) => setSettings({ autoCompaction: checked })}
        />
        <SettingRow
          id="compaction-threshold"
          label={t('Compaction Threshold')}
          description={t(
            'The percentage of context window usage that triggers automatic compaction. Lower values save tokens but may lose context earlier.'
          )}
          controlLayout="block"
          disabled={!autoCompaction}
          control={
            <div className="flex flex-col gap-1.5">
              <Flex align="center" gap="sm">
                <Slider
                  flex={1}
                  min={0.4}
                  max={0.9}
                  step={0.05}
                  value={threshold}
                  onChange={(v) => setSettings({ compactionThreshold: v })}
                  label={(v) => `${Math.round(v * 100)}%`}
                  disabled={!autoCompaction}
                  aria-label={t('Compaction Threshold') ?? undefined}
                />
                <Text fz={13} fw={500} w={44} ta="right">
                  {Math.round(threshold * 100)}%
                </Text>
              </Flex>
              <Flex justify="space-between" pe={52}>
                <Text fz={12} c="chatbox-tertiary">
                  {t('Cost')}
                </Text>
                <Text fz={12} c="chatbox-tertiary">
                  {t('Context')}
                </Text>
              </Flex>
              <Text fz={12} c="chatbox-tertiary">
                {strategyHint}
              </Text>
            </div>
          }
        />
        <SettingRow
          id="compaction-prompt"
          label={t('Compaction Prompt')}
          description={t('Used for automatic and manual compression. Leave empty to use the built-in prompt.')}
          control={
            <Button
              variant="subtle"
              color="chatbox-gray"
              size="compact-sm"
              aria-expanded={promptOpen}
              rightSection={
                <ScalableIcon
                  icon={IconChevronDown}
                  size={14}
                  className={clsx('transition-transform', promptOpen && 'rotate-180')}
                />
              }
              onClick={() => setPromptOpen((open) => !open)}
            >
              {promptOpen ? t('Collapse') : t('Edit')}
            </Button>
          }
        >
          <Collapse in={promptOpen}>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <Textarea
                aria-label={t('Compaction Prompt') ?? undefined}
                value={settings.compactionPrompt ?? getDefaultCompactionPrompt(languageNameMap[settings.language])}
                onChange={(event) => setSettings({ compactionPrompt: event.currentTarget.value })}
                autosize
                minRows={5}
                maxRows={12}
              />
              <Button
                variant="subtle"
                color="chatbox-gray"
                size="compact-xs"
                className="self-end"
                disabled={settings.compactionPrompt === undefined}
                onClick={() => setSettings({ compactionPrompt: undefined })}
              >
                {t('Restore Default')}
              </Button>
            </div>
          </Collapse>
        </SettingRow>
      </SettingsSection>
    </SettingsPage>
  )
}
