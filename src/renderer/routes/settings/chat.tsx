import { Button, Chip, Group, SegmentedControl, Text, Textarea } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { getDefaultPrompt } from '@shared/defaults'
import type { Settings } from '@shared/types'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION } from '@shared/utils/tool-call-limit-pause'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ContextLimitSettingRow, NO_CONTEXT_LIMIT, SamplingParamControl } from '@/components/settings/ParamControl'
import {
  SettingRow,
  SettingSwitchRow,
  SettingsPage,
  SettingsSection,
  useSettingsDensity,
} from '@/components/settings/SettingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/chat')({
  component: RouteComponent,
})

type MessageMetaKey =
  | 'showModelName'
  | 'showMessageTimestamp'
  | 'showWordCount'
  | 'showTokenUsed'
  | 'showFirstTokenLatency'

type BooleanSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends boolean | undefined ? K : never
}[keyof Settings]

const MESSAGE_META_OPTIONS: { key: MessageMetaKey; label: string }[] = [
  { key: 'showModelName', label: 'Model name' },
  { key: 'showMessageTimestamp', label: 'Time' },
  { key: 'showWordCount', label: 'Word count' },
  { key: 'showTokenUsed', label: 'Token usage' },
  { key: 'showFirstTokenLatency', label: 'First token latency' },
]

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const density = useSettingsDensity()
  const temperatureControl = (fieldId?: string) => (
    <SamplingParamControl
      inputId={fieldId}
      kind="temperature"
      inputTestId={TestId.settings.temperature}
      value={settings.temperature}
      onChange={(v) => setSettings({ temperature: v })}
    />
  )
  const defaultPrompt = getDefaultPrompt()
  const promptIsDefault = (settings.defaultPrompt ?? '') === defaultPrompt
  const defaultsUntouched =
    promptIsDefault &&
    settings.maxContextMessageCount === undefined &&
    settings.temperature === undefined &&
    settings.topP === undefined &&
    (settings.stream ?? true)

  const toggle = (key: BooleanSettingKey) => (checked: boolean) => {
    setSettings({ [key]: checked } as Partial<Settings>)
  }

  return (
    <SettingsPage
      title={t('Chat')}
      description={t(
        'Defaults for new chats and how messages are shown. Each chat can override them in its conversation settings.'
      )}
    >
      <SettingsSection
        title={t('New chat defaults')}
        action={
          <Button
            variant="subtle"
            color="chatbox-gray"
            size="compact-sm"
            disabled={defaultsUntouched}
            onClick={() =>
              setSettings({
                defaultPrompt,
                maxContextMessageCount: undefined,
                temperature: undefined,
                topP: undefined,
                stream: true,
              })
            }
          >
            {t('Restore all defaults')}
          </Button>
        }
        footer={
          <ContextLimitSettingRow
            testId={TestId.settings.maxContext}
            inputTestId={TestId.settings.maxContextCustom}
            value={settings.maxContextMessageCount ?? NO_CONTEXT_LIMIT}
            onChange={(v) => setSettings({ maxContextMessageCount: v })}
          />
        }
      >
        <SettingRow
          id="system-prompt"
          label={t('System prompt')}
          description={t('The first instruction sent to the model')}
          controlLayout="block"
          control={(fieldId) => (
            <div className="flex flex-col gap-1.5">
              <Textarea
                id={fieldId}
                data-testid={TestId.settings.defaultPrompt}
                aria-label={t('System prompt') ?? undefined}
                value={settings.defaultPrompt || ''}
                autosize
                minRows={2}
                maxRows={12}
                onChange={(e) => setSettings({ defaultPrompt: e.currentTarget.value })}
              />
              {promptIsDefault ? (
                <Text fz={12} c="chatbox-tertiary">
                  {t('Default')}
                </Text>
              ) : (
                <Button
                  variant="subtle"
                  color="chatbox-gray"
                  size="compact-xs"
                  className="self-start"
                  onClick={() => setSettings({ defaultPrompt })}
                >
                  {t('Reset to Default')}
                </Button>
              )}
            </div>
          )}
        />
        <SettingRow
          id="temperature"
          label={t('Temperature')}
          description={t('Lower is steadier, higher is more varied')}
          controlLayout="block"
          control={temperatureControl}
        />
        <SettingRow
          id="top-p"
          label="Top P"
          description={t('Usually adjusted instead of temperature, not together')}
          controlLayout="block"
          control={(fieldId) => (
            <SamplingParamControl
              inputId={fieldId}
              kind="topP"
              inputTestId={TestId.settings.topP}
              value={settings.topP}
              onChange={(v) => setSettings({ topP: v })}
            />
          )}
        />
        <SettingSwitchRow
          id="stream"
          label={t('Stream output')}
          description={t('Show replies as they are written')}
          checked={settings.stream ?? true}
          onChange={(checked) => setSettings({ stream: checked })}
        />
      </SettingsSection>

      <SettingsSection title={t('Message display')}>
        <SettingRow
          id="message-layout"
          label={t('Message layout')}
          control={
            <SegmentedControl
              size={density === 'touch' ? 'sm' : 'xs'}
              radius="md"
              value={settings.messageLayout ?? 'bubble'}
              onChange={(value) => {
                if (value === 'bubble' || value === 'left') setSettings({ messageLayout: value })
              }}
              data={[
                { value: 'bubble', label: t('Chat bubbles') },
                { value: 'left', label: t('Left-aligned') },
              ]}
            />
          }
        />
        <SettingRow
          id="message-meta"
          label={t('Show below messages')}
          controlLayout="block"
          control={
            <Chip.Group
              multiple
              value={MESSAGE_META_OPTIONS.filter((option) => settings[option.key]).map((option) => option.key)}
              onChange={(values) =>
                setSettings(
                  Object.fromEntries(
                    MESSAGE_META_OPTIONS.map((option) => [option.key, values.includes(option.key)])
                  ) as Pick<Settings, MessageMetaKey>
                )
              }
            >
              <Group gap={6}>
                {MESSAGE_META_OPTIONS.map((option) => (
                  <Chip key={option.key} value={option.key} size={density === 'touch' ? 'sm' : 'xs'} radius="md">
                    {t(option.label)}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          }
        />
        <SettingSwitchRow
          id="show-avatar"
          label={t('Show Avatar')}
          checked={settings.showAvatar ?? true}
          onChange={(checked) => setSettings({ showAvatar: checked })}
        />
        <SettingSwitchRow
          id="hide-system-prompt"
          label={t('Hide system prompt')}
          checked={settings.hideSystemPromptMessage}
          onChange={toggle('hideSystemPromptMessage')}
        />
        <SettingSwitchRow
          id="auto-scroll"
          label={t('Auto-scroll new messages to top')}
          checked={settings.autoScrollNewMessagesToTop}
          onChange={toggle('autoScrollNewMessagesToTop')}
        />
      </SettingsSection>

      <SettingsSection title={t('Input & rendering')}>
        <SettingSwitchRow
          id="auto-title"
          label={t('Auto-Generate Chat Titles')}
          checked={settings.autoGenerateTitle}
          onChange={toggle('autoGenerateTitle')}
        />
        <SettingSwitchRow
          id="pause-on-tool-call-limit"
          switchTestId={TestId.settings.pauseOnToolCallLimitSwitch}
          label={t('Pause after every {{count}} steps', { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION })}
          description={t(
            "Long tasks pause for confirmation after every {{count}} steps so you can check they're on track. Individual chats can override this in their conversation settings.",
            { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION }
          )}
          checked={settings.pauseOnToolCallLimit ?? true}
          onChange={(checked) => setSettings({ pauseOnToolCallLimit: checked })}
        />
        <SettingSwitchRow
          id="spell-check"
          label={t('Spell Check')}
          checked={settings.spellCheck}
          onChange={toggle('spellCheck')}
        />
        <SettingSwitchRow
          id="paste-long-text"
          label={t('Paste long text as a file')}
          description={t(
            'Pasting long text will automatically insert it as a file, keeping chats clean and reducing token usage with prompt caching.'
          )}
          checked={settings.pasteLongTextAsAFile}
          onChange={toggle('pasteLongTextAsAFile')}
        />
        <SettingSwitchRow
          id="inject-metadata"
          label={t('Inject default metadata')}
          description={t('e.g., Model Name, Current Date')}
          checked={settings.injectDefaultMetadata}
          onChange={toggle('injectDefaultMetadata')}
        />
        <SettingSwitchRow
          id="markdown"
          label={t('Markdown Rendering')}
          checked={settings.enableMarkdownRendering}
          onChange={toggle('enableMarkdownRendering')}
        />
        <SettingSwitchRow
          id="latex"
          indent
          label={t('LaTeX Rendering')}
          description={t('Requires Markdown rendering')}
          disabled={!settings.enableMarkdownRendering}
          checked={settings.enableMarkdownRendering && settings.enableLaTeXRendering}
          onChange={toggle('enableLaTeXRendering')}
        />
        <SettingSwitchRow
          id="mermaid"
          indent
          label={t('Mermaid Diagrams & Charts Rendering')}
          description={t('Requires Markdown rendering')}
          disabled={!settings.enableMarkdownRendering}
          checked={settings.enableMarkdownRendering && settings.enableMermaidRendering}
          onChange={toggle('enableMermaidRendering')}
        />
        <SettingSwitchRow
          id="auto-collapse-code"
          label={t('Auto-collapse code blocks')}
          checked={settings.autoCollapseCodeBlock}
          onChange={toggle('autoCollapseCodeBlock')}
        />
        <SettingSwitchRow
          id="auto-preview-artifacts"
          label={t('Auto-preview artifacts')}
          description={t('Automatically render generated artifacts (e.g., HTML with CSS, JS, Tailwind)')}
          checked={settings.autoPreviewArtifacts}
          onChange={toggle('autoPreviewArtifacts')}
        />
      </SettingsSection>
    </SettingsPage>
  )
}
