import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex, Stack, Text } from '@mantine/core'
import { IconReload } from '@tabler/icons-react'
import clsx from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Artifact } from '@/components/Artifact'
import { Modal } from '@/components/Overlay'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

export interface ArtifactPreviewProps {
  htmlCode: string
}

const ArtifactPreview = NiceModal.create(({ htmlCode }: ArtifactPreviewProps) => {
  const modal = useModal()
  const { t } = useTranslation()
  const [reloadSign, setReloadSign] = useState(0)
  const onReload = () => {
    setReloadSign(Math.random())
  }
  const onClose = () => {
    modal.resolve()
    modal.hide()
  }
  const isSmallScreen = useIsSmallScreen()

  return (
    <Modal
      opened={modal.visible}
      onClose={onClose}
      title={
        <Flex align="center" gap="xxs" py="xs">
          <Text fw={600} size="md">
            {t('Preview')}
          </Text>
          {isSmallScreen && (
            <ActionIcon
              variant="transparent"
              size="sm"
              onClick={onReload}
              aria-label={t('Refresh')}
              title={t('Refresh')}
            >
              <IconReload />
            </ActionIcon>
          )}
        </Flex>
      }
      size="100%"
      classNames={{
        content: clsx('flex flex-col', isSmallScreen ? '!h-[100vh] !max-h-[auto]' : 'max-w-5xl h-4/5'),
        header: 'flex-0 pt-[var(--mobile-safe-area-inset-top)] !pb-0',
        body: clsx('flex-1', isSmallScreen ? '!p-0' : ''),
      }}
      fullScreen={isSmallScreen}
      centered
      radius={0}
      transitionProps={{ transition: 'slide-up', duration: 200 }}
    >
      <Stack h="100%" gap="md">
        <Artifact htmlCode={htmlCode} reloadSign={reloadSign} className="flex-1" />
        {!isSmallScreen && (
          <Flex justify="flex-end" align="center" gap="md">
            <Button variant="transparent" onClick={onReload}>
              {t('Refresh')}
            </Button>
            <Button variant="transparent" onClick={onClose}>
              {t('Close')}
            </Button>
          </Flex>
        )}
      </Stack>
    </Modal>
  )
})

export default ArtifactPreview
