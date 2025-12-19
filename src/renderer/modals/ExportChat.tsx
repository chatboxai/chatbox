import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Select, Stack, Text } from '@mantine/core'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExportChatFormat, ExportChatScope } from '@/../shared/types'
import { Modal } from '@/components/Overlay'
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
    <Modal
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
        <Select
          label={t('Scope')}
          data={['all_threads', 'current_thread'].map((scope) => ({
            label: t((scope.charAt(0).toUpperCase() + scope.slice(1).toLowerCase()).split('_').join(' ')),
            value: scope,
          }))}
          value={scope}
          onChange={(e) => e && setScope(e as ExportChatScope)}
        />

        <Select
          label={t('Format')}
          data={['Markdown', 'TXT', 'HTML']}
          value={format}
          onChange={(e) => e && setFormat(e as ExportChatFormat)}
        />
      </Stack>
      <Flex gap="md" mt="md" justify="flex-end" align="center">
        <Button onClick={onCancel} color="chatbox-gray" variant="light">
          {t('cancel')}
        </Button>
        <Button onClick={onExport}>{t('export')}</Button>
      </Flex>
    </Modal>
  )
})

export default ExportChat
