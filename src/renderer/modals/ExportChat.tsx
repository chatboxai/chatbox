import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Select, Stack, Text } from '@mantine/core'
import type { ExportChatFormat, ExportChatScope } from '@shared/types'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { currentSessionIdAtom } from '@/stores/atoms'
import { exportSessionChat } from '@/stores/sessionActions'

const ExportChat = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const [scope, setScope] = useState<ExportChatScope>('all_threads')
  const [format, setFormat] = useState<ExportChatFormat>('HTML')

  const currentSessionId = useAtomValue(currentSessionIdAtom)
  const onCancel = () => {
    modal.resolve()
    modal.hide()
  }
  const onExport = () => {
    if (!currentSessionId) {
      return
    }
    void exportSessionChat(currentSessionId, scope, format)
    modal.resolve()
    modal.hide()
  }

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={() => {
        modal.resolve()
        modal.hide()
      }}
      centered
      title={t('Export Chat')}
    >
      <Stack gap="md" p="sm">
        <div className="rounded-md border border-solid border-chatbox-border-warning bg-chatbox-background-warning-secondary px-sm py-xs">
          <Text size="sm" c="chatbox-warning" className="leading-snug">
            {t('Exports are for viewing only. Use Settings → Backup if you need a backup you can restore.')}
          </Text>
        </div>
        <AdaptiveSelect
          label={t('Scope')}
          classNames={{ dropdown: 'pointer-events-auto' }}
          data={['all_threads', 'current_thread'].map((scope) => ({
            label: t((scope.charAt(0).toUpperCase() + scope.slice(1).toLowerCase()).split('_').join(' ')),
            value: scope,
          }))}
          value={scope}
          onChange={(e) => e && setScope(e as ExportChatScope)}
        />

        <AdaptiveSelect
          label={t('Format')}
          classNames={{ dropdown: 'pointer-events-auto' }}
          data={['Markdown', 'TXT', 'HTML']}
          value={format}
          onChange={(e) => e && setFormat(e as ExportChatFormat)}
        />
      </Stack>

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onCancel} />

        <Button onClick={onExport}>{t('Export')}</Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default ExportChat
