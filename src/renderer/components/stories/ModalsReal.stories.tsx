import NiceModal from '@ebay/nice-modal-react'
import { Box, Paper, Stack, Text } from '@mantine/core'
import { MessageRoleEnum, ModelProviderEnum, type Session } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { type ComponentType, useEffect, useReducer, useRef, useState } from 'react'
import i18n from '@/i18n'
import { QueryKeys } from '@chatbox/react/query'
import { settingsStore } from '@/stores/settingsStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  },
})

const meta: Meta = {
  title: 'Real Components/Modals',
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <NiceModal.Provider>
          <StorybookAnalyticsStub />
          <Box p="lg" bg="var(--chatbox-background-primary)" style={{ minHeight: 560 }}>
            <Story />
          </Box>
        </NiceModal.Provider>
      </QueryClientProvider>
    ),
  ],
}

export default meta

function StorybookAnalyticsStub() {
  useEffect(() => {
    window.gtag = window.gtag ?? (() => undefined)
  }, [])

  return null
}

export const ModalRegistryStates: StoryObj = {
  name: 'Modal registry real NiceModal registration preview',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/index'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="Modal Registry"
        description="The production modal registry is imported in this story module, so named NiceModal registrations are available for the real modal previews."
      />
      <Paper withBorder radius="md" p="md">
        <Text size="sm" c="dimmed">
          Registered modal ids include welcome, file-parse-error, content-viewer, session-settings, app-store-rating,
          agent-mode-reward-claim-success, artifact-preview, clear-session-list, export-chat, message-edit, json-viewer,
          report-content, model-edit, thread-name-edit, vibedrop-publish, and copilot-settings.
        </Text>
      </Paper>
    </Stack>
  ),
}

export const AppStoreRatingStates: StoryObj = {
  name: 'App Store rating modal rate now and maybe later actions',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/AppStoreRating'],
  },
  render: () => (
    <ModalPreview
      title="AppStoreRating"
      description="Actual App Store rating prompt with icon, rating CTA, and later action."
    >
      <OpenModal loadModal={() => import('@/modals/AppStoreRating').then((module) => module.default)} />
    </ModalPreview>
  ),
}

export const AgentModeRewardClaimSuccessStates: StoryObj = {
  name: 'Agent Mode limited-time reward success',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/AgentModeRewardClaimSuccess'],
  },
  render: () => <AgentModeRewardClaimSuccessFixture />,
}

function AgentModeRewardClaimSuccessFixture() {
  const [ready, setReady] = useState(i18n.language === 'zh-Hans')

  useEffect(() => {
    const previousLanguage = i18n.language
    const previousSettingsLanguage = settingsStore.getState().language
    settingsStore.setState({ language: 'zh-Hans' })
    void i18n.changeLanguage('zh-Hans').then(() => setReady(true))
    return () => {
      settingsStore.setState({ language: previousSettingsLanguage })
      void i18n.changeLanguage(previousLanguage)
    }
  }, [])

  if (!ready) {
    return null
  }

  return (
    <ModalPreview
      title="AgentModeRewardClaimSuccess"
      description="Production success modal with mocked reward points and expiry. Does not call the claim API."
    >
      <OpenModal
        loadModal={() => import('@/modals/AgentModeRewardClaimSuccess').then((module) => module.default)}
        props={{
          tokenLimit: 200000,
          expiresAt: '2026-08-03T12:00:00.000000+08:00',
        }}
      />
    </ModalPreview>
  )
}

export const AttachLinkStates: StoryObj = {
  name: 'Attach link modal multiline URL entry states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/AttachLink'],
  },
  render: () => (
    <ModalPreview
      title="AttachLink"
      description="Actual link attachment modal with multiline URL textarea and submit action."
    >
      <OpenModal loadModal={() => import('@/modals/AttachLink').then((module) => module.default)} />
    </ModalPreview>
  ),
}

