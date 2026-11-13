import { Button, Flex, Text } from '@mantine/core'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { autoDialogueConfirmStore, resolveAutoDialogueConfirm } from '@/stores/session/generation'

/** Asks before each AI vs AI turn; the dialogue stops if nobody confirms in time. */
export const AutoDialogueConfirmBar = memo(function AutoDialogueConfirmBar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const pending = useStore(autoDialogueConfirmStore, (state) => Boolean(state[sessionId]))
  if (!pending) return null

  return (
    <Flex align="center" gap="xs" className="rounded-md bg-chatbox-background-secondary px-2 py-1.5">
      <Text size="sm" c="chatbox-secondary" className="min-w-0 flex-1">
        {t('AI vs AI: confirm the next turn. Stops automatically if not confirmed within 10 minutes.')}
      </Text>
      <Button
        size="compact-sm"
        variant="default"
        className="flex-shrink-0"
        onClick={() => resolveAutoDialogueConfirm(sessionId, false)}
      >
        {t('Stop')}
      </Button>
      <Button size="compact-sm" className="flex-shrink-0" onClick={() => resolveAutoDialogueConfirm(sessionId, true)}>
        {t('Confirm')}
      </Button>
    </Flex>
  )
})
