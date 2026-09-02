import NiceModal from '@ebay/nice-modal-react'
import { Box, Paper, Stack, Text } from '@mantine/core'
import type { Message, Session, SessionMeta, SessionMetaRecord } from '@shared/types'
import { MessageRoleEnum } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { getDefaultStore } from 'jotai'
import { createContext, type MutableRefObject, type ReactNode, useContext, useEffect, useRef } from 'react'
import { currentSessionIdAtom, showThreadHistoryDrawerAtom } from '@/stores/atoms'
import { QueryKeys } from '@chatbox/react/query'
import { rendererApplication } from '@/app/renderer-application'
import { resetSessionActivityStore, sessionActivityStore } from '@/stores/sessionActivityStore'
import SessionItem from '../session/SessionItem'
import SessionList from '../session/SessionList'
import ThreadHistoryDrawer from '../session/ThreadHistoryDrawer'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  },
})

const meta: Meta = {
  title: 'Real Components/Session',
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

const sessionMetas: SessionMeta[] = [
  {
    id: 'session-product',
    name: 'Product strategy and release notes',
    starred: true,
    type: 'chat',
    picUrl: '',
    assistantAvatarKey: 'openai',
  },
  {
    id: 'session-support',
    name: 'Support reply drafts for enterprise users',
    starred: false,
    type: 'chat',
    picUrl: '',
    assistantAvatarKey: 'claude',
  },
  {
    id: 'session-image',
    name: 'Campaign hero image exploration',
    starred: false,
    type: 'picture',
    picUrl: '',
  },
]

const sessionMetaRecords: SessionMetaRecord[] = sessionMetas.map((session, index) => ({
  ...session,
  sortOrder: 1000 - index,
  createdAt: Date.now() - index * 1000 * 60 * 60,
}))

const message = (id: string, role: Message['role'], text: string): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text }],
  tokenCalculatedAt: 0,
  timestamp: Date.now(),
})

const threadedSession: Session = {
  id: 'session-threaded',
  name: 'Launch planning',
  threadName: 'Current rollout blockers',
  type: 'chat',
  picUrl: '',
  messages: [
    message('current-user', MessageRoleEnum.User, 'What still blocks the launch?'),
    message('current-assistant', MessageRoleEnum.Assistant, 'The main blockers are QA signoff and pricing copy.'),
  ],
  threads: [
    {
      id: 'thread-positioning',
      name: 'Positioning research',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
      messages: [
        message('thread-positioning-user', MessageRoleEnum.User, 'Compare the positioning options.'),
        message(
          'thread-positioning-assistant',
          MessageRoleEnum.Assistant,
          'Option A emphasizes privacy; option B emphasizes speed.'
        ),
        message('thread-positioning-followup', MessageRoleEnum.User, 'Keep privacy as the lead message.'),
      ],
    },
    {
      id: 'thread-pricing',
      name: 'Pricing page copy',
      createdAt: Date.now() - 1000 * 60 * 60 * 5,
      messages: [
        message('thread-pricing-user', MessageRoleEnum.User, 'Draft pricing page copy.'),
        message('thread-pricing-assistant', MessageRoleEnum.Assistant, 'Lead with Pro workflows and team controls.'),
      ],
    },
  ],
}

export const SessionItemStates: StoryObj = {
  name: 'Session item selected generating completed and picture states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/session/SessionItem'],
  },
  render: () => <SessionItemStatesFixture />,
}

function SessionItemStatesFixture() {
  useEffect(() => {
    const runtime = rendererApplication.generationRuntime.start(sessionMetas[1].id, 'story-reply')
    sessionActivityStore.setState({
      unreadCompletedSessionIds: { [sessionMetas[2].id]: true },
    })
    return () => {
      rendererApplication.generationRuntime.finishActive(sessionMetas[1].id, runtime.messageId, runtime)
      resetSessionActivityStore()
    }
  }, [])

  return (
    <Stack gap="lg">
      <SurfaceLabel
        title="SessionItem"
        description="Actual session list row with selected, generating, unread-completed, starred, and picture states."
      />
      <Paper withBorder radius="md" p="xs" maw={360}>
        <Stack gap={2}>
          <SessionItem session={sessionMetas[0]} selected />
          <SessionItem session={sessionMetas[1]} selected={false} />
          <SessionItem session={sessionMetas[2]} selected={false} />
        </Stack>
      </Paper>
    </Stack>
  )
}

export const ThreadHistoryDrawerStates: StoryObj = {
  name: 'Thread history drawer with current and archived threads',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/session/ThreadHistoryDrawer'],
  },
  render: () => <ThreadHistoryDrawerFixture />,
}

export const SessionListStates: StoryObj = {
  name: 'Session list search clear selected paginated states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/session/SessionList'],
  },
  render: () => (
    <StoryRouter>
      <SessionListFixture />
    </StoryRouter>
  ),
}

function ThreadHistoryDrawerFixture() {
  useEffect(() => {
    const store = getDefaultStore()
    store.set(currentSessionIdAtom, threadedSession.id)
    store.set(showThreadHistoryDrawerAtom, true)
    return () => {
      store.set(showThreadHistoryDrawerAtom, false)
    }
  }, [])

  return (
    <Paper withBorder radius="md" p="md" h={320} pos="relative" style={{ overflow: 'hidden' }}>
      <SurfaceLabel
        title="ThreadHistoryDrawer"
        description="Actual thread history drawer populated from a real Session object with historical threads."
      />
      <Text size="sm" c="dimmed" mt="md">
        The drawer is opened through the same Jotai UI state used by the app.
      </Text>
      <ThreadHistoryDrawer session={threadedSession} />
    </Paper>
  )
}

function SessionListFixture() {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const seededRef = useRef(false)
  if (!seededRef.current) {
    seededRef.current = true
    queryClient.setQueryData(QueryKeys.ChatSessionsList, {
      pages: [
        {
          items: sessionMetaRecords,
          nextCursor: null,
          total: sessionMetaRecords.length,
        },
      ],
      pageParams: [0],
    })
  }

  return (
    <Stack gap="lg">
      <SurfaceLabel
        title="SessionList"
        description="Actual sortable chat session list with search action, clear action, selected row, starred row, and picture session row."
      />
      <Paper
        withBorder
        radius="md"
        h={320}
        maw={380}
        style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <SessionList sessionListViewportRef={viewportRef as MutableRefObject<HTMLDivElement | null>} />
      </Paper>
    </Stack>
  )
}

const storyRootRoute = createRootRoute({
  component: () => <StoryRouteSlot />,
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
const StoryRouteContext = createContext<ReactNode>(null)

function StoryRouter({ children }: { children: ReactNode }) {
  return (
    <StoryRouteContext.Provider value={children}>
      <RouterProvider router={storyRouter} />
    </StoryRouteContext.Provider>
  )
}

function StoryRouteSlot() {
  return <>{useContext(StoryRouteContext)}</>
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