export const ClearSessionListStates: StoryObj = {
  name: 'Clear session list modal numeric retention state',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/ClearSessionList'],
  },
  render: () => (
    <ModalPreview
      title="ClearSessionList"
      description="Actual destructive cleanup modal with inline numeric retention input and cleanup action."
    >
      <OpenModal loadModal={() => import('@/modals/ClearSessionList').then((module) => module.default)} />
    </ModalPreview>
  ),
}

export const ExportChatStates: StoryObj = {
  name: 'Export chat modal scope format warning states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/ExportChat'],
  },
  render: () => (
    <ModalPreview
      title="ExportChat"
      description="Actual chat export modal with restore-warning copy, scope selector, format selector, and export action."
    >
      <OpenModal loadModal={() => import('@/modals/ExportChat').then((module) => module.default)} />
    </ModalPreview>
  ),
}

export const FileParseErrorStates: StoryObj = {
  name: 'File parse error modal unknown and file-specific state',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/FileParseError'],
  },
  render: () => (
    <ModalPreview
      title="FileParseError"
      description="Actual file processing error modal with filename, alert body, and document parser guidance."
    >
      <OpenModal
        loadModal={() => import('@/modals/FileParseError').then((module) => module.default)}
        props={{ errorCode: 'session_attachment_rag_requires_knowledge_base', fileName: 'large-report.pdf' }}
      />
    </ModalPreview>
  ),
}

export const JsonViewerStates: StoryObj = {
  name: 'JSON viewer modal pretty printed copy state',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/JsonViewer'],
  },
  render: () => (
    <ModalPreview
      title="JsonViewer"
      description="Actual JSON viewer modal with pretty printed content and copy action."
    >
      <OpenModal
        loadModal={() => import('@/modals/JsonViewer').then((module) => module.default)}
        props={{
          title: 'Provider response payload',
          data: {
            provider: 'OpenAI',
            model: 'gpt-4.1',
            usage: { inputTokens: 1820, outputTokens: 512 },
            flags: ['streaming', 'tool_use'],
          },
        }}
      />
    </ModalPreview>
  ),
}

export const VibedropPublishStates: StoryObj = {
  name: 'VibeDrop publish modal visibility and success states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/VibedropPublish'],
  },
  render: () => (
    <ModalPreview
      title="VibedropPublish"
      description="VibeDrop publish modal: visibility choice (link-only/public) and the published URL success state with copy and open actions."
    >
      <OpenModal
        loadModal={() => import('@/modals/VibedropPublish').then((module) => module.default)}
        props={{ html: '<!doctype html><title>Chatbox demo</title><h1>Hello</h1>', uniqueId: 'story-demo' }}
      />
    </ModalPreview>
  ),
}

export const ModelEditStates: StoryObj = {
  name: 'Model edit modal existing chat model capability states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/ModelEdit'],
  },
  render: () => (
    <ModalPreview
      title="ModelEdit"
      description="Actual model editor modal with model id, nickname, type, capabilities, context window, max output, test, cancel, and save actions."
    >
      <OpenModal
        loadModal={() => import('@/modals/ModelEdit').then((module) => module.default)}
        props={{
          providerId: ModelProviderEnum.OpenAI,
          model: {
            modelId: 'gpt-4.1',
            nickname: 'GPT-4.1 Launch',
            capabilities: ['vision', 'tool_use'],
            contextWindow: 1_000_000,
            maxOutput: 32_000,
            type: 'chat',
          },
        }}
      />
    </ModalPreview>
  ),
}

export const ReportContentStates: StoryObj = {
  name: 'Report content modal type and detail states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/ReportContent'],
  },
  render: () => (
    <ModalPreview
      title="ReportContent"
      description="Actual report content modal with content id, report type selector, details textarea, cancel, and submit action."
    >
      <OpenModal
        loadModal={() => import('@/modals/ReportContent').then((module) => module.default)}
        props={{ contentId: 'img-item-story-0001' }}
      />
    </ModalPreview>
  ),
}

export const WelcomeStates: StoryObj = {
  name: 'Welcome modal setup provider and later states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/Welcome'],
  },
  render: () => (
    <ModalPreview
      title="Welcome"
      description="Actual first-run welcome modal with app identity, value bullets, setup provider CTA, and setup-later action."
    >
      <OpenModal loadModal={() => import('@/modals/Welcome').then((module) => module.default)} />
    </ModalPreview>
  ),
}

