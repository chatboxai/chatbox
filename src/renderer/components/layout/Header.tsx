import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMenu2 } from '@tabler/icons-react'
import clsx from 'clsx'
import { PencilIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { scheduleGenerateNameAndThreadName, scheduleGenerateThreadName } from '@/stores/sessionActions'
import * as settingActions from '@/stores/settingActions'
import { useUIStore } from '@/stores/uiStore'
import Divider from '../common/Divider'
import { getAutoTitleGenerationAction } from './auto-title'
import Toolbar from './Toolbar'
import WindowControls from './WindowControls'

export default function Header(props: { session: Session }) {
  const { t } = useTranslation()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)

  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  const { session: currentSession } = props

  useEffect(() => {
    const autoGenerateTitle = settingActions.getAutoGenerateTitle()
    if (!autoGenerateTitle) {
      return
    }

    const action = getAutoTitleGenerationAction(currentSession)
    if (action === 'session-and-thread') {
      scheduleGenerateNameAndThreadName(currentSession.id)
    } else if (action === 'thread') {
      scheduleGenerateThreadName(currentSession.id)
    }
  }, [currentSession])

  const editCurrentSession = () => {
    if (!currentSession) {
      return
    }
    NiceModal.show('session-settings', { session: currentSession })
  }

  return (
    <>
      <Flex
        h={48}
        align="center"
        px="md"
        className={clsx('flex-none title-bar border-0', isSmallScreen ? 'bg-chatbox-background-primary' : '')}
      >
        <Flex align="center" className={!showSidebar && needRoomForMacWindowControls ? 'pl-20' : ''}>
          <ActionIcon
            className="controls"
            aria-label={t(showSidebar && !isSmallScreen ? 'Collapse' : 'Expand')}
            variant="subtle"
            size={isSmallScreen ? 24 : 20}
            color={isSmallScreen ? 'chatbox-secondary' : 'chatbox-tertiary'}
            mr="xs"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            {isSmallScreen ? (
              <IconMenu2 />
            ) : showSidebar ? (
              <IconLayoutSidebarLeftCollapse />
            ) : (
              <IconLayoutSidebarLeftExpand />
            )}
          </ActionIcon>
        </Flex>

        <Flex
          align="center"
          flex={1}
          className="min-w-0"
          {...(isSmallScreen ? { justify: 'center', pl: 28, pr: 8 } : {})}
        >
          <Text fw={600} fz={18} lh="24px" truncate="end" className="min-w-0">
            {currentSession?.name}
          </Text>
          <Tooltip>
            <TooltipTrigger asChild>
              <ActionIcon
                className="controls"
                variant="subtle"
                color="chatbox-tertiary"
                size={isSmallScreen ? 20 : 16}
                ml={4}
                aria-label={t('Customize settings for the current conversation')}
                onClick={editCurrentSession}
              >
                <PencilIcon size={12} />
              </ActionIcon>
            </TooltipTrigger>
            <TooltipContent>{t('Customize settings for the current conversation')}</TooltipContent>
          </Tooltip>
        </Flex>

        <Toolbar sessionId={currentSession.id} />

        <WindowControls className="-mr-3 ml-2" />
      </Flex>

      {isSmallScreen && <Divider />}
    </>
  )
}
