import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import * as picUtils from '@/packages/pic_utils'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import NiceModal from '@ebay/nice-modal-react'
import { useAtom, useAtomValue } from 'jotai'
import _ from 'lodash'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { SessionType, ShortcutSendValue } from '../../shared/types'
import * as dom from '../hooks/dom'
import * as atoms from '../stores/atoms'
import { FileMiniCard, ImageMiniCard, LinkMiniCard } from './Attachments'
import { Keys } from './Shortcut'
import ModelSelector from './ModelSelectorNew'
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowUp,
  IconCirclePlus,
  IconEraser,
  IconFilePencil,
  IconFolder,
  IconHammer,
  IconLink,
  IconPhoto,
  IconPlayerStopFilled,
  IconSelector,
  IconVocabulary,
  IconWorld,
} from '@tabler/icons-react'
import { useProviders } from '@/hooks/useProviders'
import ImageModelSelect from './ImageModelSelect'
import { ActionIcon, Badge, Box, Button, Flex, Menu, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { useViewportSize } from '@mantine/hooks'
import useInputBoxHistory from '@/hooks/useInputBoxHistory'
import ProviderImageIcon from './icons/ProviderImageIcon'
import { delay } from '@/utils'
import { featureFlags } from '@/utils/feature-flags'
import MCPMenu from './mcp/MCPMenu'

export type InputBoxPayload = {
  input: string
  pictureKeys?: string[]
  attachments?: File[]
  links?: { url: string }[]
  webBrowsing?: boolean
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
  onSelectModel?(provider: string, model: string): void
  onSubmit?(payload: InputBoxPayload): Promise<boolean>
  onStopGenerating?(): boolean
  onStartNewThread?(): boolean
  onRollbackThread?(): boolean
  onClickSessionSettings?(): boolean
}

const InputBox = forwardRef<InputBoxRef, InputBoxProps>(
  (
    {
      sessionId,
      sessionType = 'chat',
      generating = false,
      model,
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
    const pasteLongTextAsAFile = useAtomValue(atoms.pasteLongTextAsAFileAtom)
    const shortcuts = useAtomValue(atoms.shortcutsAtom)

    const [messageInput, setMessageInput] = useState('')
    const [pictureKeys, setPictureKeys] = useState<string[]>([])
    const [attachments, setAttachments] = useState<File[]>([])
    const [webBrowsingMode, setWebBrowsingMode] = useAtom(atoms.inputBoxWebBrowsingModeAtom)
    const [links, setLinks] = useAtom(atoms.inputBoxLinksAtom)
    const pictureInputRef = useRef<HTMLInputElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
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
      return isSmallScreen
        ? `${modelInfo?.nickname || model.modelId}`
        : `${modelInfo?.nickname || model.modelId} (${providerInfo?.name || model.provider})`
    }, [providers, model])

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
          setMessageInput((prev) => prev + '\n\n' + data)
          dom.focusMessageInput()
          dom.setMessageInputCursorToEnd()
        },
      }),
      [messageInput]
    )

    const { addInputBoxHistory, getPreviousHistoryInput, getNextHistoryInput, resetHistoryIndex } = useInputBoxHistory()

    const handleSubmit = async (needGenerating = true) => {
      if (disableSubmit) {
        return
      }

      // 未选择模型时 显示error tip
      if (!model) {
        // 如果不延时执行，会导致error tip 立即消失
        await delay(100)
        setShowSelectModelErrorTip(true)
        return
      }

      addInputBoxHistory(messageInput)

      const res = await onSubmit?.({
        input: messageInput,
        pictureKeys,
        attachments,
        links,
        webBrowsing: webBrowsingMode,
        needGenerating,
      })

      if (!res) {
        return
      }

      // 重置输入内容
      setMessageInput('')
      setPictureKeys([])
      setAttachments([])
      setLinks([])
      // 重置清理上下文按钮
      setShowRollbackThreadButton(false)

      trackingEvent('send_message', { event_category: 'user' })
    }

    const onMessageInput = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const input = event.target.value
      setMessageInput(input)
      resetHistoryIndex()
    }, [])

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

    const insertLinks = (urls: string[]) => {
      let newLinks = [...(links || []), ...urls.map((u) => ({ url: u }))]
      newLinks = _.uniqBy(newLinks, 'url')
      newLinks = newLinks.slice(-6) // 最多插入 6 个链接
      setLinks(newLinks)
    }

    const insertFiles = async (files: File[]) => {
      for (const file of files) {
        // 文件和图片插入方法复用，会导致 svg、gif 这类不支持的图片也被插入，但暂时没看到有什么问题
        if (file.type.startsWith('image/')) {
          const base64 = await picUtils.getImageBase64AndResize(file)
          const key = StorageKeyGenerator.picture('input-box')
          await storage.setBlob(key, base64)
          setPictureKeys((prev) => [...prev, key].slice(-8)) // 最多插入 8 个图片
        } else {
          setAttachments((prev) => [...prev, file].slice(-10)) // 最多插入 10 个附件
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
      setPictureKeys(pictureKeys?.filter((k) => k !== picKey))
      // 不删除图片数据，因为可能在其他地方引用，比如通过上下键盘的历史消息快捷输入、发送的消息中引用
      // await storage.delBlob(picKey)
    }

    const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (sessionType === 'picture') {
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
                const file = new File([text], `pasted_text_${attachments?.length || 0}.txt`, {
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
    const [quote, setQuote] = useAtom(atoms.quoteAtom)
    useEffect(() => {
      if (quote !== '') {
        // TODO: 支持引用消息中的图片
        // TODO: 支持引用消息中的文件
        setQuote('')
        setMessageInput((val) => {
          if (!val) {
            return quote
          } else {
            const newlines = val.match(/(\n)+$/)?.[0].length || 0
            console.log(newlines, Math.max(0, 2 - newlines))
            return val + '\n'.repeat(Math.max(0, 2 - newlines)) + quote
          }
        })
        // setPreviousMessageQuickInputMark('')
        dom.focusMessageInput()
        dom.setMessageInputCursorToEnd()
      }
    }, [quote])

    return (
      <Box p="sm" pt={isSmallScreen ? 0 : 'sm'} id={dom.InputBoxID} {...getRootProps()}>
        <input className="hidden" {...getInputProps()} />
        <Stack
          className="rounded-lg sm:rounded-md bg-[var(--mantine-color-chatbox-background-secondary-text)] border border-solid border-[var(--mantine-color-chatbox-border-primary-outline)]"
          gap={0}
        >
          <Textarea
            unstyled={true}
            classNames={{
              input:
                'block w-full outline-none border-none px-sm pt-sm pb-xs resize-none bg-transparent text-[var(--mantine-color-chatbox-primary-text)]',
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
              {pictureKeys?.map((picKey, ix) => (
                <ImageMiniCard key={ix} storageKey={picKey} onDelete={() => onImageDeleteClick(picKey)} />
              ))}
              {attachments?.map((file, ix) => (
                <FileMiniCard
                  key={ix}
                  name={file.name}
                  fileType={file.type}
                  onDelete={() => setAttachments(attachments.filter((f) => f.name != file.name))}
                />
              ))}
              {links?.map((link, ix) => (
                <LinkMiniCard
                  key={ix}
                  url={link.url}
                  onDelete={() => setLinks(links.filter((l) => l.url != link.url))}
                />
              ))}
            </Flex>
          )}

          <Flex px="sm" pb="sm" align="center" justify="space-between" gap="xl">
            <Flex gap="md" flex="0 1 auto" className="!hidden sm:!flex">
              {showRollbackThreadButton ? (
                <Tooltip label={t('Back to Previous')} withArrow position="top-start">
                  <ActionIcon variant="subtle" color="chatbox-secondary" onClick={rollbackThread}>
                    <IconArrowBackUp />
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
                    variant="subtle"
                    color="chatbox-secondary"
                    disabled={!onStartNewThread}
                    onClick={startNewThread}
                  >
                    <IconFilePencil />
                  </ActionIcon>
                </Tooltip>
              )}

              {sessionType !== 'picture' && (
                <>
                  <input
                    type="file"
                    ref={pictureInputRef}
                    className="hidden"
                    onChange={onFileInputChange}
                    accept="image/png, image/jpeg"
                    multiple
                  />
                  <Tooltip label={t('Attach Image')} withArrow position="top">
                    <ActionIcon variant="subtle" color="chatbox-secondary" onClick={onImageUploadClick}>
                      <IconPhoto />
                    </ActionIcon>
                  </Tooltip>

                  <input type="file" ref={fileInputRef} className="hidden" onChange={onFileInputChange} multiple />
                  <Tooltip label={t('Select File')} withArrow position="top">
                    <ActionIcon variant="subtle" color="chatbox-secondary" onClick={onFileUploadClick}>
                      <IconFolder />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip label={t('Attach Link')} withArrow position="top">
                    <ActionIcon variant="subtle" color="chatbox-secondary" onClick={handleAttachLink}>
                      <IconLink />
                    </ActionIcon>
                  </Tooltip>

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
                    <ActionIcon
                      variant="subtle"
                      color={webBrowsingMode ? 'chatbox-brand' : 'chatbox-secondary'}
                      onClick={() => {
                        setWebBrowsingMode(!webBrowsingMode)
                        dom.focusMessageInput()
                      }}
                    >
                      <IconWorld />
                    </ActionIcon>
                  </Tooltip>

                  {featureFlags.mcp && (
                    <MCPMenu>
                      {(enabledTools) =>
                        enabledTools > 0 ? (
                          <Button radius="md" variant="light" h="auto" w="auto" px="xs" py={0}>
                            <Flex gap="3xs" align="center">
                              <IconHammer />
                              <span>{enabledTools}</span>
                            </Flex>
                          </Button>
                        ) : (
                          <ActionIcon variant="subtle" color="chatbox-secondary">
                            <IconHammer />
                          </ActionIcon>
                        )
                      }
                    </MCPMenu>
                  )}
                </>
              )}

              <Tooltip label={t('Customize settings for the current conversation')} withArrow position="top">
                <ActionIcon
                  variant="subtle"
                  color="chatbox-secondary"
                  disabled={!onClickSessionSettings}
                  onClick={onClickSessionSettings}
                >
                  <IconAdjustmentsHorizontal />
                </ActionIcon>
              </Tooltip>

              {/* <ActionIcon variant="subtle" color="chatbox-secondary">
              <IconVocabulary />
            </ActionIcon> */}
            </Flex>

            <Flex className="sm:!hidden" gap="xs">
              {sessionType !== 'picture' ? (
                <>
                  <Menu shadow="md" position="top-start">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="chatbox-secondary">
                        <IconCirclePlus />
                      </ActionIcon>
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

                  <ActionIcon
                    variant="subtle"
                    color={webBrowsingMode ? 'chatbox-brand' : 'chatbox-secondary'}
                    onClick={() => {
                      setWebBrowsingMode(!webBrowsingMode)
                      dom.focusMessageInput()
                    }}
                  >
                    <IconWorld />
                  </ActionIcon>

                  <ActionIcon
                    variant="subtle"
                    color="chatbox-secondary"
                    disabled={!onClickSessionSettings}
                    onClick={onClickSessionSettings}
                  >
                    <IconAdjustmentsHorizontal />
                  </ActionIcon>
                </>
              ) : null}
            </Flex>

            <Flex
              gap={isSmallScreen ? 'xxs' : 'sm'}
              align="center"
              justify="flex-end"
              flex={1}
              maw={isSmallScreen ? undefined : '30%'}
            >
              <Tooltip
                label={t('Please select a model')}
                color="chatbox-error"
                opened={showSelectModelErrorTip}
                withArrow
              >
                {sessionType === 'picture' ? (
                  <ImageModelSelect onSelect={onSelectModel}>
                    <span className="flex items-center text-sm opacity-70 cursor-pointer bg-transparent hover:bg-slate-400/25 rounded h-8 p-1">
                      {providers.find((p) => p.id === model?.provider)?.name || model?.provider || t('Select Model')}
                      <IconSelector size={16} className="opacity-50" />
                    </span>
                  </ImageModelSelect>
                ) : (
                  <ModelSelector onSelect={onSelectModel}>
                    {isSmallScreen ? (
                      <Flex
                        gap="xxs"
                        px="xs"
                        py="xxs"
                        align="center"
                        className="cursor-pointer hover:bg-slate-400/25 rounded"
                      >
                        {!!model && <ProviderImageIcon size={20} provider={model.provider} />}
                        <Text fw={600} className="line-clamp-1">
                          {modelSelectorDisplayText}
                        </Text>
                        <IconSelector
                          size={20}
                          className="flex-[0_0_auto] text-[var(--mantine-color-chatbox-tertiary-text)]"
                        />
                      </Flex>
                    ) : (
                      <Flex align="center" className="cursor-pointer hover:bg-slate-400/25 rounded p-1">
                        <Text
                          span
                          c="chatbox-secondary"
                          size="sm"
                          className="line-clamp-2 break-words text-center flex-initial"
                        >
                          {modelSelectorDisplayText}
                        </Text>
                        <IconSelector size={16} className="opacity-50 flex-[0_0_auto]" />
                      </Flex>
                    )}
                  </ModelSelector>
                )}
              </Tooltip>

              <ActionIcon
                disabled={disableSubmit && !generating}
                radius={18}
                size={isSmallScreen ? 28 : 36}
                onClick={generating ? onStopGenerating : () => handleSubmit()}
                className={
                  disableSubmit && !generating
                    ? '!text-white !bg-[var(--mantine-color-chatbox-background-tertiary-text)]'
                    : ''
                }
              >
                {generating ? <IconPlayerStopFilled size={20} /> : <IconArrowUp size={20} />}
              </ActionIcon>
            </Flex>
          </Flex>
        </Stack>
      </Box>
    )
  }
)

export default InputBox