export const ArtifactPreviewStates: StoryObj = {
  name: 'Artifact preview modal html preview refresh and close states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/ArtifactPreview'],
  },
  render: () => (
    <ModalPreview
      title="ArtifactPreview"
      description="Actual artifact preview modal with iframe-backed HTML artifact, refresh action, full preview surface, and close action."
    >
      <OpenModal
        loadModal={() => import('@/modals/ArtifactPreview').then((module) => module.default)}
        props={{
          htmlCode: [
            '<!doctype html><html><body style="font-family:-apple-system;padding:32px;background:#f8f9fa">',
            '<main style="max-width:720px;margin:auto;background:white;border:1px solid #dee2e6;border-radius:12px;padding:24px">',
            '<h1 style="margin-top:0;color:#1c7ed6">Launch Brief</h1>',
            '<p>This is a real ArtifactPreview modal rendering generated HTML content.</p>',
            '<button style="border:0;background:#228be6;color:white;border-radius:8px;padding:10px 16px">Primary action</button>',
            '</main></body></html>',
          ].join(''),
        }}
      />
    </ModalPreview>
  ),
}

export const ContentViewerStates: StoryObj = {
  name: 'Content viewer modal parser index metadata content copy state',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/ContentViewer'],
  },
  render: () => (
    <ModalPreview
      title="ContentViewer"
      description="Actual content viewer modal with parser/index metadata rows, monospaced content body, copy action, and close action. For indexed attachments the parser is hidden in the attachment subtitle and shown here instead."
    >
      <OpenModal
        loadModal={() => import('@/modals/ContentViewer').then((module) => module.default)}
        props={{
          title: 'Parsed attachment content',
          metadata: [{ value: 'Parser: MinerU' }, { label: 'Status', value: 'Indexed · 36 chunks' }],
          content: [
            '# Launch Notes',
            '',
            '- QA signoff is pending.',
            '- Pricing page copy needs one final review.',
            '- Model provider fallback behavior has been checked.',
          ].join('\n'),
        }}
      />
    </ModalPreview>
  ),
}

export const MessageEditStates: StoryObj = {
  name: 'Message edit modal role text parts and save states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/MessageEdit'],
  },
  render: () => (
    <ModalPreview
      title="MessageEdit"
      description="Actual message edit modal with role combobox, editable text area, cancel, save, and save-and-resend actions."
    >
      <OpenModal
        loadModal={() => import('@/modals/MessageEdit').then((module) => module.default)}
        props={{
          sessionId: sampleSession.id,
          msg: sampleSession.messages[1],
        }}
      />
    </ModalPreview>
  ),
}

export const SessionSettingsStates: StoryObj = {
  name: 'Session settings modal chat config background and system prompt states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/SessionSettings'],
  },
  render: () => (
    <ModalPreview
      title="SessionSettings"
      description="Actual conversation settings modal with avatar, name, system prompt, model-specific settings, context count, and background controls."
    >
      <OpenModal
        loadModal={() => import('@/modals/SessionSettings').then((module) => module.default)}
        props={{
          session: sampleSession,
          disableAutoSave: true,
        }}
      />
    </ModalPreview>
  ),
}

export const ThreadNameEditStates: StoryObj = {
  name: 'Thread name edit modal current and historical thread states',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/ThreadNameEdit'],
  },
  render: () => (
    <ModalPreview
      title="ThreadNameEdit"
      description="Actual thread name edit modal backed by the session query cache, with input, cancel, and save actions."
    >
      <SeedSampleSession />
      <OpenModal
        loadModal={() => import('@/modals/ThreadNameEdit').then((module) => module.default)}
        props={{
          sessionId: sampleSession.id,
          threadId: 'thread-pricing',
        }}
      />
    </ModalPreview>
  ),
}

