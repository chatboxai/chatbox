import NiceModal from '@ebay/nice-modal-react'
import { Box, Group, Paper, Stack, Text } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { settingsStore } from '@/stores/settingsStore'
import { uiStore } from '@/stores/uiStore'
import AgentModeButton from '../InputBox/AgentModeButton'
import AgentModePanel from '../InputBox/AgentModePanel'
import { FileMiniCard, ImageMiniCard, MessageAttachment } from '../InputBox/Attachments'
import InputBox from '../InputBox/InputBox'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  },
})

const meta: Meta = {
  title: 'Real Components/Input Surfaces',
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <NiceModal.Provider>
          <SeedInputSettings />
          <Box p="lg" bg="var(--chatbox-background-primary)" style={{ maxWidth: 900, minHeight: 540 }}>
            <Story />
          </Box>
        </NiceModal.Provider>
      </QueryClientProvider>
    ),
  ],
}

export default meta

export const AgentModePanelStates: StoryObj = {
  name: 'Agent mode panel auto on off unsupported and extension states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/AgentModePanel'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="AgentModePanel"
        description="Actual agent mode capability panel with AUTO/ON/OFF modes, web search, code execution, skills, MCP, and knowledge base rows."
      />
      <Group align="flex-start">
        <Paper withBorder radius="md" p={0} style={{ overflow: 'visible' }}>
          <AgentModePanel
            sessionId="storybook-agent-auto"
            modelSupportsAgentMode
            webBrowsingMode
            currentKnowledgeBaseId={1}
            onWebBrowsingChange={() => undefined}
            onKnowledgeBaseSelect={() => undefined}
            onSkillSelect={() => undefined}
            onClose={() => undefined}
          />
        </Paper>
        <Paper withBorder radius="md" p={0} style={{ overflow: 'visible' }}>
          <AgentModePanel
            sessionId="storybook-agent-unsupported"
            modelSupportsAgentMode={false}
            webBrowsingMode={false}
            onWebBrowsingChange={() => undefined}
            onKnowledgeBaseSelect={() => undefined}
            onSkillSelect={() => undefined}
            onClose={() => undefined}
          />
        </Paper>
      </Group>
    </Stack>
  ),
}

export const AgentModeButtonStates: StoryObj = {
  name: 'Agent mode button auto on off unsupported popover states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/AgentModeButton'],
  },
  render: () => <AgentModeButtonFixture />,
}

export const AgentModeTouchMenuDemo: StoryObj = {
  name: 'Agent mode touch sheet drill-down demo',
  parameters: {
    layout: 'fullscreen',
    uiInventoryTargets: [
      'src/renderer/components/InputBox/AgentModeButton',
      'src/renderer/components/InputBox/AgentModePanel',
    ],
  },
  render: () => <AgentModeTouchMenuDemoFixture />,
}

export const AttachmentMiniCardStates: StoryObj = {
  name: 'Attachment mini card image file processing completed error states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/Attachments'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="ImageMiniCard and FileMiniCard"
        description="Actual upload preview cards used in the input composer for images, files, processing progress, completed status, and retryable errors."
      />
      <Group align="flex-start">
        <ImageMiniCard storageKey="storybook-image-preview" onDelete={() => undefined} />
        <FileMiniCard
          name="release-plan.pdf"
          fileType="application/pdf"
          status="processing"
          statusText="Indexing"
          progressValue={42}
          onDelete={() => undefined}
          onPreviewClick={() => undefined}
        />
        <FileMiniCard
          name="meeting-notes.docx"
          fileType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          status="completed"
          parserType="local"
          onDelete={() => undefined}
          onPreviewClick={() => undefined}
        />
        <FileMiniCard
          name="scanned-contract.pdf"
          fileType="application/pdf"
          status="completed"
          parserType="mineru"
          onDelete={() => undefined}
          onPreviewClick={() => undefined}
        />
        <FileMiniCard
          name="annual-report.pdf"
          fileType="application/pdf"
          status="completed"
          parserType="chatbox-ai"
          onDelete={() => undefined}
          onPreviewClick={() => undefined}
        />
        <FileMiniCard
          name="large-dataset.csv"
          fileType="text/csv"
          status="error"
          errorMessage="file_too_large"
          onDelete={() => undefined}
          onErrorClick={() => undefined}
        />
      </Group>
    </Stack>
  ),
}

