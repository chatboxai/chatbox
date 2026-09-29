import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SettingsPage } from '@/components/settings/SettingsLayout'
import { SkillsSection } from '@/components/settings/skills'
import { MobileSkillsSection } from '@/components/settings/skills/MobileSkillsSection'
import platform from '@/platform'

export const Route = createFileRoute('/settings/skills')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()

  return (
    <SettingsPage
      title={t('Skills')}
      description={
        platform.type === 'mobile'
          ? t('Manage built-in skills for Work Mode.')
          : t('Enabled skills will be available in Task mode.')
      }
    >
      {platform.type === 'mobile' ? <MobileSkillsSection /> : <SkillsSection />}
    </SettingsPage>
  )
}
