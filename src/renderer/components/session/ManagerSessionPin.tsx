import { Flex, Text } from '@mantine/core'
import { SESSION_MANAGER_ID } from '@shared/defaults'
import { IconRobot } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { switchCurrentSession } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'

// Persistent pin slot for the AI Manager system session.
// Always renders regardless of storage state — clicks are safe even mid-bootstrap
// because switchCurrentSession + chatStore.getSession resolve lazily.
export default function ManagerSessionPin() {
  const { t } = useTranslation()
  const routerState = useRouterState()
  const isSmallScreen = useIsSmallScreen()
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)

  const selected = routerState.location.pathname === `/session/${SESSION_MANAGER_ID}`

  const onClick = () => {
    switchCurrentSession(SESSION_MANAGER_ID)
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }

  return (
    <Flex
      align="center"
      gap={10}
      mx="xs"
      px="xs"
      py={10}
      onClick={onClick}
      className={clsx(
        'cursor-pointer rounded-sm',
        selected ? 'bg-chatbox-background-brand-secondary' : 'bg-chatbox-background-gray-primary'
      )}
    >
      <IconRobot size={16} className={selected ? 'text-[var(--mantine-color-chatbox-brand-filled)]' : ''} />
      <Text span flex={1} lineClamp={1} fw={500} c={selected ? 'chatbox-brand' : 'chatbox-primary'}>
        {t('AI Manager')}
      </Text>
    </Flex>
  )
}
