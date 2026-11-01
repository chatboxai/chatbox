import { getSessionSearchTarget, clearSessionSearchTarget } from '@/stores/session-search-target'
import { resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { Box, Button, Loader } from '@mantine/core'
import type { ModelProvider } from '@shared/types'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { JK_PAGE_NAMES } from '@/analytics/jk-events'
import { rendererApplication } from '@/app/renderer-application'
import MessageList, { type MessageListRef } from '@/components/chat/MessageList'
import { ChatboxWelcomeCard } from '@/components/common/ChatboxWelcomeCard'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import InputBox, { type InputBoxPayload } from '@/components/InputBox/InputBox'
import { paddedContentColumnClassName } from '@/components/layout/contentColumn'
import Header from '@/components/layout/Header'
import Page from '@/components/layout/Page'
import { SessionSheet } from '@/components/session/SessionSheet'
import { closeSessionPanel, SessionSidePanel } from '@/components/session/SessionSidePanel'
import { useGenerationStop } from '@/hooks/useGenerationStop'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSessionPresentation, useSessionTranscript } from '@/hooks/useSessionPresentation'
import useVersion from '@/hooks/useVersion'
import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import * as remote from '@/packages/remote'
import {
  sessionStartupRecovery,
  useSessionStartupGuard,
  useSessionStartupLoadTarget,
  useSessionStartupQueryFailure,
} from '@/packages/session-startup-recovery'
import platform from '@/platform'
import { showSessionArchiveUndo } from '@/presentation/session/session-archive-notification'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { applyChatboxLicenseDefaultModelToSession } from '@/stores/defaultChatModel'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { switchCurrentSession } from '@/stores/session/crud'
import { submitNewUserMessage } from '@/stores/session/messages'
import { startNewThread } from '@/stores/session/threads'
import { clearSessionActivity, setOnScreenSession } from '@/stores/sessionActivityStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { getHomeWelcomeCardMode } from '@/utils/homeWelcomeCard'

export const Route = createFileRoute('/session/$sessionId')({
  component: SessionRouteWithErrorBoundary,
})

function SessionRouteWithErrorBoundary() {
  const { sessionId } = Route.useParams()
  return (
    <ErrorBoundary key={sessionId} name="session-route" onError={() => sessionStartupRecovery.fail(sessionId)}>
      <RouteComponent />
    </ErrorBoundary>
  )
}

const builtInTemplateSessionIds = new Set(
  [...defaultSessionsForEN, ...defaultSessionsForCN].map((session) => session.id)
)

