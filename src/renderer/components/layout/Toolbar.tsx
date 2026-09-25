import type { SessionHeader } from '@chatbox/core/ports'
import { isThreadHistoryAvailable, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal from '@ebay/nice-modal-react'
import { Flex } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Session } from '@shared/types'
import {
  IconCode,
  IconCopy,
  IconDeviceFloppy,
  IconDots,
  IconHistory,
  IconId,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react'
import { useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { useIsLargeScreen } from '@/hooks/useScreenChange'
import { copyToClipboard } from '@/packages/navigator'
import { confirmSessionDeletion } from '@/presentation/session/session-deletion-confirmation'
import { router } from '@/router'
import * as atoms from '@/stores/atoms'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { clear as clearSession, copyAndSwitchSession, deleteSession } from '@/stores/session/crud'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps, type ActionMenuProps } from '../ActionMenu'
import { IconButton } from '../common/IconButton'
import Broom from '../icons/Broom'
import LayoutExpand from '../icons/LayoutExpand'
import LayoutShrink from '../icons/LayoutShrink'

/**
 * Conversation menu (width, thread history, duplicate, export, clear, delete) opened from `children`.
 * Wide layouts trigger it from the ⋯ button in the title bar; small screens from the header title.
 */
export function SessionMenu({
  session,
  children,
  onEditSettings,
}: {
  session: Session | SessionHeader
  children: ActionMenuProps['children']
  /** Adds a conversation settings entry at the top, for layouts without the title's edit button. */
  onEditSettings?: () => void
}) {
  const { t } = useTranslation()
  const sessionId = session.id
  const isLargeScreen = useIsLargeScreen()

  const setThreadHistoryDrawerOpen = useSetAtom(atoms.showThreadHistoryDrawerAtom)
  const widthFull = useUIStore((s) => s.widthFull)
  const setWidthFull = useUIStore((s) => s.setWidthFull)
  const agentModeEntry = useSessionAgentMode(sessionId)
  const showThreadHistory = isThreadHistoryAvailable(
    'threads' in session ? session : {},
    resolveSessionMode(agentModeEntry.value)
  )

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

  const items: ActionMenuItemProps[] = [
    ...(onEditSettings
      ? [
          {
            text: t('Conversation Settings'),
            icon: IconSettings,
            onClick: onEditSettings,
          },
        ]
      : []),
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
    ...(onEditSettings || isLargeScreen || showThreadHistory ? [{ divider: true as const }] : []),
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
    { divider: true },
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
  ]

  return (
    <ActionMenu position="bottom-end" contentTestId={TestId.session.headerMenu} items={items}>
      {children}
    </ActionMenu>
  )
}

/** Title bar actions for a conversation. */
export default function Toolbar({ session }: { session: Session | SessionHeader }) {
  const { t } = useTranslation()
  return (
    <Flex align="center" className="controls">
      <SessionMenu session={session}>
        <IconButton icon={IconDots} size="sm" aria-label={t('More')} data-testid={TestId.session.headerMenuTrigger} />
      </SessionMenu>
    </Flex>
  )
}
