import NiceModal from '@ebay/nice-modal-react'
import { Box, Group, Paper, Stack, Text } from '@mantine/core'
import type { Message as ChatMessage, MessageFile, MessageLink, MessageStatus, Session } from '@shared/types'
import { MessageRoleEnum } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import { CompactionStatus } from '../chat/CompactionStatus'
import Message from '../chat/Message'
import { MessageAttachmentGrid } from '../chat/MessageAttachmentGrid'
import MessageList from '../chat/MessageList'
import MessageStatuses from '../chat/MessageLoading'
import MessageNavigation, { ScrollToBottomButton } from '../chat/MessageNavigation'
import SummaryMessage from '../chat/SummaryMessage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  },
})

const meta: Meta = {
  title: 'Real Components/Chat Surfaces',
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <NiceModal.Provider>
          <Box p="lg" bg="var(--chatbox-background-primary)" style={{ maxWidth: 760, minHeight: 360 }}>
            <Story />
          </Box>
        </NiceModal.Provider>
      </QueryClientProvider>
    ),
  ],
}

export default meta

const makeSummaryMessage = (id: string, text: string): ChatMessage => ({
  id,
  role: MessageRoleEnum.Assistant,
  contentParts: [{ type: 'text', text }],
  tokenCalculatedAt: 0,
  isSummary: true,
  timestamp: Date.now(),
})

const makeMessage = (
  id: string,
  role: ChatMessage['role'],
  text: string,
  overrides: Partial<ChatMessage> = {}
): ChatMessage => ({
  id,
  role,
  contentParts: [{ type: 'text', text }],
  tokenCalculatedAt: 0,
  timestamp: Date.now(),
  ...overrides,
})

const sampleFiles: MessageFile[] = [
  {
    id: 'file-product-plan',
    name: 'Product requirements.pdf',
    fileType: 'application/pdf',
    byteLength: 142_000,
    storageKey: 'storybook/product-requirements.pdf',
    ragMode: 'session-retrieval',
    sessionAttachmentStatus: 'ready',
    sessionAttachmentIndexStatus: 'ready',
    sessionAttachmentAvailability: 'allowed',
    sessionAttachmentChunkCount: 36,
    sessionAttachmentTotalChunks: 36,
    sessionAttachmentEmbeddedChunks: 36,
    tokenCalculatedAt: 0,
  },
  {
    id: 'file-transcript',
    name: 'Customer interview transcript.txt',
    fileType: 'text/plain',
    byteLength: 18_420,
    storageKey: 'storybook/customer-interview.txt',
    ragMode: 'inline',
    tokenCalculatedAt: 0,
  },
  {
    id: 'file-indexing',
    name: 'Market analysis.xlsx',
    fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteLength: 64_800,
    storageKey: 'storybook/market-analysis.xlsx',
    ragMode: 'session-retrieval',
    sessionAttachmentStatus: 'indexing',
    sessionAttachmentIndexStatus: 'indexing',
    sessionAttachmentIndexingStage: 'embedding',
    sessionAttachmentChunkCount: 18,
    sessionAttachmentTotalChunks: 42,
    sessionAttachmentEmbeddedChunks: 18,
    tokenCalculatedAt: 0,
  },
  {
    id: 'file-blocked',
    name: 'Scanned contract.png',
    fileType: 'image/png',
    byteLength: 2_840_000,
    storageKey: 'storybook/scanned-contract.png',
    ragMode: 'session-retrieval',
    sessionAttachmentStatus: 'failed',
    sessionAttachmentIndexStatus: 'failed',
    sessionAttachmentAvailability: 'blocked',
    sessionAttachmentBlockedReason: 'Image-only document needs OCR before retrieval indexing.',
    tokenCalculatedAt: 0,
  },
]

const sampleLinks: MessageLink[] = [
  {
    id: 'link-pricing',
    title: 'Chatbox pricing research',
    url: 'https://chatboxai.app/pricing',
    byteLength: 21_000,
    storageKey: 'storybook/pricing-page',
    tokenCalculatedAt: 0,
  },
  {
    id: 'link-docs',
    title: 'Model provider docs',
    url: 'https://docs.example.com/models',
    byteLength: 33_200,
    storageKey: 'storybook/model-provider-docs',
    tokenCalculatedAt: 0,
  },
]