export const MessageAttachmentStates: StoryObj = {
  name: 'Message attachment inline retrieval indexed indexing blocked failed states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/Attachments'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="MessageAttachment"
        description="Actual message attachment row with inline file, URL, retrieval indexing progress, ready, blocked, failed, and retry states."
      />
      <Paper withBorder radius="md" p="md" maw={640}>
        <Stack gap="xs">
          <MessageAttachment
            label="Product roadmap"
            filename="roadmap.md"
            fileType="text/markdown"
            byteLength={18_432}
            parserType="local"
            storageKey="storybook-roadmap"
          />
          <MessageAttachment
            label="Scanned contract"
            filename="contract.pdf"
            fileType="application/pdf"
            byteLength={2_400_000}
            parserType="mineru"
            storageKey="storybook-contract"
          />
          <MessageAttachment
            label="Quarterly deck"
            filename="q3-deck.pptx"
            fileType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
            byteLength={5_600_000}
            parserType="chatbox-ai"
            storageKey="storybook-deck"
          />
          <MessageAttachment
            label="Reference URL"
            url="https://chatboxai.app/docs/model-settings"
            storageKey="storybook-url"
          />
          <MessageAttachment
            label="Knowledge base report"
            filename="annual-report.pdf"
            fileType="application/pdf"
            byteLength={2_400_000}
            ragMode="session-retrieval"
            sessionAttachmentIndexStatus="indexing"
            sessionAttachmentTotalChunks={20}
            sessionAttachmentEmbeddedChunks={8}
            sessionAttachmentIndexingStage="embedding"
            sessionAttachmentProcessingStartedAt={Date.now() - 45_000}
          />
          <MessageAttachment
            label="Indexed handbook"
            filename="handbook.pdf"
            fileType="application/pdf"
            byteLength={1_320_000}
            parserType="mineru"
            ragMode="session-retrieval"
            sessionAttachmentIndexStatus="ready"
            sessionAttachmentChunkCount={36}
          />
          <MessageAttachment
            label="Oversized archive"
            filename="archive.zip"
            fileType="application/zip"
            byteLength={78_000_000}
            ragMode="session-retrieval"
            sessionAttachmentAvailability="blocked"
            sessionAttachmentBlockedReason="This attachment is too large for chat attachments."
          />
          <MessageAttachment
            label="Failed transcript"
            filename="transcript.txt"
            fileType="text/plain"
            byteLength={54_000}
            ragMode="session-retrieval"
            sessionAttachmentIndexStatus="failed"
            sessionAttachmentError="Large file indexing failed."
            recoveryAction="continue"
            onRecover={() => undefined}
          />
        </Stack>
      </Paper>
    </Stack>
  ),
}

