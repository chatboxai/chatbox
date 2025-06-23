import { chatSessionSettingsAtom } from '@/stores/atoms'
import { createFileRoute, useRouterState } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import Page from '@/components/Page'
import InputBox, { InputBoxPayload } from '@/components/InputBoxNew'
import { ActionIcon, Avatar, Divider, Flex, Modal, ScrollArea, Stack, Text } from '@mantine/core'
import * as sessionActions from '@/stores/sessionActions'
import { CopilotDetail, createMessage, Message, SessionSettings } from 'src/shared/types'
import { delay } from '@/utils'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { v4 as uuidv4 } from 'uuid'
import { createSession } from '@/stores/sessionStorageMutations'
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import { ChatConfig } from '@/modals/SessionSettings'
import { initEmptyChatSession } from '@/stores/sessionActions'
import HomepageIcon from '@/components/icons/HomepageIcon'
import platform from '@/platform'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [chatSessionSettings, setChatSessionSettings] = useAtom(chatSessionSettingsAtom)
  const selectedModel = useMemo(() => {
    if (chatSessionSettings.provider && chatSessionSettings.modelId) {
      return {
        provider: chatSessionSettings.provider,
        modelId: chatSessionSettings.modelId,
      }
    }
  }, [chatSessionSettings])

  const { copilots: myCopilots } = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilots()
  const [selectedCopilotId, setSelectedCopilotId] = useState<string>()
  const selectedCopilot = useMemo(
    () => myCopilots.find((c) => c.id === selectedCopilotId) || remoteCopilots.find((c) => c.id === selectedCopilotId),
    [myCopilots, remoteCopilots, selectedCopilotId]
  )

  const routerState = useRouterState()
  useEffect(() => {
    const { copilotId } = routerState.location.search as any
    if (copilotId) {
      setSelectedCopilotId(copilotId)
    }
  }, [routerState.location.search])

  const [sessionSettings, setSessionSettings] = useState<SessionSettings>()
  const [opened, { open, close }] = useDisclosure(false)

  const handleSubmit = async ({
    needGenerating = true,
    input = '',
    pictureKeys = [],
    attachments = [],
    links = [],
    webBrowsing = false,
  }: InputBoxPayload) => {
    const msgs: Message[] = []

    if (selectedCopilot) {
      msgs.push({ id: uuidv4(), role: 'system', contentParts: [{ type: 'text', text: selectedCopilot.prompt }] })
      if (selectedCopilot.demoQuestion) {
        msgs.push({
          id: uuidv4(),
          role: 'user',
          contentParts: [{ type: 'text', text: selectedCopilot.demoQuestion }],
        })
      }
      if (selectedCopilot.demoAnswer) {
        msgs.push({
          id: uuidv4(),
          role: 'assistant',
          contentParts: [{ type: 'text', text: selectedCopilot.demoAnswer }],
        })
      }
    }
    const newSession = selectedCopilot
      ? await createSession({
          name: selectedCopilot.name,
          type: 'chat',
          picUrl: selectedCopilot.picUrl,
          messages: msgs,
          copilotId: selectedCopilot.id,
          settings: sessionSettings,
        })
      : await createSession({
          ...initEmptyChatSession(),
          settings: sessionSettings,
        })

    sessionActions.switchCurrentSession(newSession.id)

    const newMessage = createMessage('user', input)
    if (pictureKeys && pictureKeys.length > 0) {
      newMessage.contentParts.push(...pictureKeys.map((k) => ({ type: 'image' as const, storageKey: k })))
    }
    // FIXME: submitNewUserMessage内部会使用到getSession，getSession读取了一个动态的atom，是异步的，所以暂时通过延时来解决，否则会导致无法生成消息
    await delay(200)

    await sessionActions.submitNewUserMessage({
      currentSessionId: newSession.id,
      newUserMsg: newMessage,
      needGenerating,
      attachments,
      links,
      webBrowsing,
    })
    return true
  }

  return (
    <Page title="">
      <div className="p-0 flex flex-col h-full">
        <Stack align="center" justify="center" gap="sm" flex={1}>
          <HomepageIcon className="h-8" />
          <Text fw="600" size={isSmallScreen ? 'sm' : 'md'}>
            {t('What can I help you with today?')}
          </Text>
        </Stack>

        <Stack gap="sm">
          {selectedCopilot ? (
            <Stack mx="md" gap="sm">
              <Flex align="center" gap="sm">
                <CopilotItem copilot={selectedCopilot} selected />
                <ActionIcon
                  size={32}
                  radius={16}
                  c="chatbox-tertiary"
                  bg="#F1F3F5"
                  onClick={() => setSelectedCopilotId(undefined)}
                >
                  <IconX size={24} />
                </ActionIcon>
              </Flex>

              <Text c="chatbox-secondary" className="line-clamp-5">
                {selectedCopilot.prompt}
              </Text>
            </Stack>
          ) : (
            <CopilotPicker onSelect={(copilot) => setSelectedCopilotId(copilot?.id)} />
          )}

          <InputBox
            sessionType="chat"
            sessionId="new"
            model={selectedModel}
            onSelectModel={(p, m) =>
              setChatSessionSettings({
                provider: p as any,
                modelId: m,
              })
            }
            onClickSessionSettings={() => {
              open()
              return true
            }}
            onSubmit={handleSubmit}
          />
        </Stack>

        <Modal opened={opened} onClose={close} centered size="lg" title={t('Conversation Settings')}>
          <ChatConfig
            settings={{
              ...sessionSettings,
              provider: selectedModel?.provider,
              modelId: selectedModel?.modelId,
            }}
            onSettingsChange={(_settings) => setSessionSettings((old) => ({ ...(old ?? {}), ..._settings }))}
          />
        </Modal>
      </div>
    </Page>
  )
}

