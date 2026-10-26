import { type ModalProps, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/layout/Overlay'
import classes from './BackupDialog.module.css'

type BackupDialogProps = Omit<ModalProps, 'children'> & {
  children: ReactNode
  footer?: ReactNode
  status?: boolean
}

export function BackupDialog({
  opened,
  onClose,
  title,
  children,
  footer,
  status = false,
  ...props
}: BackupDialogProps) {
  const { t } = useTranslation()
  const narrow = useMediaQuery('(max-width: 600px)')

  return (
    <Modal
      closeButtonProps={{ 'aria-label': String(t('Close')) }}
      size={640}
      fullScreen={narrow}
      centered
      {...props}
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={600} size="xl">
          {title}
        </Text>
      }
      classNames={{ content: classes.content, header: classes.header, body: classes.body }}
    >
      <div className={status ? `${classes.scrollArea} ${classes.status}` : classes.scrollArea}>{children}</div>
      {footer && <div className={classes.footer}>{footer}</div>}
    </Modal>
  )
}
