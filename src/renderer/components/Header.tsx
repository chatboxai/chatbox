import { cn } from '@/lib/utils'
import NiceModal from '@ebay/nice-modal-react'
import EditIcon from '@mui/icons-material/Edit'
import ImageIcon from '@mui/icons-material/Image'
import BookmarkIcon from '@mui/icons-material/Bookmark'
import { Box, Chip, IconButton, Tooltip, Typography, useTheme } from '@mui/material'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { PanelRightClose } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { isChatSession, isPictureSession } from '../../shared/types'
import useNeedRoomForWinControls from '../hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '../hooks/useScreenChange'
import * as atoms from '../stores/atoms'
import * as sessionActions from '../stores/sessionActions'
import * as settingActions from '../stores/settingActions'
import Toolbar from './Toolbar'
import BookmarkSidebar from './BookmarkSidebar'
import { bookmarkSidebarOpenAtom } from '../stores/atoms'

interface Props {}

export default function Header(props: Props) {
  const { t } = useTranslation()
  const theme = useTheme()
  const currentSession = useAtomValue(atoms.currentSessionAtom)
  const [showSidebar, setShowSidebar] = useAtom(atoms.showSidebarAtom)
  const [bookmarkSidebarOpen, setBookmarkSidebarOpen] = useAtom(bookmarkSidebarOpenAtom)
  const setBookmarks = useSetAtom(atoms.bookmarksAtom)
  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls, needRoomForWindowsWindowControls } = useNeedRoomForWinControls()

  // 会话名称自动生成和底部书签插入
  useEffect(() => {
    if (!currentSession) return;
    if (currentSession.messages && currentSession.messages.length > 0) {
      const lastMsg = currentSession.messages[currentSession.messages.length - 1];
      setBookmarks((prev) => {
        // 先移除当前会话的"返回最后一个"书签
        const filtered = prev.filter(
          (b) => !(b.sessionId === currentSession.id && b.title === '返回最后一个')
        );
        // 再插入最新的
        return [
          ...filtered,
          {
            messageId: lastMsg.id,
            title: '返回最后一个',
            timestamp: Date.now(),
            sessionId: currentSession.id,
          },
        ];
      });
    }
    // 自动生成会话名称
    const autoGenerateTitle = settingActions.getAutoGenerateTitle();
    if (!autoGenerateTitle) return;
    if (currentSession.name === 'Untitled' && currentSession.messages.length >= 2) {
      sessionActions.generateNameAndThreadName(currentSession.id);
      return;
    }
    if (!currentSession.threadName && currentSession.messages.length >= 2) {
      sessionActions.generateThreadName(currentSession.id);
    }
  }, [currentSession?.id, currentSession?.messages.length, setBookmarks]);

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
    <div className="relative">
      <div
        className={cn(
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
          <Box 
            className="controls cursor-pointer" 
            onClick={() => setShowSidebar(!showSidebar)}
            sx={{ 
              marginRight: 2,
              display: 'flex',
              alignItems: 'center',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                borderRadius: '50%'
              }
            }}
          >
            <IconButton
              sx={{
                ...(isSmallScreen
                  ? {
                      borderColor: theme.palette.action.hover,
                      borderStyle: 'solid',
                      borderWidth: 1,
                    }
                  : {}),
                color: theme.palette.text.secondary,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                }
              }}
            >
              <PanelRightClose size="20" strokeWidth={1.5} />
            </IconButton>
          </Box>
        )}
        <div className="flex items-center flex-1">
          <Typography
            variant="h6"
            color="inherit"
            component="div"
            noWrap
            sx={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            className="flex items-center"
          >
            <div className={cn('controls flex flex-row cursor-pointer')}>
              {currentSession && (
                <>
                  <Typography
                    variant="h6"
                    noWrap
                    className={cn(showSidebar ? 'ml-3' : 'ml-1')}
                    sx={{
                      maxWidth: isSmallScreen ? '12rem' : '18rem',
                    }}
                    onClick={() => {
                      editCurrentSession()
                    }}
                  >
                    {currentSession.name}
                  </Typography>
                  <div
                    onClick={() => {
                      editCurrentSession()
                    }}
                  >
                    {EditButton}
                  </div>
                </>
              )}
            </div>
          </Typography>
        </div>

        <div className="flex items-center">
          <div className={needRoomForWindowsWindowControls ? 'mr-36' : ''}>
            <Toolbar />
          </div>
          {/* 书签按钮已移入 Toolbar 的更多菜单 */}
        </div>
      </div>
      <BookmarkSidebar open={bookmarkSidebarOpen} onClose={() => setBookmarkSidebarOpen(false)} />
    </div>
  )
}
