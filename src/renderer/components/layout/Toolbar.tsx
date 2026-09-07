import { isThreadHistoryAvailable, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Session } from '@shared/types'
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
import { rendererApplication } from '@/app/renderer-application'
import { useIsLargeScreen, useIsSmallScreen } from '@/hooks/useScreenChange'
import { copyToClipboard } from '@/packages/navigator'
import { confirmSessionDeletion } from '@/presentation/session/session-deletion-confirmation'
import { router } from '@/router'
import * as atoms from '@/stores/atoms'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { clear as clearSession, copyAndSwitchSession, deleteSession } from '@/stores/session/crud'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu from '../ActionMenu'
import { ScalableIcon } from '../common/ScalableIcon'
import Broom from '../icons/Broom'
import LayoutExpand from '../icons/LayoutExpand'
import LayoutShrink from '../icons/LayoutShrink'

/**
 * 顶部标题工具栏（右侧）
 * @returns
 */
export default function Toolbar({ session }: { session: Session }) {
  const { t } = useTranslation()
  const sessionId = session.id
  const isSmallScreen = useIsSmallScreen()
  const isLargeScreen = useIsLargeScreen()

  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const setThreadHistoryDrawerOpen = useSetAtom(atoms.showThreadHistoryDrawerAtom)
  const widthFull = useUIStore((s) => s.widthFull)
  const setWidthFull = useUIStore((s) => s.setWidthFull)
  const agentModeEntry = useSessionAgentMode(sessionId)
  const showThreadHistory = isThreadHistoryAvailable(session, resolveSessionMode(agentModeEntry.value))

  const handleExportAndSave = () => {
    NiceModal.show('export-chat')
  }
  const handleSessionClean = () => {
    void clearSession(sessionId)
  }
  const handleSessionDelete = async () => {
    if (!(await confirmSessionDeletion(sessionId))) {
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
    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
    if (session) {
      await NiceModal.show('json-viewer', { title: t('Session Raw JSON'), data: session })
    }
  }, [sessionId, t])

  const handleCopySession = useCallback(async () => {
    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
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
          radius="lg"
          variant="outline"
          color="chatbox-tertiary"
          data-testid={TestId.session.searchTrigger}
          leftSection={<ScalableIcon icon={IconSearch} size={16} strokeWidth={1.8} />}
          className="border-chatbox-border-primary"
          classNames={{
            label: 'px-1',
          }}
          onClick={() => setOpenSearchDialog(true)}
        >
          {t('Search')}...
        </Button>
      ) : (
        <ActionIcon
          variant="subtle"
          size={28}
          color="chatbox-secondary"
          data-testid={TestId.session.searchTrigger}
          onClick={() => setOpenSearchDialog(true)}
        >
          <IconSearch strokeWidth={1.8} />
        </ActionIcon>
      )}

      <ActionMenu
        position="bottom-end"
        contentTestId={TestId.session.headerMenu}
        items={[
          ...(isLargeScreen
            ? [
                {
                  text: widthFull ? t('Standard Width') : t('Full Width'),
                  icon: widthFull ? LayoutExpand : LayoutShrink,
                  testId: TestId.session.widthToggle,
                  onClick: () => setWidthFull(!widthFull),
                },
              ]
            : []),
          ...(showThreadHistory
            ? [
                {
                  text: t('Thread History'),
                  icon: IconHistory,
                  testId: TestId.session.threadHistory,
                  onClick: () => setThreadHistoryDrawerOpen(true),
                },
              ]
            : []),
          ...(isLargeScreen || showThreadHistory
            ? [
                {
                  divider: true as const,
                },
              ]
            : []),
          {
            text: t('Duplicate Conversation'),
            icon: IconCopy,
            testId: TestId.session.duplicate,
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
            testId: TestId.session.export,
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
            testId: TestId.session.clearMessages,
            confirmTestId: TestId.session.clearMessagesConfirm,
            onClick: handleSessionClean,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Delete Current Session'),
            icon: IconTrash,
            color: 'chatbox-primary',
            testId: TestId.session.delete,
            confirmTestId: TestId.session.deleteConfirm,
            onClick: handleSessionDelete,
          },
        ]}
      >
        <ActionIcon variant="subtle" size={28} color="chatbox-secondary" data-testid={TestId.session.headerMenuTrigger}>
          <IconDots strokeWidth={1.8} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  ) : (
    <Flex align="center" gap="xs">
      <ActionIcon
        variant="subtle"
        size={24}
        color="chatbox-secondary"
        data-testid={TestId.session.searchTrigger}
        onClick={() => setOpenSearchDialog(true)}
      >
        <IconSearch strokeWidth={1.8} />
      </ActionIcon>
      <ActionMenu
        position="bottom-end"
        contentTestId={TestId.session.headerMenu}
        items={[
          ...(showThreadHistory
            ? [
                {
                  text: t('Thread History'),
                  icon: IconHistory,
                  testId: TestId.session.threadHistory,
                  onClick: () => setThreadHistoryDrawerOpen(true),
                },
              ]
            : []),
          {
            text: t('Duplicate Conversation'),
            icon: IconCopy,
            testId: TestId.session.duplicate,
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
            testId: TestId.session.export,
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
            testId: TestId.session.clearMessages,
            confirmTestId: TestId.session.clearMessagesConfirm,
            onClick: handleSessionClean,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Delete Current Session'),
            icon: IconTrash,
            color: 'chatbox-primary',
            testId: TestId.session.delete,
            confirmTestId: TestId.session.deleteConfirm,
            onClick: handleSessionDelete,
          },
        ]}
      >
        <ActionIcon variant="subtle" size={24} color="chatbox-secondary" data-testid={TestId.session.headerMenuTrigger}>
          <IconDots strokeWidth={1.8} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  )
}
