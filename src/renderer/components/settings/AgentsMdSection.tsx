import { Button, Flex, Stack, Text, Textarea } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingSwitchRow } from '@/components/settings/SettingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

const MAX_CHARS = 64 * 1024

/**
 * Global AGENTS.md protocol editor (Kimi Code's ~/.kimi-code/AGENTS.md
 * equivalent). The content is stored in `extension.agentsMd` and injected into
 * every conversation's system prompt while enabled; the mobile app also
 * auto-loads a per-session workspace AGENTS.md, so this section edits only the
 * global layer.
 */
export function AgentsMdSection() {
  const { t } = useTranslation()
  const extension = useSettingsStore((s) => s.extension)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const agentsMd = extension.agentsMd
  const enabled = agentsMd?.enabled ?? false
  const savedContent = agentsMd?.content ?? ''
  const [content, setContent] = useState(savedContent)

  const dirty = content !== savedContent
  const overLimit = content.length > MAX_CHARS

  const patchAgentsMd = (patch: Partial<{ enabled: boolean; content: string }>) => {
    setSettings({ extension: { ...extension, agentsMd: { enabled, content: savedContent, ...patch } } })
  }

  const handleSave = () => {
    if (overLimit) return
    patchAgentsMd({ content })
    addToast(t('Saved'))
  }

  return (
    <Stack gap="sm">
      <SettingSwitchRow
        id="agents-md"
        label={t('Enable AGENTS.md protocol')}
        description={t('Inject the AGENTS.md below into every conversation (Chat and Work Mode), like Kimi Code loading ~/.kimi-code/AGENTS.md.')}
        checked={enabled}
        onChange={(checked) => patchAgentsMd({ enabled: checked })}
      />
      <Textarea
        aria-label={t('AGENTS.md content') || ''}
        autosize
        minRows={12}
        maxRows={26}
        value={content}
        disabled={!enabled}
        onChange={(event) => setContent(event.currentTarget.value)}
        placeholder={t('Paste your AGENTS.md workspace protocol here…') || ''}
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
      />
      <Flex gap="sm" align="center">
        <Button size="xs" disabled={!dirty || overLimit} onClick={handleSave}>
          {t('Save')}
        </Button>
        <Text size="xs" c={overLimit ? 'red' : 'dimmed'}>
          {overLimit ? t('Content exceeds the 64 KB limit') : t('{{count}} characters', { count: content.length })}
        </Text>
      </Flex>
    </Stack>
  )
}
