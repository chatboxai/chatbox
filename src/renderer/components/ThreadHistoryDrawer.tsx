import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Badge, Flex, Text } from '@mantine/core'
import { IconDots, IconEdit, IconSwitch, IconTrash } from '@tabler/icons-react'
import { useAtom, useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Session, SessionThreadBrief } from 'src/shared/types'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { currentSessionIdAtom, showThreadHistoryDrawerAtom } from '@/stores/atoms'
import { scrollToIndex } from '@/stores/scrollActions'
import { removeCurrentThread, removeThread, switchThread as switchThreadAction } from '@/stores/sessionActions'
import { getAllMessageList, getCurrentThreadHistoryHash } from '@/stores/sessionHelpers'
import { useLanguage } from '@/stores/settingsStore'
import ActionMenu from './ActionMenu'
import { Drawer } from './Overlay'
import { ScalableIcon } from './ScalableIcon'

export default function ThreadHistoryDrawer({ session }: { session: Session }) {
  const { t } = useTranslation()
  const language = useLanguage()
  const [showDrawer, setShowDrawer] = useAtom(showThreadHistoryDrawerAtom)

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
      setShowDrawer(false)
    },
    [threadList, setShowDrawer, currentMessageList]
  )

  const handleSwitchThread = useCallback(
    (threadId: string) => {
      void switchThreadAction(session.id, threadId)
      setShowDrawer(false)
    },
    [session.id, setShowDrawer]
  )

  return (
    <Drawer
      opened={!!showDrawer}
      onClose={() => setShowDrawer(false)}
      position={language === 'ar' ? 'left' : 'right'}
      size={280}
      title={t('Thread History')}
      classNames={{
        body: 'flex flex-col p-0 gap-xs',
      }}
    >
      {threadList.map((thread, index) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          goto={gotoThreadMessage}
          showHistoryDrawer={showDrawer}
          switchThread={handleSwitchThread}
          lastOne={index === threadList.length - 1}
        />
      ))}
    </Drawer>
  )
}

function ThreadItem(props: {
  thread: SessionThreadBrief
  goto(threadId: string): void
  showHistoryDrawer: string | boolean
  switchThread(threadId: string): void
  lastOne?: boolean
}) {
  const { t } = useTranslation()
  const { thread, goto, switchThread, lastOne } = props
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
      className="group/thread-item px-xs py-xxs cursor-pointer hover:bg-chatbox-background-gray-secondary"
    >
      <Badge color="chatbox-tertiary" size="xs">
        {thread.messageCount}
      </Badge>
      {/* <Text size="xs" c="chatbox-tertiary">
        {thread.messageCount}
      </Text> */}
      <Text size="xs" lineClamp={1} flex={1}>
        {threadName} ({thread.createdAtLabel})
      </Text>
      <ActionMenu
        position="bottom"
        items={[
          { text: t('Edit Thread Name'), icon: IconEdit, onClick: onEditButtonClick },
          { text: t('Switch'), icon: IconSwitch, onClick: onSwitchButtonClick },
          {
            divider: true,
          },
          {
            doubleCheck: true,
            text: t('delete'),
            icon: IconTrash,
            onClick: () => {
              if (!currentSessionId) {
                return
              }
              if (lastOne) {
                void removeCurrentThread(currentSessionId)
              } else {
                void removeThread(currentSessionId, thread.id)
              }
            },
          },
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
