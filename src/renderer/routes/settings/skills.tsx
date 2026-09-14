import platform from '@/platform'
import { MobileSkillsSection } from '@/components/settings/skills/MobileSkillsSection'
import { Box, Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SkillsSection } from '@/components/settings/skills'

export const Route = createFileRoute('/settings/skills')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()

  return (
    <Box p="md">
      <Title order={5}>{t('Skills')}</Title>
      <Text size="sm" c="dimmed" mt="xs">
        {platform.type === 'mobile'
          ? t('Manage built-in skills for Work Mode.')
          : t('Enabled skills will be available in Task mode.')}
      </Text>
      <Box className="mt-8">{platform.type === 'mobile' ? <MobileSkillsSection /> : <SkillsSection />}</Box>
    </Box>
  )
}
