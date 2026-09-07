import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Checkbox, Stack, Text } from '@mantine/core'
import type { ExportChatFormat, ExportChatScope } from '@shared/types'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { currentSessionIdAtom } from '@/stores/atoms'
import { exportSessionChat } from '@/stores/session/export'

const ExportChat = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const [scope, setScope] = useState<ExportChatScope>('all_threads')
  const [format, setFormat] = useState<ExportChatFormat>('HTML')
  const [includeAllBranches, setIncludeAllBranches] = useState(false)

  const currentSessionId = useAtomValue(currentSessionIdAtom)
  const closeModal = () => {
    setIncludeAllBranches(false)
    modal.resolve()
    modal.hide()
  }
  const onExport = () => {
    if (!currentSessionId) {
      return
    }
    void exportSessionChat(currentSessionId, scope, format, includeAllBranches)
    closeModal()
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={closeModal} centered title={t('Export Chat')}>
      <Stack gap="md" p="sm">
        <div className="rounded-lg border border-solid border-chatbox-border-warning bg-chatbox-background-warning-secondary px-sm py-xs">
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

        <Checkbox
          label={t('Export all branches')}
          checked={includeAllBranches}
          onChange={(event) => setIncludeAllBranches(event.currentTarget.checked)}
        />
      </Stack>

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={closeModal} />
        <Button onClick={onExport}>{t('Export')}</Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default ExportChat