const localProcessingStatuses: MessageStatus[] = [
  { type: 'sending_file', mode: 'local' },
  { type: 'loading_webpage', mode: 'advanced' },
  { type: 'retrying', attempt: 2, maxAttempts: 5, error: 'Gateway timeout' },
  { type: 'preparing_tool_call', toolName: 'web_search', progress: { kind: 'lines', value: 128 } },
  { type: 'preparing_tool_call', toolName: 'read_file', progress: { kind: 'size_kb', value: 42.8 } },
]

const conversationSession: Session = {
  id: 'storybook-chat-session',
  name: 'Launch readiness review',
  type: 'chat',
  picUrl: '',
  assistantAvatarKey: 'openai',
  messages: [
    makeMessage('system-context', MessageRoleEnum.System, 'System note: keep answers concise and cite source files.', {
      isNameManuallyEdited: false,
    }),
    makeMessage(
      'user-plan',
      MessageRoleEnum.User,
      'Summarize the launch blockers from these files and highlight what needs a decision.',
      {
        files: sampleFiles.slice(0, 2),
        links: sampleLinks,
      }
    ),
    makeSummaryMessage(
      'summary-history',
      'Earlier context: pricing copy, QA signoff, and model-provider compatibility were the main launch topics.'
    ),
    makeMessage(
      'assistant-answer',
      MessageRoleEnum.Assistant,
      [
        'The launch is close, but three items still need attention:',
        '',
        '1. QA signoff for attachment indexing.',
        '2. Pricing copy for the desktop upsell.',
        '3. Provider compatibility checks for agent mode.',
      ].join('\n'),
      {
        model: 'gpt-4.1',
        tokensUsed: 1280,
        firstTokenLatency: 820,
      }
    ),
    makeMessage(
      'assistant-error',
      MessageRoleEnum.Assistant,
      'The retryable tool step failed after the gateway timed out.',
      {
        error: 'Gateway timeout while reading the provider response.',
        contentParts: [
          { type: 'text', text: 'I started checking the provider response, but the request timed out.' },
          {
            type: 'tool-call',
            toolName: 'web_search',
            toolCallId: 'tool-timeout',
            state: 'error',
            args: { query: 'Chatbox provider status' },
            result: { error: 'Gateway timeout' },
          },
        ],
      }
    ),
  ],
}

function CompactionRunningFixture() {
  useEffect(() => {
    setCompactionUIState('storybook-running-compaction', {
      status: 'running',
      error: null,
      streamingText: 'Collecting old context...\nSelecting messages...\nWriting compact summary...',
    })
  }, [])

  return <CompactionStatus sessionId="storybook-running-compaction" />
}

function CompactionFailedFixture() {
  useEffect(() => {
    setCompactionUIState('storybook-failed-compaction', {
      status: 'failed',
      error:
        'Compaction failed while summarizing earlier context. The provider returned an empty response after retrying the request. Keep the current messages visible and try again after switching models.',
      streamingText: '',
    })
  }, [])

  return <CompactionStatus sessionId="storybook-failed-compaction" />
}

function CompactionCompletedFixture() {
  useEffect(() => {
    setCompactionUIState('storybook-completed-compaction', {
      status: 'completed',
      error: null,
      streamingText: '',
      summaryMessageId: 'storybook-summary',
    })
  }, [])

  return <CompactionStatus sessionId="storybook-completed-compaction" onViewSummary={() => undefined} />
}

