import type { ModalProps as MantineModalProps } from '@mantine/core'
import { Button, type ButtonProps, Flex, Stack, Text } from '@mantine/core'
import type { HTMLAttributes, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { Modal } from '../layout/Overlay'

export interface AdaptiveModalProps extends Omit<MantineModalProps, 'opened' | 'onClose'> {
  opened: boolean
  onClose: () => void
}

export function AdaptiveModal({ opened, onClose, children, title, ...props }: AdaptiveModalProps) {
  const isSmallScreen = useIsSmallScreen()

  if (isSmallScreen) {
    return (
      <Drawer.Root open={opened} onOpenChange={(open) => !open && onClose()} noBodyStyles repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
          <Drawer.Content className="flex flex-col h-fit fixed bottom-0 left-0 right-0 outline-none bg-chatbox-background-primary rounded-t-lg">
            <Drawer.Handle />
            <Stack gap="md" p="sm" className="max-h-[85vh] overflow-y-auto">
              {title && typeof title === 'string' && (
                <Text size="md" fw={600} className="text-center">
                  {title}
                </Text>
              )}
              {title && typeof title !== 'string' && <div>{title}</div>}
              {children}
            </Stack>
            <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    )
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} {...props}>
      {children}
    </Modal>
  )
}

function AdaptiveModalActions({ children }: { children: ReactNode }) {
  const isSmallScreen = useIsSmallScreen()

  if (isSmallScreen) {
    return (
      <Stack gap="xs" mt="md" className="flex-col-reverse">
        {children}
      </Stack>
    )
  }

  return (
    <Flex gap="md" mt="md" justify="flex-end" align="center">
      {children}
    </Flex>
  )
}

AdaptiveModal.Actions = AdaptiveModalActions

function AdaptiveModalCloseButton(props: ButtonProps & HTMLAttributes<HTMLButtonElement>) {
  const isSmallScreen = useIsSmallScreen()
  const { t } = useTranslation()
  if (isSmallScreen) {
    return null
  }

  return (
    <Button color="chatbox-gray" variant="light" {...props}>
      {props.children || t('Cancel')}
    </Button>
  )
}

AdaptiveModal.CloseButton = AdaptiveModalCloseButton
