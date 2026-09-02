import { listPendingPauseInteractions } from '@chatbox/core/message-approval'
import { getSubmitAvailability } from '@chatbox/core/session/action-gates'
import { isActionAvailableInMode, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal from '@ebay/nice-modal-react'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { ActionIcon, Box, Button, Flex, Loader, Menu, Stack, Text, Textarea, UnstyledButton } from '@mantine/core'
import { useViewportSize } from '@mantine/hooks'
import { TestId } from '@shared/automation/testids'
import {
  getFileAcceptConfig,
  getFileAcceptString,
  getUnsupportedFileType,
  isSupportedFile,
} from '@shared/file-extensions'
import { KNOWLEDGE_BASE_MAX_FILE_SIZE, KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL } from '@shared/knowledge-base'
import { isDeepSeekWeakToolUse } from '@shared/models/utils/deepseek'
import { formatNumber } from '@shared/utils'
import { resolveReasoningProviderOptions } from '@shared/utils/reasoning-control'
import {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowUp,
  IconChevronRight,
  IconCirclePlus,
  IconFilePencil,
  IconFolder,
  IconPhoto,
  IconPlayerStopFilled,
  IconWand,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAtom, useAtomValue } from 'jotai'
import { pick } from 'lodash'
import type React from 'react'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from 'zustand'
import { JK_PAGE_NAMES } from '@/analytics/jk-events'
import { rendererApplication } from '@/app/renderer-application'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import useInputBoxHistory from '@/hooks/useInputBoxHistory'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useProviders } from '@/hooks/useProviders'
import { useSaveBlob } from '@/hooks/useSaveBlob'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSessionLockState } from '@/hooks/useSessionLockState'
import { cn } from '@/lib/utils'
import {
  getContextMessageIds,
  isAutoCompactionEnabled,
  isCompactionInProgress,
  useContextTokens,
  useStableEligibleMessages,
} from '@/packages/context-management'
import { trackingEvent } from '@/packages/event'
import {
  getModelContextWindowSync,
  getProviderModelContextWindowSync,
  useModelRegistryVersion,
} from '@/packages/model-registry'
import * as picUtils from '@/packages/pic_utils'
import { skillsController, subscribeSkillsChanged } from '@/packages/skills/controller'
import { seedExactDraftTokens } from '@/packages/token-estimation'
import platform from '@/platform'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as atoms from '@/stores/atoms'
import { resolveWebBrowsingMode } from '@/stores/session'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { useSessionSettings } from '@/stores/session/session-settings'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { confirmModelSwitchIfNeeded } from '@/utils/prompt-cache-confirm'
import { getSessionLockNotice, notifySessionLockBlocked } from '@/utils/session-lock-copy'
import { trackEvent } from '@/utils/track'
import type {
  KnowledgeBase,
  Message,
  ProviderModelInfo,
  SessionAttachment,
  SessionAttachmentIndexingStage,
  SessionSettings,
  SessionType,
  ShortcutSendValue,
} from '../../../shared/types'
import * as dom from '../../hooks/dom'
import {
  enqueueUserMessage,
  MAX_QUEUED_MESSAGES,
  messageQueueStore,
  resumeQueueAndDrain,
} from '../../stores/session/message-queue'
import { startPreparedSessionAttachmentIndexing } from '../../stores/sessionAttachmentRagIndexing'
import * as sessionHelpers from '../../stores/sessionHelpers'
import * as toastActions from '../../stores/toastActions'
import type { PreprocessedFile } from '../../types/input-box'
import { CompactionStatus } from '../chat/CompactionStatus'
import { AdaptiveModal } from '../common/AdaptiveModal'
import { CompressionModal } from '../common/CompressionModal'
import { ScalableIcon } from '../common/ScalableIcon'
import Disclaimer from '../Disclaimer'
import ProviderImageIcon from '../icons/ProviderImageIcon'
import ModelSelectorV2 from '../ModelSelectorV2'
import AgentModeButton from './AgentModeButton'
import { FileMiniCard, getParserTypeLabel, ImageMiniCard } from './Attachments'
import { ComposerSettingsMenu } from './ComposerSettingsMenu'
import { getAgentModeUIState } from './agentModeState'
import { ImageUploadInput } from './ImageUploadInput'
import { INPUT_SURFACE_CLASS_NAME, INPUT_SURFACE_MIN_HEIGHT_CLASS_NAME, INPUT_SURFACE_STYLE } from './inputSurface'
import { MessageInputField, type MessageInputFieldRef } from './MessageInputField'
import PendingActionBar from './PendingActionBar'
import { cleanupFile, markFileProcessing, onFileProcessed, storeFilePromise } from './preprocessState'
import { QueuedMessagesBar } from './QueuedMessagesBar'
import ReasoningControlButton from './ReasoningControlButton'
import { mergeSessionAttachmentStatesIntoFiles, shouldRefetchSessionAttachmentStates } from './sessionAttachmentState'
import { getTrailingSkillCommand, insertSkillCommandText } from './skillCommand'
import { getComposerPlaceholder, getSubmitAction, getSubmitControl } from './submitAction'
import TokenCountMenu from './TokenCountMenu'
import { useModelToolCapabilities } from './useModelToolCapabilities'
import { useReasoningControlState } from './useReasoningControlState'
import { WebSearchUnavailableBanner } from './WebSearchUnavailableBanner'
import WorkModeStatusRow from './WorkModeStatusRow'

const useSession = (sessionId: string | null) => rendererApplication.sessionHooks.useSession(sessionId)

export type InputBoxPayload = {
  constructedMessage: Message
  needGenerating?: boolean
  onUserMessageReady?: () => void
  settingsPatch?: Partial<SessionSettings>
}

export type InputBoxRef = {
  setQuote: (quote: string) => void
}

export type InputBoxProps = {
  sessionId?: string
  sessionType?: SessionType
  /** Copilot picked on the new-chat page, where the draft session is not persisted yet. */
  draftCopilotId?: string
  draftCopilotName?: string
  model?: {
    provider: string
    modelId: string
  }
  fullWidth?: boolean
  onSelectModel?(provider: string, model: string): void
  onSubmit?(payload: InputBoxPayload): Promise<void>
  onStopGenerating?(): boolean
  onStartNewThread?(): boolean
  onRollbackThread?(): boolean
  onClickSessionSettings?(): boolean | Promise<boolean>
  onViewCompactionSummary?(summaryMessageId: string): void
}

function getSessionAttachmentProgressValue(embeddedChunks?: number, totalChunks?: number): number | undefined {
  if (!totalChunks || totalChunks <= 0 || embeddedChunks === undefined) return undefined
  return Math.max(0, Math.min(100, Math.round((embeddedChunks / totalChunks) * 100)))
}

function getSessionAttachmentStageLabel(
  stage: SessionAttachmentIndexingStage | undefined,
  t: (key: string) => string
): string {
  switch (stage) {
    case 'queued':
      return t('Queued')
    case 'chunking':
      return t('Preparing')
    case 'embedding':
      return t('Indexing')
    case 'finalizing':
      return t('Finishing')
    case 'ready':
      return t('Indexed')
    default:
      return t('Indexing')
  }
}

