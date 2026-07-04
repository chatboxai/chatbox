import {
  ActionIcon,
  Box,
  Button,
  Center,
  Code,
  Collapse,
  Flex,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core'
import { TASK_DEFAULT_DIRECTORY } from '@shared/constants/task'
import type { Message } from '@shared/types'
import { formatNumber } from '@shared/utils'
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconLayoutSidebarLeftExpand,
  IconMenu2,
  IconPlayerStopFilled,
  IconRocket,
  IconX,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import Divider from '@/components/common/Divider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import TokenCountMenu from '@/components/InputBox/TokenCountMenu'
import ProviderImageIcon from '@/components/icons/ProviderImageIcon'
import WindowControls from '@/components/layout/WindowControls'
import Markdown, { BlockCodeCollapsedStateProvider } from '@/components/Markdown'
import ModelSelector from '@/components/ModelSelector'
import DirectoryMenu from '@/components/task/DirectoryMenu'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useTaskContextTokens } from '@/hooks/useTaskContextTokens'
import {
  getModelContextWindowSync,
  getProviderModelContextWindowSync,
  useModelRegistryVersion,
} from '@/packages/model-registry'
import platform from '@/platform'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import * as settingActions from '@/stores/settingActions'
import { cancelTaskGeneration, isTaskGenerating, submitTaskMessage } from '@/stores/taskSessionActions'
import { scheduleGenerateTaskName } from '@/stores/taskSessionNaming'
import {
  TASK_SESSION_QUERY_KEY,
  taskSessionStore,
  updateTaskSession,
  useTaskSessionRecord,
} from '@/stores/taskSessionStore'
import { useUIStore } from '@/stores/uiStore'

export const Route = createFileRoute('/task/$taskId')({
  component: TaskSessionRoute,
})

function TaskSessionRoute() {
  const { taskId } = Route.useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: session, isFetching } = useTaskSessionRecord(taskId)

  useEffect(() => {
    taskSessionStore.getState().setCurrentTaskId(taskId)
  }, [taskId])

  if (isFetching && !session) {
    return (
      <Center h="100%">
        <Loader size="lg" />
      </Center>
    )
  }

  if (!session) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <Text fw={600} size="lg">
            {t('Task not found')}
          </Text>
          <Button variant="outline" onClick={() => navigate({ to: '/task' })}>
            {t('Back to Tasks')}
          </Button>
        </Stack>
      </Center>
    )
  }

  return <TaskChat session={session} />
}

interface ToolCallInfo {
  type: 'tool-call'
  toolName: string
  state: 'call' | 'result' | 'error'
  toolCallId: string
  args: unknown
  result?: unknown
}

function formatToolLabel(toolName: string, args: unknown): string {
  const a = args as Record<string, unknown> | null
  switch (toolName) {
    case 'sandbox_bash':
      return a?.command ? `$ ${String(a.command)}` : 'bash'
    case 'sandbox_read':
      return a?.file_path ? `Read ${String(a.file_path)}` : 'Read file'
    case 'sandbox_write':
      return a?.file_path ? `Write ${String(a.file_path)}` : 'Write file'
    case 'sandbox_edit':
      return a?.file_path ? `Edit ${String(a.file_path)}` : 'Edit file'
    case 'sandbox_grep':
      return a?.pattern ? `grep "${String(a.pattern)}"` : 'grep'
    case 'sandbox_ls':
      return `ls ${a?.path ? String(a.path) : '.'}`
    case 'sandbox_find':
      return a?.pattern ? `find "${String(a.pattern)}"` : 'find'
    case 'web_search':
      return a?.query ? `Search "${String(a.query)}"` : 'Web Search'
    case 'parse_link':
      return a?.url ? `Read ${String(a.url)}` : 'Parse Link'
    default:
      return toolName
  }
}

