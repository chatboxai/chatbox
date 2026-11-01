import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import NotificationMarkdown, { isNotificationAssetUrl } from '@/components/NotificationMarkdown'
import { type ClientNotification, getNextClientNotification } from '@/packages/remote'
import platform from '@/platform'
import defaultDarkCover from '@/static/images/notifications/default-dark.png'
import defaultLightCover from '@/static/images/notifications/default-light.png'
import { useDbSchemaGuardStore } from '@/storage/db-schema-guard'
import { initSettingsStore, settingsStore } from '@/stores/settingsStore'
import { trackClientNotificationImpression, trackClientNotificationLinkClick } from './client-notification-analytics'
import {
  markBatchDisplayed,
  readDisplayedBatchIds,
  withWebNotificationDisplayLock,
} from './client-notification-storage'

export type ClientNotificationWindowDependencies = {
  getLanguage: () => Promise<string>
  getNextNotification: (request: {
    locale: string
    displayed_batch_ids: string[]
  }) => Promise<ClientNotification | null>
  readDisplayedBatchIds: () => string[]
  markBatchDisplayed: (batchId: string) => void
  withDisplayLock: (display: () => Promise<void>) => Promise<void>
  trackImpression: (notification: ClientNotification) => void
  trackLinkClick: (notification: ClientNotification) => void
  openLink: (url: string) => void | Promise<void>
  onBackButton?: (callback: () => void) => () => void
}

function openNotificationLink(url: string) {
  if (platform.type !== 'web') return platform.openLink(url)
  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer')
  if (openedWindow) openedWindow.opener = null
}

function onMobileBackButton(callback: () => void) {
  if (platform.type !== 'mobile') return () => undefined
  let cancelled = false
  let removeListener: (() => void) | undefined

  void import('@capacitor/app')
    .then(({ App }) => App.addListener('backButton', callback))
    .then((handle) => {
      if (cancelled) {
        void handle.remove()
        return
      }
      removeListener = () => void handle.remove()
    })
    .catch((error) => console.warn('Failed to listen for mobile back button:', error))

  return () => {
    cancelled = true
    removeListener?.()
  }
}

const defaultDependencies: ClientNotificationWindowDependencies = {
  getLanguage: async () => {
    await initSettingsStore()
    return settingsStore.getState().language
  },
  getNextNotification: getNextClientNotification,
  readDisplayedBatchIds,
  markBatchDisplayed,
  withDisplayLock: (display) => (platform.type === 'web' ? withWebNotificationDisplayLock(display) : display()),
  trackImpression: trackClientNotificationImpression,
  trackLinkClick: trackClientNotificationLinkClick,
  openLink: openNotificationLink,
  onBackButton: onMobileBackButton,
}

const isDatabaseBlocked = (state: ReturnType<typeof useDbSchemaGuardStore.getState>) =>
  Boolean(state.schemaTooNewDbName || state.upgradedElsewhereDbName || state.upgradeBlockedDbName)

