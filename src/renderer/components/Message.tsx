import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, type ActionIconProps, Flex, Image as Img, Loader, Text, Tooltip as Tooltip1 } from '@mantine/core'
import { Grid, Typography, useTheme } from '@mui/material'
import Box from '@mui/material/Box'
import {
  IconArrowDown,
  IconBug,
  IconCode,
  IconCopy,
  IconDotsVertical,
  IconInfoCircle,
  IconMessageReport,
  IconPencil,
  IconPhotoPlus,
  type IconProps,
  IconQuoteFilled,
  IconReload,
  IconTrash,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import * as dateFns from 'date-fns'
import { concat } from 'lodash'
import type { UIElementData } from 'photoswipe'
import type React from 'react'
import { type FC, forwardRef, type MouseEventHandler, memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item as GalleryItem } from 'react-photoswipe-gallery'
import Markdown from '@/components/Markdown'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { navigateToSettings } from '@/modals/Settings'
import { copyToClipboard } from '@/packages/navigator'
import { countWord } from '@/packages/word-count'
import platform from '@/platform'
import storage from '@/storage'
import { getSession } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { Message, MessagePicture, MessageToolCallPart, SessionType } from '../../shared/types'
import { getMessageText } from '../../shared/utils/message'
import '../static/Block.css'
import { generateMore, modifyMessage, regenerateInNewFork, removeMessage } from '../stores/sessionActions'
import * as toastActions from '../stores/toastActions'
import ActionMenu, { type ActionMenuItemProps } from './ActionMenu'
import { isContainRenderableCode, MessageArtifact } from './Artifact'
import { MessageAttachment } from './Attachments'
import { AssistantAvatar, SystemAvatar, UserAvatar } from './Avatar'
import Loading from './icons/Loading'
import MessageErrTips from './MessageErrTips'
import MessageStatuses from './MessageLoading'
import { ReasoningContentUI, ToolCallPartUI } from './message-parts/ToolCallPartUI'
import { ScalableIcon } from './ScalableIcon'

interface Props {
  id?: string
  sessionId: string
  sessionType: SessionType
  msg: Message
  className?: string
  collapseThreshold?: number // 文本长度阀值, 超过这个长度则会被折叠
  buttonGroup?: 'auto' | 'always' | 'none' // 按钮组显示策略, auto: 只在 hover 时显示; always: 总是显示; none: 不显示
  small?: boolean
  assistantAvatarKey?: string
  sessionPicUrl?: string
}

const _Message: FC<Props> = (props) => {
  const {
    sessionId,
    msg,
    className,
    collapseThreshold,
    buttonGroup = 'auto',
    small,
    assistantAvatarKey,
    sessionPicUrl,
  } = props

  const { t } = useTranslation()
  const theme = useTheme()
  const isSamllScreen = useIsSmallScreen()
  const {
    userAvatarKey,
    showMessageTimestamp,
    showModelName,
    showTokenCount,
    showWordCount,
    showTokenUsed,
    showFirstTokenLatency,
    enableMarkdownRendering,
    enableLaTeXRendering,
    enableMermaidRendering,
    autoPreviewArtifacts,
    autoCollapseCodeBlock,
  } = useSettingsStore((state) => state)

  const [previewArtifact, setPreviewArtifact] = useState(autoPreviewArtifacts)
  const [shouldThrowError, setShouldThrowError] = useState(false)

  const contentLength = useMemo(() => {
    return getMessageText(msg).length
  }, [msg])

  const needCollapse =
    collapseThreshold &&
    props.sessionType !== 'picture' && // 绘图会话不折叠
    contentLength > collapseThreshold &&
    contentLength - collapseThreshold > 50 // 只有折叠有明显效果才折叠，为了更好的用户体验
  const [isCollapsed, setIsCollapsed] = useState(needCollapse)

  const ref = useRef<HTMLDivElement>(null)

  const setQuote = useUIStore((state) => state.setQuote)

  const quoteMsg = useCallback(() => {
    let input = getMessageText(msg)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    input += '\n\n-------------------\n\n'
    setQuote(input)
  }, [msg, setQuote])

  const handleStop = () => {
    modifyMessage(sessionId, { ...msg, generating: false }, true)
  }

  const handleRefresh = () => {
    handleStop()
    regenerateInNewFork(sessionId, msg)
  }

  const onGenerateMore = () => {
    generateMore(sessionId, msg.id)
  }

  const onCopyMsg = () => {
    copyToClipboard(getMessageText(msg, true, false))
    toastActions.add(t('copied to clipboard'), 2000)
  }

  // 复制特定 reasoning 内容
  const onCopyReasoningContent =
    (content: string): MouseEventHandler<HTMLButtonElement> =>
    (e) => {
      e.stopPropagation()
      if (content) {
        copyToClipboard(content)
        toastActions.add(t('copied to clipboard'))
      }
    }

  const onReport = useCallback(async () => {
    await NiceModal.show('report-content', { contentId: getMessageText(msg) || msg.id })
  }, [msg])

  const onDelMsg = useCallback(() => {
    removeMessage(sessionId, msg.id)
  }, [msg.id, sessionId])

  const onEditClick = async () => {
    await NiceModal.show('message-edit', { sessionId, msg: msg })
  }

  // for testing: manual trigger error
  const onTriggerError = useCallback(() => {
    setShouldThrowError(true)
  }, [])

  const onViewMessageJson = useCallback(async () => {
    await NiceModal.show('json-viewer', { title: t('Message Raw JSON'), data: msg })
  }, [msg, t])

  if (shouldThrowError) {
    throw new Error('Manual error triggered from Message component for testing ErrorBoundary')
  }

  const tips: string[] = []
  if (props.sessionType === 'chat' || !props.sessionType) {
    if (showWordCount && !msg.generating) {
      // 兼容旧版本没有提前计算的消息
      tips.push(`word count: ${msg.wordCount !== undefined ? msg.wordCount : countWord(getMessageText(msg))}`)
    }
    if (showTokenCount && !msg.generating) {
      // 兼容旧版本没有提前计算的消息
      // if (msg.tokenCount === undefined) {
      //   msg.tokenCount = estimateTokensFromMessages([msg])
      // }
      tips.push(`token count: ${msg.tokenCount}`)
    }
    if (showTokenUsed && msg.role === 'assistant' && !msg.generating) {
      tips.push(`tokens used: ${msg.usage?.totalTokens ? msg.usage.totalTokens : msg.tokensUsed || 'unknown'}`)
      // `tokens used: ${msg.usage?.totalTokens ? `${msg.usage.totalTokens}${msg.usage.cachedInputTokens ? `(cached: ${msg.usage.cachedInputTokens})` : ''}` : msg.tokensUsed || 'unknown'}`
    }
    if (showFirstTokenLatency && msg.role === 'assistant' && !msg.generating) {
      const latency = msg.firstTokenLatency ? `${msg.firstTokenLatency}ms` : 'unknown'
      tips.push(`first token latency: ${latency}`)
    }
    if (showModelName && props.msg.role === 'assistant') {
      tips.push(`model: ${props.msg.model || 'unknown'}`)
    }
  } else if (props.sessionType === 'picture') {
    if (showModelName && props.msg.role === 'assistant') {
      tips.push(`model: ${props.msg.model || 'unknown'}`)
      tips.push(`style: ${props.msg.style || 'unknown'}`)
    }
  }

  if (msg.finishReason && ['content-filter', 'length', 'error'].includes(msg.finishReason)) {
    tips.push(`finish reason: ${msg.finishReason}`)
  }

  // 消息时间戳
  if (showMessageTimestamp && msg.timestamp !== undefined) {
    const date = new Date(msg.timestamp)
    let messageTimestamp: string
    if (dateFns.isToday(date)) {
      // - 当天，显示 HH:mm
      messageTimestamp = dateFns.format(date, 'HH:mm')
    } else if (dateFns.isThisYear(date)) {
      // - 当年，显示 MM-dd HH:mm
      messageTimestamp = dateFns.format(date, 'MM-dd HH:mm')
    } else {
      // - 其他年份：yyyy-MM-dd HH:mm
      messageTimestamp = dateFns.format(date, 'yyyy-MM-dd HH:mm')
    }

    tips.push(`time: ${messageTimestamp}`)
  }

  // 是否需要渲染 Aritfact 组件
  const needArtifact = useMemo(() => {
    if (msg.role !== 'assistant') {
      return false
    }
    return isContainRenderableCode(getMessageText(msg))
  }, [msg.contentParts, msg.role, msg])

  const contentParts = msg.contentParts || []

  const CollapseButton = (
    <span
      className="cursor-pointer inline-block font-bold text-blue-500 hover:text-white hover:bg-blue-500"
      onClick={() => setIsCollapsed(!isCollapsed)}
    >
      [{isCollapsed ? t('Expand') : t('Collapse')}]
    </span>
  )

  const onClickAssistantAvatar = async () => {
    await NiceModal.show('session-settings', {
      session: await getSession(props.sessionId),
    })
  }

  const actionMenuItems = useMemo<ActionMenuItemProps[]>(
    () => [
      {
        text: t('quote'),
        icon: IconQuoteFilled,
        onClick: quoteMsg,
      },
      { divider: true },
      ...(msg.role === 'assistant' && platform.type === 'mobile'
        ? [
            {
              text: t('report'),
              icon: IconMessageReport,
              onClick: onReport,
            },
          ]
        : []),
      // 开发环境添加测试错误按钮
      ...(process.env.NODE_ENV === 'development'
        ? [
            // {
            //   text: 'Trigger Error (Test)',
            //   icon: IconBug,
            //   onClick: onTriggerError,
            // },
            {
              text: t('View Message JSON'),
              icon: IconCode,
              onClick: onViewMessageJson,
            },
          ]
        : []),
      {
        doubleCheck: true,
        text: t('delete'),
        icon: IconTrash,
        onClick: onDelMsg,
      },
    ],
    [t, msg.role, onReport, quoteMsg, onDelMsg, onTriggerError, onViewMessageJson]
  )
  const [actionMenuOpened, setActionMenuOpened] = useState(false)

  return (
    <Box
      ref={ref}
      id={props.id}
      key={msg.id}
      className={cn(
        'group/message',
        'msg-block',
        'px-2 py-1.5',
        msg.generating ? 'rendering' : 'render-done',
        { user: 'user-msg', system: 'system-msg', assistant: 'assistant-msg', tool: 'tool-msg' }[msg.role || 'user'],
        className,
        'w-full'
      )}
      sx={{
        paddingBottom: '0.1rem',
        paddingX: '1rem',
        [theme.breakpoints.down('sm')]: {
          paddingX: '0.3rem',
        },
      }}
    >
      <Grid container wrap="nowrap" spacing={1.5}>
        <Grid item>
          <Box className={cn('relative', msg.role !== 'assistant' ? 'mt-1' : 'mt-2')}>
            {
              {
                assistant: (
                  <AssistantAvatar
                    avatarKey={assistantAvatarKey}
                    picUrl={sessionPicUrl}
                    sessionType={props.sessionType}
                    onClick={onClickAssistantAvatar}
                  />
                ),
                user: <UserAvatar avatarKey={userAvatarKey} onClick={() => navigateToSettings('/chat')} />,
                system: <SystemAvatar sessionType={props.sessionType} onClick={onClickAssistantAvatar} />,
                tool: null,
              }[msg.role]
            }
            {msg.role === 'assistant' && msg.generating && (
              <Flex className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <Loader size={32} className=" " classNames={{ root: "after:content-[''] after:border-[2px]" }} />
              </Flex>
            )}
          </Box>
        </Grid>
        <Grid item xs sm container sx={{ width: '0px', paddingRight: '15px' }}>
          <Grid item xs>
            <MessageStatuses statuses={msg.status} />
            <div
              className={cn(
                'max-w-full inline-block',
                msg.role !== 'assistant' ? 'bg-chatbox-background-secondary px-4 rounded-lg' : 'w-full'
              )}
            >
              <Box
                className={cn('msg-content', { 'msg-content-small': small })}
                sx={small ? { fontSize: theme.typography.body2.fontSize } : {}}
              >
                {msg.reasoningContent && (
                  <ReasoningContentUI message={msg} onCopyReasoningContent={onCopyReasoningContent} />
                )}
                {
                  // 这里的空行仅仅是为了在只发送文件时消息气泡的美观
                  // 正常情况下，应该考虑优化 msg-content 的样式。现在这里是一个临时的偷懒方式。
                  getMessageText(msg, true, true).trim() === '' && <p></p>
                }
                {contentParts && contentParts.length > 0 && (
                  <div>
                    {contentParts.map((item, index) =>
                      item.type === 'reasoning' ? (
                        <div key={`reasoning-${msg.id}-${index}`}>
                          <ReasoningContentUI
                            message={msg}
                            part={item}
                            onCopyReasoningContent={onCopyReasoningContent}
                          />
                        </div>
                      ) : item.type === 'text' ? (
                        <div key={`text-${msg.id}-${index}`}>
                          {enableMarkdownRendering && !isCollapsed ? (
                            <Markdown
                              uniqueId={`${msg.id}-${index}`}
                              enableLaTeXRendering={enableLaTeXRendering}
                              enableMermaidRendering={enableMermaidRendering}
                              generating={msg.generating}
                            >
                              {item.text || ''}
                            </Markdown>
                          ) : (
                            <div className="break-words whitespace-pre-line">
                              {needCollapse && isCollapsed ? `${item.text.slice(0, collapseThreshold)}...` : item.text}
                              {needCollapse && isCollapsed && CollapseButton}
                            </div>
                          )}
                        </div>
                      ) : item.type === 'info' ? (
                        <Flex key={`info-${item.text}`} className="mb-2 ">
                          <Flex
                            className="bg-chatbox-background-brand-secondary border-0 border-l-2 border-solid border-chatbox-tint-brand rounded-r-md"
                            align="center"
                            gap="xxs"
                            px="xs"
                          >
                            <ScalableIcon
                              icon={IconInfoCircle}
                              size={16}
                              className="flex-none text-chatbox-tint-brand"
                            />

                            <Text size="xs" c="chatbox-brand">
                              {item.text}
                            </Text>
                          </Flex>
                        </Flex>
                      ) : item.type === 'image' ? (
                        props.sessionType !== 'picture' && (
                          <div key={`image-${item.storageKey}`} className="mt-2">
                            <PictureGallery key={`image-${item.storageKey}`} pictures={[item]} />
                            {item.ocrResult && (
                              <div
                                className="my-2 p-2 bg-chatbox-background-brand-secondary rounded-md cursor-pointer hover:bg-chatbox-background-brand-secondary-hover transition-colors"
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  await NiceModal.show('ocr-content-viewer', { content: item.ocrResult })
                                }}
                              >
                                <Typography variant="caption" className="text-gray-600 dark:text-gray-400 block mb-1">
                                  {t('OCR Text')} ({item.ocrResult.length} {t('characters')})
                                </Typography>
                                <Typography
                                  variant="body2"
                                  className="line-clamp-2 text-gray-700 dark:text-gray-300"
                                  title={item.ocrResult}
                                >
                                  {item.ocrResult}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  className="text-blue-500 hover:text-blue-600 mt-1 inline-block"
                                >
                                  {t('Click to view full text')}
                                </Typography>
                              </div>
                            )}
                          </div>
                        )
                      ) : item.type === 'tool-call' ? (
                        <ToolCallPartUI key={item.toolCallId} part={item as MessageToolCallPart} />
                      ) : null
                    )}
                  </div>
                )}
              </Box>
              {props.sessionType === 'picture' && msg.contentParts.filter((p) => p.type === 'image').length > 0 && (
                <PictureGallery
                  pictures={msg.contentParts.filter((p) => p.type === 'image')}
                  onReport={platform.type === 'mobile' ? onReport : undefined}
                />
              )}
              {(msg.files || msg.links) && (
                <div className="flex flex-row items-start justify-start overflow-x-auto overflow-y-hidden pb-1">
                  {msg.files?.map((file) => (
                    <MessageAttachment key={file.name} label={file.name} filename={file.name} />
                  ))}
                  {msg.links?.map((link) => (
                    <MessageAttachment key={link.url} label={link.title} url={link.url} />
                  ))}
                </div>
              )}
              <MessageErrTips msg={msg} />
              {needCollapse && !isCollapsed && CollapseButton}

              {msg.generating && msg.contentParts.length === 0 && <Loading />}

              {!msg.generating && msg.role === 'assistant' && tips.length > 0 && (
                <Text c="chatbox-tertiary">{tips.join(', ')}</Text>
              )}
            </div>

            {/* actions */}
            {buttonGroup !== 'none' && !msg.generating && (
              <Flex
                gap={0}
                m="4px -4px -4px -4px"
                className={clsx(
                  'group-hover/message:opacity-100 opacity-0 transition-opacity',
                  actionMenuOpened || buttonGroup === 'always' ? 'opacity-100' : '',
                  isSamllScreen ? 'sticky bottom-4' : ''
                )}
                align="center"
              >
                <Flex
                  gap={0}
                  className={
                    isSamllScreen
                      ? 'p-xxs bg-chatbox-background-primary rounded-md border-[0.5px] border-solid border-chatbox-border-primary shadow-sm'
                      : ''
                  }
                >
                  {!msg.generating && msg.role === 'assistant' && (
                    <MessageActionIcon icon={IconReload} tooltip={t('Reply Again')} onClick={handleRefresh} />
                  )}

                  {msg.role !== 'assistant' && (
                    <MessageActionIcon icon={IconArrowDown} tooltip={t('Reply Again Below')} onClick={onGenerateMore} />
                  )}

                  {
                    // Chatbox-AI 模型不支持编辑消息
                    !msg.model?.startsWith('Chatbox-AI') &&
                      // 图片会话中，助手消息无需编辑
                      !(msg.role === 'assistant' && props.sessionType === 'picture') && (
                        <MessageActionIcon icon={IconPencil} tooltip={t('edit')} onClick={onEditClick} />
                      )
                  }

                  {!(props.sessionType === 'picture' && msg.role === 'assistant') && (
                    <MessageActionIcon icon={IconCopy} tooltip={t('copy')} onClick={onCopyMsg} />
                  )}

                  {!msg.generating && props.sessionType === 'picture' && msg.role === 'assistant' && (
                    <MessageActionIcon
                      icon={IconPhotoPlus}
                      tooltip={t('Generate More Images Below')}
                      onClick={onGenerateMore}
                    />
                  )}

                  <ActionMenu
                    items={actionMenuItems}
                    opened={actionMenuOpened}
                    onChange={(opened) => setActionMenuOpened(opened)}
                  >
                    <MessageActionIcon icon={IconDotsVertical} tooltip={t('More')} />
                  </ActionMenu>
                </Flex>
              </Flex>
            )}
          </Grid>
        </Grid>
      </Grid>
    </Box>
  )
}

