import { Button, SnackbarContent } from '@mui/material'
import { TestId } from '@shared/automation/testids'
import type { Message } from '@shared/types'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { uiStore, useUIStore } from '@/stores/uiStore'

export const MESSAGE_LONG_PRESS_HINT_DURATION_MS = 5000

/** The hint appears on a small screen once a finished assistant reply is on screen, until the user acknowledges it. */
export function shouldShowMessageLongPressHint({
  isSmallScreen,
  alreadyShown,
  messages,
}: {
  isSmallScreen: boolean
  alreadyShown: boolean
  messages: readonly Pick<Message, 'role' | 'generating'>[]
}): boolean {
  return (
    isSmallScreen && !alreadyShown && messages.some((message) => message.role === 'assistant' && !message.generating)
  )
}

/**
 * Notice above the composer telling small-screen users that swiping an AI reply right replies again and that the
 * remaining message actions live in the long-press menu.
 * It appears at most once per app launch and closes after five seconds or on "Got it"; only "Got it" records it as
 * seen, so a hint that timed out appears again on the next launch.
 */
export const MessageLongPressHint: FC<{ messages: readonly Pick<Message, 'role' | 'generating'>[] }> = ({
  messages,
}) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const alreadyShown = useUIStore((state) => state.messageGestureHintShown || state.messageLongPressHintShownThisLaunch)
  const [visible, setVisible] = useState(false)

  const shouldShow = shouldShowMessageLongPressHint({ isSmallScreen, alreadyShown, messages })
  useEffect(() => {
    if (!shouldShow) return
    uiStore.setState({ messageLongPressHintShownThisLaunch: true })
    setVisible(true)
  }, [shouldShow])

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(false), MESSAGE_LONG_PRESS_HINT_DURATION_MS)
    return () => clearTimeout(timer)
  }, [visible])

  const acknowledge = () => {
    uiStore.setState({ messageGestureHintShown: true })
    setVisible(false)
  }

  if (!visible) return null
  return (
    <SnackbarContent
      data-testid={TestId.message.longPressHint}
      role="status"
      sx={{ flexWrap: 'nowrap', '& .MuiSnackbarContent-action': { flexShrink: 0 } }}
      message={t('Swipe an AI reply right to reply again. Long press a message to edit, copy, or select text')}
      action={
        <Button size="small" data-testid={TestId.message.longPressHintDismiss} onClick={acknowledge}>
          {t('Got it')}
        </Button>
      }
    />
  )
}
