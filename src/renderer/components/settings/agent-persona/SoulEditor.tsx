import { Button, Flex, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconRestore } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildSoulTemplate, readSoul, writeSoul } from '@/stores/agentPersonaStore'
import { add as addToast } from '@/stores/toastActions'

export function SoulEditor() {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    void readSoul().then((record) => {
      if (!mounted) return
      setContent(record.content)
      setSavedContent(record.content)
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const record = await writeSoul(content)
      setContent(record.content)
      setSavedContent(record.content)
      addToast(t('Saved. Running agent sessions keep their snapshot; new sessions use the updated Soul.'))
    } finally {
      setSaving(false)
    }
  }, [content, t])

  const dirty = content !== savedContent

  return (
    <Stack gap="sm">
      <Textarea
        autosize
        minRows={14}
        maxRows={28}
        value={content}
        disabled={loading}
        onChange={(event) => setContent(event.currentTarget.value)}
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
      />
      <Flex gap="sm" align="center">
        <Button size="xs" disabled={!dirty || loading} loading={saving} onClick={() => void handleSave()}>
          {t('Save')}
        </Button>
        <Tooltip label={t('Replace the content with the default template')}>
          <Button
            size="xs"
            variant="light"
            color="chatbox-secondary"
            leftSection={<IconRestore size={14} />}
            disabled={loading}
            onClick={() => setContent(buildSoulTemplate())}
          >
            {t('Reset to template')}
          </Button>
        </Tooltip>
        {dirty && (
          <Text size="xs" c="dimmed">
            {t('Unsaved changes')}
          </Text>
        )}
      </Flex>
    </Stack>
  )
}
