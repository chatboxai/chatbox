import { useProviders } from '@/hooks/useProviders'
import { useInputBoxHeight, useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { trackingEvent } from '@/packages/event'
import * as picUtils from '@/packages/pic_utils'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { scrollToMessage } from '@/stores/scrollActions'
import { saveSession } from '@/stores/sessionStorageMutations'
import { getMessageText } from '@/utils/message'
import NiceModal from '@ebay/nice-modal-react'
import { Box, Text, Tooltip } from '@mantine/core'
import StopIcon from '@mui/icons-material/Stop'
import { useTheme } from '@mui/material'
import { IconSelector } from '@tabler/icons-react'
import autosize from 'autosize'
import { clsx } from 'clsx'
import { useAtom, useAtomValue } from 'jotai'
import _ from 'lodash'
import { FilePen, FolderClosed, Gavel, Globe, Image, Link, SendHorizontal, Settings2, Undo2 } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { createMessage, ModelProvider, ShortcutSendValue } from '../../shared/types'
import * as dom from '../hooks/dom'
import icon from '../static/icon.png'
import * as atoms from '../stores/atoms'
import * as sessionActions from '../stores/sessionActions'
import { FileMiniCard, ImageMiniCard, LinkMiniCard } from './Attachments'
import ImageModelSelect from './ImageModelSelect'
import MCPMenu from './mcp/MCPMenu'
import MiniButton from './MiniButton'
import ModelSelector from './ModelSelectorNew'
import { Keys } from './Shortcut'
import { featureFlags } from '@/utils/feature-flags'

export default function InputBox() {
  const theme = useTheme()
  const [quote, setQuote] = useAtom(atoms.quoteAtom)
  const currentSessionId = useAtomValue(atoms.currentSessionIdAtom)
  const currentSessionType = useAtomValue(atoms.currentSessionTypeAtom)
  const isSmallScreen = useIsSmallScreen()
  const { t } = useTranslation()
  const [messageInput, setMessageInput] = useState('')
  const [pictureKeys, setPictureKeys] = useState<string[]>([])
  const [attachments, setAttachments] = useState<File[]>([])
  const [webBrowsingMode, setWebBrowsingMode] = useAtom(atoms.inputBoxWebBrowsingModeAtom)
  const [links, setLinks] = useAtom(atoms.inputBoxLinksAtom)
  const pictureInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [showRollbackThreadButton, setShowRollbackThreadButton] = useState(false)
  const showRollbackThreadButtonTimerRef = useRef<null | NodeJS.Timeout>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [previousMessageQuickInputMark, setPreviousMessageQuickInputMark] = useState('')
  const pasteLongTextAsAFile = useAtomValue(atoms.pasteLongTextAsAFileAtom)
  const shortcuts = useAtomValue(atoms.shortcutsAtom)

  const { min: minTextareaHeight, max: maxTextareaHeight } = useInputBoxHeight()

  useEffect(() => {
    if (quote !== '') {
      // TODO: 支持引用消息中的图片
      // TODO: 支持引用消息中的文件
      setMessageInput(quote)
      setQuote('')
      setPreviousMessageQuickInputMark('')
      dom.focusMessageInput()
      dom.setMessageInputCursorToEnd()
    }
  }, [quote])
  useEffect(() => {
    if (!isSmallScreen) {
      dom.focusMessageInput() // 大屏幕切换会话时自动聚焦
    }
    setWebBrowsingMode(false)
  }, [currentSessionId])

  const currentSession = useAtomValue(atoms.currentSessionAtom)
  const lastMessage = currentSession?.messages.length
    ? currentSession.messages[currentSession.messages.length - 1]
    : null

  const handleStop = () => {
    if (!currentSession) {
      return
    }
    if (lastMessage?.generating) {
      lastMessage?.cancel?.()
      sessionActions.modifyMessage(currentSession.id, { ...lastMessage, generating: false }, true)
    }
  }

  const handleSubmit = (needGenerating = true) => {
    if (lastMessage?.generating) {
      return
    }
    setPreviousMessageQuickInputMark('')

    if (messageInput.trim() === '' && links.length === 0 && attachments.length === 0 && pictureKeys.length === 0) {
      return
    }

    if (!currentSession?.settings?.provider || !currentSession?.settings?.modelId) {
      setShowSelectModelErrorTip(true)
      const clickEventListener = () => {
        setShowSelectModelErrorTip(false)
        document.removeEventListener('click', clickEventListener)
      }
      document.addEventListener('click', clickEventListener)
      return
    }

    const newMessage = createMessage('user', messageInput)
    if (pictureKeys.length > 0) {
      newMessage.contentParts.push(...pictureKeys.map((k) => ({ type: 'image' as const, storageKey: k })))
    }
    sessionActions.submitNewUserMessage({
      currentSessionId: currentSessionId,
      newUserMsg: newMessage,
      needGenerating,
      attachments,
      links,
      webBrowsing: webBrowsingMode,
    })
    setMessageInput('')
    setPictureKeys([])
    setAttachments([])
    setLinks([])

    trackingEvent('send_message', { event_category: 'user' })
    // 重置清理上下文按钮
    if (showRollbackThreadButton) {
      setShowRollbackThreadButton(false)
      if (showRollbackThreadButtonTimerRef.current) {
        clearTimeout(showRollbackThreadButtonTimerRef.current)
      }
    }
    setTimeout(() => scrollToMessage(newMessage.id), 100)
  }

  // 自动调整输入框高度
  useEffect(() => {
    if (inputRef.current) {
      autosize(inputRef.current)
    }
    return () => {
      if (inputRef.current) {
        autosize.destroy(inputRef.current)
      }
    }
  }, [])
  useEffect(() => {
    if (inputRef.current) {
      autosize.update(inputRef.current)
    }
  }, [messageInput])

  const onMessageInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const input = event.target.value
    setMessageInput(input)
    setPreviousMessageQuickInputMark('')
    // 自动调整输入框高度
    if (inputRef.current) {
      inputRef.current.style.height = 'inherit' // Reset the height - important to shrink on delete
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, maxTextareaHeight)}px`
    }
  }

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
    if (isPressedHash[shortcuts.inpubBoxSendMessage]) {
      if (platform.type === 'mobile' && isSmallScreen && shortcuts.inpubBoxSendMessage === 'Enter') {
        // 移动端点击回车不会发送消息
        return
      }
      event.preventDefault()
      handleSubmit()
      return
    }
    // 发送消息但不生成回复
    if (isPressedHash[shortcuts.inpubBoxSendMessageWithoutResponse]) {
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
      let historyMessages = sessionActions.getCurrentMessages()
      historyMessages = historyMessages.slice(historyMessages.length - 100)
      historyMessages = historyMessages.filter((m) => m.role !== 'assistant')
      if (historyMessages.length === 0) {
        return
      }
      if (!previousMessageQuickInputMark) {
        if (event.key === 'ArrowUp') {
          const msg = historyMessages[historyMessages.length - 1]
          setMessageInput(getMessageText(msg, false))
          setPictureKeys(msg.contentParts.filter((p) => p.type === 'image').map((p) => p.storageKey))
          setPreviousMessageQuickInputMark(msg.id)
          setTimeout(() => inputRef.current?.select(), 10)
          return
        } else if (event.key === 'ArrowDown') {
          return
        }
      } else {
        const ix = historyMessages.findIndex((m) => m.id === previousMessageQuickInputMark)
        if (ix === -1) {
          return
        }
        const msg = event.key === 'ArrowUp' ? historyMessages[ix - 1] : historyMessages[ix + 1]
        if (msg) {
          setMessageInput(getMessageText(msg, false))
          setPictureKeys(msg.contentParts.filter((p) => p.type === 'image').map((p) => p.storageKey))
          setPreviousMessageQuickInputMark(msg.id)
          setTimeout(() => inputRef.current?.select(), 10)
        }
        return
      }
    }
  }

  const startNewThread = () => {
    sessionActions.startNewThread()
    // 显示撤回上下文按钮
    setShowRollbackThreadButton(true)
    if (showRollbackThreadButtonTimerRef.current) {
      clearTimeout(showRollbackThreadButtonTimerRef.current)
    }
    showRollbackThreadButtonTimerRef.current = setTimeout(() => {
      setShowRollbackThreadButton(false)
    }, 5000)
  }
  const rollbackThread = () => {
    setShowRollbackThreadButton(false)
    if (showRollbackThreadButtonTimerRef.current) {
      clearTimeout(showRollbackThreadButtonTimerRef.current)
    }
    sessionActions.removeCurrentThread(currentSessionId)
  }

  const insertLinks = (urls: string[]) => {
    setLinks((links) => {
      let newLinks = [...links, ...urls.map((u) => ({ url: u }))]
      newLinks = _.uniqBy(newLinks, 'url')
      newLinks = newLinks.slice(-6) // 最多插入 6 个链接
      return newLinks
    })
  }

  const insertFiles = async (files: File[]) => {
    for (const file of files) {
      // 文件和图片插入方法复用，会导致 svg、gif 这类不支持的图片也被插入，但暂时没看到有什么问题
      if (file.type.startsWith('image/')) {
        const base64 = await picUtils.getImageBase64AndResize(file)
        const key = StorageKeyGenerator.picture('input-box')
        await storage.setBlob(key, base64)
        setPictureKeys((keys) => [...keys, key].slice(-8)) // 最多插入 8 个图片
      } else {
        setAttachments((attachments) => [...attachments, file].slice(-10)) // 最多插入 10 个附件
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
    setPictureKeys((keys) => keys.filter((k) => k !== picKey))
    // 不删除图片数据，因为可能在其他地方引用，比如通过上下键盘的历史消息快捷输入、发送的消息中引用
    // await storage.delBlob(picKey)
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (currentSessionType === 'picture') {
      return
    }
    if (event.clipboardData && event.clipboardData.items) {
      // 对于 Doc/PPT/XLS 等文件中的内容，粘贴时一般会有 4 个 items，分别是 text 文本、html、某格式和图片
      // 因为 getAsString 为异步操作，无法根据 items 中的内容来定制不同的粘贴行为，因此这里选择了最简单的做法：
      // 保持默认的粘贴行为，这时候会粘贴从文档中复制的文本和图片。我认为应该保留图片，因为文档中的表格、图表等图片信息也很重要，很难通过文本格式来表述。
      // 仅在只粘贴图片或文件时阻止默认行为，防止插入文件或图片的名字
      let hasText = false
      for (let item of event.clipboardData.items) {
        if (item.kind === 'file') {
          // 插入文件和图片
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
              const file = new File([text], `pasted_text_${attachments.length}.txt`, {
                type: 'text/plain',
              })
              insertFiles([file])
              setMessageInput(messageInput) // 删除掉默认粘贴进去的长文本
            }
          })
          continue
        }
      }
      // 如果没有任何文本，则说明只是复制了图片或文件。这里阻止默认行为，防止插入文件或图片的名字
      if (!hasText) {
        event.preventDefault()
      }
    }
  }

  // 小彩蛋
  const [easterEgg, setEasterEgg] = useState(false)

  // 拖拽上传
  const { getRootProps, getInputProps } = useDropzone({
    onDrop: (acceptedFiles: File[]) => {
      insertFiles(acceptedFiles)
    },
    noClick: true,
    noKeyboard: true,
  })

  const { providers } = useProviders()
  const modelSelectorDisplayText = useMemo(() => {
    if (!currentSession?.settings?.provider || !currentSession.settings.modelId) {
      return t('Select Model')
    }
    const providerInfo = providers.find((p) => p.id === currentSession?.settings?.provider)

    const modelInfo = (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find(
      (m) => m.modelId === currentSession?.settings?.modelId
    )
    return `${modelInfo?.nickname || currentSession?.settings?.modelId} (${
      providerInfo?.name || currentSession?.settings?.provider
    })`
  }, [providers, currentSession])
  const [showSelectModelErrorTip, setShowSelectModelErrorTip] = useState(false)
  const handleSelectModel = (provider: ModelProvider, modelId: string) => {
    if (!currentSession) {
      return
    }
    saveSession({
      id: currentSession.id,
      settings: {
        ...(currentSession.settings || {}),
        provider,
        modelId,
      },
    })
  }

  const sendOrStopButton = (
    <MiniButton
      className={clsx(
        'w-8 ml-2 rounded-full flex items-center justify-center',
        isSmallScreen ? 'absolute bottom-3 right-1' : ''
      )}
      style={{
        color: theme.palette.getContrastText(theme.palette.primary.main),
        backgroundColor: currentSessionType === 'picture' ? theme.palette.secondary.main : theme.palette.primary.main,
      }}
      tooltipPlacement="top"
      onClick={lastMessage?.generating ? handleStop : () => handleSubmit()}
    >
      {lastMessage?.generating ? (
        <StopIcon className="!w-6 !h-6" />
      ) : (
        <SendHorizontal size="18" strokeWidth={1} className=" ml-0.5" />
      )}
    </MiniButton>
  )

  return (
    <div
      className="pl-1 pr-2 sm:pl-2 sm:pr-4"
      id={dom.InputBoxID}
      style={{
        borderTopWidth: '1px',
        borderTopStyle: 'solid',
        borderTopColor: theme.palette.divider,
      }}
    >
      <div className={'w-full mx-auto flex flex-col'}>
        <div className="flex flex-row flex-nowrap justify-between py-1 ">
          <div className="flex flex-1 flex-row items-center overflow-x-auto scrollbar-none">
            {!isSmallScreen && (
              <MiniButton
                className="mr-1 sm:mr-2 hover:bg-transparent"
                style={{ color: theme.palette.text.primary }}
                onClick={() => {
                  setEasterEgg(true)
                  setTimeout(() => setEasterEgg(false), 1000)
                }}
              >
                <img className={cn('w-5 h-5', easterEgg ? 'animate-spin' : '')} src={icon} />
              </MiniButton>
            )}
            {showRollbackThreadButton ? (
              <MiniButton
                className="mr-1 sm:mr-2"
                style={{ color: theme.palette.text.primary }}
                tooltipTitle={
                  <div className="text-center inline-block">
                    <span>{t('Back to Previous')}</span>
                  </div>
                }
                tooltipPlacement="top"
                onClick={rollbackThread}
              >
                <Undo2 size="22" strokeWidth={1} />
              </MiniButton>
            ) : (
              <MiniButton
                className="mr-1 sm:mr-2"
                style={{ color: theme.palette.text.primary }}
                tooltipTitle={
                  <div className="text-center inline-block">
                    <span>{t('Start a New Thread')}</span>
                    <br />
                    <Keys keys={shortcuts.messageListRefreshContext.split('+')} size="small" opacity={0.7} />
                  </div>
                }
                tooltipPlacement="top"
                onClick={startNewThread}
              >
                <FilePen size="22" strokeWidth={1} />
              </MiniButton>
            )}

            <input
              type="file"
              ref={pictureInputRef}
              className="hidden"
              onChange={onFileInputChange}
              // accept="image/png, image/jpeg, image/gif"
              accept="image/png, image/jpeg"
              multiple
            />
            <MiniButton
              className={cn('mr-1 sm:mr-2', currentSessionType !== 'picture' ? '' : 'hidden')}
              style={{ color: theme.palette.text.primary }}
              onClick={onImageUploadClick}
              tooltipTitle={
                <div className="text-center inline-block">
                  <span>{t('Attach Image')}</span>
                </div>
              }
              tooltipPlacement="top"
            >
              <Image size="22" strokeWidth={1} />
            </MiniButton>
            <input type="file" ref={fileInputRef} className="hidden" onChange={onFileInputChange} multiple />
            <MiniButton
              className={cn('mr-1 sm:mr-2', currentSessionType !== 'picture' ? '' : 'hidden')}
              style={{ color: theme.palette.text.primary }}
              onClick={onFileUploadClick}
              tooltipTitle={
                <div className="text-center inline-block">
                  <span>{t('Select File')}</span>
                  <br />
                  <span>{t('PDF, DOC, PPT, XLS, TXT, Code...')}</span>
                </div>
              }
              tooltipPlacement="top"
            >
              <FolderClosed size="22" strokeWidth={1} />
            </MiniButton>
            <MiniButton
              className={cn('mr-1 sm:mr-2', currentSessionType !== 'picture' ? '' : 'hidden')}
              style={{ color: theme.palette.text.primary }}
              onClick={async () => {
                const links: string[] = await NiceModal.show('attach-link')
                if (links) {
                  insertLinks(links)
                }
              }}
              tooltipTitle={
                <div className="text-center inline-block">
                  <span>{t('Attach Link')}</span>
                </div>
              }
              tooltipPlacement="top"
            >
              <Link size="22" strokeWidth={1} />
            </MiniButton>
            <MiniButton
              className={cn('mr-1 sm:mr-2', currentSessionType !== 'picture' ? '' : 'hidden')}
              style={{ color: theme.palette.text.primary }}
              onClick={() => {
                setWebBrowsingMode(!webBrowsingMode)
                dom.focusMessageInput()
              }}
              tooltipTitle={
                <div className="text-center inline-block">
                  <span>{t('Web Browsing')}</span>
                  <br />
                  <Keys keys={shortcuts.inputBoxWebBrowsingMode.split('+')} size="small" opacity={0.7} />
                </div>
              }
              tooltipPlacement="top"
            >
              <Globe
                size="22"
                strokeWidth={webBrowsingMode ? 1.5 : 1}
                className={cn(webBrowsingMode && 'text-blue-500')}
              />
            </MiniButton>
            {featureFlags.mcp && (
              <MCPMenu>
                {(enabledTools) =>
                  enabledTools > 0 ? (
                    <div
                      className={cn(
                        'cursor-pointer flex flex-row gap-1 items-center mr-1 sm:mr-2 text-blue-500 bg-blue-100 rounded-md p-1',
                        currentSessionType !== 'picture' ? '' : 'hidden'
                      )}
                    >
                      <Gavel size="20" strokeWidth={1.5} />
                      <span className="font-medium">{enabledTools}</span>
                    </div>
                  ) : (
                    <MiniButton
                      className={cn('mr-1 sm:mr-2', currentSessionType !== 'picture' ? '' : 'hidden')}
                      style={{ color: theme.palette.text.primary }}
                    >
                      <Gavel size="22" strokeWidth={1} />
                    </MiniButton>
                  )
                }
              </MCPMenu>
            )}
            {!isSmallScreen && (
              <MiniButton
                className="mr-1 sm:mr-2"
                style={{ color: theme.palette.text.primary }}
                onClick={() => {
                  if (!currentSession) {
                    return
                  }
                  NiceModal.show('session-settings', {
                    chatConfigDialogSessionId: currentSession.id,
                  })
                }}
                tooltipTitle={
                  <div className="text-center inline-block">
                    <span>{t('Customize settings for the current conversation')}</span>
                  </div>
                }
                tooltipPlacement="top"
              >
                <Settings2 size="22" strokeWidth={1} />
              </MiniButton>
            )}
          </div>
          <div className="flex flex-row items-center flex-grow-0 flex-shrink-0 max-w-[50%] sm:max-w-[30%]">
            <Tooltip
              label={t('Please select a model')}
              color="chatbox-error"
              opened={showSelectModelErrorTip}
              withArrow
            >
              <Box>
                {currentSessionType === 'chat' && (
                  <ModelSelector onSelect={handleSelectModel}>
                    <Text
                      span
                      c="chatbox-secondary"
                      size={isSmallScreen ? 'xs' : 'sm'}
                      className="flex items-center cursor-pointer bg-transparent hover:bg-slate-400/25 rounded h-8 p-1"
                    >
                      <span className="line-clamp-2 break-words">{modelSelectorDisplayText}</span>

                      <IconSelector size={16} className="opacity-50 flex-none" />
                    </Text>
                  </ModelSelector>
                )}
                {currentSessionType === 'picture' && (
                  <ImageModelSelect onSelect={handleSelectModel}>
                    <span className="flex items-center text-sm opacity-70 cursor-pointer bg-transparent hover:bg-slate-400/25 rounded h-8 p-1">
                      {providers.find((p) => p.id === currentSession?.settings?.provider)?.name ||
                        currentSession?.settings?.provider ||
                        t('Select Model')}
                      <IconSelector size={16} className="opacity-50" />
                    </span>
                  </ImageModelSelect>
                )}
              </Box>
            </Tooltip>

            {/* <MiniButton className='mr-2 w-auto flex items-center opacity-70'>
                        <span className='text-sm' style={{ color: theme.palette.text.primary }}>
                            严谨(0.7)
                        </span>
                        <ChevronsUpDown size='16' strokeWidth={1}
                            style={{ color: theme.palette.text.primary }}
                            className='opacity-50'
                        />
                    </MiniButton> */}
            {!isSmallScreen && sendOrStopButton}
          </div>
        </div>
        <div className="w-full pl-1 pb-2" {...getRootProps()}>
          <input {...getInputProps()} />
          <div className="relative">
            <textarea
              id={dom.messageInputID}
              className={cn(
                `w-full`,
                'overflow-y resize-none border-none outline-none',
                'bg-slate-300/25 rounded-lg p-2',
                'sm:bg-transparent sm:p-1'
              )}
              value={messageInput}
              onChange={onMessageInput}
              onKeyDown={onKeyDown}
              ref={inputRef}
              autoFocus={!isSmallScreen}
              style={{
                minHeight: minTextareaHeight + 'px',
                maxHeight: maxTextareaHeight + 'px',
                color: theme.palette.text.primary,
                fontFamily: theme.typography.fontFamily,
                fontSize: theme.typography.body1.fontSize,
              }}
              placeholder={t('Type your question here...') || ''}
              onPaste={onPaste}
              // {...{ enterKeyHint: 'send' } as any}
            />
            {isSmallScreen && sendOrStopButton}
          </div>
          <div className="flex flex-row items-center" onClick={() => dom.focusMessageInput()}>
            {pictureKeys.map((picKey, ix) => (
              <ImageMiniCard key={ix} storageKey={picKey} onDelete={() => onImageDeleteClick(picKey)} />
            ))}
            {attachments.map((file, ix) => (
              <FileMiniCard
                key={ix}
                name={file.name}
                fileType={file.type}
                onDelete={() => setAttachments((files) => files.filter((f) => f.name != file.name))}
              />
            ))}
            {links.map((link, ix) => (
              <LinkMiniCard
                key={ix}
                url={link.url}
                onDelete={() => setLinks((links) => links.filter((l) => l.url != link.url))}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