export default memo(_Message)

function getBase64ImageSize(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = (err) => {
      reject(err)
    }
    img.src = base64
  })
}

type PictureGalleryProps = {
  pictures: MessagePicture[]
  onReport?(picture: MessagePicture): void
}

const PictureGallery = memo(({ pictures, onReport }: PictureGalleryProps) => {
  const isSmallScreen = useIsSmallScreen()
  const uiElements: UIElementData[] = concat(
    [
      {
        name: 'custom-download-button',
        ariaLabel: 'Download',
        order: 9,
        isButton: true,
        html: {
          isCustomSVG: true,
          inner:
            '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
          outlineID: 'pswp__icn-download',
        },
        appendTo: 'bar',
        onClick: async (_e, _el, pswp) => {
          const picture = pictures[pswp.currIndex]
          if (picture.storageKey) {
            const base64 = await storage.getBlob(picture.storageKey)
            if (!base64) {
              return
            }
            // storageKey中含有冒号，会在android端导致存储失败，且android端在同文件名的情况下不会再次保存图片，也无提示，可能对用户造成困扰，所以增加随机后缀
            const filename =
              platform.type === 'mobile'
                ? `${picture.storageKey.replaceAll(':', '_')}_${Math.random().toString(36).substring(7)}`
                : picture.storageKey
            platform.exporter.exportImageFile(filename, base64)
          } else if (picture.url) {
            platform.exporter.exportByUrl(`image_${Math.random().toString(36).substring(7)}`, picture.url)
          }
        },
      },
    ],
    onReport
      ? [
          {
            name: 'report-button',
            ariaLabel: 'Report',
            order: 8,
            isButton: true,
            html: {
              isCustomSVG: true,
              inner:
                '<path d="M 16 6 A 10 10 0 0 1 16 26 L 16 24 A 8 8 0 0 0 16 8 L 16 6 A 10 10 0 0 0 16 26 L 16 24 A 8 8 0 0 1 16 8 M 15 11 A 1 1 0 0 1 17 11 L 17 16 A 1 1 0 0 1 15 16 M 16 19 A 1.5 1.5 0 0 1 16 22 A 1.5 1.5 0 0 1 16 19 Z" id="pswp__icn-report">',
              outlineID: 'pswp__icn-report',
            },
            appendTo: 'bar',
            onClick: (_e, _el, pswp) => {
              const picture = pictures[pswp.currIndex]
              pswp.close()
              onReport(picture)
            },
          },
        ]
      : []
  )
  return (
    <Flex gap="sm" wrap="wrap">
      <Gallery uiElements={uiElements}>
        {pictures.map((p) =>
          p.storageKey ? (
            <ImageInStorageGalleryItem key={p.storageKey} storageKey={p.storageKey} />
          ) : p.url ? (
            <GalleryItem key={p.url} original={p.url} thumbnail={p.url} width={1024} height={1024}>
              {({ ref, open }) => (
                <Img
                  src={p.url}
                  h={isSmallScreen ? 100 : 200}
                  w="auto"
                  fit="contain"
                  radius="md"
                  ref={ref}
                  onClick={open}
                  className="cursor-pointer"
                />
              )}
            </GalleryItem>
          ) : undefined
        )}
      </Gallery>
    </Flex>
  )
})

