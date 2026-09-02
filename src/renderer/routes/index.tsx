import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Avatar, Box, Divider, Flex, ScrollArea, Space, Stack, Text } from '@mantine/core'
import {
  type AgentModeEntry,
  type CopilotDetail,
  createMessage,
  type ImageSource,
  ModelProviderEnum,
  type Session,
  type SessionSettings,
} from '@shared/types'
import { IconChevronLeft, IconChevronRight, IconMessageCircle2Filled, IconX } from '@tabler/icons-react'
import { createFileRoute, useRouterState } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { rendererApplication } from '@/app/renderer-application'
import { ChatboxWelcomeCard } from '@/components/common/ChatboxWelcomeCard'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { ImageInStorage } from '@/components/Image'
import InputBox, { type InputBoxPayload } from '@/components/InputBox/InputBox'
import HomepageIcon from '@/components/icons/HomepageIcon'
import Page from '@/components/layout/Page'
import { getForceShowNewUserScenarioCardsFlag } from '@/dev/devToolsFlags'
import { useMyCopilots, useRemoteCopilotsByCursor } from '@/hooks/useCopilots'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import * as remote from '@/packages/remote'
import { router } from '@/router'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { resolveChatboxLicenseDefaultModel } from '@/stores/defaultChatModel'
import { getHasCompletedFirstSuccessfulChat } from '@/stores/firstSuccessfulChat'
import { getSessionAgentModeEntry } from '@/stores/session/agent-mode'
import { switchCurrentSession } from '@/stores/session/crud'
import { generate } from '@/stores/session/generation'
import { submitNewUserMessage } from '@/stores/session/messages'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { getHomeWelcomeCardMode } from '@/utils/homeWelcomeCard'
import { NewUserScenarioGrid } from './-new-user-scenarios/NewUserScenarioGrid'
import { type NewUserScenario, newUserScenarios, resolveNewUserScenarioContent } from './-new-user-scenarios/scenarios'

const scenarioAgentModeOff = {
  value: 'off',
  locked: false,
  lockReason: null,
} satisfies AgentModeEntry

const firstChatScenarioDefaultModel = {
  provider: ModelProviderEnum.ChatboxAI,
  modelId: 'chatboxai-3.5',
} satisfies Pick<SessionSettings, 'provider' | 'modelId'>

export const Route = createFileRoute('/')({
  component: Index,
  validateSearch: zodValidator(
    z.object({
      copilotId: z.string().optional(),
      copilot: z.string().optional(),
      settings: z.string().optional(),
    })
  ),
})

