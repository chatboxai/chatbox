import { Stack, Switch, Text, Group, Paper, Badge } from '@mantine/core'
import { mobileSkillLabels, isMobileSkillEnabled } from '@shared/mobile-work/skill-settings'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'

export function MobileSkillsSection() {
  const { t } = useTranslation()
  const preferences = useSettingsStore((state) => state.mobileSkillPreferences)
  const setSettings = useSettingsStore((state) => state.setSettings)
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t(
          'Enabled skills are loaded automatically when needed in Work Mode. Changes apply to the next request. Attachment parsing is always available.'
        )}
      </Text>
      {mobileSkillLabels(t).map((skill) => {
        return (
          <Paper key={skill.name} withBorder p="md" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600}>{skill.title}</Text>
              <Switch
                aria-label={skill.title}
                checked={isMobileSkillEnabled(skill.name, preferences)}
                onChange={(event) =>
                  setSettings({ mobileSkillPreferences: { ...preferences, [skill.name]: event.currentTarget.checked } })
                }
              />
            </Group>
            <Text size="sm" c="dimmed" mt="xs">
              {skill.description}
            </Text>
            <Badge variant="light" size="xs" mt="sm">
              {t('Built-in')}
            </Badge>
          </Paper>
        )
      })}
    </Stack>
  )
}
