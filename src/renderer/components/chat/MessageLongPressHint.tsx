import { Button, SnackbarContent } from '@mui/material'
import { TestId } from '@shared/automation/testids'
import type { Message } from '@shared/types'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { uiStore, useUIStore } from '@/stores/uiStore'

export const MESSAGE_LONG_PRESS_HINT_DURATION_MS = 5000

/** The hint appears once, on a small screen, the first time a finished assistant reply is on screen. */
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
 * One-time notice above the composer telling small-screen users that message actions moved into the long-press menu.
 * It is marked as shown as soon as it appears, closes after five seconds or on "Got it", and never returns.
 */
export const MessageLongPressHint: FC<{ messages: readonly Pick<Message, 'role' | 'generating'>[] }> = ({
  messages,
}) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const alreadyShown = useUIStore((state) => state.messageLongPressHintShown)
  const [visible, setVisible] = useState(false)

  const shouldShow = shouldShowMessageLongPressHint({ isSmallScreen, alreadyShown, messages })
  useEffect(() => {
    if (!shouldShow) return
    uiStore.setState({ messageLongPressHintShown: true })
    setVisible(true)
  }, [shouldShow])

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(false), MESSAGE_LONG_PRESS_HINT_DURATION_MS)
    return () => clearTimeout(timer)
  }, [visible])

  if (!visible) return null
  return (
    <SnackbarContent
      data-testid={TestId.message.longPressHint}
      role="status"
      sx={{ flexWrap: 'nowrap', '& .MuiSnackbarContent-action': { flexShrink: 0 } }}
      message={t('Long press a message to reply again, edit, copy, or select text')}
      action={
        <Button size="small" data-testid={TestId.message.longPressHintDismiss} onClick={() => setVisible(false)}>
          {t('Got it')}
        </Button>
      }
    />
  )
}