function Index() {
  const { t, i18n } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  const newSessionState = useUIStore((s) => s.newSessionState)
  const setNewSessionState = useUIStore((s) => s.setNewSessionState)
  const addSessionKnowledgeBase = useUIStore((s) => s.addSessionKnowledgeBase)
  const showCopilotsInNewSession = useUIStore((s) => s.showCopilotsInNewSession)
  const widthFull = useUIStore((s) => s.widthFull)
  const sessionWebBrowsingMap = useUIStore((s) => s.sessionWebBrowsingMap)
  const newSessionWebBrowsingDefault = useUIStore((s) => s.newSessionWebBrowsingDefault)
  const newSessionCommandApprovalModeDefault = useUIStore((s) => s.newSessionCommandApprovalModeDefault)
  const newSessionWorkingDirectoriesDefault = useUIStore((s) => s.newSessionWorkingDirectoriesDefault)
  const setSessionWebBrowsing = useUIStore((s) => s.setSessionWebBrowsing)
  const clearSessionWebBrowsing = useUIStore((s) => s.clearSessionWebBrowsing)
  const sessionAgentModeMap = useUIStore((s) => s.sessionAgentModeMap)
  const clearSessionAgentMode = useUIStore((s) => s.clearSessionAgentMode)
  const [session, setSession] = useState<Session>({
    id: 'new',
    ...initEmptyChatSession(),
  })
  const [hasCompletedFirstSuccessfulChat, setHasCompletedFirstSuccessfulChat] = useState<boolean | null>(null)
  const [forceShowNewUserScenarioCards, setForceShowNewUserScenarioCards] = useState(
    getForceShowNewUserScenarioCardsFlag
  )
  const hasUserSelectedModelRef = useRef(false)

  const { providers } = useProviders()
  const defaultChatModel = useSettingsStore((s) => s.defaultChatModel)
  const hasLicense = useSettingsStore((s) => Boolean(s.licenseKey))
  const licenseKey = useSettingsStore((s) => s.licenseKey)
  const licenseDetail = useSettingsStore((s) => s.licenseDetail)
  const licensePlanName = useSettingsStore((s) => s.licensePlanName)
  const hasExpiredLicense = useSettingsStore((s) => s.hasExpiredLicense)
  const isLoggedIn = useAuthInfoStore((s) => Boolean(s.accessToken && s.refreshToken))
  const { isExceeded, isExceededResolved } = useVersion()
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

  const selectedModel = useMemo(() => {
    if (session.settings?.provider && session.settings?.modelId) {
      return {
        provider: session.settings.provider,
        modelId: session.settings.modelId,
      }
    }
  }, [session.settings?.provider, session.settings?.modelId])

  useEffect(() => {
    let cancelled = false

    setForceShowNewUserScenarioCards(getForceShowNewUserScenarioCardsFlag())

    getHasCompletedFirstSuccessfulChat()
      .then((completed) => {
        if (!cancelled) {
          setHasCompletedFirstSuccessfulChat(completed)
        }
      })
      .catch((error) => {
        console.warn('[new-user-scenarios] failed to resolve first successful chat state:', error)
        if (!cancelled) {
          setHasCompletedFirstSuccessfulChat(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSession((old) => {
      if (
        hasCompletedFirstSuccessfulChat === false &&
        isLoggedIn &&
        !session.copilotId &&
        !hasUserSelectedModelRef.current
      ) {
        if (
          old.settings?.provider === firstChatScenarioDefaultModel.provider &&
          old.settings?.modelId === firstChatScenarioDefaultModel.modelId
        ) {
          return old
        }
        return {
          ...old,
          settings: {
            ...(old.settings || {}),
            ...firstChatScenarioDefaultModel,
          },
        }
      }
      if (old.settings?.provider && old.settings?.modelId) {
        return old
      }
      const defaultModel = defaultChatModel
        ? {
            provider: defaultChatModel.provider,
            modelId: defaultChatModel.model,
          }
        : resolveChatboxLicenseDefaultModel({
            licenseKey,
            hasExpiredLicense,
            licenseDetail,
            licensePlanName,
          })
      if (!defaultModel) {
        return old
      }
      return {
        ...old,
        settings: {
          ...(old.settings || {}),
          ...defaultModel,
        },
      }
    })
  }, [
    defaultChatModel,
    hasCompletedFirstSuccessfulChat,
    hasExpiredLicense,
    isLoggedIn,
    licenseDetail,
    licenseKey,
    licensePlanName,
    session.copilotId,
  ])

  const { copilots: myCopilots } = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilotsByCursor({ limit: 10 })
  const selectedCopilotId = useMemo(() => session?.copilotId, [session?.copilotId])
  const selectedCopilot = useMemo(
    () => myCopilots.find((c) => c.id === selectedCopilotId) || remoteCopilots.find((c) => c.id === selectedCopilotId),
    [myCopilots, remoteCopilots, selectedCopilotId]
  )
  useEffect(() => {
    setSession((old) => ({
      ...old,
      assistantAvatarKey:
        selectedCopilot?.avatar?.type === 'storage-key' ? selectedCopilot.avatar.storageKey : undefined,
      picUrl: selectedCopilot?.avatar?.type === 'url' ? selectedCopilot.avatar.url : selectedCopilot?.picUrl,
      backgroundImage: selectedCopilot?.backgroundImage,
      name: selectedCopilot?.name || 'Untitled',
      threadName: '',
      messages: selectedCopilot
        ? [
            {
              id: uuidv4(),
              role: 'system',
              contentParts: [
                {
                  type: 'text',
                  text: selectedCopilot.prompt,
                },
              ],
            },
          ]
        : initEmptyChatSession().messages,
    }))
  }, [selectedCopilot])

  const routerState = useRouterState()
  useEffect(() => {
    const { copilotId, copilot } = routerState.location.search
    if (copilot) {
      let c: CopilotDetail | null = null
      try {
        c = JSON.parse(copilot) as CopilotDetail
      } catch (_e) {
        return
      }

      setSession((old) => ({
        ...old,
        copilotId: c.id,
        assistantAvatarKey: c.avatar?.type === 'storage-key' ? c.avatar.storageKey : undefined,
        picUrl: c.avatar?.type === 'url' ? c.avatar.url : c.picUrl,
        backgroundImage: c.backgroundImage,
        name: c.name || 'Untitled',
        threadName: '',
        messages: [
          {
            id: uuidv4(),
            role: 'system',
            contentParts: [
              {
                type: 'text',
                text: c.prompt,
              },
            ],
          },
        ],
      }))
    } else if (copilotId) {
      setSession((old) => ({ ...old, copilotId }))
    }
  }, [routerState.location.search])

  const createPersistedChatSession = useCallback(
    async (options?: {
      name?: string
      threadName?: string
      messages?: Session['messages']
      settingsPatch?: Partial<SessionSettings>
      settingsOverride?: Partial<SessionSettings>
    }) => {
      // Transient choices made while the chat was "new" win; otherwise new chats
      // continue the last explicit choice remembered from any earlier chat.
      const effectiveApprovalMode = newSessionState.commandApprovalMode ?? newSessionCommandApprovalModeDefault
      const effectiveWorkingDirectories = newSessionState.workingDirectories ?? newSessionWorkingDirectoriesDefault
      const newSession = await rendererApplication.sessions.createSession({
        name: options?.name ?? session.name,
        type: 'chat',
        assistantAvatarKey: session.assistantAvatarKey,
        picUrl: session.picUrl,
        backgroundImage: session.backgroundImage,
        messages: options?.messages ?? session.messages,
        copilotId: session.copilotId,
        threadName: options?.threadName ?? session.threadName ?? '',
        settings: {
          ...session.settings,
          ...options?.settingsPatch,
          // Bake the exact mode shown while the chat was "new" into the created session, so
          // remembered defaults and transient selections follow the same resolution path.
          agentMode: getSessionAgentModeEntry('new', undefined, sessionAgentModeMap),
          // Working directories bound while the chat was still "new" (not yet persisted),
          // falling back to the remembered default from earlier chats.
          ...(effectiveWorkingDirectories?.length ? { workingDirectories: effectiveWorkingDirectories } : {}),
          ...(effectiveApprovalMode
            ? {
                commandApprovalMode: effectiveApprovalMode,
                // Keep the legacy flag in lockstep for older readers.
                ...(effectiveApprovalMode === 'full_access' ? { agentFullAccess: true } : {}),
              }
            : newSessionState.agentFullAccess
              ? { agentFullAccess: true }
              : {}),
          ...options?.settingsOverride,
        },
      })

      if (session.copilotId) {
        void remote
          .recordCopilotUsage({ id: session.copilotId, action: 'create_session' })
          .catch((error) => console.warn('[recordCopilotUsage] failed', error))
      }

      // Transfer knowledge base / Work Mode settings from newSessionState to the actual
      // session, then clear it so nothing bleeds into the next new chat. (workingDirectories
      // and the command approval policy are already baked into the created session's settings above;
      // this only clears them.)
      if (newSessionState.knowledgeBase) {
        addSessionKnowledgeBase(newSession.id, newSessionState.knowledgeBase)
      }
      if (
        newSessionState.knowledgeBase ||
        newSessionState.workingDirectories?.length ||
        newSessionState.agentFullAccess ||
        newSessionState.commandApprovalMode
      ) {
        setNewSessionState({})
      }

      // Transfer either the transient choice or the remembered new-chat default.
      // Clearing only removes the transient "new" slot; the remembered default remains.
      const newSessionWebBrowsing = sessionWebBrowsingMap.new ?? newSessionWebBrowsingDefault
      if (newSessionWebBrowsing !== undefined) {
        setSessionWebBrowsing(newSession.id, newSessionWebBrowsing)
        clearSessionWebBrowsing('new')
      }

      // Transfer agent mode setting from "new" session to the actual session
      if (sessionAgentModeMap.new) {
        clearSessionAgentMode('new')
      }

      switchCurrentSession(newSession.id)
      localStorage.removeItem('new-chat')

      return newSession
    },
    [
      session,
      addSessionKnowledgeBase,
      newSessionState.knowledgeBase,
      newSessionState.workingDirectories,
      newSessionState.agentFullAccess,
      newSessionState.commandApprovalMode,
      newSessionCommandApprovalModeDefault,
      newSessionWorkingDirectoriesDefault,
      setNewSessionState,
      sessionWebBrowsingMap,
      newSessionWebBrowsingDefault,
      setSessionWebBrowsing,
      clearSessionWebBrowsing,
      sessionAgentModeMap,
      clearSessionAgentMode,
    ]
  )

  const handleSubmit = useCallback(
    async ({ constructedMessage, needGenerating = true, onUserMessageReady, settingsPatch }: InputBoxPayload) => {
      const newSession = await createPersistedChatSession({ settingsPatch })

      void submitNewUserMessage(newSession.id, {
        newUserMsg: constructedMessage,
        needGenerating,
        onUserMessageReady,
      })
    },
    [createPersistedChatSession]
  )

  const handleScenarioSelect = useCallback(
    async (scenario: NewUserScenario) => {
      const scenarioContent = resolveNewUserScenarioContent(scenario, i18n.language)
      trackJkClickEvent(JK_EVENTS.LEAD_CHAT_CARD_CLICK, {
        pageName: JK_PAGE_NAMES.CHAT_PAGE,
        content: t(scenario.titleKey),
        contentType: session.settings?.modelId ?? firstChatScenarioDefaultModel.modelId,
      })
      const assistantMessage = createMessage('assistant', '')
      assistantMessage.generating = true
      const newSession = await createPersistedChatSession({
        name: scenarioContent.sessionTitle,
        threadName: scenarioContent.sessionTitle,
        messages: [
          createMessage('system', scenarioContent.systemPrompt),
          createMessage('user', scenarioContent.firstUserMessage),
          assistantMessage,
        ],
        settingsOverride: { agentMode: scenarioAgentModeOff },
      })

      void generate(newSession.id, assistantMessage, { operationType: 'send_message' })
    },
    [createPersistedChatSession, i18n.language, session.settings?.modelId, t]
  )

  const onSelectModel = useCallback((p: string, m: string) => {
    hasUserSelectedModelRef.current = true
    setSession((old) => ({
      ...old,
      settings: {
        ...(old.settings || {}),
        provider: p,
        modelId: m,
      },
    }))
  }, [])

  const onClickSessionSettings = useCallback(async () => {
    const res: Session = await NiceModal.show('session-settings', {
      session,
      disableAutoSave: true,
    })
    if (res) {
      setSession((old) => ({
        ...old,
        ...res,
      }))
    }
    return true
  }, [session])

  const showNewUserScenarios =
    (forceShowNewUserScenarioCards || (hasCompletedFirstSuccessfulChat === false && isLoggedIn)) && !session.copilotId

  return (
    <Page title="">
      <div className="p-0 flex flex-col h-full min-h-0 overflow-hidden">
        <div
          className={clsx('min-h-0 flex-1 overflow-y-auto', welcomeCardMode !== 'none' ? 'pb-36 sm:pb-32' : 'pb-md')}
        >
          {showNewUserScenarios ? (
            <Stack justify="center" className="min-h-full" py="xl">
              <NewUserScenarioGrid scenarios={newUserScenarios} onSelect={handleScenarioSelect} />
            </Stack>
          ) : (
            <Stack align="center" justify="center" gap="sm" className="min-h-full">
              <HomepageIcon className="h-8" />
              <Text fw="600" size={isSmallScreen ? 'sm' : 'md'}>
                {t('What can I help you with today?')}
              </Text>
            </Stack>
          )}
        </div>

        <Stack gap="sm" className="shrink-0">
          {session.copilotId ? (
            <Box px="md">
              <Stack gap="sm" className={widthFull ? 'w-full' : 'w-full max-w-4xl mx-auto'}>
                <Flex align="center" gap="sm">
                  <CopilotItem
                    name={session.name}
                    avatar={
                      session.assistantAvatarKey
                        ? { type: 'storage-key', storageKey: session.assistantAvatarKey }
                        : undefined
                    }
                    picUrl={session.picUrl}
                    selected
                    onClick={() => onClickSessionSettings?.()}
                  />
                  <ActionIcon
                    size={32}
                    radius="lg"
                    c="chatbox-tertiary"
                    bg="#F1F3F5"
                    onClick={() => setSession((old) => ({ ...old, copilotId: undefined }))}
                  >
                    <ScalableIcon icon={IconX} size={24} />
                  </ActionIcon>
                </Flex>

                <Text c="chatbox-secondary" className="line-clamp-5">
                  {session.messages[0]?.contentParts?.map((part) => (part.type === 'text' ? part.text : '')).join('') ||
                    ''}
                </Text>
              </Stack>
            </Box>
          ) : (
            showCopilotsInNewSession && (
              <CopilotPicker onSelect={(copilot) => setSession((old) => ({ ...old, copilotId: copilot?.id }))} />
            )
          )}

          <Box className="relative">
            {welcomeCardMode !== 'none' && (
              <Box
                className="pointer-events-none absolute left-0 right-0 z-10"
                style={{ bottom: '100%' }}
                px="sm"
                mb="sm"
              >
                <Box className={widthFull ? 'w-full' : 'w-full max-w-4xl mx-auto'}>
                  <ChatboxWelcomeCard
                    mode={welcomeCardMode}
                    pageName={JK_PAGE_NAMES.CHAT_PAGE}
                    className="pointer-events-auto w-full"
                  />
                </Box>
              </Box>
            )}

            <InputBox
              sessionType="chat"
              sessionId="new"
              draftCopilotId={session.copilotId}
              draftCopilotName={session.copilotId ? session.name : undefined}
              model={selectedModel}
              // fullWidth
              onSelectModel={onSelectModel}
              onClickSessionSettings={onClickSessionSettings}
              onSubmit={handleSubmit}
            />
          </Box>
        </Stack>
      </div>
    </Page>
  )
}

const MAX_COPILOTS_TO_SHOW = 10

const CopilotPicker = ({ selectedId, onSelect }: { selectedId?: string; onSelect?(copilot?: CopilotDetail): void }) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const widthFull = useUIStore((s) => s.widthFull)
  const { copilots: myCopilots } = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilotsByCursor()

  const copilots = useMemo(
    () =>
      myCopilots.length >= MAX_COPILOTS_TO_SHOW
        ? myCopilots
        : [
            ...myCopilots,
            ...(myCopilots.length && remoteCopilots.length ? [undefined] : []),
            ...remoteCopilots
              .filter((c) => !myCopilots.map((mc) => mc.id).includes(c.id))
              .slice(0, MAX_COPILOTS_TO_SHOW - myCopilots.length - 1),
          ],
    [myCopilots, remoteCopilots]
  )

  const showMoreButton = useMemo(
    () => copilots.length < myCopilots.length + remoteCopilots.length,
    [copilots.length, myCopilots.length, remoteCopilots.length]
  )

  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollPosition, onScrollPositionChange] = useState({ x: 0, y: 0 })

  if (!copilots.length) {
    return null
  }

  return (
    <Box px="md">
      <Stack gap="xs" className={widthFull ? 'w-full' : 'w-full max-w-4xl mx-auto'}>
        <Flex align="center" justify="space-between">
          <Text size="xxs" c="chatbox-tertiary">
            {t('My Copilots').toUpperCase()}
          </Text>

          {!isSmallScreen && (
            <Flex align="center" gap="sm">
              <ActionIcon
                variant="transparent"
                color="chatbox-tertiary"
                // onClick={() => setPage((p) => Math.max(p - 1, 0))}
                onClick={() => {
                  if (viewportRef.current) {
                    // const scrollWidth = viewportRef.current.scrollWidth
                    const clientWidth = viewportRef.current.clientWidth
                    const newScrollPosition = Math.max(scrollPosition.x - clientWidth, 0)
                    viewportRef.current.scrollTo({ left: newScrollPosition, behavior: 'smooth' })
                    onScrollPositionChange({ x: newScrollPosition, y: 0 })
                  }
                }}
              >
                <ScalableIcon icon={IconChevronLeft} />
              </ActionIcon>
              <ActionIcon
                variant="transparent"
                color="chatbox-tertiary"
                // onClick={() => setPage((p) => p + 1)}
                onClick={() => {
                  if (viewportRef.current) {
                    const scrollWidth = viewportRef.current.scrollWidth
                    const clientWidth = viewportRef.current.clientWidth
                    const newScrollPosition = Math.min(scrollPosition.x + clientWidth, scrollWidth - clientWidth)
                    viewportRef.current.scrollTo({ left: newScrollPosition, behavior: 'smooth' })
                    onScrollPositionChange({ x: newScrollPosition, y: 0 })
                  }
                }}
              >
                <ScalableIcon icon={IconChevronRight} />
              </ActionIcon>
            </Flex>
          )}
        </Flex>

        <ScrollArea
          type={isSmallScreen ? 'never' : 'scroll'}
          mx="-md"
          scrollbars="x"
          offsetScrollbars="x"
          viewportRef={viewportRef}
          onScrollPositionChange={onScrollPositionChange}
          className="copilot-picker-scroll-area"
        >
          {scrollPosition.x > 8 && !isSmallScreen && (
            <div className="absolute top-0 left-0 w-8 h-full bg-gradient-to-r from-chatbox-background-primary to-transparent"></div>
          )}
          {!isSmallScreen && (
            <div className="absolute top-0 right-0 w-8 h-full bg-gradient-to-l from-chatbox-background-primary to-transparent"></div>
          )}
          <Flex wrap="nowrap" gap="xs">
            <Space w="xs" />
            {copilots.map((copilot) =>
              copilot ? (
                <CopilotItem
                  key={copilot.id}
                  name={copilot.name}
                  avatar={copilot.avatar}
                  picUrl={copilot.picUrl}
                  selected={selectedId === copilot.id}
                  onClick={() => {
                    onSelect?.(copilot)
                  }}
                />
              ) : (
                <Divider key="divider" orientation="vertical" my="xs" mx="xxs" />
              )
            )}
            {showMoreButton && (
              <CopilotItem
                name={t('View All Copilots')}
                noAvatar={true}
                selected={false}
                onClick={() =>
                  router.navigate({
                    to: '/copilots',
                  })
                }
              />
            )}
            <Space w="xs" />
          </Flex>
        </ScrollArea>
      </Stack>
    </Box>
  )
}

const CopilotItem = ({
  name,
  avatar,
  picUrl,
  selected,
  onClick,
  noAvatar = false,
}: {
  name: string
  avatar?: ImageSource
  picUrl?: string
  selected?: boolean
  onClick?(): void
  noAvatar?: boolean
}) => {
  const isSmallScreen = useIsSmallScreen()
  return (
    <Flex
      align="center"
      gap={isSmallScreen ? 'xxs' : 'xs'}
      py="xs"
      px={isSmallScreen ? 'xs' : 'md'}
      bd={selected ? 'none' : '1px solid var(--chatbox-border-primary)'}
      bg={selected ? 'var(--chatbox-background-brand-secondary)' : 'transparent'}
      className={clsx(
        'max-w-[75vw] sm:max-w-[50vw] cursor-pointer shrink-0 shadow-[0px_2px_12px_0px_rgba(0,0,0,0.04)]',
        isSmallScreen ? 'rounded-full' : 'rounded-lg'
      )}
      onClick={onClick}
    >
      {!noAvatar &&
        (avatar?.type === 'storage-key' || avatar?.type === 'url' || picUrl ? (
          <Avatar
            src={avatar?.type === 'storage-key' ? '' : avatar?.url || picUrl}
            alt={name}
            size={isSmallScreen ? 20 : 24}
            radius="lg"
            className="flex-shrink-0 border border-solid border-chatbox-border-primary"
          >
            {avatar?.type === 'storage-key' ? (
              <ImageInStorage storageKey={avatar.storageKey} className="object-cover object-center w-full h-full" />
            ) : (
              name?.charAt(0)?.toUpperCase()
            )}
          </Avatar>
        ) : (
          <Stack
            w={isSmallScreen ? 20 : 24}
            h={isSmallScreen ? 20 : 24}
            align="center"
            justify="center"
            className="flex-shrink-0 rounded-full bg-chatbox-background-brand-secondary"
          >
            <ScalableIcon icon={IconMessageCircle2Filled} size={24} className="text-chatbox-tint-brand" />
          </Stack>
        ))}
      <Text fw="600" c={selected ? 'chatbox-brand' : 'chatbox-primary'} lineClamp={1}>
        {name}
      </Text>
    </Flex>
  )
}