function ToolResultDisplay({ tc }: { tc: ToolCallInfo }) {
  if (tc.state !== 'result' || tc.result === undefined) return null

  const result = tc.result
  const resultStr = typeof result === 'string' ? result : null
  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : null

  if (resultStr && (resultStr.startsWith('Error') || resultStr.startsWith('Sandbox not available'))) {
    return (
      <Text size="xs" c="red" className="font-mono" style={{ whiteSpace: 'pre-wrap' }}>
        {resultStr}
      </Text>
    )
  }

  if (resultObj && 'exitCode' in resultObj) {
    const stdout = String(resultObj.stdout ?? '')
    const stderr = String(resultObj.stderr ?? '')
    const exitCode = Number(resultObj.exitCode ?? 0)
    return (
      <Stack gap={4}>
        {stdout && (
          <Code block className="text-xs max-h-[300px] overflow-auto">
            {stdout}
          </Code>
        )}
        {stderr && (
          <Code block className="text-xs max-h-[200px] overflow-auto" color="yellow">
            {stderr}
          </Code>
        )}
        {exitCode !== 0 && (
          <Text size="xs" c="red" className="font-mono">
            Exit code: {exitCode}
          </Text>
        )}
      </Stack>
    )
  }

  if (resultObj && 'content' in resultObj) {
    const content = String(resultObj.content ?? '')
    if (!content) return null
    return (
      <Code block className="text-xs max-h-[300px] overflow-auto">
        {content}
      </Code>
    )
  }

  if (resultStr) {
    return (
      <Text size="xs" c="dimmed" className="font-mono">
        {resultStr}
      </Text>
    )
  }

  return null
}

function ToolCallItem({ tc }: { tc: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)
  const label = formatToolLabel(tc.toolName, tc.args)
  const hasResult = tc.state === 'result' && tc.result !== undefined
  const isRunning = tc.state === 'call'
  const isError = tc.state === 'error'

  return (
    <Box className="border-l-2 border-[var(--workspaice-border-primary)] pl-2 py-0.5">
      <Flex
        align="center"
        gap={4}
        className="cursor-pointer select-none"
        onClick={() => hasResult && setExpanded((v) => !v)}
      >
        {isRunning ? (
          <Loader size={10} className="shrink-0" />
        ) : isError ? (
          <Box className="shrink-0" c="red">
            <IconX size={12} />
          </Box>
        ) : (
          <Box className="shrink-0" c="dimmed">
            <IconCheck size={12} />
          </Box>
        )}
        {hasResult && (
          <Box className="shrink-0" c="dimmed">
            {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </Box>
        )}
        <Text size="xs" c="dimmed" className="font-mono" truncate>
          {label}
        </Text>
      </Flex>
      {hasResult && (
        <Collapse in={expanded}>
          <Box mt={4} ml={16}>
            <ToolResultDisplay tc={tc} />
          </Box>
        </Collapse>
      )}
    </Box>
  )
}

function TaskMessageBubble({ message, sessionName }: { message: Message; sessionName?: string }) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const hasContent = message.contentParts.length > 0
  const onCodeCopy = useCallback(() => {
    trackJkClickEvent(JK_EVENTS.COPY_CODE_CLICK, {
      pageName: JK_PAGE_NAMES.TASK_PAGE,
      content: sessionName,
    })
  }, [sessionName])

  return (
    <Flex justify={isUser ? 'flex-end' : 'flex-start'} w="100%">
      {isUser ? (
        <Box
          className="rounded-xl px-4 py-2.5 max-w-[85%]"
          style={{ backgroundColor: 'var(--mantine-color-blue-filled)', color: 'white' }}
        >
          <Stack gap={6}>
            {message.contentParts.map((part, i) => {
              if (part.type === 'tool-call') {
                return <ToolCallItem key={(part as ToolCallInfo).toolCallId} tc={part as ToolCallInfo} />
              }
              if (part.type === 'text') {
                const text = (part as { type: 'text'; text: string }).text
                if (!text) return null
                return (
                  <Text key={i} size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {text}
                  </Text>
                )
              }
              return null
            })}
          </Stack>
          {message.generating && !hasContent && (
            <Flex align="center" gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                {t('Generating...')}
              </Text>
            </Flex>
          )}
          {message.error && (
            <Text size="sm" c="red">
              {message.error}
            </Text>
          )}
        </Box>
      ) : (
        <Box className="max-w-[90%]">
          <Stack gap={6}>
            {message.contentParts.map((part, i) => {
              if (part.type === 'tool-call') {
                return <ToolCallItem key={(part as ToolCallInfo).toolCallId} tc={part as ToolCallInfo} />
              }
              if (part.type === 'text') {
                const text = (part as { type: 'text'; text: string }).text
                if (!text) return null
                return (
                  <Markdown
                    key={i}
                    uniqueId={`${message.id}-${i}`}
                    generating={message.generating}
                    onCodeCopy={onCodeCopy}
                  >
                    {text}
                  </Markdown>
                )
              }
              return null
            })}
          </Stack>
          {message.generating && !hasContent && (
            <Flex align="center" gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                {t('Generating...')}
              </Text>
            </Flex>
          )}
          {message.error && (
            <Text size="sm" c="red">
              {message.error}
            </Text>
          )}
        </Box>
      )}
    </Flex>
  )
}

