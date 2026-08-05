import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex } from '@mantine/core'
import {
  IconClearAll,
  IconCode,
  IconCopy,
  IconDeviceFloppy,
  IconDots,
  IconHistory,
  IconId,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react'
import { useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsLargeScreen, useIsSmallScreen } from '@/hooks/useScreenChange'
import { copyToClipboard } from '@/packages/navigator'
import { router } from '@/router'
import * as atoms from '@/stores/atoms'
import { confirmSessionDeletion, deleteSession, getSession } from '@/stores/chatStore'
import { clear as clearSession, copyAndSwitchSession } from '@/stores/sessionActions'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu from '../ActionMenu'
import { ScalableIcon } from '../common/ScalableIcon'
import { confirmAndDiscardSubmissionQueue } from '../InputBox/queued-message-confirmation'
import Broom from '../icons/Broom'
import LayoutExpand from '../icons/LayoutExpand'
import LayoutShrink from '../icons/LayoutShrink'

/**
 * 顶部标题工具栏（右侧）
 * @returns
 */
export default function Toolbar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const isLargeScreen = useIsLargeScreen()

  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const setThreadHistoryDrawerOpen = useSetAtom(atoms.showThreadHistoryDrawerAtom)
  const widthFull = useUIStore((s) => s.widthFull)
  const setWidthFull = useUIStore((s) => s.setWidthFull)

  const handleExportAndSave = () => {
    NiceModal.show('export-chat')
  }
  const handleSessionClean = async () => {
    if (!(await confirmAndDiscardSubmissionQueue(sessionId))) {
      return
    }
    await clearSession(sessionId)
  }
  const handleSessionDelete = async () => {
    if (!(await confirmSessionDeletion(sessionId))) {
      return
    }
    if (!(await confirmAndDiscardSubmissionQueue(sessionId))) {
      return
    }
    try {
      await deleteSession(sessionId)
      router.navigate({ to: '/', replace: true })
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const handleViewSessionJson = useCallback(async () => {
    const session = await getSession(sessionId)
    if (session) {
      await NiceModal.show('json-viewer', { title: t('Session Raw JSON'), data: session })
    }
  }, [sessionId, t])

  const handleCopySession = useCallback(async () => {
    const session = await getSession(sessionId)
    if (session) {
      await copyAndSwitchSession(session)
    }
  }, [sessionId])

  const handleCopySessionId = useCallback(() => {
    copyToClipboard(sessionId)
    toastActions.add(t('copied to clipboard'), 2000)
  }, [sessionId, t])

  return !isSmallScreen ? (
    <Flex align="center" gap="md" className="controls">
      {!isSmallScreen ? (
        <Button
          h={28}
          px="xs"
          radius="sm"
          variant="outline"
          color="chatbox-tertiary"
          leftSection={<ScalableIcon icon={IconSearch} size={16} strokeWidth={1.8} />}
          className="border-chatbox-border-primary"
          onClick={() => setOpenSearchDialog(true)}
        >
          {t('Search')}...
        </Button>
      ) : (
        <ActionIcon variant="subtle" size={28} color="chatbox-secondary" onClick={() => setOpenSearchDialog(true)}>
          <IconSearch strokeWidth={1.8} />
        </ActionIcon>
      )}

      {isLargeScreen && (
        <ActionIcon variant="subtle" size={28} color="chatbox-secondary" onClick={() => setWidthFull(!widthFull)}>
          {widthFull ? <LayoutExpand strokeWidth={1.8} /> : <LayoutShrink strokeWidth={1.8} />}
        </ActionIcon>
      )}

      <ActionIcon variant="subtle" size={28} color="chatbox-secondary" onClick={() => setThreadHistoryDrawerOpen(true)}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="lucide lucide-table-of-contents-icon lucide-table-of-contents"
        >
          <path d="M16 5H3" />
          <path d="M16 12H3" />
          <path d="M16 19H3" />
          <path d="M21 5h.01" />
          <path d="M21 12h.01" />
          <path d="M21 19h.01" />
        </svg>
      </ActionIcon>

      <ActionMenu
        position="bottom-end"
        items={[
          {
            text: t('Duplicate Conversation'),
            icon: IconCopy,
            onClick: handleCopySession,
          },
          {
            text: t('Copy Conversation ID'),
            icon: IconId,
            onClick: handleCopySessionId,
          },
          {
            text: t('Export Chat'),
            icon: IconDeviceFloppy,
            onClick: handleExportAndSave,
          },
          ...(process.env.NODE_ENV === 'development'
            ? [
                {
                  text: t('View Session JSON'),
                  icon: IconCode,
                  onClick: handleViewSessionJson,
                },
              ]
            : []),
          {
            divider: true,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Clear All Messages'),
            icon: Broom,
            color: 'chatbox-primary',
            onClick: handleSessionClean,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Delete Current Session'),
            icon: IconTrash,
            color: 'chatbox-primary',
            onClick: handleSessionDelete,
          },
        ]}
      >
        <ActionIcon variant="subtle" size={28} color="chatbox-secondary">
          <IconDots strokeWidth={1.8} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  ) : (
    <Flex align="center" gap="xs">
      <ActionIcon variant="subtle" size={24} color="chatbox-secondary" onClick={() => setOpenSearchDialog(true)}>
        <IconSearch strokeWidth={1.8} />
      </ActionIcon>
      <ActionMenu
        position="bottom-end"
        items={[
          {
            text: t('Thread History'),
            icon: IconHistory,
            onClick: () => setThreadHistoryDrawerOpen(true),
          },
          {
            text: t('Duplicate Conversation'),
            icon: IconCopy,
            onClick: handleCopySession,
          },
          {
            text: t('Copy Conversation ID'),
            icon: IconId,
            onClick: handleCopySessionId,
          },
          {
            text: t('Export Chat'),
            icon: IconDeviceFloppy,
            onClick: handleExportAndSave,
          },
          ...(process.env.NODE_ENV === 'development'
            ? [
                {
                  text: t('View Session JSON'),
                  icon: IconCode,
                  onClick: handleViewSessionJson,
                },
              ]
            : []),
          {
            divider: true,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Clear All Messages'),
            icon: IconClearAll,
            color: 'chatbox-primary',
            onClick: handleSessionClean,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Delete Current Session'),
            icon: IconTrash,
            color: 'chatbox-primary',
            onClick: handleSessionDelete,
          },
        ]}
      >
        <ActionIcon variant="subtle" size={24} color="chatbox-secondary">
          <IconDots strokeWidth={1.8} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  )
}
