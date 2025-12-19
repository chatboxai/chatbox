import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Button, Flex, Menu, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { useViewportSize } from '@mantine/hooks'
import {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowUp,
  IconCirclePlus,
  IconFilePencil,
  IconFolder,
  IconHammer,
  IconLink,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlus,
  IconSelector,
  IconSettings,
  IconVocabulary,
} from '@tabler/icons-react'
import { useAtom } from 'jotai'
import _, { pick } from 'lodash'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { formatNumber } from 'src/shared/utils'
import useInputBoxHistory from '@/hooks/useInputBoxHistory'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useMessageInput } from '@/hooks/useMessageInput'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useTokenCount } from '@/hooks/useTokenCount'
import { cn } from '@/lib/utils'
import { trackingEvent } from '@/packages/event'
import * as picUtils from '@/packages/pic_utils'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as atoms from '@/stores/atoms'
import { useSession, useSessionSettings } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
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
import { FileMiniCard, ImageMiniCard, LinkMiniCard } from '../Attachments'
import { CompressionModal } from '../CompressionModal'
import ImageModelSelect from '../ImageModelSelect'
import ProviderImageIcon from '../icons/ProviderImageIcon'
import KnowledgeBaseMenu from '../knowledge-base/KnowledgeBaseMenu'
import ModelSelector from '../ModelSelector'
import MCPMenu from '../mcp/MCPMenu'
import { ScalableIcon } from '../ScalableIcon'
import { Keys } from '../Shortcut'
import { ImageUploadButton } from './ImageUploadButton'
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
import { SessionSettingsButton } from './SessionSettingsButton'
import TokenCountMenu from './TokenCountMenu'
import { WebBrowsingButton } from './WebBrowsingButton'

