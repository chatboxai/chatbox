import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { DocumentParserSettings } from '@/components/settings/DocumentParserSettings'
import { SettingsPage } from '@/components/settings/SettingsLayout'

export const Route = createFileRoute('/settings/document-parser')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  return (
    <SettingsPage
      title={t('Document Parser')}
      description={t('How files attached to chats and knowledge bases are turned into text.')}
    >
      <DocumentParserSettings />
    </SettingsPage>
  )
}
