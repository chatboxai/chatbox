import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Stack, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import * as remote from '@/packages/remote'
import * as toastActions from '@/stores/toastActions'

const ReportContent = NiceModal.create(({ contentId }: { contentId: string }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  const [content, setContent] = useState('')
  const [reportType, setReportType] = useState('Harmful or offensive content')

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  const onSubmit = async () => {
    toastActions.add(t('Thank you for your report'))
    if (!contentId) {
      return
    }
    await remote.reportContent({
      id: contentId,
      type: reportType,
      details: content,
    })
    modal.resolve()
    modal.hide()
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} centered title={t('Report Content')}>
      <Stack>
        <TextInput
          label={t('Report Content ID')}
          className="w-full"
          autoFocus={!isSmallScreen}
          value={contentId}
          disabled
        />

        <AdaptiveSelect
          label={t('Report Type')}
          value={reportType}
          classNames={{ dropdown: 'pointer-events-auto' }}
          data={[
            { value: 'Harmful or offensive content', label: t('Harmful or offensive content') },
            { value: 'Misleading information', label: t('Misleading information') },
            { value: 'Spam or advertising', label: t('Spam or advertising') },
            { value: 'Violence or dangerous content', label: t('Violence or dangerous content') },
            { value: 'Child-inappropriate content', label: t('Child-inappropriate content') },
            { value: 'Sexual content', label: t('Sexual content') },
            { value: 'Hate speech or harassment', label: t('Hate speech or harassment') },
            { value: 'Other concerns', label: t('Other concerns') },
          ]}
          onChange={(value) => setReportType(value as string)}
        />

        <Textarea
          autosize
          minRows={3}
          maxRows={10}
          label={t('Details')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </Stack>

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button onClick={onSubmit}>{t('Submit')}</Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default ReportContent
