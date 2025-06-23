import { cn } from '@/lib/utils'
import NiceModal from '@ebay/nice-modal-react'
import EditIcon from '@mui/icons-material/Edit'
import ImageIcon from '@mui/icons-material/Image'
import { Box, Chip, IconButton, Tooltip, Typography, useTheme } from '@mui/material'
import { useAtom, useAtomValue } from 'jotai'
import { PanelRightClose, Settings2 } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { isChatSession, isPictureSession } from '../../shared/types'
import useNeedRoomForWinControls from '../hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '../hooks/useScreenChange'
import * as atoms from '../stores/atoms'
import * as sessionActions from '../stores/sessionActions'
import * as settingActions from '../stores/settingActions'
import Toolbar from './Toolbar'
import MiniButton from './MiniButton'

interface Props {}

export default function Header(props: Props) {
  const { t } = useTranslation()
  const theme = useTheme()
  const currentSession = useAtomValue(atoms.currentSessionAtom)
  const [showSidebar, setShowSidebar] = useAtom(atoms.showSidebarAtom)

  const isSmallScreen = useIsSmallScreen()

  const { needRoomForMacWindowControls, needRoomForWindowsWindowControls } = useNeedRoomForWinControls()

  // 会话名称自动生成
  useEffect(() => {
    if (!currentSession) {
      return
    }
    const autoGenerateTitle = settingActions.getAutoGenerateTitle()
    if (!autoGenerateTitle) {
      return
    }
    if (currentSession.name === 'Untitled' && currentSession.messages.length >= 2) {
      sessionActions.generateNameAndThreadName(currentSession.id)
      return // 生成了会话名称，就不再生成 thread 名称
    }
    if (!currentSession.threadName && currentSession.messages.length >= 2) {
      sessionActions.generateThreadName(currentSession.id)
    }
  }, [currentSession?.messages.length])

  const editCurrentSession = () => {
    if (!currentSession) {
      return
    }
    NiceModal.show('session-settings', { chatConfigDialogSessionId: currentSession.id })
  }

  let EditButton: React.ReactNode | null = null
  if (currentSession && isChatSession(currentSession) && currentSession.settings) {
    EditButton = (
      <Tooltip title={t('Current conversation configured with specific model settings')} className="cursor-pointer">
        <EditIcon
          className="ml-1 cursor-pointer w-4 h-4 opacity-30"
          fontSize="small"
          style={{ color: theme.palette.warning.main }}
        />
      </Tooltip>
    )
  } else if (currentSession && isPictureSession(currentSession)) {
    EditButton = (
      <Tooltip
        title={t('The Image Creator plugin has been activated for the current conversation')}
        className="cursor-pointer"
      >
        <Chip
          className="ml-2 cursor-pointer"
          variant="outlined"
          color="secondary"
          size="small"
          icon={<ImageIcon className="cursor-pointer" />}
          label={<span className="cursor-pointer">{t('Image Creator')}</span>}
        />
      </Tooltip>
    )
  } else {
    EditButton = <EditIcon className="ml-1 cursor-pointer w-4 h-4 opacity-30" fontSize="small" />
  }

  return (
    <div
      className={cn(
        // 固定高度，和 Windows 的 win controls bar 高度一致
        'title-bar flex flex-row h-12 items-center',
        isSmallScreen ? '' : showSidebar ? 'sm:pl-3 sm:pr-2' : 'pr-2',
        (!showSidebar || isSmallScreen) && needRoomForMacWindowControls ? 'pl-20' : 'pl-3'
      )}
      style={{
        borderBottomWidth: '1px',
        borderBottomStyle: 'solid',
        borderBottomColor: theme.palette.divider,
      }}
    >
      {(!showSidebar || isSmallScreen) && (
        <Box className={cn('controls cursor-pointer')} onClick={() => setShowSidebar(!showSidebar)}>
          <IconButton
            sx={
              isSmallScreen
                ? {
                    borderColor: theme.palette.action.hover,
                    borderStyle: 'solid',
                    borderWidth: 1,
                  }
                : {}
            }
          >
            <PanelRightClose size="20" strokeWidth={1.5} />
          </IconButton>
        </Box>
      )}
      <div className={cn('w-full flex flex-row flex-grow pt-2 pb-2')}>
        <div className="flex flex-row items-center w-0 flex-1 mr-1">
          <Typography
            variant="h6"
            noWrap
            className={cn(
              'flex-shrink flex-grow-0 overflow-hidden text-ellipsis whitespace-nowrap',
              showSidebar ? 'ml-3' : 'ml-1'
            )}
          >
            {currentSession?.name}
          </Typography>
          {isSmallScreen ? (
            <MiniButton
              className="ml-1 sm:ml-2 controls cursor-pointer"
              style={{ color: theme.palette.text.secondary }}
              onClick={() => {
                editCurrentSession()
              }}
              tooltipTitle={
                <div className="text-center inline-block">
                  <span>{t('Customize settings for the current conversation')}</span>
                </div>
              }
              tooltipPlacement="top"
            >
              <Settings2 size="16" strokeWidth={1} />
            </MiniButton>
          ) : (
            <a
              onClick={() => {
                editCurrentSession()
              }}
              className="controls flex mr-8 cursor-pointer"
            >
              {EditButton}
            </a>
          )}
        </div>
        <div className={cn('flex-shrink-0', needRoomForWindowsWindowControls ? 'mr-36' : '')}>
          <Toolbar />
        </div>
      </div>
    </div>
  )
}