function RouteComponent() {
  const { t } = useTranslation()
  const { sessionId: currentSessionId } = Route.useParams()
  const navigate = useNavigate()
  const sessionLoadTarget = useSessionStartupLoadTarget(currentSessionId)
  const recovering = sessionLoadTarget === null
  const { header: currentSession, read: headerRead, isFetching, isError } = useSessionPresentation(sessionLoadTarget)
  useSessionStartupQueryFailure(currentSessionId, sessionLoadTarget, isError && !currentSession)
  const sessionLoadSettled = currentSession?.id === currentSessionId || (!isFetching && !isError)
  useSessionStartupGuard(currentSessionId, sessionLoadSettled, recovering)
  const messageListRef = useRef<MessageListRef>(null)
  const [searchTarget] = useState(() => getSessionSearchTarget(currentSessionId))
  const initialOrigin = useMemo(
    () => (searchTarget ? { messageId: searchTarget.messageId } : ('tail' as const)),
    [searchTarget]
  )
  const captureAnchor = useCallback(() => messageListRef.current?.captureAnchor() ?? null, [])
  const transcript = useSessionTranscript(sessionLoadTarget, initialOrigin, captureAnchor)
  useEffect(() => {
    if (searchTarget) clearSessionSearchTarget(searchTarget)
  }, [searchTarget])
  const { providers } = useProviders()
  const licenseKey = useSettingsStore((s) => s.licenseKey)
  const hasLicense = Boolean(licenseKey)
  const licenseDetail = useSettingsStore((s) => s.licenseDetail)
  const licensePlanName = useSettingsStore((s) => s.licensePlanName)
  const hasExpiredLicense = useSettingsStore((s) => s.hasExpiredLicense)
  const autoScrollNewMessagesToTop = useSettingsStore((s) => s.autoScrollNewMessagesToTop)
  const isLoggedIn = useAuthInfoStore((s) => Boolean(s.accessToken && s.refreshToken))
  const { isExceeded, isExceededResolved } = useVersion()
  const widthFull = useUIStore((s) => s.widthFull)
  const isSmallScreen = useIsSmallScreen()
  const setLastUsedChatModel = useStore(lastUsedModelStore, (state) => state.setChatModel)
  const isWorkMode = resolveSessionMode(useSessionAgentMode(currentSessionId).value) === 'work'
  const builtInBrowser = useMemo(
    () => (!isSmallScreen && isWorkMode ? platform.builtInBrowser?.forSession(currentSessionId) : undefined),
    [isSmallScreen, isWorkMode, currentSessionId]
  )

  useEffect(() => {
    setOnScreenSession(currentSessionId)
    clearSessionActivity(currentSessionId)
    return () => setOnScreenSession(null)
  }, [currentSessionId])

  const welcomeCardMode = useMemo(
    () =>
      getHomeWelcomeCardMode({
        providerCount: providers.length,
        isLoggedIn,
        hasLicense,
        hasExpiredLicense,
        hideForStoreReview: isExceeded || !isExceededResolved,
      }),
    [providers.length, isLoggedIn, hasLicense, hasExpiredLicense, isExceeded, isExceededResolved]
  )

  const shouldShowTemplateWelcomeCard = useMemo(
    () => Boolean(currentSession && builtInTemplateSessionIds.has(currentSession.id) && welcomeCardMode !== 'none'),
    [currentSession, welcomeCardMode]
  )
  const currentSessionWithDefaultModel = useMemo(() => {
    if (!currentSession || !builtInTemplateSessionIds.has(currentSession.id)) {
      return currentSession
    }
    return applyChatboxLicenseDefaultModelToSession(currentSession, {
      licenseKey,
      hasExpiredLicense,
      licenseDetail,
      licensePlanName,
    })
  }, [currentSession, hasExpiredLicense, licenseDetail, licenseKey, licensePlanName])
  const goHome = useCallback(() => {
    navigate({ to: '/', replace: true })
  }, [navigate])

  // currentSession变化时（包括session settings变化），存下当前的settings作为新Session的默认值
  useEffect(() => {
    if (currentSession) {
      if (currentSession.type === 'chat' && currentSession.settings) {
        const { provider, modelId } = currentSession.settings
        if (provider && modelId) {
          setLastUsedChatModel(provider, modelId)
        }
      }
    }
  }, [currentSession?.settings, currentSession?.type, currentSession, setLastUsedChatModel])

  useEffect(() => {
    if (!currentSession || !currentSessionWithDefaultModel || currentSessionWithDefaultModel === currentSession) {
      return
    }
    void rendererApplication.sessions.updateSessionHeader(currentSession.id, {
      settings: currentSessionWithDefaultModel.settings,
    })
  }, [currentSession, currentSessionWithDefaultModel])

  const onSelectModel = useCallback(
    (provider: ModelProvider, modelId: string) => {
      if (!currentSession) {
        return
      }
      void rendererApplication.sessions.updateSessionHeader(currentSession.id, {
        settings: {
          ...(currentSession.settings || {}),
          provider,
          modelId,
        },
      })
    },
    [currentSession]
  )

  const onStartNewThread = useCallback(async () => {
    if (!currentSession) return
    const rollback = await startNewThread(currentSession.id)
    if (!rollback) return
    if (currentSession.copilotId) {
      void remote
        .recordCopilotUsage({ id: currentSession.copilotId, action: 'create_thread' })
        .catch((error) => console.warn('[recordCopilotUsage] failed', error))
    }
    return rollback
  }, [currentSession])

  const onSubmit = useCallback(
    async ({ constructedMessage, needGenerating = true, onUserMessageReady }: InputBoxPayload) => {
      messageListRef.current?.setIsNewMessage(autoScrollNewMessagesToTop)

      if (!currentSession) {
        return
      }
      if (currentSessionWithDefaultModel && currentSessionWithDefaultModel !== currentSession) {
        await rendererApplication.sessions.updateSessionHeader(currentSession.id, {
          settings: currentSessionWithDefaultModel.settings,
        })
      }

      if (currentSession.copilotId) {
        void remote
          .recordCopilotUsage({ id: currentSession.copilotId, action: 'create_message' })
          .catch((error) => console.warn('[recordCopilotUsage] failed', error))
      }

      await submitNewUserMessage(currentSession.id, {
        newUserMsg: constructedMessage,
        needGenerating,
        onUserMessageReady,
      })
    },
    [autoScrollNewMessagesToTop, currentSession, currentSessionWithDefaultModel]
  )

  const onClickSessionSettings = useCallback(() => {
    if (!currentSession) {
      return false
    }
    const state = uiStore.getState()
    const current = state.sessionPanels[currentSession.id]
    if (current?.open && current.tab === 'settings') closeSessionPanel(currentSession.id)
    else state.openSessionPanel(currentSession.id, 'settings')
    return true
  }, [currentSession])

  const { requestStop: onStopGenerating, status: stopGenerationStatus } = useGenerationStop(currentSession?.id)

  const onViewCompactionSummary = useCallback((summaryMessageId: string) => {
    messageListRef.current?.scrollToMessage(summaryMessageId)
  }, [])

  const model = useMemo(() => {
    if (!currentSessionWithDefaultModel?.settings?.modelId || !currentSessionWithDefaultModel?.settings?.provider) {
      return undefined
    }
    return {
      provider: currentSessionWithDefaultModel.settings.provider,
      modelId: currentSessionWithDefaultModel.settings.modelId,
    }
  }, [currentSessionWithDefaultModel?.settings?.provider, currentSessionWithDefaultModel?.settings?.modelId])

  const onArchiveBrokenSession = useCallback(async () => {
    try {
      await rendererApplication.sessions.archiveSessionWithoutLoading(currentSessionId)
      sessionStartupRecovery.completeArchive(currentSessionId)
      showSessionArchiveUndo({
        t,
        restore: () => rendererApplication.sessions.restoreSessionWithoutLoading(currentSessionId),
        openSession: () => switchCurrentSession(currentSessionId),
      })
      goHome()
    } catch (error) {
      console.error('Failed to archive session:', error)
      addToast(t('Failed to archive this chat. Try again or return to the chat list.'))
    }
  }, [currentSessionId, goHome, t])

  if (recovering) {
    return (
      <Page title="">
        <div className="flex flex-1 flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="text-2xl font-semibold mb-3">{t('This chat failed to open')}</div>
          <div className="text-chatbox-tint-secondary mb-6 max-w-md">
            {t(
              'The last time this chat opened, the app had to stop loading it. You can go back to the chat list, archive it, or try again.'
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" onClick={goHome}>
              {t('Back to HomePage')}
            </Button>
            <Button variant="outline" onClick={() => void onArchiveBrokenSession()}>
              {t('Archive')}
            </Button>
            <Button onClick={() => sessionStartupRecovery.retry(currentSessionId)}>{t('Try Again')}</Button>
          </div>
        </div>
      </Page>
    )
  }

  return currentSession ? (
    <div className="flex h-full">
      <div className={`flex min-w-0 flex-1 flex-col h-full ${!isSmallScreen ? 'relative' : ''}`}>
        <Header session={currentSession} />
        <MessageList
          ref={messageListRef}
          key={`message-list${currentSessionId}`}
          headerRead={headerRead!}
          transcript={transcript}
          className={!isSmallScreen ? 'pt-[2px]' : undefined}
        />

        <Box className="relative">
          {shouldShowTemplateWelcomeCard && (
            // absolute — taken out of flow, doesn't affect layout of siblings
            // bottom: '100%' — positioned right above the parent box's top edge (like a tooltip anchoring upward)
            <Box className="pointer-events-none absolute left-0 right-0 z-10" style={{ bottom: '100%' }} mb="sm">
              <Box className={paddedContentColumnClassName(widthFull)}>
                <ChatboxWelcomeCard
                  mode={welcomeCardMode}
                  pageName={JK_PAGE_NAMES.CHAT_PAGE}
                  className="pointer-events-auto w-full"
                />
              </Box>
            </Box>
          )}

          {/* <ScrollButtons /> */}
          <ErrorBoundary name="session-inputbox">
            <InputBox
              key={`input-box${currentSession.id}`}
              sessionId={currentSession.id}
              sessionType={currentSession.type}
              tokenEstimationEnabled={transcript.firstWindowReady}
              model={model}
              onStartNewThread={onStartNewThread}
              onSelectModel={onSelectModel}
              onClickSessionSettings={onClickSessionSettings}
              onSubmit={onSubmit}
              onStopGenerating={onStopGenerating}
              stopGenerationStatus={stopGenerationStatus}
              onViewCompactionSummary={onViewCompactionSummary}
            />
          </ErrorBoundary>
        </Box>
      </div>
      {isSmallScreen ? (
        <SessionSheet session={currentSession} sessionId={currentSessionId} />
      ) : (
        <SessionSidePanel key={currentSessionId} session={currentSession} builtInBrowser={builtInBrowser} />
      )}
    </div>
  ) : (
    !isFetching && (
      <Page title="">
        <div className="flex flex-1 flex-col items-center justify-center min-h-[60vh]">
          <div className="text-2xl font-semibold text-gray-700 mb-4">{t('Conversation not found')}</div>
          <Button variant="outline" onClick={goHome}>
            {t('Back to HomePage')}
          </Button>
        </div>
      </Page>
    )
  )
}
