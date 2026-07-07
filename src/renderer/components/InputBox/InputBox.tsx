import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Button, Flex, Loader, Menu, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { useViewportSize } from '@mantine/hooks'
import {
  getFileAcceptConfig,
  getFileAcceptString,
  getUnsupportedFileType,
  isSupportedFile,
} from '@shared/file-extensions'
import { KNOWLEDGE_BASE_MAX_FILE_SIZE, KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL } from '@shared/knowledge-base'
import { getModel } from '@shared/providers'
import { formatNumber } from '@shared/utils'
import {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowUp,
  IconChevronRight,
  IconCirclePlus,
  IconFilePencil,
  IconFolder,
  IconHammer,
  IconLink,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlus,
  IconSettings,
  IconVocabulary,
  IconWorldWww,
  IconX,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAtom, useAtomValue } from 'jotai'
import { pick } from 'lodash'
import type React from 'react'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { createModelDependencies } from '@/adapters'
import useInputBoxHistory from '@/hooks/useInputBoxHistory'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useProviders } from '@/hooks/useProviders'
import { useSaveBlob } from '@/hooks/useSaveBlob'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import {
  getContextMessageIds,
  isAutoCompactionEnabled,
  isCompactionInProgress,
  useContextTokens,
} from '@/packages/context-management'
import { trackingEvent } from '@/packages/event'
import {
  getModelContextWindowSync,
  getProviderModelContextWindowSync,
  useModelRegistryVersion,
} from '@/packages/model-registry'
import * as picUtils from '@/packages/pic_utils'
import { parseSlashInvocation } from '@/packages/skills/slash'
import { useEnabledSkills } from '@/packages/skills/useEnabledSkills'
import platform from '@/platform'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as atoms from '@/stores/atoms'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'
import * as chatStore from '@/stores/chatStore'
import { useSession, useSessionSettings } from '@/stores/chatStore'
import { settingsStore, useHasConfiguredProvider, useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { delay } from '@/utils'
import { featureFlags } from '@/utils/feature-flags'
import {
  type KnowledgeBase,
  type Message,
  ModelProviderEnum,
  type SessionAttachment,
  type SessionType,
} from '../../../shared/types'
import * as dom from '../../hooks/dom'
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
import KnowledgeBaseMenu from '../knowledge-base/KnowledgeBaseMenu'
import ModelSelector from '../ModelSelector'
import MCPMenu from '../mcp/MCPMenu'
import { FileMiniCard, ImageMiniCard, LinkMiniCard } from './Attachments'
import {
  findProviderModelInfo,
  getUnsupportedFileMessage,
  MAX_LINKS,
  planLinkInsertion,
  resolveModelDisplayText,
} from './composerInsertion'
import { resolveComposerKeyAction } from './composerKeyboard'
import * as composerSubmit from './composerSubmit'
import { ImageUploadInput } from './ImageUploadInput'
import { MessageInputField, type MessageInputFieldRef } from './MessageInputField'
import {
  cleanupFile,
  cleanupLink,
  markFileProcessing,
  markLinkProcessing,
  onFileProcessed,
  onLinkProcessed,
  storeFilePromise,
  storeLinkPromise,
} from './preprocessState'
import { deriveAttachmentCardState, mergeSessionAttachmentStatesIntoFiles } from './sessionAttachmentDisplay'
import TokenCountMenu from './TokenCountMenu'

export type InputBoxPayload = {
  constructedMessage: Message
  needGenerating?: boolean
  onUserMessageReady?: () => void
}

export type InputBoxRef = {
  setQuote: (quote: string) => void
}

export type InputBoxProps = {
  sessionId?: string
  sessionType?: SessionType
  generating?: boolean
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
}

const InputBox = forwardRef<InputBoxRef, InputBoxProps>(
  (
    {
      sessionId,
      sessionType = 'chat',
      generating = false,
      model,
      fullWidth = false,
      onSelectModel,
      onSubmit,
      onStopGenerating,
      onStartNewThread,
      onRollbackThread,
      onClickSessionSettings,
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
    // One-shot first-use hint for the toolbar icon row (FABLE §9.3)
    const composerHintDismissed = useUIStore((s) => s.composerHintDismissed)
    const dismissComposerHint = useUIStore((s) => s.dismissComposerHint)
    const saveBlob = useSaveBlob()

    const currentSessionId = sessionId
    const isNewSession = currentSessionId === 'new'

    // Session-level web browsing mode
    const sessionWebBrowsingMap = useUIStore((s) => s.sessionWebBrowsingMap)
    const setSessionWebBrowsing = useUIStore((s) => s.setSessionWebBrowsing)
    const updateCurrentWebBrowsingDisplay = useUIStore((s) => s.updateCurrentWebBrowsingDisplay)
    // Get session-specific value, or use the local-only default.
    const webBrowsingMode = useMemo(() => {
      const sessionValue = sessionWebBrowsingMap[currentSessionId || 'new']
      if (sessionValue !== undefined) {
        return sessionValue
      }
      return false
    }, [sessionWebBrowsingMap, currentSessionId, model?.provider])

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
    const outerEnabledSkills = useEnabledSkills()
    const [hasTextContent, setHasTextContent] = useState(false)
    const draftMessageIdRef = useRef<string | undefined>(undefined)

    const debouncedUpdateTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const resetHistoryIndexRef = useRef<() => void>(() => {})

    // Called only on real user typing (not programmatic setValue), to avoid resetting history navigation
    const onUserInput = useCallback(() => {
      resetHistoryIndexRef.current()
    }, [])

    const onMessageInputValueChange = useCallback((value: string) => {
      latestInputRef.current = value
      const hasContent = value.trim().length > 0
      setHasTextContent((prev) => {
        if (prev === hasContent) return prev
        return hasContent
      })
      // Schedule debounced pre-constructed message update
      clearTimeout(debouncedUpdateTimerRef.current)
      debouncedUpdateTimerRef.current = setTimeout(() => flushRef.current(), 300)
    }, [])

    // Pre-constructed message state (scoped by session)
    const [preConstructedMessage, setPreConstructedMessage] = useAtom(
      atoms.inputBoxPreConstructedMessageFamily(currentSessionId || 'new')
    )
    const preConstructedMessageRef = useRef(preConstructedMessage)
    preConstructedMessageRef.current = preConstructedMessage
    const activeFilePreprocessingKeysRef = useRef(new Set<string>())
    const inputFileKeyByFileRef = useRef(new WeakMap<File, string>())
    useEffect(() => {
      draftMessageIdRef.current = preConstructedMessage.draftMessageId
    }, [preConstructedMessage.draftMessageId])
    const pictureKeys = preConstructedMessage.pictureKeys || []
    const attachments = preConstructedMessage.attachments || []

    const { session: currentSession } = useSession(sessionId || null)
    const { sessionSettings: currentSessionMergedSettings } = useSessionSettings(sessionId || null)

    // Get current messages for token counting - will only recalculate when stable messages actually change
    // Uses getContextMessageIds to respect compaction points
    const currentContextMessageIds = useMemo(() => {
      if (isNewSession) return null
      if (!currentSession?.messages.length) return null

      return getContextMessageIds(currentSession, currentSessionMergedSettings?.maxContextMessageCount)
    }, [isNewSession, currentSessionMergedSettings?.maxContextMessageCount, currentSession])

    const { knowledgeBase, setKnowledgeBase } = useKnowledgeBase({ isNewSession })

    const [showCompressionModal, setShowCompressionModal] = useState(false)

    const [links, setLinks] = useAtom(atoms.inputBoxLinksFamily(currentSessionId || 'new'))
    const [isSubmitting, setIsSubmitting] = useState(false)
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
        preConstructedMessage.preprocessedLinks
      )
      setPreConstructedMessage((prev) => ({
        ...prev,
        text,
        pictureKeys,
        attachments,
        links,
        message: constructedMessage,
      }))
    }, [
      preConstructedMessage.draftMessageId,
      pictureKeys,
      attachments,
      links,
      preConstructedMessage.preprocessedFiles,
      preConstructedMessage.preprocessedLinks,
      setPreConstructedMessage,
    ])

    const flushRef = useRef(flushPreConstructedMessage)
    flushRef.current = flushPreConstructedMessage

    // When non-text deps change (pictures, attachments, links), flush immediately
    useEffect(() => {
      flushRef.current()
    }, [flushPreConstructedMessage])

    const pictureInputRef = useRef<HTMLInputElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    const isPreprocessing = useMemo(
      () => composerSubmit.isPreprocessingInProgress(preConstructedMessage.preprocessingStatus),
      [preConstructedMessage.preprocessingStatus]
    )
    const hasPreprocessErrors = useMemo(
      () => composerSubmit.hasPreprocessingErrors(preConstructedMessage.preprocessingStatus),
      [preConstructedMessage.preprocessingStatus]
    )
    const hasBlockedSessionRagFiles = useMemo(
      () => composerSubmit.hasBlockedSessionRagFiles(preConstructedMessage.preprocessedFiles),
      [preConstructedMessage.preprocessedFiles]
    )
    const hasSessionRetrievalFiles = useMemo(
      () => composerSubmit.hasSessionRetrievalFiles(preConstructedMessage.preprocessedFiles),
      [preConstructedMessage.preprocessedFiles]
    )
    const hasLargeAttachmentWarning = useMemo(
      () =>
        composerSubmit.hasLargeAttachmentWarning(
          preConstructedMessage.preprocessedFiles,
          sessionHelpers.SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING
        ),
      [preConstructedMessage.preprocessedFiles]
    )

    const disableSubmit = useMemo(
      () => composerSubmit.computeDisableSubmit({ hasTextContent, links, attachments, pictureKeys }),
      [hasTextContent, links, attachments, pictureKeys]
    )

    const { providers } = useProviders()
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
    const { data: preprocessedAttachmentStates = [] } = useQuery<SessionAttachment[]>({
      queryKey: [
        'input-box-session-attachment-rag-attachments',
        ...preprocessedSessionAttachmentIds.sort((a, b) => a - b),
      ],
      queryFn: () => {
        if (platform.type !== 'desktop' || preprocessedSessionAttachmentIds.length === 0) {
          return []
        }
        return platform.getSessionAttachmentRagController().getAttachments(preprocessedSessionAttachmentIds)
      },
      enabled: platform.type === 'desktop' && preprocessedSessionAttachmentIds.length > 0,
      refetchInterval: (query): number | false => {
        const attachments = (query.state.data as SessionAttachment[] | undefined) ?? []
        return attachments.some(
          (attachment) => attachment.indexStatus === 'pending' || attachment.indexStatus === 'indexing'
        )
          ? 1500
          : false
      },
    })
    const preprocessedAttachmentIndexStatusMap = useMemo(
      () => new Map(preprocessedAttachmentStates.map((attachment) => [attachment.id, attachment.indexStatus])),
      [preprocessedAttachmentStates]
    )
    const preprocessedAttachmentErrorMap = useMemo(
      () => new Map(preprocessedAttachmentStates.map((attachment) => [attachment.id, attachment.error])),
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
    useEffect(() => {
      if (preprocessedAttachmentStates.length === 0) {
        return
      }
      setPreConstructedMessage((prev) => {
        const result = mergeSessionAttachmentStatesIntoFiles(prev.preprocessedFiles, preprocessedAttachmentStates)
        return result.changed ? { ...prev, preprocessedFiles: result.files } : prev
      })
    }, [preprocessedAttachmentStates, setPreConstructedMessage])
    const modelSelectorDisplayText = useMemo(() => resolveModelDisplayText(providers, model, t), [providers, model, t])

    // Get model info for context window
    const modelInfo = useMemo(() => {
      if (!model) return null
      return findProviderModelInfo(providers, model)
    }, [providers, model])

    // Check if model supports tool use for files
    const { data: modelSupportToolUseForFile = false, isFetched: isModelToolCapabilityFetched } = useQuery({
      queryKey: ['model-tool-capability', model?.provider, model?.modelId],
      queryFn: async () => {
        if (!model?.provider || !model?.modelId) {
          return false
        }

        try {
          const globalSettings = settingsStore.getState().getSettings()
          const configs = await platform.getConfig()
          const dependencies = await createModelDependencies()

          const settings = {
            provider: model.provider,
            modelId: model.modelId,
            ...currentSessionMergedSettings,
          }

          const modelInstance = getModel(settings, globalSettings, configs, dependencies)
          return modelInstance.isSupportToolUse('read-file')
        } catch (e) {
          console.debug('useModelToolCapability: failed to check capability', e)
          return false
        }
      },
      enabled: !!(model?.provider && model?.modelId),
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    })
    const showSessionRetrievalToolWarning =
      hasSessionRetrievalFiles && isModelToolCapabilityFetched && !modelSupportToolUseForFile

    // Calculate token counts using unified cache layer
    const { contextTokens, currentInputTokens, totalTokens, isCalculating, pendingTasks, messageCount } =
      useContextTokens({
        sessionId: currentSessionId || null,
        session: currentSession,
        settings: currentSessionMergedSettings || {},
        model,
        modelSupportToolUseForFile,
        constructedMessage: preConstructedMessage.message,
      })

    const globalSettings = useSettingsStore((state) => state)
    const [isCompacting, setIsCompacting] = useState(false)

    const compactionUIStateMap = useAtomValue(compactionUIStateMapAtom)
    const isCompactionRunning = useMemo(() => {
      if (!currentSessionId || isNewSession) return false
      return compactionUIStateMap[currentSessionId]?.status === 'running'
    }, [compactionUIStateMap, currentSessionId, isNewSession])

    const autoCompactionEnabled = useMemo(() => {
      if (!currentSession) return globalSettings.autoCompaction ?? true
      return isAutoCompactionEnabled(currentSession.settings, globalSettings)
    }, [currentSession, globalSettings])

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
        await chatStore.updateSession(currentSessionId, (session) => {
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

    const [showSelectModelErrorTip, setShowSelectModelErrorTip] = useState(false)
    // 没有配置任何 provider 时，“请选择模型”提示改为指向 provider 设置（FABLE §9.4 的死胡同修复）
    const hasProvider = useHasConfiguredProvider()
    useEffect(() => {
      if (showSelectModelErrorTip) {
        const clickEventListener = () => {
          setShowSelectModelErrorTip(false)
          document.removeEventListener('click', clickEventListener)
        }
        document.addEventListener('click', clickEventListener)
        return () => {
          document.removeEventListener('click', clickEventListener)
        }
      }
    }, [showSelectModelErrorTip])

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
    const handleSubmitRef = useRef<(needGenerating?: boolean, options?: SubmitOptions) => void>(() => {})
    const getPreviousHistoryInputRef = useRef(getPreviousHistoryInput)
    getPreviousHistoryInputRef.current = getPreviousHistoryInput
    const getNextHistoryInputRef = useRef(getNextHistoryInput)
    getNextHistoryInputRef.current = getNextHistoryInput
    const insertFilesRef = useRef<(files: File[]) => void>(() => {})
    const insertLinksRef = useRef<(urls: string[]) => void>(() => {})

    const closeSelectModelErrorTipCb = useRef<NodeJS.Timeout>()
    const handleSubmit = async (needGenerating = true, options: SubmitOptions = {}) => {
      if (
        composerSubmit.isSubmitBlocked({
          disableSubmit,
          isPreprocessing,
          isSubmitting,
          hasPreprocessErrors,
          hasBlockedSessionRagFiles,
        }) ||
        generating
      ) {
        return
      }

      // 未选择模型时 显示error tip
      if (!model) {
        // 如果不延时执行，会导致error tip 立即消失
        await delay(100)
        if (closeSelectModelErrorTipCb.current) {
          clearTimeout(closeSelectModelErrorTipCb.current)
        }
        setShowSelectModelErrorTip(true)
        closeSelectModelErrorTipCb.current = setTimeout(() => setShowSelectModelErrorTip(false), 5000)
        return
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
        if (platform.type === 'desktop' && submitSessionAttachmentIds.length > 0) {
          const latestAttachmentStates = await platform
            .getSessionAttachmentRagController()
            .getAttachments(submitSessionAttachmentIds)
          const result = mergeSessionAttachmentStatesIntoFiles(preprocessedFilesForSubmit, latestAttachmentStates)
          preprocessedFilesForSubmit = result.files
          if (result.changed) {
            setPreConstructedMessage((prev) => ({ ...prev, preprocessedFiles: result.files }))
          }
        }
        const unreadySessionAttachments = composerSubmit.selectUnreadySessionAttachments(preprocessedFilesForSubmit)
        if (unreadySessionAttachments.length > 0 && !options.allowUnreadySessionAttachments) {
          setUnreadyAttachmentSubmitPrompt({ opened: true, count: unreadySessionAttachments.length })
          return
        }

        // Deterministic skill invocation: strip a leading `/skill-name args` so the
        // sent text is just the args; the skill itself is recorded on the message.
        const slash = parseSlashInvocation(
          latestInputRef.current,
          outerEnabledSkills.map((s) => s.name)
        )
        const submitText = slash ? slash.cleanText : latestInputRef.current
        const invokedSkills = slash ? [slash.invocation] : []

        // Build the message with the latest input text, bypassing debounce delay
        const latestMessage = sessionHelpers.constructUserMessage(
          preConstructedMessage.draftMessageId,
          submitText,
          pictureKeys,
          preprocessedFilesForSubmit,
          preConstructedMessage.preprocessedLinks,
          invokedSkills
        )
        if (!latestMessage) {
          console.error('No constructed message available')
          return
        }

        const messageTextForHistory = latestMessage.contentParts.find((p) => p.type === 'text')?.text || ''

        const params = {
          constructedMessage: latestMessage,
          needGenerating,
          onUserMessageReady: () => {
            messageInputFieldRef.current?.clearDraft()
            setLinks([])
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
            if (messageTextForHistory) {
              addInputBoxHistory(messageTextForHistory)
            }
          },
        }

        await onSubmit?.(params)

        trackingEvent('send_message', { event_category: 'user' })
      } catch (e) {
        console.error('Error submitting message:', e)
        toastActions.add((e as Error)?.message || t('An error occurred while sending the message.'))
      } finally {
        setIsSubmitting(false)
      }
    }
    handleSubmitRef.current = handleSubmit

    const onKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const currentInput = latestInputRef.current
        const inputElement = messageInputFieldRef.current?.getElement()
        const action = resolveComposerKeyAction(event, {
          sendShortcut: shortcuts.inputBoxSendMessage,
          sendWithoutResponseShortcut: shortcuts.inputBoxSendMessageWithoutResponse,
          isInputFocused: !!inputElement && inputElement === document.activeElement,
          isEmptyOrFullySelected: currentInput.length === 0 || window.getSelection()?.toString() === currentInput,
        })

        switch (action.type) {
          case 'send':
            event.preventDefault()
            handleSubmitRef.current()
            return
          case 'send-without-response':
            event.preventDefault()
            handleSubmitRef.current(false)
            return
          case 'history-prev': {
            // Arrow-up: recall the previous input from history.
            event.preventDefault()
            const previousInput = getPreviousHistoryInputRef.current()
            if (previousInput !== undefined) {
              messageInputFieldRef.current?.setValue(previousInput)
              setTimeout(() => inputElement?.select(), 10)
            }
            return
          }
          case 'history-next': {
            // Arrow-down: recall the next input from history.
            event.preventDefault()
            const nextInput = getNextHistoryInputRef.current()
            if (nextInput !== undefined) {
              messageInputFieldRef.current?.setValue(nextInput)
              setTimeout(() => inputElement?.select(), 10)
            }
            return
          }
          case 'blur':
            // Prevent Chromium's native Escape behaviour which reverts textarea
            // value to its defaultValue, causing controlled-input state to desync.
            event.preventDefault()
            messageInputFieldRef.current?.getElement()?.blur()
            return
          default:
            return
        }
      },
      [shortcuts, isSmallScreen]
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

    // ----- Preprocessing helpers -----
    const startLinkPreprocessing = (url: string) => {
      // 设置为处理中状态
      setPreConstructedMessage((prev) => markLinkProcessing(prev, url))

      // 异步预处理链接，失败时标记为 error，并吞掉异常避免 Promise.all reject
      const preprocessPromise = sessionHelpers
        .preprocessLink(url, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then((preprocessedLink) => {
          setPreConstructedMessage((prev) => onLinkProcessed(prev, url, preprocessedLink, 6))
        })
        .catch((error) => {
          setPreConstructedMessage((prev) =>
            onLinkProcessed(
              prev,
              url,
              {
                url,
                title: '',
                content: '',
                storageKey: '',
                error: (error as Error)?.message || 'Failed to preprocess the link.',
              },
              6
            )
          )
        })

      // Store the promise
      setPreConstructedMessage((prev) => storeLinkPromise(prev, url, preprocessPromise))
    }

    const startFilePreprocessing = (file: File) => {
      const fileKey = StorageKeyGenerator.fileUniqKey(file)
      inputFileKeyByFileRef.current.set(file, fileKey)
      activeFilePreprocessingKeysRef.current.add(fileKey)

      // 异步预处理文件，失败时标记为 error，并吞掉异常避免 Promise.all reject
      return sessionHelpers
        .prepareFileAttachment(file, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then(async (preprocessedFile) => {
          if (!activeFilePreprocessingKeysRef.current.has(fileKey)) {
            return
          }

          let nextPreprocessedFile: PreprocessedFile = { ...preprocessedFile, inputFileKey: fileKey }
          if (platform.type === 'desktop') {
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
                inputFileKey: fileKey,
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

    const insertLinks = (urls: string[]) => {
      const plan = planLinkInsertion(links, urls)
      setLinks(plan.links)

      if (plan.droppedSome) {
        toastActions.add(
          t('Only the first {{limit}} links can be attached. The extra links were skipped.', { limit: MAX_LINKS })
        )
      }

      for (const url of plan.urlsToPreprocess) {
        startLinkPreprocessing(url)
      }
    }

    const insertFiles = async (files: File[]) => {
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
              t(
                'Chat attachments must be {{limit}} or smaller. Please upload larger documents through Knowledge Base.',
                {
                  limit: KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL,
                }
              )
            )
            continue
          }

          // Check if file type is supported
          if (!isSupportedFile(file.name)) {
            toastActions.add(getUnsupportedFileMessage(getUnsupportedFileType(file.name), file.name, t))
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
              const preprocessPromise = startFilePreprocessing(file)
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
    insertLinksRef.current = insertLinks

    const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) {
        return
      }
      void insertFiles(Array.from(event.target.files))
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
              // 插入链接：如果复制的是链接，则插入链接
              item.getAsString((text) => {
                const raw = text.trim()
                if (raw.startsWith('http://') || raw.startsWith('https://')) {
                  const urls = raw
                    .split(/\s+/)
                    .map((url) => url.trim())
                    .filter((url) => url.startsWith('http://') || url.startsWith('https://'))
                  insertLinksRef.current(urls)
                }
                if (pasteLongTextAsAFile && raw.length > 3000) {
                  const file = new File([text], `pasted_text_${Date.now()}.txt`, {
                    type: 'text/plain',
                  })
                  insertFilesRef.current([file])
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

    const handleAttachLink = async () => {
      const links: string[] = await NiceModal.show('attach-link')
      if (links) {
        insertLinks(links)
      }
    }

    // 拖拽上传
    const { getRootProps, getInputProps } = useDropzone({
      onDrop: (acceptedFiles: File[], fileRejections) => {
        void insertFiles(acceptedFiles)
        // Show toast for rejected files
        if (fileRejections.length > 0) {
          const rejectedNames = fileRejections.map((r) => r.file.name).join(', ')
          toastActions.add(t('Unsupported file type: {{fileName}}', { fileName: rejectedNames }))
        }
      },
      accept: getFileAcceptConfig(),
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
        } else {
          setKnowledgeBase(pick(kb, 'id', 'name'))
        }
      },
      [knowledgeBase, setKnowledgeBase]
    )

    // Send button: the shared submit-blocked predicate plus a running compaction.
    // `generating` is intentionally excluded — while generating the button becomes "stop".
    const sendButtonBlocked =
      composerSubmit.isSubmitBlocked({
        disableSubmit,
        isPreprocessing,
        isSubmitting,
        hasPreprocessErrors,
        hasBlockedSessionRagFiles,
      }) || isCompactionRunning

    // Show deprecated notice for legacy picture sessions
    if (sessionType === 'picture') {
      return (
        <Box pt={0} pb={isSmallScreen ? 'md' : 'sm'} px="sm" id={dom.InputBoxID}>
          <Stack
            className={cn('rounded-2xl bg-workspaice-background-secondary', widthFull ? 'w-full' : 'max-w-4xl mx-auto')}
            gap="xs"
            p="md"
            align="center"
          >
            <Text size="sm" c="workspaice-tertiary" ta="center">
              {t('This image session is no longer active. Please use the new Image Creator for image generation.')}
            </Text>
            <Button variant="light" size="xs" onClick={() => navigate({ to: '/image-creator' })}>
              {t('Go to Image Creator')}
            </Button>
          </Stack>
        </Box>
      )
    }

    return (
      <Box pt={0} pb={isSmallScreen ? 'md' : 'sm'} px="sm" id={dom.InputBoxID} {...getRootProps()}>
        <input className="hidden" {...getInputProps()} />
        <Stack className={cn(widthFull ? 'w-full' : 'max-w-4xl mx-auto')} gap="xs">
          {currentSessionId && <CompactionStatus sessionId={currentSessionId} />}
          <Stack
            className={cn(
              'rounded-md bg-workspaice-background-secondary justify-between px-3 py-2',
              !isSmallScreen && 'min-h-[92px]'
            )}
            style={{ border: '1px solid var(--workspaice-border-primary)' }}
            gap="xs"
          >
            {/* Input Row */}
            <Flex align="flex-end" gap={4}>
              <MessageInputField
                ref={messageInputFieldRef}
                isNewSession={isNewSession}
                isSmallScreen={isSmallScreen}
                viewportHeight={viewportHeight}
                isReadOnly={isCompactionRunning}
                placeholder={t('Type your question here...') || ''}
                autoFocus={!isSmallScreen}
                onValueChange={onMessageInputValueChange}
                onUserInput={onUserInput}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />

              {/* Send Button */}
              <ActionIcon
                disabled={sendButtonBlocked && !generating}
                size={32}
                variant="filled"
                color={generating ? 'dark' : 'workspaice-brand'}
                radius="xl"
                aria-label={generating ? t('Stop generating') : t('Send')}
                onClick={generating ? onStopGenerating : () => handleSubmit()}
                className={cn('shrink-0 mb-1', !generating && sendButtonBlocked && 'disabled:!opacity-100 !text-white')}
                style={
                  !generating && sendButtonBlocked
                    ? { backgroundColor: 'var(--workspaice-background-disabled)' }
                    : undefined
                }
              >
                {generating ? (
                  <ScalableIcon icon={IconPlayerStopFilled} size={16} />
                ) : (
                  <ScalableIcon icon={IconArrowUp} size={16} />
                )}
              </ActionIcon>
            </Flex>

            {(!!pictureKeys.length || !!attachments.length || !!links.length) && (
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
                    className="w-full rounded-md px-2.5 py-2 mb-1"
                    style={{
                      border: '1px solid var(--workspaice-border-primary)',
                      borderLeft: '3px solid var(--workspaice-tint-warning)',
                      background: 'var(--workspaice-background-primary)',
                    }}
                  >
                    <Box
                      className="flex items-center justify-center rounded-full shrink-0"
                      style={{
                        width: 20,
                        height: 20,
                        background: 'var(--workspaice-background-secondary)',
                        color: 'var(--workspaice-tint-warning)',
                      }}
                    >
                      <ScalableIcon icon={IconAlertCircle} size={14} />
                    </Box>
                    <Text size="xs" lh={1.35} c="workspaice-warning" className="min-w-0">
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
                    className="w-full rounded-md px-2.5 py-2 mb-1"
                    style={{
                      border: '1px solid var(--workspaice-border-primary)',
                      borderLeft: '3px solid var(--workspaice-tint-warning)',
                      background: 'var(--workspaice-background-primary)',
                    }}
                  >
                    <Box
                      className="flex items-center justify-center rounded-full shrink-0"
                      style={{
                        width: 20,
                        height: 20,
                        background: 'var(--workspaice-background-secondary)',
                        color: 'var(--workspaice-tint-warning)',
                      }}
                    >
                      <ScalableIcon icon={IconAlertCircle} size={14} />
                    </Box>
                    <Text size="xs" lh={1.35} c="workspaice-warning" className="min-w-0">
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
                  const fileKey = inputFileKeyByFileRef.current.get(file) ?? StorageKeyGenerator.fileUniqKey(file)
                  const preprocessedFile = preConstructedMessage.preprocessedFiles.find(
                    (f) => f.inputFileKey === fileKey || StorageKeyGenerator.fileUniqKey(f.file) === fileKey
                  )
                  const cardState = deriveAttachmentCardState({
                    fileStatus: preConstructedMessage.preprocessingStatus.files[fileKey],
                    preprocessedFile,
                    indexStatusMap: preprocessedAttachmentIndexStatusMap,
                    errorMap: preprocessedAttachmentErrorMap,
                    progressMap: preprocessedAttachmentProgressMap,
                    t,
                  })
                  return (
                    <FileMiniCard
                      key={fileKey}
                      name={file.name}
                      fileType={file.type}
                      status={cardState.cardStatus}
                      statusText={cardState.statusText}
                      progressValue={cardState.progressValue}
                      isTakingLong={cardState.isTakingLong}
                      errorMessage={cardState.errorMessage}
                      onErrorClick={() => {
                        const errorCode = cardState.errorMessage
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
                              void NiceModal.show('content-viewer', {
                                title: `${t('File Content')}: ${file.name}`,
                                storageKey: preprocessedFile.storageKey,
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
                        if (platform.type === 'desktop' && preprocessedFile?.sessionAttachmentId) {
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
                {links?.map((link) => {
                  const linkKey = StorageKeyGenerator.linkUniqKey(link.url)
                  const status = preConstructedMessage.preprocessingStatus.links[linkKey]
                  const preprocessedLink = preConstructedMessage.preprocessedLinks.find(
                    (l) => StorageKeyGenerator.linkUniqKey(l.url) === linkKey
                  )
                  return (
                    <LinkMiniCard
                      key={linkKey}
                      url={link.url}
                      status={status}
                      errorMessage={preprocessedLink?.error}
                      onErrorClick={() => {
                        if (preprocessedLink?.error) {
                          void NiceModal.show('file-parse-error', {
                            errorCode: preprocessedLink.error,
                            fileName: link.url,
                          })
                        }
                      }}
                      onDelete={() => {
                        setLinks(links.filter((l) => l.url !== link.url))
                        setPreConstructedMessage((prev) => cleanupLink(prev, link.url))
                      }}
                    />
                  )
                })}
              </Flex>
            )}

            {/* First-use hint for the toolbar icon row (FABLE §9.3); dismissed once, persisted */}
            {!composerHintDismissed && (
              <Flex
                align="center"
                gap={8}
                className="rounded-md px-2.5 py-1.5"
                style={{ background: 'var(--workspaice-background-brand-secondary)' }}
              >
                <Text size="xs" c="dimmed" lh={1.35} className="min-w-0 flex-1">
                  {t(
                    'Tip: the toolbar below attaches files and images, toggles web search, and picks the model for this chat.'
                  )}
                </Text>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t('Dismiss hint')}
                  onClick={dismissComposerHint}
                >
                  <ScalableIcon icon={IconX} size={14} />
                </ActionIcon>
              </Flex>
            )}

            {/* Toolbar Row */}
            <Flex align="center" gap={0} className="shrink-0 w-full" justify="space-between">
              {/* Hidden file inputs */}
              <ImageUploadInput ref={pictureInputRef} onChange={onFileInputChange} />
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={onFileInputChange}
                multiple
                accept={getFileAcceptString()}
              />

              {/* Left Group: Tool Buttons */}
              <Flex align="center" gap={0}>
                <AttachmentMenu
                  onImageUploadClick={onImageUploadClick}
                  onFileUploadClick={onFileUploadClick}
                  handleAttachLink={handleAttachLink}
                  t={t}
                />

                {featureFlags.mcp && (
                  <MCPMenu>
                    {(enabledTools) => (
                      <UnstyledButton
                        aria-label={t('Tools')}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors"
                      >
                        <IconHammer
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className={
                            enabledTools > 0
                              ? 'text-[var(--workspaice-tint-brand)]'
                              : 'text-[var(--workspaice-tint-secondary)]'
                          }
                        />
                        {enabledTools > 0 && (
                          <Text size="xs" className="text-[var(--workspaice-tint-brand)]">
                            {enabledTools}
                          </Text>
                        )}
                      </UnstyledButton>
                    )}
                  </MCPMenu>
                )}

                {featureFlags.knowledgeBase && !isSmallScreen && (
                  <KnowledgeBaseMenu currentKnowledgeBaseId={knowledgeBase?.id} onSelect={handleKnowledgeBaseSelect}>
                    <UnstyledButton
                      aria-label={t('Knowledge Base')}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors"
                    >
                      <IconVocabulary
                        size={toolbarIconSize}
                        strokeWidth={1.8}
                        className={
                          knowledgeBase
                            ? 'text-[var(--workspaice-tint-brand)]'
                            : 'text-[var(--workspaice-tint-secondary)]'
                        }
                      />
                    </UnstyledButton>
                  </KnowledgeBaseMenu>
                )}

                <Tooltip label={t('Web Search')} position="top" withArrow disabled={isSmallScreen}>
                  <UnstyledButton
                    aria-label={t('Web Search')}
                    onClick={() => {
                      setWebBrowsingMode(!webBrowsingMode)
                      dom.focusMessageInput()
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors"
                  >
                    <IconWorldWww
                      size={toolbarIconSize}
                      strokeWidth={1.8}
                      className={
                        webBrowsingMode
                          ? 'text-[var(--workspaice-tint-brand)]'
                          : 'text-[var(--workspaice-tint-secondary)]'
                      }
                    />
                  </UnstyledButton>
                </Tooltip>

                {!isSmallScreen &&
                  (showRollbackThreadButton ? (
                    <Tooltip label={t('Rollback Thread')} position="top" withArrow>
                      <UnstyledButton
                        aria-label={t('Rollback Thread')}
                        onClick={rollbackThread}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors"
                      >
                        <IconArrowBackUp
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--workspaice-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Tooltip>
                  ) : (
                    <Tooltip label={t('New Thread')} position="top" withArrow>
                      <UnstyledButton
                        aria-label={t('New Thread')}
                        onClick={startNewThread}
                        disabled={!onStartNewThread}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors disabled:opacity-50"
                      >
                        <IconFilePencil
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--workspaice-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Tooltip>
                  ))}

                {!isSmallScreen && (
                  <Tooltip label={t('Conversation Settings')} position="top" withArrow>
                    <UnstyledButton
                      aria-label={t('Conversation Settings')}
                      onClick={onClickSessionSettings}
                      disabled={!onClickSessionSettings}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors disabled:opacity-50"
                    >
                      <IconAdjustmentsHorizontal
                        size={toolbarIconSize}
                        strokeWidth={1.8}
                        className="text-[var(--workspaice-tint-secondary)]"
                      />
                    </UnstyledButton>
                  </Tooltip>
                )}

                {/* Mobile: Settings menu */}
                {isSmallScreen && (
                  <Menu
                    trigger="click"
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
                        aria-label={t('Settings')}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors"
                      >
                        <IconSettings
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--workspaice-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<ScalableIcon icon={IconPlus} size={16} />} onClick={startNewThread}>
                        {t('New Thread')}
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<ScalableIcon icon={IconAdjustmentsHorizontal} size={16} />}
                        onClick={onClickSessionSettings}
                      >
                        {t('Conversation Settings')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Flex>

              {/* Right Group: Token Count + Model Selector */}
              <Flex align="center" gap={0} className="min-w-0 ml-auto">
                <TokenCountMenu
                  currentInputTokens={currentInputTokens}
                  contextTokens={contextTokens}
                  totalTokens={totalTokens}
                  isCalculating={isCalculating}
                  pendingTasks={pendingTasks}
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
                  <UnstyledButton
                    aria-label={t('Estimated Token Usage')}
                    className={`flex items-center gap-0.5 shrink-0 text-xs cursor-pointer hover:text-workspaice-tint-secondary transition-colors px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] ${
                      tokenPercentage && tokenPercentage > 80
                        ? 'text-[var(--workspaice-tint-error)]'
                        : 'text-workspaice-tint-tertiary'
                    }`}
                  >
                    <ScalableIcon icon={IconArrowUp} size={14} />
                    {isCalculating && <Loader size={10} />}
                    <Text span size="xs" className="whitespace-nowrap" c="inherit">
                      {isCalculating ? '~' : ''}
                      {formatNumber(totalTokens)}
                      {tokenPercentage !== null && tokenPercentage > 10 && ` (${tokenPercentage}%)`}
                    </Text>
                  </UnstyledButton>
                </TokenCountMenu>

                {/* Model Selector */}
                <Box className="min-w-0 flex-1 justify-end max-w-[200px]">
                  <Tooltip
                    label={
                      <Flex align="center" c="white" gap="xxs" min-w-0>
                        <ScalableIcon icon={IconAlertCircle} size={12} className="text-inherit" />
                        <Text span size="xxs" c="white">
                          {hasProvider
                            ? t('Please select a model')
                            : t('No AI provider configured yet — click here to set one up')}
                        </Text>
                      </Flex>
                    }
                    color="dark"
                    opened={showSelectModelErrorTip}
                    withArrow
                  >
                    <ModelSelector
                      onSelect={onSelectModel}
                      selectedProviderId={model?.provider}
                      selectedModelId={model?.modelId}
                      position="top-end"
                      transitionProps={{
                        transition: 'fade-up',
                        duration: 200,
                      }}
                    >
                      <UnstyledButton
                        className={cn(
                          'flex min-w-0 max-w-full items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors',
                          !model && 'animate-pulse bg-[var(--workspaice-background-brand-secondary-hover)]'
                        )}
                      >
                        {!!model && <ProviderImageIcon size={18} provider={model.provider} />}
                        <Text
                          size="sm"
                          className={cn(
                            'min-w-0 flex-1 truncate text-[var(--workspaice-tint-secondary)]',
                            isSmallScreen ? 'max-w-[100px]' : 'max-w-[160px]'
                          )}
                        >
                          {modelSelectorDisplayText}
                        </Text>
                        <IconChevronRight
                          size={14}
                          className="text-[var(--workspaice-tint-tertiary)] rotate-90 flex-shrink-0"
                        />
                      </UnstyledButton>
                    </ModelSelector>
                  </Tooltip>
                </Box>
              </Flex>
            </Flex>
          </Stack>

          {/* Only surface the AI-accuracy disclaimer while the session is empty (FABLE §9.5) */}
          {(isNewSession || !currentSession?.messages?.length) && <Disclaimer />}
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
  handleAttachLink: () => void
  t: (key: string) => string
}> = ({ onImageUploadClick, onFileUploadClick, handleAttachLink, t }) => {
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
          aria-label={t('Add Attachment')}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--workspaice-background-tertiary)] transition-colors"
        >
          <IconCirclePlus
            size={toolbarIconSize}
            strokeWidth={1.8}
            className="text-[var(--workspaice-tint-secondary)]"
          />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPhoto size={16} />} onClick={onImageUploadClick}>
          {t('Attach Image')}
        </Menu.Item>
        <Menu.Item leftSection={<IconFolder size={16} />} onClick={onFileUploadClick}>
          {t('Select File')}
        </Menu.Item>
        <Menu.Item leftSection={<IconLink size={16} />} onClick={handleAttachLink}>
          {t('Attach Link')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

// Memoize the InputBox component to prevent unnecessary re-renders during streaming
export default memo(InputBox)
