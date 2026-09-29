import { isMobileSkillEnabled, mobileSkillLabels } from '@shared/mobile-work/skill-settings'
import { useTranslation } from 'react-i18next'
import { SettingSwitchRow, SettingsSection } from '@/components/settings/SettingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'

export function MobileSkillsSection() {
  const { t } = useTranslation()
  const preferences = useSettingsStore((state) => state.mobileSkillPreferences)
  const setSettings = useSettingsStore((state) => state.setSettings)
  return (
    <SettingsSection
      title={t('Built-in')}
      description={t(
        'Enabled skills are loaded automatically when needed in Work Mode. Changes apply to the next request. Attachment parsing is always available.'
      )}
    >
      {mobileSkillLabels(t).map((skill) => (
        <SettingSwitchRow
          key={skill.name}
          id={`skill-${skill.name}`}
          label={skill.title}
          description={skill.description}
          checked={isMobileSkillEnabled(skill.name, preferences)}
          onChange={(checked) => setSettings({ mobileSkillPreferences: { ...preferences, [skill.name]: checked } })}
        />
      ))}
    </SettingsSection>
  )
}
