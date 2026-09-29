import { type CurrentThreadTarget, getCurrentThreadTarget } from '@chatbox/core/application/session'
import { resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Badge, Flex, Text } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Session, SessionThreadBrief } from '@shared/types'
import { IconDots, IconEdit, IconSwitch, IconTrash } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { currentSessionIdAtom } from '@/stores/atoms'
import { scrollToIndex } from '@/stores/scrollActions'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { removeThread, switchThread as switchThreadAction } from '@/stores/session/threads'
import { getAllMessageList, getCurrentThreadHistoryHash } from '@/stores/sessionHelpers'
import ActionMenu from '../ActionMenu'
import { ScalableIcon } from '../common/ScalableIcon'

/**
 * Threads of the conversation, newest last. Selecting one scrolls to it; the menu renames,
 * switches to or deletes it. Hosted by the side panel and the small-screen conversation sheet.
 */
export default function ThreadHistoryList({
  session,
  onNavigate,
  inlineMenus,
}: {
  session: Session
  onNavigate?: () => void
  /** Renders thread menus inside the list, for hosts such as a modal sheet that block the page outside. */
  inlineMenus?: boolean
}) {
  const { t } = useTranslation()
  const agentModeEntry = useSessionAgentMode(session.id)
  const sessionMode = resolveSessionMode(agentModeEntry.value)

  const currentMessageList = useMemo(() => getAllMessageList(session), [session])

  const currentThreadHistoryHash = useMemo(() => getCurrentThreadHistoryHash(session), [session])
  const threadList = useMemo(
    () => (currentThreadHistoryHash ? Object.values(currentThreadHistoryHash) : []),
    [currentThreadHistoryHash]
  )

  const gotoThreadMessage = useCallback(
    (threadId: string) => {
      const thread = threadList.find((t) => t.id === threadId)
      if (!thread) {
        return
      }
      const msgIndex = currentMessageList.findIndex((m) => m.id === thread.firstMessageId)
      if (msgIndex >= 0) {
        scrollToIndex(msgIndex, 'start', 'smooth')
      }
      onNavigate?.()
    },
    [threadList, onNavigate, currentMessageList]
  )

  const handleSwitchThread = useCallback(
    (threadId: string) => {
      void switchThreadAction(session.id, threadId)
      onNavigate?.()
    },
    [session.id, onNavigate]
  )

  if (threadList.length === 0) {
    return (
      <Text fz={13} c="chatbox-tertiary" ta="center" py="xl">
        {t('No threads yet')}
      </Text>
    )
  }

  return (
    <div className="flex flex-col gap-0.5" data-testid={TestId.session.threadHistoryList}>
      {threadList.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          goto={gotoThreadMessage}
          switchThread={handleSwitchThread}
          allowStructureActions={sessionMode === 'chat'}
          sessionId={session.id}
          currentThreadTarget={getCurrentThreadTarget(session)}
          inlineMenu={inlineMenus}
        />
      ))}
    </div>
  )
}

function ThreadItem(props: {
  thread: SessionThreadBrief
  goto(threadId: string): void
  switchThread(threadId: string): void
  allowStructureActions: boolean
  sessionId: string
  currentThreadTarget: CurrentThreadTarget
  inlineMenu?: boolean
}) {
  const { t } = useTranslation()
  const { thread, goto, switchThread, allowStructureActions, sessionId, currentThreadTarget, inlineMenu } = props
  const threadName = thread.name || t('New Thread')
  const currentSessionId = useAtomValue(currentSessionIdAtom)
  const isSmallScreen = useIsSmallScreen()

  const [menuOpened, setMenuOpened] = useState(false)

  const onEditButtonClick = useCallback(() => {
    void NiceModal.show('thread-name-edit', { sessionId: currentSessionId, threadId: thread.id })
  }, [currentSessionId, thread.id])

  const onSwitchButtonClick = useCallback(() => {
    switchThread(thread.id)
  }, [switchThread, thread.id])

  return (
    <Flex
      gap="sm"
      align="center"
      onClick={() => {
        goto(thread.id)
      }}
      className={clsx(
        'group/thread-item cursor-pointer rounded-md px-2 hover:bg-chatbox-background-gray-secondary',
        isSmallScreen ? 'min-h-11' : 'min-h-8'
      )}
    >
      <Badge color="chatbox-tertiary" size="xs">
        {thread.messageCount}
      </Badge>
      {/* <Text size="xs" c="chatbox-tertiary">
        {thread.messageCount}
      </Text> */}
      <Text fz={isSmallScreen ? 14 : 13} lineClamp={1} flex={1}>
        {threadName} ({thread.createdAtLabel})
      </Text>
      <ActionMenu
        position="bottom"
        type="desktop"
        withinPortal={!inlineMenu}
        items={[
          { text: t('Edit Thread Name'), icon: IconEdit, onClick: onEditButtonClick },
          ...(allowStructureActions
            ? [
                { text: t('Switch'), icon: IconSwitch, onClick: onSwitchButtonClick },
                {
                  divider: true as const,
                },
                {
                  doubleCheck: true,
                  text: t('Delete'),
                  icon: IconTrash,
                  onClick: () => {
                    if (!currentSessionId) {
                      return
                    }
                    return removeThread(sessionId, thread.id, currentThreadTarget)
                  },
                },
              ]
            : []),
        ]}
        opened={menuOpened}
        onChange={(opened) => setMenuOpened(opened)}
      >
        <ActionIcon
          variant="transparent"
          color="chatbox-primary"
          className={isSmallScreen || menuOpened ? '' : 'group-hover/thread-item:visible invisible'}
          onClick={(e) => e.stopPropagation()}
        >
          <ScalableIcon icon={IconDots} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  )
}