function TaskChat({ session }: { session: NonNullable<ReturnType<typeof useTaskSessionRecord>['data']> }) {
  const modelRegistryVersion = useModelRegistryVersion()

  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  const generating = session.messages.some((m) => m.generating)

  // Model state from session settings or lastUsedModelStore.task
  const model = useMemo(() => {
    if (session.settings?.provider && session.settings?.modelId) {
      return { provider: session.settings.provider, modelId: session.settings.modelId }
    }
    const lastUsedTask = lastUsedModelStore.getState().task
    if (lastUsedTask?.provider && lastUsedTask?.modelId) {
      return lastUsedTask
    }
    return undefined
  }, [session.settings?.provider, session.settings?.modelId])

  const { contextTokens, currentInputTokens, totalTokens, isCalculating, pendingTasks, messageCount } =
    useTaskContextTokens({
      taskId: session.id,
      messages: session.messages,
      model,
      compactionPoints: session.compactionPoints,
    })

  const { providers } = useProviders()
  const providerModelInfo = useMemo(() => {
    if (!model) return undefined
    const providerInfo = providers.find((p) => p.id === model.provider)
    return (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find((m) => m.modelId === model.modelId)
  }, [providers, model])

  const contextWindow = useMemo(() => {
    if (providerModelInfo?.contextWindow) {
      return providerModelInfo.contextWindow
    }

    if (model?.provider && model?.modelId) {
      const providerWindow = getProviderModelContextWindowSync(model.provider, model.modelId)
      if (providerWindow !== null) return providerWindow
    }

    // Fallback: provider-agnostic lookup (same as compaction detector)
    if (model?.modelId) return getModelContextWindowSync(model.modelId)
    return null
  }, [model?.modelId, model?.provider, providerModelInfo?.contextWindow, modelRegistryVersion])

  const tokenPercentage = useMemo(() => {
    if (!contextWindow || contextWindow <= 0) return null
    return Math.round((totalTokens / contextWindow) * 100)
  }, [totalTokens, contextWindow])

  const modelDisplayText = useMemo(() => {
    if (!model) return t('Select Model')
    return providerModelInfo?.nickname || model.modelId
  }, [providerModelInfo, model, t])

  const handleSelectModel = useCallback(
    async (provider: string, modelId: string) => {
      const updated = await updateTaskSession(session.id, {
        settings: { ...(session.settings || {}), provider, modelId },
      })
      if (updated) {
        queryClient.setQueryData([TASK_SESSION_QUERY_KEY, session.id], updated)
      }
      lastUsedModelStore.getState().setTaskModel(provider, modelId)
    },
    [session.id, session.settings, queryClient]
  )

  const handleSelectDirectory = useCallback(
    async (path: string) => {
      if (path === session.workingDirectory) return
      platform.sandboxReset?.()
      const updated = await updateTaskSession(session.id, {
        workingDirectory: path,
        messages: [],
      })
      if (updated) {
        queryClient.setQueryData([TASK_SESSION_QUERY_KEY, session.id], updated)
      }
    },
    [session.id, session.workingDirectory, queryClient]
  )

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || generating) return
    setInput('')
    await submitTaskMessage(session.id, trimmed)
  }, [input, session.id, generating])

  const handleStop = useCallback(() => {
    void cancelTaskGeneration(session.id)
  }, [session.id])

  useEffect(() => {
    if (!isTaskGenerating() && session.messages.some((m) => m.generating)) {
      void cancelTaskGeneration(session.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector(
          '[data-radix-scroll-area-viewport], .mantine-ScrollArea-viewport'
        )
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight
        }
      }
    })
  }, [session.messages])

  // Auto-naming trigger
  useEffect(() => {
    const autoGenerateTitle = settingActions.getAutoGenerateTitle()
    if (!autoGenerateTitle) return

    const hasGeneratingMessage = session.messages.some((msg) => msg.generating)
    const hasAssistantReply = session.messages.some((msg) => msg.role === 'assistant' && !msg.generating)
    if (hasGeneratingMessage || !hasAssistantReply) return

    if (session.name === 'New Task') {
      scheduleGenerateTaskName(session.id)
    }
  }, [session])

  return (
    <Flex direction="column" h="100%" className="overflow-hidden">
      <Flex h={48} align="center" px="md" className="shrink-0 title-bar">
        {(!showSidebar || isSmallScreen) && (
          <Flex align="center" className={needRoomForMacWindowControls ? 'pl-20' : ''}>
            <ActionIcon
              className="controls"
              variant="subtle"
              size={isSmallScreen ? 24 : 20}
              color={isSmallScreen ? 'workspaice-secondary' : 'workspaice-tertiary'}
              mr="xs"
              aria-label={isSmallScreen ? t('Menu') : t('Expand')}
              onClick={() => setShowSidebar(!showSidebar)}
            >
              {isSmallScreen ? <IconMenu2 /> : <IconLayoutSidebarLeftExpand />}
            </ActionIcon>
          </Flex>
        )}
        <Flex
          align="center"
          flex={1}
          className="min-w-0"
          {...(isSmallScreen ? { justify: 'center', pl: 28, pr: 8 } : {})}
        >
          <Text fw={600} size="18px" lineClamp={1}>
            {session.name}
          </Text>
        </Flex>
        <WindowControls className="-mr-3 ml-2" />
      </Flex>
      <Divider />

      <BlockCodeCollapsedStateProvider defaultCollapsed={false}>
        <ScrollArea flex={1} ref={scrollAreaRef} type="auto">
          <Stack gap="sm" maw={800} mx="auto" py="md" px="md" className="min-h-full">
            {session.messages.length === 0 && (
              <Center py="xl">
                <Stack align="center" gap="md">
                  {session.workingDirectory === TASK_DEFAULT_DIRECTORY ? (
                    <>
                      <Box
                        className="flex items-center justify-center rounded-full"
                        style={{ width: 72, height: 72, backgroundColor: 'var(--workspaice-background-secondary)' }}
                      >
                        <IconRocket size={48} className="text-[var(--mantine-color-dimmed)]" stroke={1.5} />
                      </Box>
                      <Text c="dimmed" size="md" ta="center">
                        {t('Send a message to start. Choose a working directory for file access.')}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Box
                        className="flex items-center justify-center rounded-full"
                        style={{ width: 72, height: 72, backgroundColor: 'var(--workspaice-background-secondary)' }}
                      >
                        <IconFolder size={48} className="text-[var(--mantine-color-dimmed)]" stroke={1.5} />
                      </Box>
                      <Text c="dimmed" size="md" ta="center">
                        {t('Send a message to start working in this directory.')}
                      </Text>
                      <Text c="dimmed" size="xs" ta="center" className="font-mono">
                        {session.workingDirectory}
                      </Text>
                    </>
                  )}
                </Stack>
              </Center>
            )}
            {session.messages.map((msg) => (
              <TaskMessageBubble key={msg.id} message={msg} sessionName={session.name} />
            ))}
          </Stack>
        </ScrollArea>
      </BlockCodeCollapsedStateProvider>

      <Box className="py-3 px-4 shrink-0">
        <Box maw={800} mx="auto">
          <Stack
            gap={6}
            className="rounded-md bg-[var(--workspaice-background-secondary)] px-3 py-2 min-h-[92px]"
            style={{ border: '1px solid var(--workspaice-border-primary)' }}
          >
            <Flex align="flex-end" gap={4}>
              <Textarea
                ref={textareaRef}
                placeholder={t('Describe what you want to do...') || ''}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                minRows={2}
                maxRows={6}
                autosize
                unstyled={true}
                classNames={{
                  root: 'flex-1',
                  wrapper: 'flex-1',
                  input:
                    'block w-full outline-none border-none px-2 py-1 resize-none bg-transparent text-workspaice-tint-primary text-sm',
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
              />
              {generating ? (
                <ActionIcon
                  size={32}
                  variant="filled"
                  color="dark"
                  radius="xl"
                  onClick={handleStop}
                  className="shrink-0 mb-1"
                  aria-label={t('Stop generating')}
                  title={t('Stop generating')}
                >
                  <ScalableIcon icon={IconPlayerStopFilled} size={16} />
                </ActionIcon>
              ) : (
                <ActionIcon
                  size={32}
                  variant="filled"
                  color="workspaice-brand"
                  radius="xl"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className={`shrink-0 mb-1 ${!input.trim() ? 'disabled:!opacity-100 !text-white' : ''}`}
                  style={!input.trim() ? { backgroundColor: 'rgba(222, 226, 230, 1)' } : undefined}
                  aria-label={t('Send message')}
                  title={t('Send message')}
                >
                  <ScalableIcon icon={IconArrowUp} size={16} />
                </ActionIcon>
              )}
            </Flex>
            <Flex align="center" justify="space-between">
              <DirectoryMenu currentDirectory={session.workingDirectory} onSelect={handleSelectDirectory} />
              <Flex align="center" gap={4}>
                <TokenCountMenu
                  currentInputTokens={currentInputTokens}
                  contextTokens={contextTokens}
                  totalTokens={totalTokens}
                  isCalculating={isCalculating}
                  pendingTasks={pendingTasks}
                  totalContextMessages={messageCount}
                  contextWindow={contextWindow ?? undefined}
                >
                  <Flex
                    align="center"
                    gap="2"
                    className={[
                      'text-xs cursor-pointer hover:text-workspaice-tint-secondary',
                      'transition-colors px-2 py-1 rounded-lg',
                      'hover:bg-[var(--workspaice-background-tertiary)]',
                      tokenPercentage && tokenPercentage > 80 ? 'text-red-500' : 'text-workspaice-tint-tertiary',
                    ].join(' ')}
                  >
                    <ScalableIcon icon={IconArrowUp} size={14} />
                    {isCalculating && <Loader size={10} />}
                    <Text span size="xs" className="whitespace-nowrap" c="inherit">
                      {isCalculating ? '~' : ''}
                      {formatNumber(totalTokens)}
                      {contextWindow ? ` / ${formatNumber(contextWindow)}` : ''}
                      {tokenPercentage !== null ? ` (${tokenPercentage}%)` : ''}
                    </Text>
                  </Flex>
                </TokenCountMenu>
                <ModelSelector
                  onSelect={handleSelectModel}
                  selectedProviderId={model?.provider}
                  selectedModelId={model?.modelId}
                  modelFilter={(m, providerId) => {
                    if (!m.capabilities?.includes('tool_use')) return false
                    return true
                  }}
                  position="top-end"
                  transitionProps={{ transition: 'fade-up', duration: 200 }}
                >
                  <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors">
                    {!!model && <ProviderImageIcon size={18} provider={model.provider} />}
                    <Text size="sm" className="text-[var(--workspaice-tint-secondary)] truncate max-w-[160px]">
                      {modelDisplayText}
                    </Text>
                    <IconChevronDown size={14} className="text-[var(--workspaice-tint-tertiary)] shrink-0" />
                  </UnstyledButton>
                </ModelSelector>
              </Flex>
            </Flex>
          </Stack>
        </Box>
      </Box>
    </Flex>
  )
}
