import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, type ActionIconProps, Flex, Image as Img, Loader, Text, Tooltip as Tooltip1 } from '@mantine/core'
import { Grid, useTheme } from '@mui/material'
import Box from '@mui/material/Box'
import type { Message, MessageAppPart, MessagePicture, MessageToolCallPart, SessionType } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
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
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import Markdown from '@/components/Markdown'
import { useFetchBlob } from '@/hooks/useBlob'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { navigateToSettings } from '@/modals/Settings'
import { copyToClipboard } from '@/packages/navigator'
import { countWord } from '@/packages/word-count'
import platform from '@/platform'
import { getSession } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import '../../static/Block.css'
import { generateMore, modifyMessage, regenerateInNewFork, removeMessage } from '@/stores/sessionActions'
import * as toastActions from '@/stores/toastActions'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { isContainRenderableCode, MessageArtifact } from '../Artifact'
import { ChatBridgeMessagePart } from '../chatbridge/ChatBridgeMessagePart'
import { AssistantAvatar, SystemAvatar, UserAvatar } from '../common/Avatar'
import { ScalableIcon } from '../common/ScalableIcon'
import Loading from '../icons/Loading'
import { ReasoningContentUI, ToolCallPartUI, WebSearchGroupUI } from '../message-parts/ToolCallPartUI'
import { MessageAttachmentGrid } from './MessageAttachmentGrid'
import MessageErrTips from './MessageErrTips'
import MessageStatuses from './MessageLoading'

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
  const isSmallScreen = useIsSmallScreen()
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
    showAvatar,
    messageLayout,
  } = useSettingsStore((state) => state)

  const isBubbleLayout = messageLayout === 'bubble'

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

  const prefillChatBridgePrompt = useCallback(
    (prompt: string) => {
      const normalizedPrompt = prompt.trim()
      if (!normalizedPrompt) {
        return
      }
      setQuote(`${normalizedPrompt}\n\n`)
    },
    [setQuote]
  )

  const handleStop = useCallback(() => {
    modifyMessage(sessionId, { ...msg, generating: false }, true)
  }, [sessionId, msg])

  const handleRefresh = useCallback(() => {
    handleStop()
    regenerateInNewFork(sessionId, msg)
  }, [handleStop, sessionId, msg])

  const onGenerateMore = useCallback(() => {
    generateMore(sessionId, msg.id)
  }, [sessionId, msg.id])

  const onCopyMsg = useCallback(() => {
    copyToClipboard(getMessageText(msg, true, false))
    toastActions.add(t('copied to clipboard'), 2000)
  }, [msg, t])

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

  const onEditClick = useCallback(async () => {
    await NiceModal.show('message-edit', { sessionId, msg: msg })
  }, [msg, sessionId])

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

  // Units like "tokens", "words", "tkn", "s" are intentionally kept as hardcoded English
  // because they are technical/universal abbreviations that remain readable across all locales.
  const tips: { label: string; tooltip?: string }[] = []
  if (props.sessionType === 'chat' || !props.sessionType) {
    if (showModelName && props.msg.role === 'assistant') {
      tips.push({ label: props.msg.model || 'unknown', tooltip: t('Model') as string })
    }
    if (showTokenUsed && msg.role === 'assistant' && !msg.generating) {
      const tokens = msg.usage?.totalTokens ? msg.usage.totalTokens : msg.tokensUsed
      if (tokens) tips.push({ label: `${tokens} tokens`, tooltip: t('Total tokens consumed') as string })
    }
    if (showWordCount && !msg.generating) {
      const wc = msg.wordCount !== undefined ? msg.wordCount : countWord(getMessageText(msg))
      tips.push({ label: `${wc} words`, tooltip: t('Word count') as string })
    }
    if (showFirstTokenLatency && msg.role === 'assistant' && !msg.generating) {
      if (msg.firstTokenLatency)
        tips.push({
          label: `${(msg.firstTokenLatency / 1000).toFixed(1)}s`,
          tooltip: t('First token latency') as string,
        })
    }
    // if (showTokenCount && !msg.generating) {
    //   if (msg.tokenCount) tips.push({ label: `${msg.tokenCount} tkn`, tooltip: t('Token count') as string })
    // }
  } else if (props.sessionType === 'picture') {
    if (showModelName && props.msg.role === 'assistant') {
      tips.push({ label: props.msg.model || 'unknown', tooltip: t('Model') as string })
      if (props.msg.style) tips.push({ label: props.msg.style })
    }
  }

  if (msg.finishReason && ['content-filter', 'length', 'error'].includes(msg.finishReason)) {
    tips.push({ label: msg.finishReason })
  }

  if (showMessageTimestamp && msg.timestamp !== undefined) {
    const date = new Date(msg.timestamp)
    let messageTimestamp: string
    if (dateFns.isToday(date)) {
      messageTimestamp = dateFns.format(date, 'HH:mm')
    } else if (dateFns.isThisYear(date)) {
      messageTimestamp = dateFns.format(date, 'MM-dd HH:mm')
    } else {
      messageTimestamp = dateFns.format(date, 'yyyy-MM-dd HH:mm')
    }
    tips.push({ label: messageTimestamp })
  }

  // 是否需要渲染 Aritfact 组件
  const needArtifact = useMemo(() => {
    if (msg.role !== 'assistant') {
      return false
    }
    if (msg.contentParts.some((part) => part.type === 'app')) {
      return false
    }
    return isContainRenderableCode(getMessageText(msg))
  }, [msg.contentParts, msg.role, msg])

  const trackWithSessionName = useCallback(
    async (event: string) => {
      const session = await getSession(sessionId).catch(() => null)
      trackJkClickEvent(event, {
        pageName: JK_PAGE_NAMES.CHAT_PAGE,
        content: session?.name,
      })
    },
    [sessionId]
  )
  const onCodeCopy = useCallback(() => {
    trackWithSessionName(JK_EVENTS.COPY_CODE_CLICK)
  }, [trackWithSessionName])
  const onPreviewWebpage = useCallback(() => {
    trackWithSessionName(JK_EVENTS.PREVIEW_WEBPAGE_CLICK)
  }, [trackWithSessionName])

  const contentParts = msg.contentParts || []

  const groupedContentParts = useMemo(() => {
    const groups: Array<{ type: 'web_search_group'; parts: MessageToolCallPart[] } | (typeof contentParts)[number]> = []
    for (const item of contentParts) {
      if (item.type === 'tool-call' && (item as MessageToolCallPart).toolName === 'web_search') {
        const last = groups[groups.length - 1]
        if (last && 'parts' in last && last.type === 'web_search_group') {
          last.parts.push(item as MessageToolCallPart)
        } else {
          groups.push({ type: 'web_search_group', parts: [item as MessageToolCallPart] })
        }
      } else {
        groups.push(item)
      }
    }
    return groups
  }, [contentParts])

  const CollapseButton = (
    <span
      className="cursor-pointer inline-block text-xs font-medium text-chatbox-tint-brand
                 hover:text-chatbox-tint-brand-hover px-1.5 py-0.5 rounded
                 hover:bg-chatbox-background-brand-secondary transition-colors"
      onClick={() => setIsCollapsed(!isCollapsed)}
    >
      {isCollapsed ? t('Expand') : t('Collapse')}
    </span>
  )

  const onClickAssistantAvatar = async () => {
    await NiceModal.show('session-settings', {
      session: await getSession(props.sessionId),
    })
  }

  const actionMenuItems = useMemo<ActionMenuItemProps[]>(
    () => [
      ...(isSmallScreen
        ? [
            !msg.generating &&
              msg.role === 'assistant' && {
                text: t('Reply Again'),
                icon: IconReload,
                onClick: handleRefresh,
              },
            msg.role !== 'assistant' && {
              text: t('Reply Again Below'),
              icon: IconArrowDown,
              onClick: onGenerateMore,
            },
            !msg.model?.startsWith('Chatbox-AI') &&
              !(msg.role === 'assistant' && props.sessionType === 'picture') && {
                text: t('Edit'),
                icon: IconPencil,
                onClick: onEditClick,
              },
            !(props.sessionType === 'picture' && msg.role === 'assistant') && {
              text: t('copy'),
              icon: IconCopy,
              onClick: onCopyMsg,
            },
            !msg.generating &&
              props.sessionType === 'picture' &&
              msg.role === 'assistant' && {
                text: t('Generate More Images Below'),
                icon: IconPhotoPlus,
                onClick: onGenerateMore,
              },
          ].filter((i) => !!i)
        : []),
      {
        text: t('Quote'),
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
    [
      t,
      msg.role,
      onReport,
      quoteMsg,
      onDelMsg,
      onViewMessageJson,
      isSmallScreen,
      handleRefresh,
      msg.generating,
      onGenerateMore,
      onEditClick,
      onCopyMsg,
      msg.model,
      props.sessionType,
    ]
  )
  const [actionMenuOpened, setActionMenuOpened] = useState(false)

  const isUserBubble = isBubbleLayout && msg.role === 'user'

  const messageContent = (
    <>
      <MessageStatuses statuses={msg.status} />
      <div
        className={cn(
          isBubbleLayout ? 'inline-block max-w-full' : msg.role === 'assistant' ? 'w-full' : 'inline-block',
          isBubbleLayout
            ? cn(
                'px-4 py-1 rounded-2xl',
                msg.role === 'user'
                  ? 'bg-[var(--mantine-color-chatbox-brand-filled)] text-white'
                  : msg.role === 'assistant'
                    ? msg.error
                      ? 'bg-chatbox-background-error-secondary border border-solid border-chatbox-border-error'
                      : 'bg-chatbox-background-secondary'
                    : 'bg-chatbox-background-secondary rounded-lg'
              )
            : msg.role !== 'assistant'
              ? 'bg-chatbox-background-secondary px-4 rounded-lg'
              : ''
        )}
      >
        <Box
          className={cn('msg-content', { 'msg-content-small': small })}
          sx={small ? { fontSize: theme.typography.body2.fontSize } : {}}
        >
          {msg.reasoningContent && <ReasoningContentUI message={msg} onCopyReasoningContent={onCopyReasoningContent} />}
          {getMessageText(msg, true, true).trim() === '' && <p></p>}
          {groupedContentParts.length > 0 && (
            <div>
              {groupedContentParts.map((item, index) =>
                'parts' in item && item.type === 'web_search_group' ? (
                  <WebSearchGroupUI key={`web-search-group-${msg.id}-${index}`} parts={item.parts} />
                ) : item.type === 'reasoning' ? (
                  <div key={`reasoning-${msg.id}-${index}`}>
                    <ReasoningContentUI message={msg} part={item} onCopyReasoningContent={onCopyReasoningContent} />
                  </div>
                ) : item.type === 'text' ? (
                  <div key={`text-${msg.id}-${index}`}>
                    {enableMarkdownRendering && !isCollapsed ? (
                      <Markdown
                        uniqueId={`${msg.id}-${index}`}
                        enableLaTeXRendering={enableLaTeXRendering}
                        enableMermaidRendering={enableMermaidRendering}
                        generating={msg.generating}
                        onCodeCopy={onCodeCopy}
                        onPreviewWebpage={onPreviewWebpage}
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
                      <ScalableIcon icon={IconInfoCircle} size={16} className="flex-none text-chatbox-tint-brand" />
                      <Text size="xs" c="chatbox-brand">
                        {item.text}
                      </Text>
                    </Flex>
                  </Flex>
                ) : item.type === 'app' ? (
                  <ChatBridgeMessagePart
                    key={`app-${item.appInstanceId}-${index}`}
                    part={item as MessageAppPart}
                    onPrefillPrompt={prefillChatBridgePrompt}
                  />
                ) : item.type === 'image' ? (
                  props.sessionType !== 'picture' && (
                    <div key={`image-${item.storageKey}`} className="my-2">
                      <PictureGallery
                        key={`image-${item.storageKey}`}
                        pictures={[item]}
                        compact={msg.role === 'user'}
                      />
                      {item.ocrResult && (
                        <div
                          className="my-2 p-2 rounded-md cursor-pointer transition-colors"
                          onClick={async (e) => {
                            e.stopPropagation()
                            await NiceModal.show('content-viewer', {
                              title: t('OCR Text Content'),
                              content: item.ocrResult,
                            })
                          }}
                        >
                          {isUserBubble ? (
                            <>
                              <span className="block mb-1 text-xs text-white/80">
                                {t('OCR Text')} ({item.ocrResult.length} {t('characters')})
                              </span>
                              <span className="block text-sm text-white line-clamp-2" title={item.ocrResult}>
                                {item.ocrResult}
                              </span>
                              <span className="block mt-1 text-xs text-white/60">{t('Click to view full text')}</span>
                            </>
                          ) : (
                            <>
                              <Text size="xs" className="block mb-1" c="chatbox-tertiary">
                                {t('OCR Text')} ({item.ocrResult.length} {t('characters')})
                              </Text>
                              <Text size="sm" className="line-clamp-2" c="chatbox-secondary" title={item.ocrResult}>
                                {item.ocrResult}
                              </Text>
                              <Text size="xs" className="mt-1 inline-block" c="blue">
                                {t('Click to view full text')}
                              </Text>
                            </>
                          )}
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
          {needArtifact && (
            <MessageArtifact
              sessionId={sessionId}
              messageId={msg.id}
              messageContent={getMessageText(msg, true, true)}
              generating={msg.generating}
              preview={previewArtifact}
              setPreview={setPreviewArtifact}
            />
          )}
        </Box>
        {props.sessionType === 'picture' && contentParts.filter((p) => p.type === 'image').length > 0 && (
          <PictureGallery
            pictures={contentParts.filter((p) => p.type === 'image')}
            onReport={platform.type === 'mobile' ? onReport : undefined}
          />
        )}
        <MessageErrTips
          msg={msg}
          onRetry={msg.role === 'assistant' ? handleRefresh : undefined}
          isBubbleLayout={isBubbleLayout}
        />
        {needCollapse && !isCollapsed && CollapseButton}
        {msg.generating && contentParts.length === 0 && (
          <div
            className={cn(
              'inline-flex items-center gap-1.5 py-3',
              isBubbleLayout ? 'px-1 rounded-2xl bg-chatbox-background-secondary' : 'px-4'
            )}
          >
            <Loading />
          </div>
        )}
      </div>
    </>
  )

  const tipsElements =
    !msg.generating &&
    tips.length > 0 &&
    tips.map((tip, i) => {
      const text = (
        <Text key={i} size="11px" c="chatbox-tertiary" ff="monospace" lh={1.4} className="whitespace-nowrap">
          {i > 0 ? `· ${tip.label}` : tip.label}
        </Text>
      )
      return tip.tooltip ? (
        <Tooltip1 key={i} label={tip.tooltip} withArrow>
          {text}
        </Tooltip1>
      ) : (
        text
      )
    })

  const actionButtons = buttonGroup !== 'none' && !msg.generating && (
    <Flex
      gap={0}
      m="4px -4px -4px -4px"
      className={clsx(
        'group-hover/message:opacity-100 opacity-0 transition-opacity',
        actionMenuOpened || buttonGroup === 'always' ? 'opacity-100' : '',
        isSmallScreen ? 'sticky bottom-4' : ''
      )}
      align="center"
    >
      <Flex
        gap={0}
        className={
          isSmallScreen
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
        {!msg.model?.startsWith('Chatbox-AI') && !(msg.role === 'assistant' && props.sessionType === 'picture') && (
          <MessageActionIcon icon={IconPencil} tooltip={t('Edit')} onClick={onEditClick} />
        )}
        {!(props.sessionType === 'picture' && msg.role === 'assistant') && (
          <MessageActionIcon icon={IconCopy} tooltip={t('Copy')} onClick={onCopyMsg} />
        )}
        {!msg.generating && props.sessionType === 'picture' && msg.role === 'assistant' && (
          <MessageActionIcon icon={IconPhotoPlus} tooltip={t('Generate More Images Below')} onClick={onGenerateMore} />
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
  )

  const meta = (
    <Flex
      direction="column"
      gap={2}
      mt={isBubbleLayout ? 4 : 2}
      className={cn(isBubbleLayout ? 'px-1' : '')}
      align={isUserBubble ? 'flex-end' : 'flex-start'}
    >
      {tipsElements && (
        <Flex
          align="center"
          gap={4}
          wrap="wrap"
          justify={isUserBubble ? 'flex-end' : 'flex-start'}
          className="overflow-hidden"
        >
          {tipsElements}
        </Flex>
      )}
    </Flex>
  )

  if (isBubbleLayout && msg.role === 'user') {
    return (
      <Box
        ref={ref}
        id={props.id}
        key={msg.id}
        className={cn(
          'group/message',
          'msg-block',
          'bubble-user-msg',
          'px-2 py-1.5',
          msg.generating ? 'rendering' : 'render-done',
          'user-msg',
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
        <Flex justify="flex-end" gap="xs" className="w-full">
          <Flex direction="column" align="flex-end" className={cn('max-w-[85%]', isSmallScreen && 'max-w-[95%]')}>
            {messageContent}
            {(msg.files || msg.links) && <MessageAttachmentGrid files={msg.files} links={msg.links} align="end" />}
            {meta}
            {actionButtons}
          </Flex>
          {(showAvatar ?? true) && (
            <Box className="mt-1 shrink-0">
              <UserAvatar avatarKey={userAvatarKey} onClick={() => navigateToSettings('/chat')} />
            </Box>
          )}
        </Flex>
      </Box>
    )
  }

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
        {(showAvatar ?? true) && (
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
                  user: !isBubbleLayout ? (
                    <UserAvatar avatarKey={userAvatarKey} onClick={() => navigateToSettings('/chat')} />
                  ) : null,
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
        )}
        <Grid item xs sm container sx={{ width: '0px', paddingRight: (showAvatar ?? true) ? '15px' : '0px' }}>
          <Grid item xs>
            {messageContent}
            {(msg.files || msg.links) && (
              <MessageAttachmentGrid files={msg.files} links={msg.links} align={isUserBubble ? 'end' : 'start'} />
            )}
            {meta}
            {actionButtons}
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
    const cleanup = () => {
      img.onload = null
      img.onerror = null
      try {
        img.src = ''
      } catch {
        // ignore
      }
    }
    img.onload = () => {
      const size = { width: img.width, height: img.height }
      cleanup()
      resolve(size)
    }
    img.onerror = (err) => {
      cleanup()
      reject(err)
    }
    img.src = base64
  })
}

type PictureGalleryProps = {
  pictures: MessagePicture[]
  compact?: boolean
  onReport?(picture: MessagePicture): void
}

const PictureGallery = memo(({ pictures, compact, onReport }: PictureGalleryProps) => {
  const isSmallScreen = useIsSmallScreen()
  const imageHeight = compact ? (isSmallScreen ? 60 : 100) : isSmallScreen ? 100 : 200
  const fetchBlob = useFetchBlob()
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
        onClick: async (_e: MouseEvent, _el: HTMLElement, pswp: import('photoswipe').default) => {
          const picture = pictures[pswp.currIndex]
          if (picture.storageKey) {
            const base64 = await fetchBlob(picture.storageKey)
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
            <ImageInStorageGalleryItem key={p.storageKey} storageKey={p.storageKey} height={imageHeight} />
          ) : p.url ? (
            <GalleryItem key={p.url} original={p.url} thumbnail={p.url} width={1024} height={1024}>
              {({ ref, open }) => (
                <Img
                  src={p.url}
                  h={imageHeight}
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

const ImageInStorageGalleryItem = ({ storageKey, height }: { storageKey: string; height?: number }) => {
  const isSmallScreen = useIsSmallScreen()
  const fallbackHeight = isSmallScreen ? 100 : 200
  const fetchBlob = useFetchBlob()
  const { data: pic } = useQuery({
    queryKey: ['image-in-storage-gallery-item', storageKey],
    queryFn: async ({ queryKey: [, key] }) => {
      const blob = await fetchBlob(key as string)
      if (!blob) {
        return null
      }
      const base64 = blob.startsWith('data:image/') ? blob : `data:image/png;base64,${blob}`
      const size = await getBase64ImageSize(base64)
      return {
        storageKey,
        ...size,
        data: base64,
      }
    },
    staleTime: Infinity,
    gcTime: 60 * 1000,
  })

  return pic ? (
    <GalleryItem original={pic.data} thumbnail={pic.data} width={pic.width} height={pic.height}>
      {({ ref, open }) => (
        <Img
          src={pic.data}
          h={height ?? fallbackHeight}
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
      aria-label={tooltip ?? undefined}
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
