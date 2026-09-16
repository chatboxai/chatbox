import { Button, Stack, Title } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AppIconPicker } from '@/components/common/AppIconPicker'

export const Route = createFileRoute('/settings/app-icon')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  return (
    <Stack p="md" gap="md">
      <Button
        component={Link}
        to="/settings/general"
        variant="subtle"
        leftSection={<IconChevronLeft size={18} />}
        w="fit-content"
      >
        {t('General Settings')}
      </Button>
      <Title order={5}>{t('App icon')}</Title>
      <AppIconPicker showTitle={false} />
    </Stack>
  )
}
