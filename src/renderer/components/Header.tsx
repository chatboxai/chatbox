import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Title, Tooltip } from '@mantine/core'
import { IconLayoutSidebarLeftExpand, IconMenu2, IconPencil } from '@tabler/icons-react'
import clsx from 'clsx'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { scheduleGenerateNameAndThreadName, scheduleGenerateThreadName } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import type { Session } from '../../shared/types'
import useNeedRoomForWinControls from '../hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '../hooks/useScreenChange'
import * as settingActions from '../stores/settingActions'
import { ScalableIcon } from './ScalableIcon'
import Toolbar from './Toolbar'
import WindowControls from './WindowControls'

export default function Header(props: { session: Session }) {
  const { t } = useTranslation()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)

  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  const { session: currentSession } = props

  // 会话名称自动生成
  useEffect(() => {
    const autoGenerateTitle = settingActions.getAutoGenerateTitle()
    if (!autoGenerateTitle) {
      return
    }

    // 检查是否有正在生成的消息
    const hasGeneratingMessage = currentSession.messages.some((msg) => msg.generating)

    // 如果有消息正在生成，或者消息数量少于2条，不触发名称生成
    if (hasGeneratingMessage || currentSession.messages.length < 2) {
      return
    }

    // 触发名称生成（在 sessionActions 中进行去重和延迟处理）
    if (currentSession.name === 'Untitled') {
      scheduleGenerateNameAndThreadName(currentSession.id)
    } else if (!currentSession.threadName) {
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
    <Flex
      h={54}
      align="center"
      px="sm"
      className={clsx('flex-none title-bar border-0 border-b border-solid border-chatbox-border-primary')}
    >
      {(!showSidebar || isSmallScreen) && (
        <Flex align="center" className={needRoomForMacWindowControls ? 'pl-20' : ''}>
          <ActionIcon
            className="controls"
            variant="subtle"
            size={isSmallScreen ? 24 : 20}
            color={isSmallScreen ? 'chatbox-secondary' : 'chatbox-tertiary'}
            mr="sm"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            {isSmallScreen ? <IconMenu2 /> : <IconLayoutSidebarLeftExpand />}
          </ActionIcon>
        </Flex>
      )}

      <Flex align="center" gap={'xxs'} flex={1} {...(isSmallScreen ? { justify: 'center', pl: 28, pr: 8 } : {})}>
        <Title order={4} fz={!isSmallScreen ? 20 : undefined} lineClamp={1}>
          {currentSession?.name}
        </Title>

        <Tooltip label={t('Customize settings for the current conversation')}>
          <ActionIcon
            className="controls"
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            onClick={() => {
              editCurrentSession()
            }}
          >
            <ScalableIcon icon={IconPencil} size={20} />
          </ActionIcon>
        </Tooltip>
      </Flex>

      <Toolbar sessionId={currentSession.id} />

      <WindowControls className="-mr-3 ml-2" />
    </Flex>
  )
}