const ImageInStorageGalleryItem = ({ storageKey }: { storageKey: string }) => {
  const isSmallScreen = useIsSmallScreen()
  const { data: pic } = useQuery({
    queryKey: ['image-in-storage-gallery-item', storageKey],
    queryFn: async ({ queryKey: [, key] }) => {
      const blob = await storage.getBlob(key)
      const base64 = blob?.startsWith('data:image/') ? blob : `data:image/png;base64,${blob}`
      const size = await getBase64ImageSize(base64)
      return {
        storageKey,
        ...size,
        data: base64,
      }
    },
    staleTime: Infinity,
  })

  return pic ? (
    <GalleryItem original={pic.data} thumbnail={pic.data} width={pic.width} height={pic.height}>
      {({ ref, open }) => (
        <Img
          src={pic.data}
          h={isSmallScreen ? 100 : 200}
          w="auto"
          fit="contain"
          radius="md"
          ref={ref}
          onClick={open}
          className="cursor-pointer"
        />
      )}
    </GalleryItem>
  ) : null
}

export const MessageActionIcon = forwardRef<
  HTMLButtonElement,
  ActionIconProps & {
    tooltip?: string | null
    onClick?: MouseEventHandler<HTMLButtonElement>
    icon: React.ElementType<IconProps>
  }
>(({ tooltip, icon, ...props }, ref) => {
  const isSmallScreen = useIsSmallScreen()
  const actionIcon = (
    <ActionIcon
      ref={ref}
      variant="subtle"
      w="auto"
      h="auto"
      miw="auto"
      mih="auto"
      p={4}
      bd={0}
      color="chatbox-secondary"
      {...props}
    >
      <ScalableIcon icon={icon} size={isSmallScreen ? 20 : 16} />
    </ActionIcon>
  )

  return tooltip ? (
    <Tooltip1 label={tooltip} openDelay={1000} withArrow>
      {actionIcon}
    </Tooltip1>
  ) : (
    actionIcon
  )
})
