import { isThreadHistoryAvailable, resolveSessionMode, type SessionMode } from '@chatbox/core/session/mode-policy'
import { Button, Loader, SegmentedControl } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Session } from '@shared/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { SettingsDensityProvider } from '@/components/settings/SettingsLayout'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { SessionSettingsContent } from './SessionSettingsContent'
import { closeSessionPanel, showSessionPanelTab, usePersistedSessionEdit, useSessionPanel } from './SessionSidePanel'
import ThreadHistoryList from './ThreadHistoryList'

/**
 * Small-screen counterpart of the conversation side panel: one bottom sheet whose segments match
 * the panel's tabs. The sheet is the only scroll container and every change applies immediately.
 */
export function SessionSheet({
  session,
  sessionId: requestedSessionId,
  isError,
  onRetry,
}: {
  session: Session | undefined
  sessionId?: string
  isError?: boolean
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const sessionId = session?.id ?? requestedSessionId ?? ''
  const panel = useSessionPanel(sessionId)
  const mode = resolveSessionMode(useSessionAgentMode(sessionId).value)
  const close = useCallback(() => closeSessionPanel(sessionId), [sessionId])

  const showThreads = session ? isThreadHistoryAvailable(session, mode) : false
  const tab = panel.tab === 'threads' && showThreads ? 'threads' : 'settings'

  return (
    <Drawer.Root
      open={panel.open && Boolean(sessionId)}
      onOpenChange={(open) => !open && close()}
      noBodyStyles
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <Drawer.Content
          data-testid={TestId.sessionPanel.sheet}
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 flex max-h-[90vh] flex-col rounded-t-2xl bg-chatbox-background-secondary outline-none"
        >
          <Drawer.Handle className="!mt-2 !mb-1" />
          <Drawer.Title className="sr-only">{t('Conversation panel')}</Drawer.Title>
          {showThreads && (
            <div className="shrink-0 px-3 pb-2 pt-1">
              <SegmentedControl
                fullWidth
                size="sm"
                radius="md"
                value={tab}
                onChange={(value) => showSessionPanelTab(sessionId, value === 'threads' ? 'threads' : 'settings')}
                data={[
                  { value: 'settings', label: t('Conversation Settings') },
                  { value: 'threads', label: t('Thread History') },
                ]}
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-[calc(var(--mobile-safe-area-inset-bottom,0px)+16px)]">
            {!session ? (
              <div role="status" className="flex min-h-24 items-center justify-center gap-2">
                {isError ? (
                  <Button variant="subtle" onClick={onRetry}>
                    {t('Try Again')}
                  </Button>
                ) : (
                  <>
                    <Loader size="xs" />
                    {t('Loading...')}
                  </>
                )}
              </div>
            ) : tab === 'threads' ? (
              <div className="rounded-xl bg-chatbox-background-primary p-1">
                <ThreadHistoryList key={session.id} session={session} onNavigate={close} inlineMenus />
              </div>
            ) : (
              <SettingsDensityProvider density="touch">
                <SheetSessionSettings key={session.id} session={session} mode={mode} />
              </SettingsDensityProvider>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/** Keyed per conversation, so edits still pending when the sheet moves on land in the chat they were typed in. */
function SheetSessionSettings({ session, mode }: { session: Session; mode: SessionMode }) {
  const onEdit = usePersistedSessionEdit(session)
  return <SessionSettingsContent session={session} mode={mode} onEdit={onEdit} />
}