export const AttachmentParserTypeStates: StoryObj = {
  name: 'Attachment parser type label local chatbox-ai mineru inline and indexed',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/Attachments'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="Document parser label"
        description="Shows which parser produced each attachment (Local / Chatbox AI / MinerU). Inline attachments show the parser in the subtitle; session-retrieval (indexed) attachments hide it to make room for index status — the full parser + index info is shown in the click preview window instead."
      />
      <Box>
        <Text size="xs" c="dimmed" mb={6}>
          Upload preview card (FileMiniCard) — parser shown on completed
        </Text>
        <Group align="flex-start">
          <FileMiniCard
            name="notes.docx"
            fileType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            status="completed"
            parserType="local"
            onDelete={() => undefined}
            onPreviewClick={() => undefined}
          />
          <FileMiniCard
            name="scan.pdf"
            fileType="application/pdf"
            status="completed"
            parserType="mineru"
            onDelete={() => undefined}
            onPreviewClick={() => undefined}
          />
          <FileMiniCard
            name="report.pdf"
            fileType="application/pdf"
            status="completed"
            parserType="chatbox-ai"
            onDelete={() => undefined}
            onPreviewClick={() => undefined}
          />
        </Group>
      </Box>
      <Box>
        <Text size="xs" c="dimmed" mb={6}>
          Inline message attachment — parser in subtitle
        </Text>
        <Paper withBorder radius="md" p="md" maw={520}>
          <Stack gap="xs">
            <MessageAttachment
              label="Local parsed"
              filename="roadmap.md"
              fileType="text/markdown"
              byteLength={18_432}
              parserType="local"
              storageKey="storybook-parser-local"
            />
            <MessageAttachment
              label="MinerU parsed"
              filename="contract.pdf"
              fileType="application/pdf"
              byteLength={2_400_000}
              parserType="mineru"
              storageKey="storybook-parser-mineru"
            />
            <MessageAttachment
              label="Chatbox AI parsed"
              filename="deck.pptx"
              fileType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
              byteLength={5_600_000}
              parserType="chatbox-ai"
              storageKey="storybook-parser-chatboxai"
            />
          </Stack>
        </Paper>
      </Box>
      <Box>
        <Text size="xs" c="dimmed" mb={6}>
          Indexed attachment — parser hidden in subtitle (index status takes priority)
        </Text>
        <Paper withBorder radius="md" p="md" maw={520}>
          <MessageAttachment
            label="Indexed handbook"
            filename="handbook.pdf"
            fileType="application/pdf"
            byteLength={1_320_000}
            parserType="mineru"
            ragMode="session-retrieval"
            sessionAttachmentIndexStatus="ready"
            sessionAttachmentChunkCount={36}
          />
        </Paper>
      </Box>
    </Stack>
  ),
}

export const InputBoxComposerStates: StoryObj = {
  name: 'InputBox composer ready selected model and missing model states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/InputBox'],
  },
  render: () => (
    <StoryRouter>
      <Stack gap="lg">
        <SurfaceLabel
          title="InputBox"
          description="Actual chat composer with model selector, agent mode, file/image upload actions, token menu, send/stop, and session settings controls."
        />
        <Paper withBorder radius="md" p="md" maw={780}>
          <Text size="xs" c="dimmed" mb={8}>
            New chat ready
          </Text>
          <InputBox
            sessionId="new"
            model={{ provider: ModelProviderEnum.OpenAI, modelId: 'gpt-4.1' }}
            onSubmit={async () => undefined}
            onSelectModel={() => undefined}
            onClickSessionSettings={() => true}
          />
        </Paper>
        {/* The stop state now derives from session lock state (streaming replies
            in the session), so it can no longer be forced via props here. */}
        <Paper withBorder radius="md" p="md" maw={780}>
          <Text size="xs" c="dimmed" mb={8}>
            Model not selected
          </Text>
          <InputBox sessionId="new" onSubmit={async () => undefined} onSelectModel={() => undefined} />
        </Paper>
      </Stack>
    </StoryRouter>
  ),
}

function AgentModeTouchMenuDemoFixture() {
  const [webBrowsing, setWebBrowsing] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    window.localStorage.setItem('chatbox.web-search-moved-tip-dismissed.v1', 'true')
    setReady(true)
  }, [])

  if (!ready) return null

  return (
    <StoryRouter>
      <Box className="relative mx-auto min-h-[100dvh] max-w-[390px] bg-[var(--chatbox-background-secondary)]">
        <Box px="md" pt="xl">
          <Text size="sm" fw={600}>
            Mobile composer
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Tap Chat Mode to open the sheet. Rows drill in-page; desktop-only tools stay hidden.
          </Text>
        </Box>
        <Box className="absolute inset-x-0 bottom-0 border-t border-[var(--chatbox-border-primary)] bg-[var(--chatbox-background-primary)] px-3 py-3">
          <Group justify="space-between" align="center">
            <AgentModeButton
              sessionId="storybook-agent-touch"
              layout="touch"
              compact
              webBrowsingMode={webBrowsing}
              onWebBrowsingChange={setWebBrowsing}
              onKnowledgeBaseSelect={() => undefined}
              onSkillSelect={() => undefined}
            />
            <Text size="xs" c="dimmed">
              Message
            </Text>
          </Group>
        </Box>
      </Box>
    </StoryRouter>
  )
}

