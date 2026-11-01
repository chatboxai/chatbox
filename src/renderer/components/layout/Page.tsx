import { Box, Flex, Text } from '@mantine/core'
import { IconMenu2 } from '@tabler/icons-react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useUIStore } from '@/stores/uiStore'
import Divider from '../common/Divider'
import { ICON_SIZE, IconButton } from '../common/IconButton'
import { TitleBarContent } from './AppTitleBar'
import { MobileWebDownloadBanner } from './DesktopDownloadReminder'
import WindowControls from './WindowControls'

export type PageHeaderProps = {
  title: string | ReactNode
  left?: ReactNode
  right?: ReactNode
}

/**
 * Page title row. Wide layouts render it into the app title bar; small screens get a header row
 * with the sidebar menu button and a centered title.
 */
export const PageHeader: FC<PageHeaderProps> = ({ title, left, right }) => {
  const { t } = useTranslation()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  if (!isSmallScreen) {
    return (
      <TitleBarContent>
        {left && (
          <Flex align="center" className="controls">
            {left}
          </Flex>
        )}
        <Flex align="center" gap="xxs" flex={1} miw={0}>
          {typeof title === 'string' ? (
            <Text component="h1" fw={600} fz={14} lh="20px" m={0} truncate="end">
              {title}
            </Text>
          ) : (
            title
          )}
        </Flex>
        {right && (
          <Flex align="center" className="controls">
            {right}
          </Flex>
        )}
      </TitleBarContent>
    )
  }

  return (
    <>
      <Flex h={48} align="center" px={4} className="title-bar flex-none bg-chatbox-background-primary">
        <Flex align="center" miw={44} className={needRoomForMacWindowControls ? 'pl-20' : ''}>
          {left || (
            <IconButton
              className="controls"
              icon={IconMenu2}
              size="lg"
              iconSize={ICON_SIZE.touch}
              color="chatbox-secondary"
              aria-label={t('Expand')}
              onClick={() => setShowSidebar(!showSidebar)}
            />
          )}
        </Flex>
        <Flex align="center" justify="center" gap="xxs" flex={1} miw={0} px="sm">
          {typeof title === 'string' ? (
            <Text component="h1" fw={600} fz={16} lh="24px" m={0} truncate="end">
              {title}
            </Text>
          ) : (
            title
          )}
        </Flex>
        <Flex align="center" justify="flex-end" miw={44} className="controls">
          {right}
        </Flex>
        <WindowControls className="-mr-3 ml-2" />
      </Flex>
      <Divider />
      <MobileWebDownloadBanner />
    </>
  )
}

export type PageProps = PageHeaderProps & {
  children?: ReactNode
}

export const Page: FC<PageProps> = ({ children, title, left, right }) => {
  return (
    <div className="flex flex-col h-full">
      <PageHeader title={title} left={left} right={right} />
      <Box className="flex-1 overflow-auto">{children}</Box>
    </div>
  )
}

export default Page