const InputBox = forwardRef<InputBoxRef, InputBoxProps>(
  (
    {
      sessionId,
      sessionType = 'chat',
      draftCopilotId,
      draftCopilotName,
      model,
      fullWidth = false,
      onSelectModel,
      onSubmit,
      onStopGenerating,
      onStartNewThread,
      onRollbackThread,
      onClickSessionSettings,
      onViewCompactionSummary,
    },
    ref
  ) => {
    const modelRegistryVersion = useModelRegistryVersion()

    const { t } = useTranslation()
    const navigate = useNavigate()
    const isSmallScreen = useIsSmallScreen()
    const toolbarIconSize = isSmallScreen ? 22 : 18
    const { height: viewportHeight } = useViewportSize()
    const pasteLongTextAsAFile = useSettingsStore((state) => state.pasteLongTextAsAFile)
    const shortcuts = useSettingsStore((state) => state.shortcuts)
    const widthFull = useUIStore((s) => s.widthFull) || fullWidth
    const saveBlob = useSaveBlob()

    const currentSessionId = sessionId
    const isNewSession = currentSessionId === 'new'

    // Session-level web browsing mode
    const sessionWebBrowsingMap = useUIStore((s) => s.sessionWebBrowsingMap)
    const newSessionWebBrowsingDefault = useUIStore((s) => s.newSessionWebBrowsingDefault)
    const setSessionWebBrowsing = useUIStore((s) => s.setSessionWebBrowsing)
    const updateCurrentWebBrowsingDisplay = useUIStore((s) => s.updateCurrentWebBrowsingDisplay)
    // Existing sessions keep their own value. New chats additionally inherit
    // the user's last explicit choice before falling back to provider defaults.
    const webBrowsingMode = useMemo(() => {
      return resolveWebBrowsingMode(
        currentSessionId || 'new',
        model?.provider,
        sessionWebBrowsingMap,
        newSessionWebBrowsingDefault
      )
    }, [currentSessionId, model?.provider, newSessionWebBrowsingDefault, sessionWebBrowsingMap])

    // this is used for keyboard shortcut. if we don't provide this, kbd wont know what to set when it's a new session(it doesnt have provider info)
    useEffect(() => {
      updateCurrentWebBrowsingDisplay(currentSessionId || 'new', webBrowsingMode)
    }, [currentSessionId, webBrowsingMode, updateCurrentWebBrowsingDisplay])

    const setWebBrowsingMode = useCallback(
      (enabled: boolean) => {
        setSessionWebBrowsing(currentSessionId || 'new', enabled)
      },
      [currentSessionId, setSessionWebBrowsing]
    )

    // messageInput lives inside the MessageInputField child component to avoid
    // re-rendering the entire InputBox (20+ hooks, 1300+ lines) on every keystroke.
    // The parent only keeps a ref to the latest text and a boolean for empty/non-empty.
    const messageInputFieldRef = useRef<MessageInputFieldRef>(null)
    const latestInputRef = useRef('')
    const [hasTextContent, setHasTextContent] = useState(false)
    const draftMessageIdRef = useRef<string | undefined>(undefined)
    const enabledSkillNames = useSettingsStore((state) => state.skills.enabledSkillNames)
    const [inputSkills, setInputSkills] = useState<Array<{ name: string; description: string }>>([])
    const [inputSkillsLoading, setInputSkillsLoading] = useState(false)
    const [skillCommandQuery, setSkillCommandQuery] = useState<string | null>(null)
    const [skillCommandSelectedIndex, setSkillCommandSelectedIndex] = useState(0)
    const skillCommandQueryRef = useRef<string | null>(null)
    const skillMenuAnchorRef = useRef<HTMLDivElement | null>(null)
    const skillMenuFloatingRef = useRef<HTMLDivElement | null>(null)

    const debouncedUpdateTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const resetHistoryIndexRef = useRef<() => void>(() => {})

    // Called only on real user typing (not programmatic setValue), to avoid resetting history navigation
    const onUserInput = useCallback(() => {
      resetHistoryIndexRef.current()
    }, [])

    const updateSkillCommandQuery = useCallback((query: string | null) => {
      if (skillCommandQueryRef.current === query) return
      skillCommandQueryRef.current = query
      setSkillCommandQuery(query)
      setSkillCommandSelectedIndex(0)
    }, [])

    const onMessageInputValueChange = useCallback(
      (value: string) => {
        latestInputRef.current = value
        const hasContent = value.trim().length > 0
        setHasTextContent((prev) => {
          if (prev === hasContent) return prev
          return hasContent
        })
        const trigger = getTrailingSkillCommand(value)
        const nextSkillCommandQuery = trigger?.query ?? null
        updateSkillCommandQuery(nextSkillCommandQuery)
        // Schedule debounced pre-constructed message update
        clearTimeout(debouncedUpdateTimerRef.current)
        debouncedUpdateTimerRef.current = setTimeout(() => flushRef.current(), 300)
      },
      [updateSkillCommandQuery]
    )

    const loadInputSkills = useCallback(async () => {
      setInputSkillsLoading(true)
      try {
        const allSkills = await skillsController.discoverSkills()
        setInputSkills(allSkills.map((skill) => ({ name: skill.name, description: skill.description })))
      } catch {
        setInputSkills([])
      } finally {
        setInputSkillsLoading(false)
      }
    }, [])

    useEffect(() => {
      if (skillCommandQuery === null || inputSkills.length > 0 || inputSkillsLoading) {
        return
      }
      void loadInputSkills()
    }, [inputSkills.length, inputSkillsLoading, loadInputSkills, skillCommandQuery])

    useEffect(() => {
      return subscribeSkillsChanged(() => {
        setInputSkills([])
      })
    }, [])

    const enabledInputSkills = useMemo(
      () => inputSkills.filter((skill) => enabledSkillNames.includes(skill.name)),
      [enabledSkillNames, inputSkills]
    )
    const matchingInputSkills = useMemo(() => {
      if (skillCommandQuery === null) return []
      const query = skillCommandQuery.trim().toLowerCase()
      const matchingSkills = query
        ? enabledInputSkills.filter(
            (skill) => skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
          )
        : enabledInputSkills
      return matchingSkills.slice(0, 8)
    }, [enabledInputSkills, skillCommandQuery])

    useEffect(() => {
      setSkillCommandSelectedIndex((index) => Math.min(index, Math.max(0, matchingInputSkills.length - 1)))
    }, [matchingInputSkills.length])

    const insertSkillCommand = useCallback(
      (skillName: string) => {
        messageInputFieldRef.current?.setValue((prev) => insertSkillCommandText(prev, skillName))
        updateSkillCommandQuery(null)
        setTimeout(() => {
          dom.focusMessageInput()
          dom.setMessageInputCursorToEnd()
        }, 0)
      },
      [updateSkillCommandQuery]
    )

    // Pre-constructed message state (scoped by session)
    const [preConstructedMessage, setPreConstructedMessage] = useAtom(
      atoms.inputBoxPreConstructedMessageFamily(currentSessionId || 'new')
    )
    const preConstructedMessageRef = useRef(preConstructedMessage)
    preConstructedMessageRef.current = preConstructedMessage
    const activeFilePreprocessingKeysRef = useRef(new Set<string>())
    useEffect(() => {
      draftMessageIdRef.current = preConstructedMessage.draftMessageId
    }, [preConstructedMessage.draftMessageId])
    const pictureKeys = preConstructedMessage.pictureKeys || []
    const attachments = preConstructedMessage.attachments || []

    const { session: currentSession } = useSession(sessionId || null)
    const { sessionSettings: currentSessionMergedSettings } = useSessionSettings(sessionId || null)
    const sessionLocks = useSessionLockState(currentSession)
    const submitAvailability = getSubmitAvailability(sessionLocks)
    // While replies stream, an empty draft shows Stop; entering content turns
    // the same control back into Send so it can be queued. The hard block
    // (compaction/pause decision) remains an independent axis.
    const generating = submitAvailability.control === 'stop'
    const generatingCount = sessionLocks.generatingReplyCount
    const isAwaitingPauseDecision = sessionLocks.awaitingPauseDecision
    // Every pause holds the input read-only, so the pending-action bar takes over
    // its slot instead of stacking above a dead text field. Same predicate the bar
    // renders on, so the slot never ends up empty.
    const pauseTakeover = useMemo(() => {
      if (isNewSession || !currentSession) return false
      return listPendingPauseInteractions(currentSession.messages).length > 0
    }, [isNewSession, currentSession])

    const skillMenuOpen = skillCommandQuery !== null && matchingInputSkills.length > 0 && !isAwaitingPauseDecision

    // Floating UI autoUpdate：跟随 anchor（含纯 position 变化的响应式过渡），替代手写 RO/rAF 状态机
    useLayoutEffect(() => {
      if (!skillMenuOpen) return
      const reference = skillMenuAnchorRef.current
      const floating = skillMenuFloatingRef.current
      if (!reference || !floating) return

      return autoUpdate(reference, floating, () => {
        void computePosition(reference, floating, {
          placement: 'top-start',
          strategy: 'fixed',
          middleware: [
            offset(4),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            size({
              padding: 8,
              apply({ availableHeight, rects, elements }) {
                Object.assign(elements.floating.style, {
                  maxHeight: `${Math.max(48, Math.min(208, availableHeight))}px`,
                  width: `${rects.reference.width}px`,
                })
              },
            }),
          ],
        }).then(({ x, y, strategy }) => {
          Object.assign(floating.style, {
            position: strategy,
            left: `${x}px`,
            top: `${y}px`,
          })
        })
      })
    }, [skillMenuOpen, matchingInputSkills.length])

    const { providers } = useProviders()
    const {
      effectiveProviderOptions,
      modelInfo,
      reasoningModelInfo,
      selectedProviderInfo,
      settingsPatch: reasoningSettingsPatch,
      handleReasoningLevelChange,
      markSettingsCommitted: markReasoningSettingsCommitted,
      waitForPendingPersist: waitForReasoningPersist,
    } = useReasoningControlState({
      currentSessionId,
      isNewSession,
      model,
      providers,
      sessionProviderOptions: resolveReasoningProviderOptions(
        currentSessionMergedSettings,
        model?.provider,
        model?.modelId
      ),
    })

    // Get current messages for token counting - will only recalculate when stable messages actually change
    // Uses getContextMessageIds to respect compaction points. Keyed off the
    // eligible-message subset so per-chunk streaming updates don't re-run it.
    const stableSessionMessages = useStableEligibleMessages(currentSession?.messages)
    const currentContextMessageIds = useMemo(() => {
      if (isNewSession) return null
      if (!currentSession || !stableSessionMessages.length) return null

      return getContextMessageIds(
        { ...currentSession, messages: stableSessionMessages },
        currentSessionMergedSettings?.maxContextMessageCount
      )
    }, [
      isNewSession,
      currentSessionMergedSettings?.maxContextMessageCount,
      stableSessionMessages,
      currentSession?.compactionPoints,
    ])

    const { knowledgeBase, setKnowledgeBase } = useKnowledgeBase({ isNewSession })

    // Agent mode value for conditional toolbar rendering
    const agentModeEntry = useSessionAgentMode(currentSessionId || 'new')
    const sessionMode = resolveSessionMode(agentModeEntry.value)
    // Chat mode has no message queue (mode policy): streaming keeps the Stop
    // control and submits are blocked with the standard generating notice.
    // Items already queued before the mode split still drain in order.
    const queueEnabled = isActionAvailableInMode('queue-message', sessionMode)
    const canCreateThread = isActionAvailableInMode('create-thread', sessionMode)

    const [showCompressionModal, setShowCompressionModal] = useState(false)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const activeSubmitRef = useRef<{ token: symbol; startedWhileGenerating: boolean } | null>(null)
    const [unreadyAttachmentSubmitPrompt, setUnreadyAttachmentSubmitPrompt] = useState<{
      opened: boolean
      count: number
    }>({ opened: false, count: 0 })

    const flushPreConstructedMessage = useCallback(() => {
      clearTimeout(debouncedUpdateTimerRef.current)
      const text = latestInputRef.current
      const constructedMessage = sessionHelpers.constructUserMessage(
        preConstructedMessage.draftMessageId,
        text,
        pictureKeys,
        preConstructedMessage.preprocessedFiles,
        []
      )
      setPreConstructedMessage((prev) => ({
        ...prev,
        text,
        pictureKeys,
        attachments,
        links: [],
        message: constructedMessage,
      }))
    }, [
      preConstructedMessage.draftMessageId,
      pictureKeys,
      attachments,
      preConstructedMessage.preprocessedFiles,
      setPreConstructedMessage,
    ])

    const flushRef = useRef(flushPreConstructedMessage)
    flushRef.current = flushPreConstructedMessage

    // When non-text deps change (pictures, attachments), flush immediately
    useEffect(() => {
      flushRef.current()
    }, [flushPreConstructedMessage])

    const pictureInputRef = useRef<HTMLInputElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // Check if any preprocessing is in progress
    const isPreprocessing = useMemo(() => {
      const hasProcessingFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'processing'
      )
      return hasProcessingFiles
    }, [preConstructedMessage.preprocessingStatus])

    // Check if any preprocessing has errors
    const hasPreprocessErrors = useMemo(() => {
      const hasErrorFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'error'
      )
      return hasErrorFiles
    }, [preConstructedMessage.preprocessingStatus])

    const hasBlockedSessionRagFiles = useMemo(
      () =>
        preConstructedMessage.preprocessedFiles.some(
          (file) => file.ragMode === 'session-retrieval' && file.sessionAttachmentAvailability === 'blocked'
        ),
      [preConstructedMessage.preprocessedFiles]
    )
    const hasSessionRetrievalFiles = useMemo(
      () =>
        preConstructedMessage.preprocessedFiles.some(
          (file) => file.ragMode === 'session-retrieval' && file.sessionAttachmentAvailability !== 'blocked'
        ),
      [preConstructedMessage.preprocessedFiles]
    )
    const hasLargeAttachmentWarning = useMemo(
      () =>
        preConstructedMessage.preprocessedFiles.some(
          (file) =>
            file.sessionAttachmentWarningReason === sessionHelpers.SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING
        ),
      [preConstructedMessage.preprocessedFiles]
    )

    const disableSubmit = useMemo(
      () => !(hasTextContent || attachments?.length || pictureKeys?.length),
      [hasTextContent, attachments, pictureKeys]
    )
    const currentQueueLength = useStore(messageQueueStore, (state) =>
      currentSessionId ? (state.queues[currentSessionId]?.length ?? 0) : 0
    )

    const preprocessedSessionAttachmentIds = useMemo(
      () =>
        Array.from(
          new Set(
            preConstructedMessage.preprocessedFiles.flatMap((file) =>
              file.sessionAttachmentId ? [file.sessionAttachmentId] : []
            )
          )
        ),
      [preConstructedMessage.preprocessedFiles]
    )
    const [recoveringPreprocessedAttachmentIds, setRecoveringPreprocessedAttachmentIds] = useState<number[]>([])
    const recoveringPreprocessedAttachmentIdsRef = useRef(new Set<number>())
    const { data: preprocessedAttachmentStates = [], refetch: refetchPreprocessedAttachmentStates } = useQuery<
      SessionAttachment[]
    >({
      queryKey: [
        'input-box-session-attachment-rag-attachments',
        ...[...preprocessedSessionAttachmentIds].sort((a, b) => a - b),
      ],
      queryFn: () => {
        if (!platform.isDesktopLike || preprocessedSessionAttachmentIds.length === 0) {
          return []
        }
        return platform.getSessionAttachmentRagController().getAttachments(preprocessedSessionAttachmentIds)
      },
      enabled: platform.isDesktopLike && preprocessedSessionAttachmentIds.length > 0,
      refetchInterval: (query): number | false => {
        const attachments = (query.state.data as SessionAttachment[] | undefined) ?? []
        return shouldRefetchSessionAttachmentStates(attachments, preprocessedSessionAttachmentIds.length) ? 1500 : false
      },
      // This query reads local IPC state, so browser offline/focus state must not pause progress updates.
      networkMode: 'always',
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: 'always',
    })
    const preprocessedAttachmentIndexStatusMap = useMemo(
      () => new Map(preprocessedAttachmentStates.map((attachment) => [attachment.id, attachment.indexStatus])),
      [preprocessedAttachmentStates]
    )
    const preprocessedAttachmentErrorMap = useMemo(
      () => new Map(preprocessedAttachmentStates.map((attachment) => [attachment.id, attachment.error])),
      [preprocessedAttachmentStates]
    )
    const preprocessedAttachmentResumableMap = useMemo(
      () => new Map(preprocessedAttachmentStates.map((attachment) => [attachment.id, attachment.resumable])),
      [preprocessedAttachmentStates]
    )
    const preprocessedAttachmentProgressMap = useMemo(
      () =>
        new Map(
          preprocessedAttachmentStates.map((attachment) => [
            attachment.id,
            {
              totalChunks: attachment.totalChunks ?? 0,
              embeddedChunks: attachment.embeddedChunks ?? 0,
              indexingStage: attachment.indexingStage,
              processingStartedAt: attachment.processingStartedAt,
            },
          ])
        ),
      [preprocessedAttachmentStates]
    )
    const recoverPreprocessedAttachment = useCallback(
      async (attachmentId: number) => {
        if (!platform.isDesktopLike || recoveringPreprocessedAttachmentIdsRef.current.has(attachmentId)) {
          return
        }
        recoveringPreprocessedAttachmentIdsRef.current.add(attachmentId)
        setRecoveringPreprocessedAttachmentIds((prev) => [...prev, attachmentId])
        try {
          await platform.getSessionAttachmentRagController().retryAttachment(attachmentId)
          toastActions.add(t('Queued'))
          await refetchPreprocessedAttachmentStates()
        } catch (error) {
          toastActions.add(`${t('Failed')}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          recoveringPreprocessedAttachmentIdsRef.current.delete(attachmentId)
          setRecoveringPreprocessedAttachmentIds((prev) => prev.filter((id) => id !== attachmentId))
        }
      },
      [refetchPreprocessedAttachmentStates, t]
    )
    useEffect(() => {
      if (preprocessedAttachmentStates.length === 0) {
        return
      }
      setPreConstructedMessage((prev) => {
        const result = mergeSessionAttachmentStatesIntoFiles(prev.preprocessedFiles, preprocessedAttachmentStates)
        return result.changed ? { ...prev, preprocessedFiles: result.files } : prev
      })
    }, [preprocessedAttachmentStates, setPreConstructedMessage])
    const modelSelectorDisplayText = useMemo(() => {
      if (!model) {
        return t('Select Model')
      }
      const modelInfo = (selectedProviderInfo?.models || selectedProviderInfo?.defaultSettings?.models)?.find(
        (m) => m.modelId === model.modelId
      )
      return `${modelInfo?.nickname || model.modelId}`
    }, [selectedProviderInfo, model, t])

    // When agent mode is on, block models that don't support agent tools in the model selector.
    const agentModeDisabledMessage = t('This model does not support Agent Mode')
    const modelDisabledCheck = useCallback(
      (m: ProviderModelInfo) => {
        if (agentModeEntry.value !== 'on') return undefined
        if (!m.capabilities?.includes('tool_use')) return agentModeDisabledMessage
        if (isDeepSeekWeakToolUse(m.modelId, 'agent')) return agentModeDisabledMessage
        return undefined
      },
      [agentModeDisabledMessage, agentModeEntry.value]
    )

    // Check model tool use capabilities for agent mode and file handling.
    // Uses 'agent' scope as the gate — models with weak function calling
    // (e.g. DeepSeek V3/R1) return false, disabling agent mode entirely.
    const { modelSupportToolUseForFile, modelSupportsAgentMode, isModelToolCapabilityFetched } =
      useModelToolCapabilities(model, currentSessionMergedSettings)
    const showSessionRetrievalToolWarning =
      hasSessionRetrievalFiles && isModelToolCapabilityFetched && !modelSupportToolUseForFile
    const agentModeUIState = useMemo(
      () => getAgentModeUIState(agentModeEntry, model ? modelSupportsAgentMode : true),
      [agentModeEntry, model, modelSupportsAgentMode]
    )

    // Determine sandbox mode: files exist in session and model supports tool use for files
    const sandboxMode = useMemo(() => {
      if (!modelSupportToolUseForFile || !currentSession) return false
      return currentSession.messages.some((m) => m.files?.length)
    }, [modelSupportToolUseForFile, currentSession?.messages])

    // Calculate token counts using unified cache layer
    const {
      contextTokens,
      currentInputTokens,
      totalTokens,
      isCalculating,
      isCurrentInputApproximate,
      isTotalApproximate,
      isContextApproximate,
      isContextCalculating,
      pendingContextMessages,
      messageCount,
      exactDraftTokens,
    } = useContextTokens({
      sessionId: currentSessionId || null,
      session: currentSession,
      settings: currentSessionMergedSettings || {},
      model,
      modelSupportToolUseForFile,
      sandboxMode,
      constructedMessage: preConstructedMessage.message,
    })

    const globalAutoCompaction = useSettingsStore((state) => state.autoCompaction)
    const [isCompacting, setIsCompacting] = useState(false)

    // The session-level share of the submit gate comes from the shared
    // availability model; the remaining flags are renderer-local draft state.
    const submitInProgress = isSubmitting && !generating
    const submitBlocked =
      disableSubmit ||
      isPreprocessing ||
      submitInProgress ||
      submitAvailability.blockReason !== undefined ||
      hasPreprocessErrors ||
      hasBlockedSessionRagFiles
    const submitControl = getSubmitControl({
      generating,
      hasDraft: !disableSubmit,
      canQueueDraft: !submitBlocked && currentQueueLength < MAX_QUEUED_MESSAGES,
      queueEnabled,
      sessionType,
      hasModel: Boolean(model),
    })
    const showingStopControl = submitControl === 'stop'
    const composerPlaceholder = getComposerPlaceholder({
      blockReason: submitAvailability.blockReason,
      generating,
      queueEnabled,
    })

    const autoCompactionEnabled = useMemo(() => {
      if (!currentSession) return globalAutoCompaction ?? true
      return isAutoCompactionEnabled(currentSession.settings, settingsStore.getState())
    }, [currentSession, globalAutoCompaction])

    const contextWindowKnown = useMemo(() => {
      if (!model?.modelId) return false
      if (modelInfo?.contextWindow) return true
      if (model?.provider && getProviderModelContextWindowSync(model.provider, model.modelId) !== null) return true
      // Fallback: provider-agnostic lookup (same as compaction detector)
      return getModelContextWindowSync(model.modelId) !== null
    }, [model?.modelId, model?.provider, modelInfo?.contextWindow, modelRegistryVersion])

    // Use model setting contextWindow if available, otherwise fallback to models.dev data
    const effectiveContextWindow = useMemo(() => {
      if (modelInfo?.contextWindow) return modelInfo.contextWindow
      if (model?.provider && model?.modelId) {
        const providerWindow = getProviderModelContextWindowSync(model.provider, model.modelId)
        if (providerWindow !== null) return providerWindow
      }
      // Fallback: provider-agnostic lookup (same as compaction detector)
      if (model?.modelId) return getModelContextWindowSync(model.modelId)
      return null
    }, [modelInfo?.contextWindow, model?.modelId, model?.provider, modelRegistryVersion])

    // Calculate token usage percentage
    const tokenPercentage = useMemo(() => {
      if (!effectiveContextWindow || effectiveContextWindow <= 0) return null
      return Math.round((totalTokens / effectiveContextWindow) * 100)
    }, [totalTokens, effectiveContextWindow])

    useEffect(() => {
      if (!currentSessionId || isNewSession) {
        setIsCompacting(false)
        return
      }
      const checkCompacting = () => {
        setIsCompacting(isCompactionInProgress(currentSessionId))
      }
      checkCompacting()
      const interval = setInterval(checkCompacting, 1000)
      return () => clearInterval(interval)
    }, [currentSessionId, isNewSession])

    const handleAutoCompactionChange = useCallback(
      async (enabled: boolean) => {
        if (!currentSessionId || isNewSession) return
        await rendererApplication.sessions.updateSession(currentSessionId, (session) => {
          if (!session) {
            throw new Error('Session not found')
          }
          return {
            ...session,
            settings: {
              ...session.settings,
              autoCompaction: enabled,
            },
          }
        })
      },
      [currentSessionId, isNewSession]
    )

    const [showRollbackThreadButton, setShowRollbackThreadButton] = useState(false)
    useEffect(() => {
      if (showRollbackThreadButton) {
        const tid = setTimeout(() => {
          setShowRollbackThreadButton(false)
        }, 5000)
        return () => {
          clearTimeout(tid)
        }
      }
    }, [showRollbackThreadButton])

    useImperativeHandle(
      ref,
      () => ({
        // 暂时并没有用到，还是使用了之前atom的方案
        setQuote: (data) => {
          messageInputFieldRef.current?.setValue((prev) => `${prev}\n\n${data}`)
          dom.focusMessageInput()
          dom.setMessageInputCursorToEnd()
        },
      }),
      []
    )

    const { addInputBoxHistory, getPreviousHistoryInput, getNextHistoryInput, resetHistoryIndex } = useInputBoxHistory()
    resetHistoryIndexRef.current = resetHistoryIndex

    type SubmitOptions = { allowUnreadySessionAttachments?: boolean }
    type InsertFilesOptions = { source?: 'pasted-text' }
    const handleSubmitRef = useRef<(needGenerating?: boolean, options?: SubmitOptions) => void>(() => {})
    const getPreviousHistoryInputRef = useRef(getPreviousHistoryInput)
    getPreviousHistoryInputRef.current = getPreviousHistoryInput
    const getNextHistoryInputRef = useRef(getNextHistoryInput)
    getNextHistoryInputRef.current = getNextHistoryInput
    const insertFilesRef = useRef<(files: File[], options?: InsertFilesOptions) => void>(() => {})

    const handleSubmit = async (needGenerating = true, options: SubmitOptions = {}) => {
      const submitAction = getSubmitAction({
        generating,
        needGenerating,
        sessionType,
        queueLength: currentSessionId ? (messageQueueStore.getState().queues[currentSessionId]?.length ?? 0) : 0,
        blockedForOtherReasons:
          disableSubmit ||
          submitInProgress ||
          isPreprocessing ||
          submitAvailability.blockReason !== undefined ||
          hasPreprocessErrors ||
          hasBlockedSessionRagFiles,
        queueEnabled,
        hasModel: Boolean(model),
      })
      if (submitAction === 'block' || (submitAction !== 'send' && !currentSessionId)) {
        // Compaction and approval blocks keep the standard notice. A generating
        // reply is handled by the queue action in work mode; in chat mode the
        // queue is disabled, so surface the generating lock notice instead.
        if (submitAvailability.blockReason) {
          void notifySessionLockBlocked(submitAvailability.blockReason, t)
        } else if (generating && needGenerating && !queueEnabled) {
          void notifySessionLockBlocked('generating', t)
        }
        return
      }
      if (generating && activeSubmitRef.current?.startedWhileGenerating === false) {
        activeSubmitRef.current = null
      }
      if (activeSubmitRef.current) return
      const submitAttempt = Symbol('input-submit')
      activeSubmitRef.current = { token: submitAttempt, startedWhileGenerating: generating }
      const finishSubmitting = () => {
        if (activeSubmitRef.current?.token !== submitAttempt) return
        activeSubmitRef.current = null
        setIsSubmitting(false)
      }
      // Cancel any pending debounce so it won't overwrite the reset after send
      clearTimeout(debouncedUpdateTimerRef.current)

      setIsSubmitting(true)
      try {
        let preprocessedFilesForSubmit = preConstructedMessage.preprocessedFiles
        const submitSessionAttachmentIds = Array.from(
          new Set(
            preprocessedFilesForSubmit.flatMap((file) => (file.sessionAttachmentId ? [file.sessionAttachmentId] : []))
          )
        )
        if (platform.isDesktopLike && submitSessionAttachmentIds.length > 0) {
          const latestAttachmentStates = await platform
            .getSessionAttachmentRagController()
            .getAttachments(submitSessionAttachmentIds)
          const result = mergeSessionAttachmentStatesIntoFiles(preprocessedFilesForSubmit, latestAttachmentStates)
          preprocessedFilesForSubmit = result.files
          if (result.changed) {
            setPreConstructedMessage((prev) => ({ ...prev, preprocessedFiles: result.files }))
          }
        }
        const unreadySessionAttachments = preprocessedFilesForSubmit.filter(
          (file) =>
            file.ragMode === 'session-retrieval' &&
            file.sessionAttachmentAvailability !== 'blocked' &&
            (file.sessionAttachmentIndexStatus ?? 'pending') !== 'ready'
        )
        if (unreadySessionAttachments.length > 0 && !options.allowUnreadySessionAttachments) {
          setUnreadyAttachmentSubmitPrompt({ opened: true, count: unreadySessionAttachments.length })
          return
        }

        // Build the message with the latest input text, bypassing debounce delay
        const latestMessage = sessionHelpers.constructUserMessage(
          preConstructedMessage.draftMessageId,
          latestInputRef.current,
          pictureKeys,
          preprocessedFilesForSubmit,
          []
        )
        if (!latestMessage) {
          console.error('No constructed message available')
          return
        }

        // Hand the worker's exact draft count to the send path on the message
        // itself; the projection check inside skips a draft edited since.
        const outgoingMessage = seedExactDraftTokens(latestMessage, exactDraftTokens)

        const messageTextForHistory = latestMessage.contentParts.find((p) => p.type === 'text')?.text || ''

        const finalizeUserMessageDraft = () => {
          // clearDraft updates the child on its next render; clear the parent's
          // immediate source too so a following submit cannot reuse this text.
          latestInputRef.current = ''
          setHasTextContent(false)
          messageInputFieldRef.current?.clearDraft()
          draftMessageIdRef.current = undefined
          setPreConstructedMessage({
            draftMessageId: undefined,
            text: '',
            pictureKeys: [],
            attachments: [],
            links: [],
            preprocessedFiles: [],
            preprocessedLinks: [],
            preprocessingStatus: {
              files: {},
              links: {},
            },
            preprocessingPromises: {
              files: new Map(),
              links: new Map(),
            },
            message: undefined,
          })
          setShowRollbackThreadButton(false)
          markReasoningSettingsCommitted()
          if (platform.type !== 'mobile' && messageTextForHistory) {
            addInputBoxHistory(messageTextForHistory)
          }
        }

        if (submitAction === 'queue' || submitAction === 'queue-resume') {
          if (!currentSessionId) {
            return
          }
          // Queued delivery reads session settings later; a dirty reasoning-level
          // change must land before finalize clears its state (same as the send path).
          await waitForReasoningPersist()
          const enqueueResult = enqueueUserMessage(
            currentSessionId,
            outgoingMessage,
            currentSession?.messages.at(-1)?.id
          )
          if (enqueueResult !== 'queued') {
            // The draft is kept in both failure cases — it is the only copy of the text.
            toastActions.add(enqueueResult === 'full' ? t('Message queue is full') : t('Failed to queue the message'))
            return
          }
          finalizeUserMessageDraft()
          if (submitAction === 'queue-resume') {
            resumeQueueAndDrain(currentSessionId)
          }
          trackingEvent('send_message', { event_category: 'user' })
          return
        }

        const params = {
          constructedMessage: outgoingMessage,
          needGenerating,
          settingsPatch: reasoningSettingsPatch,
          onUserMessageReady: finalizeUserMessageDraft,
        }

        // Ensure an in-flight reasoning-level persist has landed before generation reads session settings
        await waitForReasoningPersist()

        await onSubmit?.(params)

        trackingEvent('send_message', { event_category: 'user' })
      } catch (e) {
        console.error('Error submitting message:', e)
        toastActions.add((e as Error)?.message || t('An error occurred while sending the message.'))
      } finally {
        finishSubmitting()
      }
    }
    handleSubmitRef.current = handleSubmit

    const onKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (skillCommandQuery !== null && matchingInputSkills.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSkillCommandSelectedIndex((index) => (index + 1) % matchingInputSkills.length)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSkillCommandSelectedIndex(
              (index) => (index - 1 + matchingInputSkills.length) % matchingInputSkills.length
            )
            return
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const selectedSkill = matchingInputSkills[skillCommandSelectedIndex]
            if (selectedSkill) {
              insertSkillCommand(selectedSkill.name)
            }
            return
          }
        }
        if (skillCommandQuery !== null && event.key === 'Escape') {
          event.preventDefault()
          updateSkillCommandQuery(null)
          return
        }

        const isPressedHash: Record<ShortcutSendValue, boolean> = {
          '': false,
          Enter: event.keyCode === 13 && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey,
          'CommandOrControl+Enter': event.keyCode === 13 && (event.ctrlKey || event.metaKey) && !event.shiftKey,
          'Ctrl+Enter': event.keyCode === 13 && event.ctrlKey && !event.shiftKey,
          'Command+Enter': event.keyCode === 13 && event.metaKey,
          'Shift+Enter': event.keyCode === 13 && event.shiftKey,
          'Ctrl+Shift+Enter': event.keyCode === 13 && event.ctrlKey && event.shiftKey,
        }
        const isSendShortcut = isPressedHash[shortcuts.inputBoxSendMessage]
        const isSendWithoutResponseShortcut = isPressedHash[shortcuts.inputBoxSendMessageWithoutResponse]

        // 发送消息
        if (isSendShortcut) {
          if (platform.type === 'mobile' && isSmallScreen && shortcuts.inputBoxSendMessage === 'Enter') {
            // 移动端点击回车不会发送消息
            return
          }
          event.preventDefault()
          handleSubmitRef.current()
          return
        }

        // 发送消息但不生成回复
        if (isSendWithoutResponseShortcut) {
          event.preventDefault()
          handleSubmitRef.current(false)
          return
        }

        // 向上向下键翻阅历史消息
        const currentInput = latestInputRef.current
        const inputElement = messageInputFieldRef.current?.getElement()
        if (
          (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
          inputElement &&
          inputElement === document.activeElement && // 聚焦在输入框
          (currentInput.length === 0 || window.getSelection()?.toString() === currentInput) // 要么为空，要么输入框全选
        ) {
          event.preventDefault()
          if (event.key === 'ArrowUp') {
            const previousInput = getPreviousHistoryInputRef.current()
            if (previousInput !== undefined) {
              messageInputFieldRef.current?.setValue(previousInput)
              setTimeout(() => inputElement?.select(), 10)
            }
          } else if (event.key === 'ArrowDown') {
            const nextInput = getNextHistoryInputRef.current()
            if (nextInput !== undefined) {
              messageInputFieldRef.current?.setValue(nextInput)
              setTimeout(() => inputElement?.select(), 10)
            }
          }
        }

        // Prevent Chromium's native Escape behaviour which reverts textarea
        // value to its defaultValue, causing controlled-input state to desync.
        if (event.key === 'Escape') {
          event.preventDefault()
          messageInputFieldRef.current?.getElement()?.blur()
        }
      },
      [
        insertSkillCommand,
        isSmallScreen,
        matchingInputSkills,
        shortcuts,
        skillCommandQuery,
        skillCommandSelectedIndex,
        updateSkillCommandQuery,
      ]
    )

    const handleSelectModel = useCallback(
      async (provider: string, modelId: string) => {
        if (!onSelectModel) {
          return
        }
        if (model?.provider === provider && model?.modelId === modelId) {
          return
        }
        if (
          !(await confirmModelSwitchIfNeeded(sessionMode, currentSession?.messages, isNewSession, {
            compactionPoints: currentSession?.compactionPoints,
            maxContextMessageCount: currentSessionMergedSettings.maxContextMessageCount,
          }))
        ) {
          return
        }
        onSelectModel(provider, modelId)
      },
      [
        currentSession,
        currentSessionMergedSettings.maxContextMessageCount,
        isNewSession,
        model?.modelId,
        model?.provider,
        onSelectModel,
        sessionMode,
      ]
    )

    const startNewThread = () => {
      const res = onStartNewThread?.()
      if (res) {
        setShowRollbackThreadButton(true)
      }
    }

    const rollbackThread = () => {
      const res = onRollbackThread?.()
      if (res) {
        setShowRollbackThreadButton(false)
      }
    }

    const startFilePreprocessing = (file: File, options: InsertFilesOptions = {}) => {
      const fileKey = StorageKeyGenerator.fileUniqKey(file)
      activeFilePreprocessingKeysRef.current.add(fileKey)

      // 异步预处理文件，失败时标记为 error，并吞掉异常避免 Promise.all reject
      return sessionHelpers
        .prepareFileAttachment(
          file,
          { provider: model?.provider || '', modelId: model?.modelId || '' },
          { agentMode: isAgentModeActive, source: options.source }
        )
        .then(async (preprocessedFile) => {
          if (!activeFilePreprocessingKeysRef.current.has(fileKey)) {
            return
          }

          let nextPreprocessedFile: PreprocessedFile = preprocessedFile
          if (platform.isDesktopLike) {
            const draftMessageId = draftMessageIdRef.current || uuidv4()
            const indexedFile = await startPreparedSessionAttachmentIndexing({
              file,
              preparedFile: nextPreprocessedFile,
              sessionId: currentSessionId || 'new',
              draftMessageId,
              shouldContinue: () => activeFilePreprocessingKeysRef.current.has(fileKey),
            })
            if (!indexedFile) {
              return
            }
            nextPreprocessedFile = indexedFile
            if (indexedFile.draftMessageId) {
              draftMessageIdRef.current = indexedFile.draftMessageId
            }
          }

          setPreConstructedMessage((prev) =>
            onFileProcessed(prev, file, nextPreprocessedFile, 20, { fileKeys: [fileKey] })
          )
        })
        .catch((error) => {
          if (!activeFilePreprocessingKeysRef.current.has(fileKey)) {
            return
          }
          setPreConstructedMessage((prev) =>
            onFileProcessed(
              prev,
              file,
              {
                file,
                content: '',
                storageKey: '',
                error: (error as Error)?.message || 'Failed to preprocess the file.',
              },
              20,
              { fileKeys: [fileKey] }
            )
          )
        })
        .finally(() => {
          activeFilePreprocessingKeysRef.current.delete(fileKey)
        })
    }

    // In agent mode, allow all file types (sandbox can handle archives, binaries, etc.)
    // isActive is true only for 'on' — 'auto' and mobile/web behave like normal mode,
    // so they keep the standard file-type validation and accept filter.
    const isAgentModeActive = agentModeUIState.isActive

    const insertFiles = async (files: File[], options: InsertFilesOptions = {}) => {
      const MAX_IMAGES = 8
      const MAX_ATTACHMENTS = 20
      // 用本地累加器跟踪本次新增数量：同步循环内 state/ref 可能尚未刷新，靠它做无竞态的限额判断
      let imageCount = preConstructedMessageRef.current.pictureKeys?.length || 0
      let attachmentCount = preConstructedMessageRef.current.attachments?.length || 0
      let droppedImages = 0
      let droppedAttachments = 0

      for (const file of files) {
        // 文件和图片插入方法复用，会导致 svg、gif 这类不支持的图片也被插入，但暂时没看到有什么问题
        if (file.type.startsWith('image/')) {
          // 超过上限时直接跳过：保留最先添加的前 8 张，且不浪费转码/不产生孤儿 blob
          if (imageCount >= MAX_IMAGES) {
            droppedImages++
            continue
          }
          const base64 = await picUtils.getImageBase64AndResize(file)
          const key = StorageKeyGenerator.picture('input-box')
          await saveBlob.mutateAsync({ key, value: base64 })
          setPreConstructedMessage((prev) => ({
            ...prev,
            pictureKeys: [...(prev.pictureKeys || []), key].slice(0, MAX_IMAGES), // 保留最先添加的前 8 张
          }))
          imageCount++
        } else {
          if (file.size > KNOWLEDGE_BASE_MAX_FILE_SIZE) {
            toastActions.add(
              t('Chat attachments must be {{limit}} or smaller.', {
                limit: KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL,
              })
            )
            continue
          }

          // In agent mode, skip file type validation (sandbox handles any file type)
          if (!isAgentModeActive && !isSupportedFile(file.name)) {
            const unsupportedType = getUnsupportedFileType(file.name)
            let errorMsg = t('Unsupported file type: {{fileName}}', { fileName: file.name })
            if (unsupportedType === 'iwork') {
              errorMsg = t('iWork files (Pages, Keynote) are not supported. Please export to PDF or Office format.')
            } else if (unsupportedType === 'audio') {
              errorMsg = t('Audio files are not supported')
            } else if (unsupportedType === 'video') {
              errorMsg = t('Video files are not supported')
            } else if (unsupportedType === 'binary') {
              errorMsg = t('Binary/executable files are not supported')
            } else if (unsupportedType === 'archive') {
              errorMsg = t('Archive files are not supported. Please extract and upload individual files.')
            } else if (unsupportedType === 'image') {
              errorMsg = t('Advanced image formats are not supported. Please convert to JPG or PNG.')
            }
            toastActions.add(errorMsg)
            continue
          }

          // 已存在的文件视为重复（不占新增名额），新文件超过上限时直接跳过：保留最先添加的前 20 个
          const isDuplicate = (preConstructedMessageRef.current.attachments || []).some(
            (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
          )
          if (!isDuplicate && attachmentCount >= MAX_ATTACHMENTS) {
            droppedAttachments++
            continue
          }

          setPreConstructedMessage((prev) => {
            const draftMessageId = prev.draftMessageId || draftMessageIdRef.current || uuidv4()
            draftMessageIdRef.current = draftMessageId
            const newAttachments = prev.attachments.find(
              (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
            )
              ? prev.attachments
              : [...(prev.attachments || []), file].slice(0, MAX_ATTACHMENTS) // 保留最先添加的前 20 个

            // 只预处理实际保留下来的文件（findIndex 返回 -1 表示已被裁剪，跳过，避免残留状态阻塞发送）
            const fileIndex = newAttachments.findIndex(
              (f) => f.name === file.name && f.lastModified === file.lastModified
            )
            if (fileIndex >= 0 && fileIndex < MAX_ATTACHMENTS) {
              const preprocessPromise = startFilePreprocessing(file, options)
              return {
                ...storeFilePromise(markFileProcessing({ ...prev, draftMessageId }, file), file, preprocessPromise),
                attachments: newAttachments,
              }
            }

            return {
              ...prev,
              draftMessageId,
              attachments: newAttachments,
            }
          })
          if (!isDuplicate) {
            attachmentCount++
          }
        }
      }

      if (droppedImages > 0) {
        toastActions.add(
          t('You can attach up to {{limit}} images. The extra images were skipped.', { limit: MAX_IMAGES })
        )
      }
      if (droppedAttachments > 0) {
        toastActions.add(
          t('You can attach up to {{limit}} files. The extra files were skipped.', { limit: MAX_ATTACHMENTS })
        )
      }
    }
    insertFilesRef.current = insertFiles

    const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) {
        return
      }
      insertFiles(Array.from(event.target.files))
      event.target.value = ''
      dom.focusMessageInput()
    }

    const onImageUploadClick = () => {
      pictureInputRef.current?.click()
    }
    const onFileUploadClick = () => {
      fileInputRef.current?.click()
    }

    const onImageDeleteClick = async (picKey: string) => {
      setPreConstructedMessage((prev) => ({
        ...prev,
        pictureKeys: (prev.pictureKeys || []).filter((k) => k !== picKey),
      }))
      // 不删除图片数据，因为可能在其他地方引用，比如通过上下键盘的历史消息快捷输入、发送的消息中引用
      // await storage.delBlob(picKey)
    }

    const onPaste = useCallback(
      (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (sessionType === 'picture') {
          return
        }

        if (event.clipboardData?.items) {
          // 对于 Doc/PPT/XLS 等文件中的内容，粘贴时一般会有 4 个 items，分别是 text 文本、html、某格式和图片
          // 因为 getAsString 为异步操作，无法根据 items 中的内容来定制不同的粘贴行为，因此这里选择了最简单的做法：
          // 保持默认的粘贴行为，这时候会粘贴从文档中复制的文本和图片。我认为应该保留图片，因为文档中的表格、图表等图片信息也很重要，很难通过文本格式来表述。
          // 仅在只粘贴图片或文件时阻止默认行为，防止插入文件或图片的名字
          let hasText = false
          // Capture pre-paste text before async getAsString callback runs (browser will have inserted pasted text by then)
          const prePasteText = latestInputRef.current
          for (let i = 0; i < event.clipboardData.items.length; i++) {
            const item = event.clipboardData.items[i]
            if (item.kind === 'file') {
              // Insert files and images
              const file = item.getAsFile()
              if (file) {
                insertFilesRef.current([file])
              }
              continue
            }
            hasText = true
            if (item.kind === 'string' && item.type === 'text/plain') {
              item.getAsString((text) => {
                const raw = text.trim()
                if (pasteLongTextAsAFile && raw.length > 3000) {
                  const file = new File([text], `pasted_text_${Date.now()}.txt`, {
                    type: 'text/plain',
                  })
                  insertFilesRef.current([file], { source: 'pasted-text' })
                  messageInputFieldRef.current?.setValue(prePasteText) // 删除掉默认粘贴进去的长文本
                }
              })
            }
          }
          // 如果没有任何文本，则说明只是复制了图片或文件。这里阻止默认行为，防止插入文件或图片的名字
          if (!hasText) {
            event.preventDefault()
          }
        }
      },
      [sessionType, pasteLongTextAsAFile]
    )

    // 拖拽上传
    const { getRootProps, getInputProps } = useDropzone({
      onDrop: (acceptedFiles: File[], fileRejections) => {
        insertFiles(acceptedFiles)
        // Show toast for rejected files (only in non-agent mode, agent mode accepts all)
        if (fileRejections.length > 0) {
          const rejectedNames = fileRejections.map((r) => r.file.name).join(', ')
          toastActions.add(t('Unsupported file type: {{fileName}}', { fileName: rejectedNames }))
        }
      },
      // In agent mode, accept all file types; otherwise restrict to supported formats
      accept: isAgentModeActive ? undefined : getFileAcceptConfig(),
      noClick: true,
      noKeyboard: true,
    })

    // 引用消息
    const quote = useUIStore((state) => state.quote)
    const setQuote = useUIStore((state) => state.setQuote)
    // const [quote, setQuote] = useUIStore(state => [state]) useAtom(atoms.quoteAtom)
    // biome-ignore lint/correctness/useExhaustiveDependencies: todo
    useEffect(() => {
      if (quote !== '') {
        // TODO: 支持引用消息中的图片
        // TODO: 支持引用消息中的文件
        setQuote('')
        messageInputFieldRef.current?.setValue((val) => {
          const newValue = !val
            ? quote
            : val + '\n'.repeat(Math.max(0, 2 - (val.match(/(\n)+$/)?.[0].length || 0))) + quote
          return newValue
        })
        // setPreviousMessageQuickInputMark('')
        dom.focusMessageInput()
        dom.setMessageInputCursorToEnd()
      }
    }, [quote])

    const handleKnowledgeBaseSelect = useCallback(
      (kb: KnowledgeBase | null) => {
        if (!kb || kb.id === knowledgeBase?.id) {
          setKnowledgeBase(undefined)
          trackEvent('knowledge_base_disabled')
        } else {
          setKnowledgeBase(pick(kb, 'id', 'name'))
          trackEvent('knowledge_base_enabled')
        }
      },
      [knowledgeBase, setKnowledgeBase]
    )

    // Show deprecated notice for legacy picture sessions
    if (sessionType === 'picture') {
      return (
        <Box pt={0} pb={isSmallScreen ? 'md' : 'sm'} px="sm" id={dom.InputBoxID}>
          <Stack
            className={cn(
              'rounded-lg bg-chatbox-background-secondary shadow-[0_8px_48px_-8px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_48px_-8px_rgba(0,0,0,0.5)]',
              widthFull ? 'w-full' : 'max-w-4xl mx-auto'
            )}
            gap="xs"
            p="md"
            align="center"
          >
            <Text size="sm" c="chatbox-tertiary" ta="center">
              {t('This image session is read-only. Please use the new Image Creator for image generation.')}
            </Text>
            <Button variant="light" size="xs" onClick={() => navigate({ to: '/image-creator' })}>
              {t('Go to Image Creator')}
            </Button>
          </Stack>
        </Box>
      )
    }

    return (
      <Box
        pt={0}
        pb={isSmallScreen ? 'md' : 'sm'}
        px="sm"
        id={dom.InputBoxID}
        className="overflow-visible"
        {...getRootProps()}
      >
        <input className="hidden" {...getInputProps()} />
        <Stack className={cn('overflow-visible', widthFull ? 'w-full' : 'max-w-4xl mx-auto')} gap="xs">
          {currentSessionId && (
            <CompactionStatus sessionId={currentSessionId} onViewSummary={onViewCompactionSummary} />
          )}
          {currentSession && !isNewSession && <WebSearchUnavailableBanner session={currentSession} />}
          {currentSessionId && !isNewSession && <QueuedMessagesBar sessionId={currentSessionId} />}
          {currentSession && !isNewSession && (
            <ErrorBoundary name="pending-action-bar">
              <PendingActionBar session={currentSession} />
            </ErrorBoundary>
          )}
          <Box
            ref={skillMenuAnchorRef}
            className={cn(
              // min-h + justify-between 必须同层，桌面空输入时工具栏贴底
              INPUT_SURFACE_CLASS_NAME,
              !isSmallScreen && INPUT_SURFACE_MIN_HEIGHT_CLASS_NAME,
              // Kept mounted while a pause takes over the slot so the draft,
              // attachments and autosized height survive the swap.
              pauseTakeover && 'hidden'
            )}
            style={INPUT_SURFACE_STYLE}
          >
            {/*
              skill 列表：Portal + Floating UI autoUpdate
              - 不撑高 InputBox；逃出 overflow-hidden
              - 持续跟随 anchor（含双向 resize / 纯 position 过渡）
              - size middleware 按可用高度限 maxHeight
            */}
            {skillMenuOpen &&
              createPortal(
                <Box
                  ref={skillMenuFloatingRef}
                  className="z-[400] overflow-y-auto rounded-lg border border-solid border-chatbox-border-primary bg-chatbox-background-primary py-1 shadow-lg"
                  style={{ position: 'fixed', top: 0, left: 0 }}
                >
                  {matchingInputSkills.map((skill, index) => (
                    <UnstyledButton
                      key={skill.name}
                      className={cn(
                        'flex w-full items-start gap-2 px-2 py-1.5 text-left transition-colors',
                        index === skillCommandSelectedIndex
                          ? 'bg-chatbox-background-tertiary'
                          : 'hover:bg-chatbox-background-tertiary'
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertSkillCommand(skill.name)}
                    >
                      <IconWand
                        size={14}
                        strokeWidth={1.8}
                        className="mt-0.5 shrink-0 text-[var(--chatbox-tint-secondary)]"
                      />
                      <Stack gap={1} className="min-w-0 flex-1">
                        <Text size="sm" truncate c="chatbox-primary">
                          /{skill.name}
                        </Text>
                        {skill.description && (
                          <Text size="xs" c="chatbox-secondary" lineClamp={1}>
                            {skill.description}
                          </Text>
                        )}
                      </Stack>
                    </UnstyledButton>
                  ))}
                </Box>,
                document.body
              )}

            {/* Work Mode status row: approval policy + working directories, always visible
                above the input with their own in-place menus (mirrors the mode panel). */}
            {platform.isDesktopLike && agentModeUIState.isActive && (
              <WorkModeStatusRow
                sessionId={currentSessionId || 'new'}
                providerId={model?.provider}
                modelId={model?.modelId}
              />
            )}

            {/* Input Row */}
            <Flex align="flex-end" gap={4}>
              <MessageInputField
                ref={messageInputFieldRef}
                isNewSession={isNewSession}
                viewportHeight={viewportHeight}
                isReadOnly={submitAvailability.blockReason !== undefined}
                placeholder={
                  composerPlaceholder.kind === 'locked'
                    ? getSessionLockNotice(composerPlaceholder.reason, t)
                    : composerPlaceholder.kind === 'queue'
                      ? t('Type a message, press Enter to queue it') || ''
                      : t('Type your question here...') || ''
                }
                ariaLabel={t('Type your question here...') || ''}
                autoFocus={!isSmallScreen}
                onValueChange={onMessageInputValueChange}
                onUserInput={onUserInput}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />

              <Tooltip
                // `n` rather than `count`, so i18next does not engage plural resolution for a
                // label that is only ever shown for more than one reply.
                label={
                  submitControl === 'queue'
                    ? t('Will send after the current response finishes')
                    : generatingCount > 1
                      ? t('Stop all {{n}} replies', { n: generatingCount })
                      : t('Stop')
                }
                disabled={submitControl === 'send'}
                withArrow
              >
                <ActionIcon
                  data-testid={
                    submitControl === 'stop'
                      ? TestId.chat.stop
                      : submitControl === 'queue'
                        ? TestId.chat.queuedMessageEnqueue
                        : TestId.chat.send
                  }
                  disabled={submitBlocked && !showingStopControl}
                  size={32}
                  variant="filled"
                  color={showingStopControl ? 'dark' : 'chatbox-brand'}
                  radius="lg"
                  onClick={showingStopControl ? onStopGenerating : () => handleSubmit()}
                  className={cn(
                    'shrink-0 mb-1',
                    !showingStopControl && submitBlocked && 'disabled:!opacity-100 !text-white'
                  )}
                  style={
                    !showingStopControl && submitBlocked ? { backgroundColor: 'rgba(222, 226, 230, 1)' } : undefined
                  }
                >
                  {showingStopControl ? (
                    <ScalableIcon icon={IconPlayerStopFilled} size={16} />
                  ) : (
                    <ScalableIcon icon={IconArrowUp} size={16} />
                  )}
                </ActionIcon>
              </Tooltip>
            </Flex>

            {(!!pictureKeys.length || !!attachments.length) && (
              <Flex
                align="center"
                wrap="wrap"
                className="max-h-[30vh] overflow-y-auto"
                onClick={() => dom.focusMessageInput()}
              >
                {showSessionRetrievalToolWarning && (
                  <Flex
                    role="status"
                    aria-live="polite"
                    align="center"
                    gap={8}
                    className="w-full rounded-lg px-2.5 py-2 mb-1"
                    style={{
                      border: '1px solid var(--chatbox-border-primary)',
                      borderLeft: '3px solid var(--chatbox-tint-warning)',
                      background: 'var(--chatbox-background-primary)',
                    }}
                  >
                    <Box
                      className="flex items-center justify-center rounded-full shrink-0"
                      style={{
                        width: 20,
                        height: 20,
                        background: 'var(--chatbox-background-secondary)',
                        color: 'var(--chatbox-tint-warning)',
                      }}
                    >
                      <ScalableIcon icon={IconAlertCircle} size={14} />
                    </Box>
                    <Text size="xs" lh={1.35} c="chatbox-warning" className="min-w-0">
                      {t(
                        'This model may not be able to read the uploaded document. Try another model if you want to ask about the file.'
                      )}
                    </Text>
                  </Flex>
                )}
                {hasLargeAttachmentWarning && (
                  <Flex
                    role="status"
                    aria-live="polite"
                    align="center"
                    gap={8}
                    className="w-full rounded-lg px-2.5 py-2 mb-1"
                    style={{
                      border: '1px solid var(--chatbox-border-primary)',
                      borderLeft: '3px solid var(--chatbox-tint-warning)',
                      background: 'var(--chatbox-background-primary)',
                    }}
                  >
                    <Box
                      className="flex items-center justify-center rounded-full shrink-0"
                      style={{
                        width: 20,
                        height: 20,
                        background: 'var(--chatbox-background-secondary)',
                        color: 'var(--chatbox-tint-warning)',
                      }}
                    >
                      <ScalableIcon icon={IconAlertCircle} size={14} />
                    </Box>
                    <Text size="xs" lh={1.35} c="chatbox-warning" className="min-w-0">
                      {t(
                        'This attachment is very large and may consume more points. You can send it anyway, or remove it and use a smaller file.'
                      )}
                    </Text>
                  </Flex>
                )}
                {pictureKeys?.map((picKey) => (
                  <ImageMiniCard key={picKey} storageKey={picKey} onDelete={() => onImageDeleteClick(picKey)} />
                ))}
                {attachments?.map((file) => {
                  const fileKey = StorageKeyGenerator.fileUniqKey(file)
                  const status = preConstructedMessage.preprocessingStatus.files[fileKey]
                  const preprocessedFile = preConstructedMessage.preprocessedFiles.find(
                    (f) => StorageKeyGenerator.fileUniqKey(f.file) === fileKey
                  )
                  const effectiveIndexStatus = preprocessedFile?.sessionAttachmentId
                    ? (preprocessedAttachmentIndexStatusMap.get(preprocessedFile.sessionAttachmentId) ??
                      preprocessedFile.sessionAttachmentIndexStatus)
                    : preprocessedFile?.sessionAttachmentIndexStatus
                  const effectiveAttachmentError = preprocessedFile?.sessionAttachmentId
                    ? preprocessedAttachmentErrorMap.has(preprocessedFile.sessionAttachmentId)
                      ? preprocessedAttachmentErrorMap.get(preprocessedFile.sessionAttachmentId)
                      : preprocessedFile?.error
                    : preprocessedFile?.error
                  const attachmentResumable = preprocessedFile?.sessionAttachmentId
                    ? (preprocessedAttachmentResumableMap.get(preprocessedFile.sessionAttachmentId) ??
                      preprocessedFile.sessionAttachmentResumable)
                    : preprocessedFile?.sessionAttachmentResumable
                  const recoveryAction =
                    effectiveIndexStatus === 'failed' && attachmentResumable !== undefined
                      ? attachmentResumable
                        ? 'continue'
                        : 'retry'
                      : undefined
                  const attachmentProgress = preprocessedFile?.sessionAttachmentId
                    ? preprocessedAttachmentProgressMap.get(preprocessedFile.sessionAttachmentId)
                    : undefined
                  const totalChunks =
                    attachmentProgress?.totalChunks ?? preprocessedFile?.sessionAttachmentTotalChunks ?? 0
                  const embeddedChunks =
                    attachmentProgress?.embeddedChunks ?? preprocessedFile?.sessionAttachmentEmbeddedChunks ?? 0
                  const indexingStage =
                    attachmentProgress?.indexingStage ?? preprocessedFile?.sessionAttachmentIndexingStage
                  const progressValue = getSessionAttachmentProgressValue(embeddedChunks, totalChunks)
                  const isSessionAttachmentTakingLong =
                    !!attachmentProgress?.processingStartedAt &&
                    effectiveIndexStatus !== 'ready' &&
                    Date.now() - attachmentProgress.processingStartedAt > 30000
                  const statusText =
                    preprocessedFile?.ragMode === 'session-retrieval' && effectiveIndexStatus === 'failed'
                      ? totalChunks > 0
                        ? `${t('Indexing failed')} · ${embeddedChunks}/${totalChunks} ${t('chunks')}`
                        : t('Indexing failed')
                      : preprocessedFile?.ragMode === 'session-retrieval' && effectiveIndexStatus !== 'ready'
                        ? progressValue !== undefined
                          ? `${isSessionAttachmentTakingLong ? t('Still indexing') : getSessionAttachmentStageLabel(indexingStage, t)} · ${progressValue}%`
                          : isSessionAttachmentTakingLong
                            ? t('Still indexing')
                            : getSessionAttachmentStageLabel(indexingStage, t)
                        : status === 'processing'
                          ? t('Preparing')
                          : undefined
                  return (
                    <FileMiniCard
                      key={fileKey}
                      name={file.name}
                      fileType={file.type}
                      status={
                        effectiveIndexStatus === 'failed' || effectiveAttachmentError
                          ? 'error'
                          : preprocessedFile?.ragMode === 'session-retrieval'
                            ? effectiveIndexStatus === 'ready'
                              ? 'completed'
                              : 'processing'
                            : status
                      }
                      statusText={statusText}
                      parserType={preprocessedFile?.parserType}
                      progressValue={progressValue}
                      isTakingLong={isSessionAttachmentTakingLong}
                      errorMessage={effectiveAttachmentError}
                      recoveryAction={recoveryAction}
                      onRecover={
                        preprocessedFile?.sessionAttachmentId && recoveryAction
                          ? () => recoverPreprocessedAttachment(preprocessedFile.sessionAttachmentId as number)
                          : undefined
                      }
                      recovering={
                        preprocessedFile?.sessionAttachmentId
                          ? recoveringPreprocessedAttachmentIds.includes(preprocessedFile.sessionAttachmentId)
                          : false
                      }
                      onErrorClick={() => {
                        const errorCode = effectiveAttachmentError
                        if (errorCode) {
                          void NiceModal.show('file-parse-error', {
                            errorCode,
                            fileName: file.name,
                          })
                        }
                      }}
                      onPreviewClick={
                        preprocessedFile?.storageKey
                          ? () => {
                              const parserLabel = getParserTypeLabel(preprocessedFile?.parserType, t)
                              void NiceModal.show('content-viewer', {
                                title: `${t('File Content')}: ${file.name}`,
                                storageKey: preprocessedFile.storageKey,
                                metadata: parserLabel ? [{ value: parserLabel }] : undefined,
                              })
                            }
                          : undefined
                      }
                      onDelete={() => {
                        const fileKeysToRemove = new Set([fileKey])
                        // Cancel any ongoing MinerU parsing for this file
                        const filePath = platform.getLocalFilePath(file)
                        fileKeysToRemove.add(StorageKeyGenerator.fileUniqKey(file))
                        for (const key of fileKeysToRemove) {
                          activeFilePreprocessingKeysRef.current.delete(key)
                        }
                        if (filePath && platform.cancelMineruParse) {
                          platform.cancelMineruParse(filePath).catch(() => {
                            // Ignore cancellation errors
                          })
                        }
                        if (platform.isDesktopLike && preprocessedFile?.sessionAttachmentId) {
                          void platform
                            .getSessionAttachmentRagController()
                            .deleteAttachment(preprocessedFile.sessionAttachmentId)
                            .catch(() => {
                              // Ignore cancellation errors
                            })
                        }
                        setPreConstructedMessage((prev) =>
                          cleanupFile(prev, file, { fileKeys: fileKeysToRemove, removeAttachment: true })
                        )
                      }}
                    />
                  )
                })}
              </Flex>
            )}

            {/* Toolbar Row */}
            <Flex align="center" gap={0} className="shrink-0 w-full" justify="space-between">
              {/* Hidden file inputs */}
              <ImageUploadInput
                ref={pictureInputRef}
                onChange={onFileInputChange}
                testId={TestId.chat.attachmentImageInput}
              />
              <input
                data-testid={TestId.chat.attachmentFileInput}
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={onFileInputChange}
                multiple
                accept={isAgentModeActive ? undefined : getFileAcceptString()}
              />

              {/* Left Group: Tool Buttons */}
              <Flex align="center" gap={0}>
                <AttachmentMenu onImageUploadClick={onImageUploadClick} onFileUploadClick={onFileUploadClick} t={t} />

                <ReasoningControlButton
                  provider={model?.provider}
                  model={reasoningModelInfo}
                  providerOptions={effectiveProviderOptions}
                  iconSize={toolbarIconSize}
                  onChange={(level) => void handleReasoningLevelChange(level)}
                />

                <AgentModeButton
                  sessionId={currentSessionId || 'new'}
                  providerId={model?.provider}
                  modelId={model?.modelId}
                  iconSize={toolbarIconSize}
                  compact={isSmallScreen}
                  modelSupportsAgentMode={model ? modelSupportsAgentMode : true}
                  webBrowsingMode={webBrowsingMode}
                  onWebBrowsingChange={(v) => {
                    setWebBrowsingMode(v)
                    dom.focusMessageInput()
                  }}
                  currentKnowledgeBaseId={knowledgeBase?.id}
                  onKnowledgeBaseSelect={handleKnowledgeBaseSelect}
                  onSkillSelect={insertSkillCommand}
                  draftCopilotId={draftCopilotId}
                  draftCopilotName={draftCopilotName}
                />

                {!isSmallScreen &&
                  canCreateThread &&
                  (showRollbackThreadButton ? (
                    <Tooltip label={t('Rollback Thread')} position="top" withArrow>
                      <UnstyledButton
                        data-testid={TestId.chat.rollbackThread}
                        aria-label={t('Rollback Thread')}
                        onClick={rollbackThread}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
                      >
                        <IconArrowBackUp
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--chatbox-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Tooltip>
                  ) : (
                    <Tooltip label={t('New Thread')} position="top" withArrow>
                      <UnstyledButton
                        data-testid={TestId.chat.newThread}
                        aria-label={t('New Thread')}
                        onClick={startNewThread}
                        disabled={!onStartNewThread}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors disabled:opacity-50"
                      >
                        <IconFilePencil
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--chatbox-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Tooltip>
                  ))}

                {!isSmallScreen && (
                  <Tooltip label={t('Conversation Settings')} position="top" withArrow>
                    <UnstyledButton
                      data-testid={TestId.chat.sessionSettings}
                      aria-label={t('Conversation Settings') || undefined}
                      onClick={onClickSessionSettings}
                      disabled={!onClickSessionSettings}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors disabled:opacity-50"
                    >
                      <IconAdjustmentsHorizontal
                        size={toolbarIconSize}
                        strokeWidth={1.8}
                        className="text-[var(--chatbox-tint-secondary)]"
                      />
                    </UnstyledButton>
                  </Tooltip>
                )}

                {isSmallScreen && (
                  <ComposerSettingsMenu
                    canCreateThread={canCreateThread}
                    toolbarIconSize={toolbarIconSize}
                    onStartNewThread={startNewThread}
                    onClickSessionSettings={onClickSessionSettings}
                  />
                )}
              </Flex>

              {/* Right Group: Token Count + Model Selector */}
              <Flex align="center" gap={0} className="min-w-0 ml-auto">
                <TokenCountMenu
                  currentInputTokens={currentInputTokens}
                  contextTokens={contextTokens}
                  totalTokens={totalTokens}
                  isCalculating={isCalculating}
                  isCurrentInputApproximate={isCurrentInputApproximate}
                  isTotalApproximate={isTotalApproximate}
                  isContextApproximate={isContextApproximate}
                  isContextCalculating={isContextCalculating}
                  pendingContextMessages={pendingContextMessages}
                  totalContextMessages={messageCount}
                  contextWindow={effectiveContextWindow ?? undefined}
                  currentMessageCount={currentContextMessageIds?.length ?? 0}
                  maxContextMessageCount={currentSessionMergedSettings?.maxContextMessageCount}
                  onCompressClick={sessionId && !isNewSession ? () => setShowCompressionModal(true) : undefined}
                  autoCompactionEnabled={autoCompactionEnabled}
                  isCompacting={isCompacting}
                  contextWindowKnown={contextWindowKnown}
                  onAutoCompactionChange={sessionId && !isNewSession ? handleAutoCompactionChange : undefined}
                >
                  <Flex
                    align="center"
                    gap="2"
                    className={`shrink-0 text-xs cursor-pointer hover:text-chatbox-tint-secondary transition-colors px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] ${
                      tokenPercentage && tokenPercentage > 80 ? 'text-red-500' : 'text-chatbox-tint-tertiary'
                    }`}
                  >
                    <ScalableIcon icon={IconArrowUp} size={14} />
                    {isCalculating && <Loader size={10} />}
                    <Text span size="xs" className="whitespace-nowrap" c="inherit">
                      {isTotalApproximate ? '~' : ''}
                      {formatNumber(totalTokens)}
                      {tokenPercentage !== null && tokenPercentage > 10 && ` (${tokenPercentage}%)`}
                    </Text>
                  </Flex>
                </TokenCountMenu>

                {/* Model Selector */}
                <Box className="min-w-0 flex-1 justify-end max-w-[200px]">
                  <ModelSelectorV2
                    onSelect={handleSelectModel}
                    selectedProviderId={model?.provider}
                    selectedModelId={model?.modelId}
                    modelDisabledCheck={modelDisabledCheck}
                    pageName={JK_PAGE_NAMES.CHAT_PAGE}
                    position="top-end"
                    transitionProps={{
                      transition: 'fade-up',
                      duration: 200,
                    }}
                  >
                    <UnstyledButton
                      className={cn(
                        'flex min-w-0 max-w-full items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors',
                        !model && 'animate-pulse bg-blue-500/20'
                      )}
                    >
                      {!!model && <ProviderImageIcon size={18} provider={model.provider} />}
                      <Text
                        size="sm"
                        data-testid={TestId.model.selectorTrigger}
                        className={cn(
                          'min-w-0 flex-1 truncate text-[var(--chatbox-tint-secondary)]',
                          isSmallScreen ? 'max-w-[100px]' : 'max-w-[160px]'
                        )}
                      >
                        {modelSelectorDisplayText}
                      </Text>
                      <IconChevronRight
                        size={14}
                        className="text-[var(--chatbox-tint-tertiary)] rotate-90 flex-shrink-0"
                      />
                    </UnstyledButton>
                  </ModelSelectorV2>
                </Box>
              </Flex>
            </Flex>
          </Box>

          <Disclaimer />
        </Stack>
        {currentSession && (
          <CompressionModal
            opened={showCompressionModal}
            onClose={() => setShowCompressionModal(false)}
            session={currentSession}
          />
        )}
        <AdaptiveModal
          opened={unreadyAttachmentSubmitPrompt.opened}
          onClose={() => setUnreadyAttachmentSubmitPrompt((prev) => ({ ...prev, opened: false }))}
          title={t('Document is still indexing')}
          centered
          size="sm"
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {t(
                '{{count}} document(s) are still being prepared. If you send now, the answer may not use the full document.',
                { count: unreadyAttachmentSubmitPrompt.count }
              )}
            </Text>
            <AdaptiveModal.Actions>
              <Button
                variant="default"
                onClick={() => setUnreadyAttachmentSubmitPrompt((prev) => ({ ...prev, opened: false }))}
              >
                {t('Wait')}
              </Button>
              <Button
                onClick={() => {
                  setUnreadyAttachmentSubmitPrompt((prev) => ({ ...prev, opened: false }))
                  void handleSubmit(true, { allowUnreadySessionAttachments: true })
                }}
              >
                {t('Send anyway')}
              </Button>
            </AdaptiveModal.Actions>
          </Stack>
        </AdaptiveModal>
      </Box>
    )
  }
)

// Reusable attachment menu component with lightweight style
const AttachmentMenu: React.FC<{
  onImageUploadClick: () => void
  onFileUploadClick: () => void
  t: (key: string) => string
}> = ({ onImageUploadClick, onFileUploadClick, t }) => {
  const isSmallScreen = useIsSmallScreen()
  const toolbarIconSize = isSmallScreen ? 22 : 18
  return (
    <Menu
      shadow="md"
      trigger={isSmallScreen ? 'click' : 'hover'}
      position="top-start"
      openDelay={100}
      closeDelay={100}
      keepMounted
      transitionProps={{
        transition: 'pop',
        duration: 200,
      }}
    >
      <Menu.Target>
        <UnstyledButton
          data-testid={TestId.chat.attachmentMenuTrigger}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
        >
          <IconCirclePlus size={toolbarIconSize} strokeWidth={1.8} className="text-[var(--chatbox-tint-secondary)]" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          data-testid={TestId.chat.attachmentSelectImage}
          leftSection={<IconPhoto size={16} />}
          onClick={onImageUploadClick}
        >
          {t('Attach Image')}
        </Menu.Item>
        <Menu.Item
          data-testid={TestId.chat.attachmentSelectFile}
          leftSection={<IconFolder size={16} />}
          onClick={onFileUploadClick}
        >
          {t('Select File')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

// Memoize the InputBox component to prevent unnecessary re-renders during streaming
export default memo(InputBox)