function AgentModeButtonFixture() {
  const autoRef = useRef<HTMLDivElement>(null)
  const [webBrowsing, setWebBrowsing] = useState(true)

  useEffect(() => {
    const button = autoRef.current?.querySelector('button')
    button?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  }, [])

  return (
    <Stack gap="lg">
      <SurfaceLabel
        title="AgentModeButton"
        description="Actual composer button with mode color, mode label, disabled state, and hover popover."
      />
      <Group align="flex-start">
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" mb={8}>
            Auto with popover
          </Text>
          <div ref={autoRef}>
            <AgentModeButton
              sessionId="storybook-agent-auto"
              webBrowsingMode={webBrowsing}
              onWebBrowsingChange={setWebBrowsing}
              currentKnowledgeBaseId={1}
              onKnowledgeBaseSelect={() => undefined}
              onSkillSelect={() => undefined}
            />
          </div>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" mb={8}>
            Unsupported model
          </Text>
          <AgentModeButton
            sessionId="storybook-agent-unsupported"
            modelSupportsAgentMode={false}
            webBrowsingMode={false}
            onWebBrowsingChange={() => undefined}
            onKnowledgeBaseSelect={() => undefined}
            onSkillSelect={() => undefined}
          />
        </Paper>
      </Group>
    </Stack>
  )
}

const storyRootRoute = createRootRoute({
  component: () => <StoryRouteOutlet />,
})
const storyRoute = createRoute({
  getParentRoute: () => storyRootRoute,
  path: '/',
  component: () => <StoryRouteSlot />,
})
const storyRouter = createRouter({
  routeTree: storyRootRoute.addChildren([storyRoute]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
})

function StoryRouter({ children }: { children: ReactNode }) {
  return (
    <StoryRouteContext.Provider value={children}>
      <RouterProvider router={storyRouter} />
    </StoryRouteContext.Provider>
  )
}

const StoryRouteContext = createContext<ReactNode>(null)

function StoryRouteOutlet() {
  return <StoryRouteSlot />
}

function StoryRouteSlot() {
  return <>{useContext(StoryRouteContext)}</>
}

function SeedInputSettings() {
  useEffect(() => {
    window.localStorage.removeItem('new-chat')
    settingsStore.setState((state) => ({
      ...state,
      licenseKey: 'storybook-license',
      providers: {
        ...state.providers,
        [ModelProviderEnum.OpenAI]: {
          apiKey: 'storybook-openai',
          models: [{ modelId: 'gpt-4.1', capabilities: ['tool_use', 'vision'] }],
        },
      },
      extension: {
        ...state.extension,
        webSearch: {
          ...state.extension.webSearch,
          provider: 'build-in',
          tavilyApiKey: 'storybook-tavily',
        },
      },
      skills: {
        ...state.skills,
        enabledSkillNames: ['translate', 'summarize'],
      },
      mcp: {
        ...state.mcp,
        servers: [
          {
            id: 'storybook-mcp',
            name: 'Local filesystem',
            enabled: true,
            transport: {
              type: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem'],
              env: {},
            },
          },
        ],
        enabledBuiltinServers: [],
      },
    }))
    uiStore.setState((state) => ({
      ...state,
      sessionAgentModeMap: {
        ...state.sessionAgentModeMap,
        'storybook-agent-auto': { value: 'auto', locked: false, lockReason: null },
        'storybook-agent-unsupported': { value: 'auto', locked: false, lockReason: null },
      },
    }))
  }, [])

  return null
}

function SurfaceLabel({ title, description }: { title: string; description: string }) {
  return (
    <Box>
      <Text fw={700}>{title}</Text>
      <Text size="sm" c="dimmed">
        {description}
      </Text>
    </Box>
  )
}