export const SettingsModalStates: StoryObj = {
  name: 'Settings modal general route and navigation shell state',
  parameters: {
    uiInventoryTargets: ['src/renderer/modals/Settings'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="SettingsModal"
        description="Actual full-screen settings modal shell opened through a router search state, showing the production settings route surface."
      />
      <SettingsModalRouter />
    </Stack>
  ),
}

function OpenModal({ loadModal, props }: { loadModal: () => Promise<ComponentType>; props?: Record<string, unknown> }) {
  const openedRef = useRef(false)

  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true
    void loadModal().then((modal) => NiceModal.show(modal, props))
  }, [loadModal, props])

  return null
}

function SeedSampleSession() {
  queryClient.setQueryData(QueryKeys.ChatSession(sampleSession.id), sampleSession)
  return null
}

const settingsStoryRootRoute = createRootRoute({
  component: () => <LoadedSettingsModal />,
})
const settingsStoryRoute = createRoute({
  getParentRoute: () => settingsStoryRootRoute,
  path: '/',
  component: () => <LoadedSettingsModal />,
})
const settingsStoryRouter = createRouter({
  routeTree: settingsStoryRootRoute.addChildren([settingsStoryRoute]),
  history: createMemoryHistory({ initialEntries: ['/?settings=/settings/general'] }),
})

function SettingsModalRouter() {
  return (
    <Paper withBorder radius="md" p="md" h={520} style={{ overflow: 'hidden' }}>
      <RouterProvider router={settingsStoryRouter} />
    </Paper>
  )
}

function LoadedSettingsModal() {
  const SettingsModalRef = useRef<ComponentType | null>(null)
  const [, forceRender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => {
    let mounted = true
    void import('@/modals/Settings').then((module) => {
      if (!mounted) return
      SettingsModalRef.current = module.default
      forceRender()
    })
    return () => {
      mounted = false
    }
  }, [])

  const SettingsModal = SettingsModalRef.current
  return SettingsModal ? <SettingsModal /> : <Text size="sm">Loading Settings...</Text>
}

const sampleSession: Session = {
  id: 'modal-story-session',
  name: 'Launch readiness review',
  threadName: 'Current rollout blockers',
  type: 'chat',
  picUrl: '',
  assistantAvatarKey: 'openai',
  messages: [
    {
      id: 'modal-story-system',
      role: MessageRoleEnum.System,
      contentParts: [{ type: 'text', text: 'System note: keep answers concise and cite source material.' }],
      timestamp: Date.now() - 1000 * 60 * 12,
    },
    {
      id: 'modal-story-user',
      role: MessageRoleEnum.User,
      contentParts: [
        {
          type: 'text',
          text: 'Summarize the launch blockers and keep the answer ready for the release channel.',
        },
      ],
      timestamp: Date.now() - 1000 * 60 * 10,
    },
    {
      id: 'modal-story-assistant',
      role: MessageRoleEnum.Assistant,
      contentParts: [
        {
          type: 'text',
          text: 'The remaining blockers are QA signoff, pricing copy, and final provider compatibility checks.',
        },
      ],
      timestamp: Date.now() - 1000 * 60 * 9,
    },
  ],
  threads: [
    {
      id: 'thread-pricing',
      name: 'Pricing page copy',
      createdAt: Date.now() - 1000 * 60 * 60 * 5,
      messages: [
        {
          id: 'thread-pricing-user',
          role: MessageRoleEnum.User,
          contentParts: [{ type: 'text', text: 'Draft pricing page copy.' }],
          timestamp: Date.now() - 1000 * 60 * 60 * 5,
        },
      ],
    },
  ],
  settings: {
    provider: ModelProviderEnum.OpenAI,
    modelId: 'gpt-4.1',
    maxContextMessageCount: 12,
    temperature: 0.7,
    providerOptions: {
      openai: {
        reasoningEffort: 'medium',
      },
    },
  },
}

function ModalPreview({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Stack gap="lg">
      <SurfaceLabel title={title} description={description} />
      <Paper withBorder radius="md" p="md" h={360}>
        <Text size="sm" c="dimmed">
          The production NiceModal component is opened on mount.
        </Text>
        {children}
      </Paper>
    </Stack>
  )
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