export type InputBoxPayload = {
  constructedMessage: Message
  needGenerating?: boolean
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
    const { t } = useTranslation()
    const isSmallScreen = useIsSmallScreen()
    const { height: viewportHeight } = useViewportSize()
    const pasteLongTextAsAFile = useSettingsStore((state) => state.pasteLongTextAsAFile)
    const shortcuts = useSettingsStore((state) => state.shortcuts)
    const widthFull = useUIStore((s) => s.widthFull) || fullWidth

    // Use atom as the source of truth for pictureKeys and attachments
    const webBrowsingMode = useUIStore((s) => s.inputBoxWebBrowsingMode)
    const setWebBrowsingMode = useUIStore((s) => s.setInputBoxWebBrowsingMode)

    const currentSessionId = sessionId
    const isNewSession = currentSessionId === 'new'
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
    const currentContextMessageIds = useMemo(() => {
      // Attention: do not return empty array, it will cause useTokenCount to recalculate tokens
      if (isNewSession) return null
      if (!currentSessionMergedSettings?.maxContextMessageCount) return null
      if (!currentSession?.messages.length) return null
      return currentSession.messages
        .filter((m) => !m.generating)
        .map((m) => m.id)
        .slice(-(currentSessionMergedSettings.maxContextMessageCount || 0))
    }, [isNewSession, currentSessionMergedSettings?.maxContextMessageCount, currentSession?.messages])

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

    // Calculate token counts - use stable messages to avoid recalculation during streaming
    const { currentInputTokens, contextTokens, totalTokens } = useTokenCount(
      currentSessionId || null,
      preConstructedMessage.message,
      currentContextMessageIds,
      model
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

        const params = {
          constructedMessage: preConstructedMessage.message,
          needGenerating,
        }

        // 重置输入内容
        clearDraft()
        setLinks([])
        // 重置预处理数据
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
        // 重置清理上下文按钮
        setShowRollbackThreadButton(false)
        // 如果提交成功，添加到输入历史 (非手机端)
        if (platform.type !== 'mobile' && preConstructedMessage.message) {
          addInputBoxHistory(preConstructedMessage.message.contentParts.find((p) => p.type === 'text')?.text || '')
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
      // 设置为处理中状态
      setPreConstructedMessage((prevMsg) => markFileProcessing(prevMsg, file))

      // 异步预处理文件，失败时标记为 error，并吞掉异常避免 Promise.all reject
      const preprocessPromise = sessionHelpers
        .preprocessFile(file, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then((preprocessedFile) => {
          setPreConstructedMessage((prev) => onFileProcessed(prev, file, preprocessedFile, 10))
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
              10
            )
          )
        })

      // Store the promise
      setPreConstructedMessage((prev) => storeFilePromise(prev, file, preprocessPromise))
    }

    const insertLinks = async (urls: string[]) => {
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
          await storage.setBlob(key, base64)
          setPreConstructedMessage((prev) => ({
            ...prev,
            pictureKeys: [...(prev.pictureKeys || []), key].slice(-8),
          })) // 最多插入 8 个图片
        } else {
          setPreConstructedMessage((prev) => {
            const newAttachments = prev.attachments.find(
              (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
            )
              ? prev.attachments
              : [...(prev.attachments || []), file].slice(-10) // 最多插入 10 个附件

            // 只预处理前10个文件，避免浪费资源
            const fileIndex = newAttachments.findIndex(
              (f) => f.name === file.name && f.lastModified === file.lastModified
            )
            if (fileIndex < 10) {
              startFilePreprocessing(file)
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
      onDrop: (acceptedFiles: File[]) => {
        insertFiles(acceptedFiles)
      },
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

    return (
      <Box
        pt={0}
        pb={isSmallScreen ? 'md' : 'sm'}
        px={isSmallScreen ? '0.3rem' : '1rem'}
        id={dom.InputBoxID}
        {...getRootProps()}
      >
        <input className="hidden" {...getInputProps()} />
        <Stack
          className={cn(
            'rounded-lg sm:rounded-md bg-chatbox-background-secondary border border-solid border-chatbox-border-primary justify-between',
            widthFull ? 'w-full' : 'max-w-4xl mx-auto',
            !isSmallScreen && 'min-h-[92px]'
          )}
          gap={0}
        >
          <Textarea
            unstyled={true}
            classNames={{
              input:
                'block w-full outline-none border-none px-sm pt-sm pb-sm resize-none bg-transparent text-chatbox-tint-primary',
            }}
            size="sm"
            id={dom.messageInputID}
            ref={inputRef}
            placeholder={t('Type your question here...') || ''}
            bg="transparent"
            autosize={true}
            minRows={1}
            maxRows={Math.max(3, Math.floor(viewportHeight / 100))}
            value={messageInput}
            autoFocus={!isSmallScreen}
            onChange={onMessageInput}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />

          {(!!pictureKeys.length || !!attachments.length || !!links.length) && (
            <Flex px="sm" pb="xs" align="center" wrap="wrap" onClick={() => dom.focusMessageInput()}>
              {pictureKeys?.map((picKey) => (
                <ImageMiniCard key={picKey} storageKey={picKey} onDelete={() => onImageDeleteClick(picKey)} />
              ))}
              {attachments?.map((file) => (
                <FileMiniCard
                  key={StorageKeyGenerator.fileUniqKey(file)}
                  name={file.name}
                  fileType={file.type}
                  status={preConstructedMessage.preprocessingStatus.files[StorageKeyGenerator.fileUniqKey(file)]}
                  onDelete={() => {
                    setPreConstructedMessage((prev) => ({
                      ...cleanupFile(prev, file),
                      attachments: (prev.attachments || []).filter(
                        (f) => StorageKeyGenerator.fileUniqKey(f) !== StorageKeyGenerator.fileUniqKey(file)
                      ),
                    }))
                  }}
                />
              ))}
              {links?.map((link) => (
                <LinkMiniCard
                  key={StorageKeyGenerator.linkUniqKey(link.url)}
                  url={link.url}
                  status={preConstructedMessage.preprocessingStatus.links[StorageKeyGenerator.linkUniqKey(link.url)]}
                  onDelete={() => {
                    setLinks(links.filter((l) => l.url !== link.url))
                    setPreConstructedMessage((prev) => cleanupLink(prev, link.url))
                  }}
                />
              ))}
            </Flex>
          )}

          <Flex px="sm" pb="sm" align="flex-end" justify="space-between" gap="0" wrap="wrap">
            <Flex gap="md" flex="0 1 auto" className="!hidden sm:!flex">
              {sessionType !== 'picture' && (
                <>
                  <ImageUploadInput ref={pictureInputRef} onChange={onFileInputChange} />
                  <input type="file" ref={fileInputRef} className="hidden" onChange={onFileInputChange} multiple />

                  <AttachmentMenu
                    onImageUploadClick={onImageUploadClick}
                    onFileUploadClick={onFileUploadClick}
                    handleAttachLink={handleAttachLink}
                    t={t}
                  />

                  {featureFlags.mcp && (
                    <MCPMenu>
                      {(enabledTools) =>
                        enabledTools > 0 ? (
                          <Button radius="md" variant="light" h="auto" w="auto" px="xs" py={0}>
                            <Flex gap="3xs" align="center">
                              <ScalableIcon icon={IconHammer} strokeWidth={1.8} size={22} />
                              <span>{enabledTools}</span>
                            </Flex>
                          </Button>
                        ) : (
                          <ActionIcon size={24} variant="subtle" color="chatbox-secondary">
                            <ScalableIcon icon={IconHammer} size={22} strokeWidth={1.8} />
                          </ActionIcon>
                        )
                      }
                    </MCPMenu>
                  )}
                  {featureFlags.knowledgeBase && (
                    <KnowledgeBaseMenu currentKnowledgeBaseId={knowledgeBase?.id} onSelect={handleKnowledgeBaseSelect}>
                      <ActionIcon
                        size={24}
                        variant="subtle"
                        color={knowledgeBase ? 'chatbox-brand' : 'chatbox-secondary'}
                      >
                        <ScalableIcon icon={IconVocabulary} size={22} strokeWidth={1.8} />
                      </ActionIcon>
                    </KnowledgeBaseMenu>
                  )}

                  <Tooltip
                    label={
                      <Stack align="center" gap="xxs" pb="xxs">
                        <div className="whitespace-nowrap">{t('Web Browsing')}</div>
                        <Flex align="center">
                          <Keys keys={shortcuts.inputBoxWebBrowsingMode.split('+')} size="small" opacity={0.7} />
                        </Flex>
                      </Stack>
                    }
                    withArrow
                    position="top"
                  >
                    <WebBrowsingButton
                      active={webBrowsingMode}
                      onClick={() => {
                        setWebBrowsingMode(!webBrowsingMode)
                        dom.focusMessageInput()
                      }}
                    />
                  </Tooltip>

                  {showRollbackThreadButton ? (
                    <Tooltip label={t('Back to Previous')} withArrow position="top-start">
                      <ActionIcon size={24} variant="subtle" color="chatbox-secondary" onClick={rollbackThread}>
                        <ScalableIcon icon={IconArrowBackUp} size={22} strokeWidth={1.8} />
                      </ActionIcon>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      label={
                        <Stack align="center" gap="xxs" pb="xxs">
                          <div className="whitespace-nowrap">{t('Start a New Thread')}</div>
                          <Flex align="center">
                            <Keys keys={shortcuts.messageListRefreshContext.split('+')} size="small" opacity={0.7} />
                          </Flex>
                        </Stack>
                      }
                      withArrow
                      position="top-start"
                    >
                      <ActionIcon
                        size={24}
                        variant="subtle"
                        color="chatbox-secondary"
                        disabled={!onStartNewThread}
                        onClick={startNewThread}
                      >
                        <ScalableIcon icon={IconFilePencil} size={22} strokeWidth={1.8} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </>
              )}
              {model?.provider === ModelProviderEnum.ChatboxAI && sessionType === 'picture' && (
                <>
                  <ImageUploadInput ref={pictureInputRef} onChange={onFileInputChange} />
                  <ImageUploadButton onClick={onImageUploadClick} tooltipLabel={t('Attach Image')} />
                </>
              )}
              <SessionSettingsButton
                onClick={onClickSessionSettings}
                tooltipLabel={t('Customize settings for the current conversation')}
                disabled={!onClickSessionSettings}
              />
            </Flex>

            <Flex className="sm:!hidden" gap="xs">
              {sessionType !== 'picture' ? (
                <>
                  <AttachmentMenu
                    onImageUploadClick={onImageUploadClick}
                    onFileUploadClick={onFileUploadClick}
                    handleAttachLink={handleAttachLink}
                    t={t}
                    size={20}
                    iconSize={undefined}
                  />

                  <WebBrowsingButton
                    active={webBrowsingMode}
                    onClick={() => {
                      setWebBrowsingMode(!webBrowsingMode)
                      dom.focusMessageInput()
                    }}
                    isMobile
                  />

                  <Menu
                    trigger={isSmallScreen ? 'click' : 'hover'}
                    openDelay={100}
                    closeDelay={100}
                    keepMounted
                    transitionProps={{
                      transition: 'pop',
                      duration: 200,
                    }}
                  >
                    <Menu.Target>
                      <ActionIcon
                        variant="transparent"
                        w={20}
                        h={20}
                        miw={20}
                        mih={20}
                        bd="none"
                        color="chatbox-secondary"
                      >
                        <ScalableIcon icon={IconSettings} size={20} strokeWidth={1.8} />
                      </ActionIcon>
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
                </>
              ) : (
                <>
                  {model?.provider === ModelProviderEnum.ChatboxAI && (
                    <>
                      <ImageUploadInput ref={pictureInputRef} onChange={onFileInputChange} />
                      <ImageUploadButton onClick={onImageUploadClick} tooltipLabel={t('Add images')} isMobile />
                    </>
                  )}
                  <SessionSettingsButton
                    onClick={onClickSessionSettings}
                    tooltipLabel={t('Customize settings for the current conversation')}
                    disabled={!onClickSessionSettings}
                    isMobile
                  />
                </>
              )}
            </Flex>

            <Flex gap={isSmallScreen ? 'xxs' : 'sm'} align="flex-end" justify="flex-end" flex="1 1 auto ">
              {/* Wrap TokenCountMenu and ModelSelector in a Flex with center alignment */}
              <Flex gap={isSmallScreen ? 'xxs' : 'sm'} align="center">
                {/* Token count display */}
                {sessionType !== 'picture' && (
                  <TokenCountMenu
                    currentInputTokens={currentInputTokens}
                    contextTokens={contextTokens}
                    totalTokens={totalTokens}
                    contextWindow={modelInfo?.contextWindow}
                    currentMessageCount={currentContextMessageIds?.length ?? 0}
                    maxContextMessageCount={currentSessionMergedSettings?.maxContextMessageCount}
                    onCompressClick={sessionId && !isNewSession ? () => setShowCompressionModal(true) : undefined}
                  >
                    <Flex
                      align="center"
                      gap="2"
                      className="text-xs text-chatbox-tint-secondary cursor-pointer hover:text-chatbox-tint-primary transition-colors"
                    >
                      <ScalableIcon icon={IconArrowUp} size={14} />
                      <Text span size="xs" className="whitespace-nowrap">
                        {formatNumber(totalTokens)}
                        {!isSmallScreen && modelInfo?.contextWindow && ` / ${formatNumber(modelInfo.contextWindow)}`}
                      </Text>
                    </Flex>
                  </TokenCountMenu>
                )}

                <Tooltip
                  label={
                    <Flex align="center" c="white" gap="xxs">
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
                  {sessionType === 'picture' ? (
                    <ImageModelSelect onSelect={onSelectModel}>
                      <span className="flex items-center text-sm cursor-pointer bg-transparent h-6">
                        {providers.find((p) => p.id === model?.provider)?.name || model?.provider || t('Select Model')}
                        <ScalableIcon icon={IconSelector} size={16} className="opacity-50" />
                      </span>
                    </ImageModelSelect>
                  ) : (
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
                      <Flex gap="xxs" px={isSmallScreen ? 0 : 'xs'} align="center" className={cn('cursor-pointer')}>
                        {!!model && <ProviderImageIcon size={isSmallScreen ? 20 : 24} provider={model.provider} />}
                        <Text size={isSmallScreen ? 'xs' : 'sm'} className="line-clamp-1">
                          {modelSelectorDisplayText}
                        </Text>
                        <ScalableIcon
                          icon={IconSelector}
                          size={20}
                          className="flex-[0_0_auto] text-chatbox-tint-tertiary"
                        />
                      </Flex>
                    </ModelSelector>
                  )}
                </Tooltip>
              </Flex>

              <ActionIcon
                disabled={(disableSubmit || isPreprocessing || isSubmitting) && !generating}
                radius={18}
                size={isSmallScreen ? 28 : 36}
                onClick={generating ? onStopGenerating : () => handleSubmit()}
                className={cn(
                  // 'mt-[-6px] mb-[2px]',
                  (disableSubmit || isPreprocessing || isSubmitting) &&
                    !generating &&
                    '!text-white !bg-chatbox-background-tertiary'
                )}
              >
                {generating ? (
                  <ScalableIcon icon={IconPlayerStopFilled} size={20} />
                ) : (
                  <ScalableIcon icon={IconArrowUp} size={20} />
                )}
              </ActionIcon>
            </Flex>
          </Flex>
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

// Reusable attachment menu component
const AttachmentMenu: React.FC<{
  onImageUploadClick: () => void
  onFileUploadClick: () => void
  handleAttachLink: () => void
  t: (key: string) => string
  size?: number
  iconSize?: number
}> = ({ onImageUploadClick, onFileUploadClick, handleAttachLink, t, size = 24, iconSize = 20 }) => {
  const isSmallScreen = useIsSmallScreen()
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
        <ActionIcon
          size={size === 20 ? undefined : `${size}px`}
          variant={size === 20 ? 'transparent' : 'subtle'}
          color="chatbox-secondary"
          {...(size === 20 ? { w: 20, h: 20, miw: 20, mih: 20, bd: 'none' } : {})}
        >
          <ScalableIcon icon={IconCirclePlus} strokeWidth={1.8} size={iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<ScalableIcon icon={IconPhoto} size={16} />} onClick={onImageUploadClick}>
          {t('Attach Image')}
        </Menu.Item>
        <Menu.Item leftSection={<ScalableIcon icon={IconFolder} size={16} />} onClick={onFileUploadClick}>
          {t('Select File')}
        </Menu.Item>
        <Menu.Item leftSection={<ScalableIcon icon={IconLink} size={16} />} onClick={handleAttachLink}>
          {t('Attach Link')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

// Memoize the InputBox component to prevent unnecessary re-renders during streaming
export default React.memo(InputBox)
