import NiceModal from '@ebay/nice-modal-react'
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Loader,
  Menu,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useViewportSize } from '@mantine/hooks'
import {
  getFileAcceptConfig,
  getFileAcceptString,
  getUnsupportedFileType,
  isSupportedFile,
} from '@shared/file-extensions'
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
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAtom, useAtomValue } from 'jotai'
import _, { pick } from 'lodash'
import type React from 'react'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { createModelDependencies } from '@/adapters'
import useInputBoxHistory from '@/hooks/useInputBoxHistory'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useMessageInput } from '@/hooks/useMessageInput'
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
import platform from '@/platform'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as atoms from '@/stores/atoms'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'
import * as chatStore from '@/stores/chatStore'
import { useSession, useSessionSettings } from '@/stores/chatStore'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { delay } from '@/utils'
import { featureFlags } from '@/utils/feature-flags'
import { trackEvent } from '@/utils/track'
import {
  type KnowledgeBase,
  type Message,
  ModelProviderEnum,
  type SessionType,
  type ShortcutSendValue,
} from '../../../shared/types'
import * as dom from '../../hooks/dom'
import * as sessionHelpers from '../../stores/sessionHelpers'
import * as toastActions from '../../stores/toastActions'
import { CompactionStatus } from '../chat/CompactionStatus'
import { CompressionModal } from '../common/CompressionModal'
import { ScalableIcon } from '../common/ScalableIcon'
import Disclaimer from '../Disclaimer'
import ProviderImageIcon from '../icons/ProviderImageIcon'
import KnowledgeBaseMenu from '../knowledge-base/KnowledgeBaseMenu'
import ModelSelector from '../ModelSelector'
import MCPMenu from '../mcp/MCPMenu'
import { FileMiniCard, ImageMiniCard, LinkMiniCard } from './Attachments'
import { ImageUploadInput } from './ImageUploadInput'
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
    const saveBlob = useSaveBlob()

    const currentSessionId = sessionId
    const isNewSession = currentSessionId === 'new'

    // Session-level web browsing mode
    const sessionWebBrowsingMap = useUIStore((s) => s.sessionWebBrowsingMap)
    const setSessionWebBrowsing = useUIStore((s) => s.setSessionWebBrowsing)
    const updateCurrentWebBrowsingDisplay = useUIStore((s) => s.updateCurrentWebBrowsingDisplay)
    // Get session-specific value, or use default based on provider (ChatboxAI defaults to true)
    const webBrowsingMode = useMemo(() => {
      const sessionValue = sessionWebBrowsingMap[currentSessionId || 'new']
      if (sessionValue !== undefined) {
        return sessionValue
      }
      // Default: true for ChatboxAI, false for others
      return model?.provider === ModelProviderEnum.ChatboxAI
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

    const { messageInput, setMessageInput, clearDraft } = useMessageInput('', { isNewSession })

    // Pre-constructed message state (scoped by session)
    const [preConstructedMessage, setPreConstructedMessage] = useAtom(
      atoms.inputBoxPreConstructedMessageFamily(currentSessionId || 'new')
    )
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

    useEffect(() => {
      const constructedMessage = sessionHelpers.constructUserMessage(
        messageInput,
        pictureKeys,
        preConstructedMessage.preprocessedFiles,
        preConstructedMessage.preprocessedLinks
      )
      setPreConstructedMessage((prev) => ({
        ...prev,
        text: messageInput,
        pictureKeys,
        attachments,
        links,
        message: constructedMessage,
      }))
    }, [
      messageInput,
      pictureKeys,
      attachments,
      links,
      preConstructedMessage.preprocessedFiles,
      preConstructedMessage.preprocessedLinks,
      setPreConstructedMessage,
    ])

    const pictureInputRef = useRef<HTMLInputElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // Check if any preprocessing is in progress
    const isPreprocessing = useMemo(() => {
      const hasProcessingFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'processing'
      )
      const hasProcessingLinks = Object.values(preConstructedMessage.preprocessingStatus.links || {}).some(
        (status) => status === 'processing'
      )
      return hasProcessingFiles || hasProcessingLinks
    }, [preConstructedMessage.preprocessingStatus])

    // Check if any preprocessing has errors
    const hasPreprocessErrors = useMemo(() => {
      const hasErrorFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'error'
      )
      const hasErrorLinks = Object.values(preConstructedMessage.preprocessingStatus.links || {}).some(
        (status) => status === 'error'
      )
      return hasErrorFiles || hasErrorLinks
    }, [preConstructedMessage.preprocessingStatus])

    const disableSubmit = useMemo(
      () => !(messageInput.trim() || links?.length || attachments?.length || pictureKeys?.length),
      [messageInput, links, attachments, pictureKeys]
    )

    const { providers } = useProviders()
    const modelSelectorDisplayText = useMemo(() => {
      if (!model) {
        return t('Select Model')
      }
      const providerInfo = providers.find((p) => p.id === model.provider)

      const modelInfo = (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find(
        (m) => m.modelId === model.modelId
      )
      return `${modelInfo?.nickname || model.modelId}`
    }, [providers, model, t])

    // Get model info for context window
    const modelInfo = useMemo(() => {
      if (!model) return null
      const providerInfo = providers.find((p) => p.id === model.provider)
      return (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find((m) => m.modelId === model.modelId)
    }, [providers, model])

    // Check if model supports tool use for files
    const { data: modelSupportToolUseForFile = false } = useQuery({
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

    const inputRef = useRef<HTMLTextAreaElement | null>(null)

    useImperativeHandle(
      ref,
      () => ({
        // 暂时并没有用到，还是使用了之前atom的方案
        setQuote: (data) => {
          setMessageInput((prev) => `${prev}\n\n${data}`)
          dom.focusMessageInput()
          dom.setMessageInputCursorToEnd()
        },
      }),
      [setMessageInput]
    )

    const { addInputBoxHistory, getPreviousHistoryInput, getNextHistoryInput, resetHistoryIndex } = useInputBoxHistory()

    const closeSelectModelErrorTipCb = useRef<NodeJS.Timeout>()
    const handleSubmit = async (needGenerating = true) => {
      if (disableSubmit || generating || isSubmitting || isPreprocessing) {
        return
      }

      // 有解析失败的文件或链接时，阻止发送并显示 toast
      if (hasPreprocessErrors) {
        toastActions.add(t('Some files failed to parse. Please remove them and try again.'))
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

      setIsSubmitting(true)
      try {
        // Use the already constructed message
        if (!preConstructedMessage.message) {
          console.error('No constructed message available')
          return
        }

        const messageTextForHistory =
          preConstructedMessage.message.contentParts.find((p) => p.type === 'text')?.text || ''

        const params = {
          constructedMessage: preConstructedMessage.message,
          needGenerating,
          onUserMessageReady: () => {
            clearDraft()
            setLinks([])
            setPreConstructedMessage({
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
            if (platform.type !== 'mobile' && messageTextForHistory) {
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

    const onMessageInput = useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const input = event.target.value
        setMessageInput(input)
        resetHistoryIndex()
      },
      [setMessageInput, resetHistoryIndex]
    )

    const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isPressedHash: Record<ShortcutSendValue, boolean> = {
        '': false,
        Enter: event.keyCode === 13 && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey,
        'CommandOrControl+Enter': event.keyCode === 13 && (event.ctrlKey || event.metaKey) && !event.shiftKey,
        'Ctrl+Enter': event.keyCode === 13 && event.ctrlKey && !event.shiftKey,
        'Command+Enter': event.keyCode === 13 && event.metaKey,
        'Shift+Enter': event.keyCode === 13 && event.shiftKey,
        'Ctrl+Shift+Enter': event.keyCode === 13 && event.ctrlKey && event.shiftKey,
      }

      // 发送消息
      if (isPressedHash[shortcuts.inputBoxSendMessage]) {
        if (platform.type === 'mobile' && isSmallScreen && shortcuts.inputBoxSendMessage === 'Enter') {
          // 移动端点击回车不会发送消息
          return
        }
        event.preventDefault()
        handleSubmit()
        return
      }

      // 发送消息但不生成回复
      if (isPressedHash[shortcuts.inputBoxSendMessageWithoutResponse]) {
        event.preventDefault()
        handleSubmit(false)
        return
      }

      // 向上向下键翻阅历史消息
      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
        inputRef.current &&
        inputRef.current === document.activeElement && // 聚焦在输入框
        (messageInput.length === 0 || window.getSelection()?.toString() === messageInput) // 要么为空，要么输入框全选
      ) {
        event.preventDefault()
        if (event.key === 'ArrowUp') {
          const previousInput = getPreviousHistoryInput()
          if (previousInput !== undefined) {
            setMessageInput(previousInput)
            setTimeout(() => inputRef.current?.select(), 10)
          }
        } else if (event.key === 'ArrowDown') {
          const nextInput = getNextHistoryInput()
          if (nextInput !== undefined) {
            setMessageInput(nextInput)
            setTimeout(() => inputRef.current?.select(), 10)
          }
        }
      }

      // Prevent Chromium's native Escape behaviour which reverts textarea
      // value to its defaultValue, causing controlled-input state to desync.
      if (event.key === 'Escape') {
        event.preventDefault()
        inputRef.current?.blur()
      }
    }

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
      // 异步预处理文件，失败时标记为 error，并吞掉异常避免 Promise.all reject
      return sessionHelpers
        .preprocessFile(file, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then((preprocessedFile) => {
          setPreConstructedMessage((prev) => onFileProcessed(prev, file, preprocessedFile, 20))
        })
        .catch((error) => {
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
              20
            )
          )
        })
    }

    const insertLinks = (urls: string[]) => {
      let newLinks = [...(links || []), ...urls.map((u) => ({ url: u }))]
      newLinks = _.uniqBy(newLinks, 'url')
      newLinks = newLinks.slice(-6) // 最多插入 6 个链接
      setLinks(newLinks)

      // 预处理链接（只处理前6个）
      for (let i = 0; i < Math.min(urls.length, 6); i++) {
        const url = urls[i]
        const linkIndex = newLinks.findIndex((l) => l.url === url)

        if (linkIndex < 6) {
          startLinkPreprocessing(url)
        }
      }
    }

    const insertFiles = async (files: File[]) => {
      for (const file of files) {
        // 文件和图片插入方法复用，会导致 svg、gif 这类不支持的图片也被插入，但暂时没看到有什么问题
        if (file.type.startsWith('image/')) {
          const base64 = await picUtils.getImageBase64AndResize(file)
          const key = StorageKeyGenerator.picture('input-box')
          await saveBlob.mutateAsync({ key, value: base64 })
          setPreConstructedMessage((prev) => ({
            ...prev,
            pictureKeys: [...(prev.pictureKeys || []), key].slice(-8),
          })) // Maximum 8 images
        } else {
          // Check if file type is supported
          if (!isSupportedFile(file.name)) {
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
          setPreConstructedMessage((prev) => {
            const newAttachments = prev.attachments.find(
              (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
            )
              ? prev.attachments
              : [...(prev.attachments || []), file].slice(-20) // Maximum 20 attachments

            // Only preprocess first 20 files to avoid wasting resources
            const fileIndex = newAttachments.findIndex(
              (f) => f.name === file.name && f.lastModified === file.lastModified
            )
            if (fileIndex < 20) {
              const preprocessPromise = startFilePreprocessing(file)
              return {
                ...storeFilePromise(markFileProcessing(prev, file), file, preprocessPromise),
                attachments: newAttachments,
              }
            }

            return {
              ...prev,
              attachments: newAttachments,
            }
          })
        }
      }
    }

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

    const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (sessionType === 'picture') {
        return
      }
      if (event.clipboardData?.items) {
        // 对于 Doc/PPT/XLS 等文件中的内容，粘贴时一般会有 4 个 items，分别是 text 文本、html、某格式和图片
        // 因为 getAsString 为异步操作，无法根据 items 中的内容来定制不同的粘贴行为，因此这里选择了最简单的做法：
        // 保持默认的粘贴行为，这时候会粘贴从文档中复制的文本和图片。我认为应该保留图片，因为文档中的表格、图表等图片信息也很重要，很难通过文本格式来表述。
        // 仅在只粘贴图片或文件时阻止默认行为，防止插入文件或图片的名字
        let hasText = false
        for (let i = 0; i < event.clipboardData.items.length; i++) {
          const item = event.clipboardData.items[i]
          if (item.kind === 'file') {
            // Insert files and images
            const file = item.getAsFile()
            if (file) {
              insertFiles([file])
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
                insertLinks(urls)
              }
              if (pasteLongTextAsAFile && raw.length > 3000) {
                const file = new File([text], `pasted_text_${attachments?.length || 0}.txt`, {
                  type: 'text/plain',
                })
                insertFiles([file])
                setMessageInput(messageInput) // 删除掉默认粘贴进去的长文本
              }
            })
          }
        }
        // 如果没有任何文本，则说明只是复制了图片或文件。这里阻止默认行为，防止插入文件或图片的名字
        if (!hasText) {
          event.preventDefault()
        }
      }
    }

    const handleAttachLink = async () => {
      const links: string[] = await NiceModal.show('attach-link')
      if (links) {
        insertLinks(links)
      }
    }

    // 拖拽上传
    const { getRootProps, getInputProps } = useDropzone({
      onDrop: (acceptedFiles: File[], fileRejections) => {
        insertFiles(acceptedFiles)
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
        setMessageInput((val) => {
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
          trackEvent('knowledge_base_disabled', { knowledge_base_name: knowledgeBase?.name })
        } else {
          setKnowledgeBase(pick(kb, 'id', 'name'))
          trackEvent('knowledge_base_enabled', { knowledge_base_name: kb.name })
        }
      },
      [knowledgeBase, setKnowledgeBase]
    )

    // Show deprecated notice for legacy picture sessions
    if (sessionType === 'picture') {
      return (
        <Box pt={0} pb={isSmallScreen ? 'md' : 'sm'} px="sm" id={dom.InputBoxID}>
          <Stack
            className={cn('rounded-2xl bg-chatbox-background-secondary', widthFull ? 'w-full' : 'max-w-4xl mx-auto')}
            gap="xs"
            p="md"
            align="center"
          >
            <Text size="sm" c="chatbox-tertiary" ta="center">
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
              'rounded-md bg-chatbox-background-secondary justify-between px-3 py-2',
              !isSmallScreen && 'min-h-[92px]'
            )}
            style={{ border: '1px solid var(--chatbox-border-primary)' }}
            gap="xs"
          >
            {/* Input Row */}
            <Flex align="flex-end" gap={4}>
              <Textarea
                unstyled={true}
                classNames={{
                  root: 'flex-1',
                  wrapper: 'flex-1',
                  input:
                    'block w-full outline-none border-none px-2 py-1 resize-none bg-transparent text-chatbox-tint-primary leading-6',
                }}
                size="sm"
                id={dom.messageInputID}
                ref={inputRef}
                placeholder={t('Type your question here...') || ''}
                bg="transparent"
                autosize={true}
                minRows={2}
                maxRows={Math.max(4, Math.floor(viewportHeight / 100))}
                value={messageInput}
                autoFocus={!isSmallScreen}
                readOnly={isCompactionRunning}
                onChange={onMessageInput}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                data-testid="message-input"
              />

              {/* Send Button */}
              <ActionIcon
                disabled={(disableSubmit || isPreprocessing || isSubmitting || isCompactionRunning) && !generating}
                size={32}
                variant="filled"
                color={generating ? 'dark' : 'chatbox-brand'}
                radius="xl"
                onClick={generating ? onStopGenerating : () => handleSubmit()}
                className={cn(
                  'shrink-0 mb-1',
                  !generating &&
                    (disableSubmit || isPreprocessing || isSubmitting || isCompactionRunning) &&
                    'disabled:!opacity-100 !text-white'
                )}
                style={
                  !generating && (disableSubmit || isPreprocessing || isSubmitting || isCompactionRunning)
                    ? { backgroundColor: 'rgba(222, 226, 230, 1)' }
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
              <Flex align="center" wrap="wrap" onClick={() => dom.focusMessageInput()}>
                {pictureKeys?.map((picKey) => (
                  <ImageMiniCard key={picKey} storageKey={picKey} onDelete={() => onImageDeleteClick(picKey)} />
                ))}
                {attachments?.map((file) => {
                  const fileKey = StorageKeyGenerator.fileUniqKey(file)
                  const status = preConstructedMessage.preprocessingStatus.files[fileKey]
                  const preprocessedFile = preConstructedMessage.preprocessedFiles.find(
                    (f) => StorageKeyGenerator.fileUniqKey(f.file) === fileKey
                  )
                  return (
                    <FileMiniCard
                      key={fileKey}
                      name={file.name}
                      fileType={file.type}
                      status={status}
                      errorMessage={preprocessedFile?.error}
                      onErrorClick={() => {
                        if (preprocessedFile?.error) {
                          void NiceModal.show('file-parse-error', {
                            errorCode: preprocessedFile.error,
                            fileName: file.name,
                          })
                        }
                      }}
                      onDelete={() => {
                        // Cancel any ongoing MinerU parsing for this file
                        if (file.path && platform.cancelMineruParse) {
                          platform.cancelMineruParse(file.path).catch(() => {
                            // Ignore cancellation errors
                          })
                        }
                        setPreConstructedMessage((prev) => ({
                          ...cleanupFile(prev, file),
                          attachments: (prev.attachments || []).filter(
                            (f) => StorageKeyGenerator.fileUniqKey(f) !== fileKey
                          ),
                        }))
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
                      <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                        <IconHammer
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className={
                            enabledTools > 0
                              ? 'text-[var(--chatbox-tint-brand)]'
                              : 'text-[var(--chatbox-tint-secondary)]'
                          }
                        />
                        {enabledTools > 0 && (
                          <Text size="xs" className="text-[var(--chatbox-tint-brand)]">
                            {enabledTools}
                          </Text>
                        )}
                      </UnstyledButton>
                    )}
                  </MCPMenu>
                )}

                {featureFlags.knowledgeBase && !isSmallScreen && (
                  <KnowledgeBaseMenu currentKnowledgeBaseId={knowledgeBase?.id} onSelect={handleKnowledgeBaseSelect}>
                    <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                      <IconVocabulary
                        size={toolbarIconSize}
                        strokeWidth={1.8}
                        className={
                          knowledgeBase ? 'text-[var(--chatbox-tint-brand)]' : 'text-[var(--chatbox-tint-secondary)]'
                        }
                      />
                    </UnstyledButton>
                  </KnowledgeBaseMenu>
                )}

                <Tooltip label={t('Web Search')} position="top" withArrow disabled={isSmallScreen}>
                  <UnstyledButton
                    onClick={() => {
                      setWebBrowsingMode(!webBrowsingMode)
                      dom.focusMessageInput()
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
                  >
                    <IconWorldWww
                      size={toolbarIconSize}
                      strokeWidth={1.8}
                      className={
                        webBrowsingMode ? 'text-[var(--chatbox-tint-brand)]' : 'text-[var(--chatbox-tint-secondary)]'
                      }
                    />
                  </UnstyledButton>
                </Tooltip>

                {!isSmallScreen &&
                  (showRollbackThreadButton ? (
                    <Tooltip label={t('Rollback Thread')} position="top" withArrow>
                      <UnstyledButton
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
                      <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                        <IconSettings
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--chatbox-tint-secondary)]"
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
                      {isCalculating ? '~' : ''}
                      {formatNumber(totalTokens)}
                      {tokenPercentage !== null && tokenPercentage > 10 && ` (${tokenPercentage}%)`}
                    </Text>
                  </Flex>
                </TokenCountMenu>

                {/* Model Selector */}
                <Box className="min-w-0 flex-1 justify-end max-w-[200px]">
                  <Tooltip
                    label={
                      <Flex align="center" c="white" gap="xxs" min-w-0>
                        <ScalableIcon icon={IconAlertCircle} size={12} className="text-inherit" />
                        <Text span size="xxs" c="white">
                          {t('Please select a model')}
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
                          'flex min-w-0 max-w-full items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors',
                          !model && 'animate-pulse bg-blue-500/20'
                        )}
                      >
                        {!!model && <ProviderImageIcon size={18} provider={model.provider} />}
                        <Text
                          size="sm"
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
                    </ModelSelector>
                  </Tooltip>
                </Box>
              </Flex>
            </Flex>
          </Stack>

          <Disclaimer />
        </Stack>
        {currentSession && (
          <CompressionModal
            opened={showCompressionModal}
            onClose={() => setShowCompressionModal(false)}
            session={currentSession}
          />
        )}
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
        <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
          <IconCirclePlus size={toolbarIconSize} strokeWidth={1.8} className="text-[var(--chatbox-tint-secondary)]" />
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