const CopilotPicker = ({ selectedId, onSelect }: { selectedId?: string; onSelect?(copilot?: CopilotDetail): void }) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const { copilots: myCopilots } = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilots()

  const copilots = useMemo(
    () => [
      ...myCopilots,
      ...(myCopilots.length && remoteCopilots.length ? [undefined] : []),
      ...remoteCopilots.filter((c) => !myCopilots.map((mc) => mc.id).includes(c.id)),
    ],
    [myCopilots, remoteCopilots]
  )

  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollPosition, onScrollPositionChange] = useState({ x: 0, y: 0 })

  return (
    !!copilots.length && (
      <Stack mx="md" gap="xs">
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
                    const scrollWidth = viewportRef.current.scrollWidth
                    const clientWidth = viewportRef.current.clientWidth
                    const newScrollPosition = Math.max(scrollPosition.x - clientWidth, 0)
                    viewportRef.current.scrollTo({ left: newScrollPosition, behavior: 'smooth' })
                    onScrollPositionChange({ x: newScrollPosition, y: 0 })
                  }
                }}
              >
                <IconChevronLeft size={16} />
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
                <IconChevronRight size={16} />
              </ActionIcon>
            </Flex>
          )}
        </Flex>

        <ScrollArea
          type={platform.type === 'mobile' ? 'never' : 'hover'}
          scrollbars="x"
          offsetScrollbars="x"
          mx={-16}
          viewportRef={viewportRef}
          onScrollPositionChange={onScrollPositionChange}
        >
          <Flex wrap="nowrap" gap="xs" px={16} className="haha">
            {copilots.map((copilot) =>
              copilot ? (
                <CopilotItem
                  key={copilot.id}
                  copilot={copilot}
                  selected={selectedId === copilot.id}
                  onClick={() => {
                    onSelect?.(copilot)
                  }}
                />
              ) : (
                <Divider key="divider" orientation="vertical" my="xs" mx="xxs" />
              )
            )}
          </Flex>
        </ScrollArea>
      </Stack>
    )
  )
}

const CopilotItem = ({
  copilot,
  selected,
  onClick,
}: {
  copilot: CopilotDetail
  selected?: boolean
  onClick?(): void
}) => {
  const isSmallScreen = useIsSmallScreen()
  return (
    <Flex
      align="center"
      gap={isSmallScreen ? 'xxs' : 'xs'}
      py="xs"
      px={isSmallScreen ? 'xs' : 'md'}
      bd={selected ? 'none' : '1px solid var(--mantine-color-chatbox-border-primary-outline)'}
      bg={selected ? 'var(--mantine-color-chatbox-brand-light)' : 'transparent'}
      className={isSmallScreen ? 'cursor-pointer rounded-full shrink-0' : 'cursor-pointer rounded-md shrink-0'}
      onClick={onClick}
    >
      <Avatar src={copilot.picUrl} color="chatbox-brand" size={isSmallScreen ? 20 : 24}>
        {copilot.name.slice(0, 1)}
      </Avatar>
      <Text fw="600" c={selected ? 'chatbox-brand' : 'chatbox-primary'}>
        {copilot.name}
      </Text>
    </Flex>
  )
}