export const MessageStates: StoryObj = {
  name: 'Message system user assistant error generating attachment states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/chat/Message'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="Message"
        description="Actual chat message bubble with system, user, assistant, attachment, metadata, error, and generating states."
      />
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Message
            sessionId={conversationSession.id}
            sessionType="chat"
            msg={conversationSession.messages[0]}
            buttonGroup="always"
          />
          <Message
            sessionId={conversationSession.id}
            sessionType="chat"
            msg={conversationSession.messages[1]}
            buttonGroup="always"
          />
          <Message
            sessionId={conversationSession.id}
            sessionType="chat"
            msg={conversationSession.messages[3]}
            buttonGroup="always"
            assistantAvatarKey="openai"
          />
          <Message
            sessionId={conversationSession.id}
            sessionType="chat"
            msg={conversationSession.messages[4]}
            buttonGroup="always"
            assistantAvatarKey="openai"
          />
          <Message
            sessionId={conversationSession.id}
            sessionType="chat"
            msg={makeMessage(
              'assistant-generating',
              MessageRoleEnum.Assistant,
              'Thinking through the final checklist...',
              {
                generating: true,
                status: localProcessingStatuses.slice(0, 2),
              }
            )}
            buttonGroup="always"
            assistantAvatarKey="openai"
          />
        </Stack>
      </Paper>
    </Stack>
  ),
}

export const MessageListStates: StoryObj = {
  name: 'Message list grouped conversation summary navigation states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/chat/MessageList'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="MessageList"
        description="Actual virtualized conversation list with grouped latest turn, system note, attachments, summary, assistant response, and error message."
      />
      <Paper withBorder radius="md" h={520} style={{ overflow: 'hidden' }}>
        <MessageList currentSession={conversationSession} />
      </Paper>
    </Stack>
  ),
}

export const MessageLoadingStates: StoryObj = {
  name: 'Message loading and tool preparation states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/chat/MessageLoading'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="MessageStatuses"
        description="Actual status rows shown while the assistant is preparing work."
      />
      <MessageStatuses statuses={localProcessingStatuses} />
    </Stack>
  ),
}

export const AttachmentGridStates: StoryObj = {
  name: 'Message attachments with files, links, and RAG states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/chat/MessageAttachmentGrid'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="MessageAttachmentGrid"
        description="Actual message attachment grid with collapsed overflow, file cards, web links, and retrieval status."
      />
      <MessageAttachmentGrid files={sampleFiles} links={sampleLinks} />
      <MessageAttachmentGrid files={sampleFiles.slice(0, 1)} align="end" />
    </Stack>
  ),
}

export const CompactionStatusStates: StoryObj = {
  name: 'Compaction running completed and failed states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/chat/CompactionStatus'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="CompactionStatus"
        description="Actual conversation compaction banner driven through the Jotai compaction UI state."
      />
      <CompactionRunningFixture />
      <CompactionCompletedFixture />
      <CompactionFailedFixture />
    </Stack>
  ),
}

export const SummaryMessageStates: StoryObj = {
  name: 'Summary message latest editable state',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/chat/SummaryMessage'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="SummaryMessage"
        description="Actual collapsed summary divider used after conversation compaction."
      />
      <SummaryMessage
        sessionId="storybook-session"
        msg={makeSummaryMessage(
          'summary-latest',
          [
            'The earlier conversation established three product constraints:',
            '',
            '- keep local files private by default',
            '- surface token pressure before a request is sent',
            '- preserve source citations when compacting long chats',
          ].join('\n')
        )}
        isLatestSummary
        onDelete={() => undefined}
      />
    </Stack>
  ),
}

export const NavigationControls: StoryObj = {
  name: 'Message navigation floating controls',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/chat/MessageNavigation'],
  },
  render: () => (
    <Paper withBorder radius="md" p="lg" h={320} pos="relative" bg="var(--chatbox-background-secondary)">
      <SurfaceLabel
        title="MessageNavigation"
        description="Actual floating message navigation controls and scroll-to-bottom affordance."
      />
      <Box mt="xl">
        <Text size="sm" c="dimmed">
          A long conversation uses these controls to jump between messages and return to the latest response.
        </Text>
      </Box>
      <MessageNavigation visible />
      <ScrollToBottomButton />
    </Paper>
  ),
}

function SurfaceLabel({ title, description }: { title: string; description: string }) {
  return (
    <Group align="flex-start" gap="sm">
      <Box w={4} h={36} bg="var(--chatbox-tint-brand)" style={{ borderRadius: 999 }} />
      <Box>
        <Text fw={700}>{title}</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </Box>
    </Group>
  )
}