const isPageVisible = () => platform.type !== 'web' || document.visibilityState === 'visible'
const subscribePageVisibility = (onChange: () => void) => {
  if (platform.type !== 'web') return () => {}
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

export function ClientNotificationWindow({ dependencies }: { dependencies: ClientNotificationWindowDependencies }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isNarrowScreen = useMediaQuery('(max-width:479.95px)')
  const titleId = useId()
  const requestRef = useRef<Promise<ClientNotification | null> | null>(null)
  const displayedRef = useRef(false)
  const databaseBlocked = useDbSchemaGuardStore(isDatabaseBlocked)
  const pageVisible = useSyncExternalStore(subscribePageVisibility, isPageVisible)
  const [claimedBatchId, setClaimedBatchId] = useState<string | null>(null)
  const [notification, setNotification] = useState<ClientNotification | null>(null)
  const [failedCover, setFailedCover] = useState<string>()
  const [loadedCover, setLoadedCover] = useState<string>()
  const hasCustomCover =
    isNotificationAssetUrl(notification?.cover_image_url) && notification?.cover_image_url !== failedCover
  const coverSrc = hasCustomCover
    ? notification?.cover_image_url
    : theme.palette.mode === 'dark'
      ? defaultDarkCover
      : defaultLightCover
  const close = useCallback(() => setNotification(null), [])
  const open = Boolean(notification && claimedBatchId === notification.batch_id && !databaseBlocked && pageVisible)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const locale = await dependencies.getLanguage()
        let displayedBatchIds: string[] = []
        try {
          displayedBatchIds = dependencies.readDisplayedBatchIds()
        } catch {
          displayedBatchIds = []
        }
        const nextNotification = await dependencies.getNextNotification({
          locale,
          displayed_batch_ids: displayedBatchIds,
        })
        return nextNotification
      } catch (error) {
        console.warn('Failed to load client notification:', error)
        return null
      }
    }

    requestRef.current ??= load()
    void requestRef.current.then((nextNotification) => {
      if (active) setNotification(nextNotification)
    })
    return () => {
      active = false
    }
  }, [dependencies])

  useEffect(() => {
    if (!notification || databaseBlocked || !pageVisible) return
    let active = true
    let release = () => {}
    void dependencies
      .withDisplayLock(async () => {
        if (!active || !isPageVisible()) return
        if (!displayedRef.current && dependencies.readDisplayedBatchIds().includes(notification.batch_id)) {
          setNotification(null)
          return
        }
        await new Promise<void>((resolve) => {
          release = resolve
          setClaimedBatchId(notification.batch_id)
        })
      })
      .catch((error) => console.warn('Failed to claim client notification:', error))
    return () => {
      active = false
      setClaimedBatchId(null)
      release()
    }
  }, [databaseBlocked, dependencies, notification, pageVisible])

  useEffect(() => {
    if (!open || !dependencies.onBackButton) return
    return dependencies.onBackButton(close)
  }, [close, dependencies, open])

  const markVisible = () => {
    if (
      !notification ||
      !open ||
      displayedRef.current ||
      !isPageVisible() ||
      isDatabaseBlocked(useDbSchemaGuardStore.getState())
    )
      return
    displayedRef.current = true
    try {
      dependencies.markBatchDisplayed(notification.batch_id)
    } catch (error) {
      console.warn('Failed to mark client notification as displayed:', error)
    }
    try {
      dependencies.trackImpression(notification)
    } catch (error) {
      console.warn('Failed to track client notification impression:', error)
    }
  }

  const openBodyLink = (url: string) => {
    if (!notification) return
    try {
      dependencies.trackLinkClick(notification)
    } catch (error) {
      console.warn('Failed to track client notification link click:', error)
    }
    try {
      void Promise.resolve(dependencies.openLink(url)).catch((error) => {
        console.warn('Failed to open client notification link:', error)
      })
    } catch (error) {
      console.warn('Failed to open client notification link:', error)
    }
  }

  return (
    <Dialog
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
      open={open}
      PaperProps={{
        sx: {
          '--notification-mobile-height':
            'min(638px, calc(100dvh - 12px - var(--mobile-safe-area-inset-top, env(safe-area-inset-top, 0px))))',
          backgroundImage: 'none',
          outline: '1px solid',
          outlineColor: 'var(--chatbox-border-primary)',
          outlineOffset: '-1px',
          color: 'var(--chatbox-tint-secondary)',
          borderRadius: isNarrowScreen ? '34px 34px 58px 58px' : '24px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          boxShadow: isNarrowScreen
            ? '0 4px 56px color-mix(in srgb, var(--chatbox-tint-black) 16%, transparent)'
            : '0 4px 24px -5px color-mix(in srgb, var(--chatbox-tint-black) 12%, transparent)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          m: isNarrowScreen ? '6px' : '16px',
          height: isNarrowScreen ? 'auto' : '544px',
          minHeight: isNarrowScreen ? 'min(320px, var(--notification-mobile-height))' : undefined,
          maxHeight: isNarrowScreen ? 'var(--notification-mobile-height)' : 'min(640px, calc(100dvh - 32px))',
          maxWidth: isNarrowScreen ? 418 : 571,
          width: isNarrowScreen ? 'calc(100% - 12px)' : 'calc(100% - 32px)',
        },
      }}
      scroll="paper"
      sx={{ '& .MuiDialog-container': { alignItems: isNarrowScreen ? 'flex-end' : 'center' } }}
      TransitionProps={{ onEntered: markVisible }}
      onClose={close}
    >
      <Box
        component="img"
        key={coverSrc}
        alt=""
        src={coverSrc}
        sx={{
          aspectRatio: '571 / 132',
          height: isNarrowScreen ? 'min(96px, calc(var(--notification-mobile-height) * 0.3))' : 'auto',
          display: 'block',
          flexShrink: 0,
          objectFit: 'cover',
          objectPosition: 'center bottom',
          width: '100%',
          opacity: loadedCover === coverSrc ? 1 : 0,
        }}
        onLoad={() => setLoadedCover(coverSrc)}
        onError={() => {
          if (hasCustomCover) setFailedCover(coverSrc)
        }}
      />
      <DialogContent
        sx={{
          minHeight: 0,
          overscrollBehavior: 'contain',
          p: '0 !important',
          '&::-webkit-scrollbar': { width: '6px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'color-mix(in srgb, currentColor 24%, transparent)',
            backgroundClip: 'content-box',
            border: '1px solid transparent',
            borderRadius: '999px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'color-mix(in srgb, currentColor 48%, transparent)',
          },
        }}
      >
        <DialogTitle
          component="div"
          sx={{
            fontFamily: 'inherit',
            overflowWrap: 'anywhere',
            p: isNarrowScreen ? '12px 16px 0' : '8px 16px 0',
          }}
        >
          <Typography
            component="h2"
            id={titleId}
            sx={{
              color: 'inherit',
              fontFamily: 'inherit',
              fontSize: '20px',
              fontWeight: 700,
              letterSpacing: 0,
              lineHeight: '24px',
              m: 0,
            }}
          >
            {notification?.title}
          </Typography>
          {notification?.subtitle ? (
            <Typography
              color="inherit"
              sx={{
                fontFamily: 'inherit',
                fontSize: isNarrowScreen ? '14px' : '12px',
                lineHeight: isNarrowScreen ? '20px' : '16px',
                mt: '12px',
              }}
            >
              {notification.subtitle}
            </Typography>
          ) : null}
        </DialogTitle>
        <Box sx={{ p: isNarrowScreen ? '20px 16px 0' : '16px 16px 0' }}>
          {notification ? (
            <NotificationMarkdown compact={!isNarrowScreen} onLinkClick={openBodyLink}>
              {notification.body_markdown}
            </NotificationMarkdown>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions
        sx={{
          flexShrink: 0,
          p: isNarrowScreen
            ? '16px 16px max(34px, var(--mobile-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))'
            : '24px 16px 16px',
        }}
      >
        <Button
          variant="contained"
          fullWidth
          disableElevation
          sx={{
            borderRadius: '999px',
            backgroundColor: 'var(--chatbox-background-brand-primary)',
            color: 'var(--chatbox-tint-white)',
            fontFamily: 'inherit',
            fontSize: isNarrowScreen ? '17px' : '14px',
            fontWeight: isNarrowScreen ? 500 : 400,
            minHeight: isNarrowScreen ? 52 : 32,
            lineHeight: '20px',
            p: '6px 16px',
            boxShadow: isNarrowScreen
              ? 'inset 0 1px 2px color-mix(in srgb, var(--chatbox-tint-white) 65%, transparent), inset 0 -2px 6px color-mix(in srgb, var(--chatbox-tint-white) 20%, transparent)'
              : 'none',
            textTransform: 'none',
            '&:hover': { backgroundColor: 'var(--chatbox-background-brand-primary-hover)' },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          }}
          onClick={close}
        >
          {t('Got it')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function ClientNotificationWindowRoot() {
  return <ClientNotificationWindow dependencies={defaultDependencies} />
}
