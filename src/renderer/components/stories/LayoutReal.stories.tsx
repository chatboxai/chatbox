import NiceModal from '@ebay/nice-modal-react'
import { Box, Button, Group, Paper, Stack, Text } from '@mantine/core'
import type { Session } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconCircleCheck, IconSettings } from '@tabler/icons-react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { getDefaultStore } from 'jotai'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { isFullscreenAtom, platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { windowMaximizedAtom } from '@/hooks/useWindowMaximized'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { uiStore } from '@/stores/uiStore'
import { ScalableIcon } from '../common/ScalableIcon'
import DesktopDownloadReminder from '../layout/DesktopDownloadReminder'
import ExitFullscreenButton from '../layout/ExitFullscreenButton'
import { Drawer, Modal } from '../layout/Overlay'
import Page from '../layout/Page'
import Toolbar from '../layout/Toolbar'
import WindowControls from '../layout/WindowControls'

const toolbarSession: Session = {
  id: 'storybook-session',
  name: 'Product strategy',
  type: 'chat',
  messages: [],
}

const meta: Meta = {
  title: 'Real Components/Layout',
  decorators: [
    (Story) => (
      <NiceModal.Provider>
        <Box p="lg" bg="var(--chatbox-background-primary)" style={{ maxWidth: 920, minHeight: 520 }}>
          <Story />
        </Box>
      </NiceModal.Provider>
    ),
  ],
}

export default meta

export const PageStates: StoryObj = {
  name: 'Page header sidebar title and action states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/layout/Page'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="Page"
        description="Actual app page shell with sidebar toggle, title area, right actions, and scrollable content body."
      />
      <SeedLayoutAtoms platformType="darwin" fullscreen={false} maximized={false} />
      <Paper withBorder radius="md" h={360} style={{ overflow: 'hidden' }}>
        <Page
          title="Conversation Settings"
          right={
            <Group gap="xs">
              <Button size="xs" variant="light" leftSection={<ScalableIcon icon={IconSettings} size={14} />}>
                Configure
              </Button>
            </Group>
          }
        >
          <Stack p="md" gap="md">
            <Paper withBorder p="md" radius="md">
              <Text fw={600}>Model defaults</Text>
              <Text size="sm" c="dimmed">
                Real page content area below the shared title bar.
              </Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text fw={600}>Session controls</Text>
              <Text size="sm" c="dimmed">
                The header keeps its fixed height while this body scrolls.
              </Text>
            </Paper>
          </Stack>
        </Page>
      </Paper>
    </Stack>
  ),
}

export const ToolbarStates: StoryObj = {
  name: 'Toolbar search layout thread history and menu states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/layout/Toolbar'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="Toolbar"
        description="Actual chat title toolbar with search, layout width toggle, thread history, export, raw JSON, clear, and delete menu actions."
      />
      <SeedLayoutAtoms platformType="darwin" fullscreen={false} maximized={false} />
      <Paper withBorder radius="md" p="md" maw={520}>
        <Toolbar session={toolbarSession} />
      </Paper>
    </Stack>
  ),
}

export const WindowControlsStates: StoryObj = {
  name: 'Window controls normal and maximized desktop states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/layout/WindowControls'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="WindowControls"
        description="Actual desktop window controls shown for Windows and Linux title bars, including restore state."
      />
      <Group align="flex-start">
        <Paper withBorder radius="md" p="sm">
          <Text size="xs" c="dimmed" mb={6}>
            Windows normal
          </Text>
          <SeedLayoutAtoms platformType="win32" fullscreen={false} maximized={false} />
          <WindowControls />
        </Paper>
        <Paper withBorder radius="md" p="sm">
          <Text size="xs" c="dimmed" mb={6}>
            Windows maximized
          </Text>
          <SeedLayoutAtoms platformType="win32" fullscreen={false} maximized />
          <WindowControls />
        </Paper>
      </Group>
    </Stack>
  ),
}

export const OverlayStates: StoryObj = {
  name: 'Overlay modal drawer stacked escape management states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/layout/Overlay'],
  },
  render: () => {
    const [modalOpened, setModalOpened] = useState(true)
    const [drawerOpened, setDrawerOpened] = useState(true)

    return (
      <Stack gap="lg">
        <SurfaceLabel
          title="Modal and Drawer"
          description="Actual overlay wrappers with shared stack management so only the top overlay responds to Escape."
        />
        <Group>
          <Button onClick={() => setModalOpened(true)}>Open modal</Button>
          <Button variant="light" onClick={() => setDrawerOpened(true)}>
            Open drawer
          </Button>
        </Group>
        <Paper withBorder radius="md" p="md">
          <Group gap="xs">
            <ScalableIcon icon={IconCircleCheck} size={16} />
            <Text size="sm">Both overlays use the production overlay manager.</Text>
          </Group>
        </Paper>
        <Modal opened={modalOpened} onClose={() => setModalOpened(false)} title="Delete conversation?">
          <Text size="sm">This is the actual managed Modal wrapper used by layout overlays.</Text>
        </Modal>
        <Drawer opened={drawerOpened} onClose={() => setDrawerOpened(false)} title="Thread history" position="right">
          <Box p="md">
            <Text size="sm">This is the actual managed Drawer wrapper stacked above the modal.</Text>
          </Box>
        </Drawer>
      </Stack>
    )
  },
}

export const ExitFullscreenButtonState: StoryObj = {
  name: 'Exit fullscreen hit area state',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/layout/ExitFullscreenButton'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="ExitFullscreenButton"
        description="Actual invisible top hit area that appears when the desktop window is in fullscreen."
      />
      <FullscreenPlatformFixture />
      <Paper withBorder radius="md" h={96} pos="relative" style={{ overflow: 'hidden' }}>
        <ExitFullscreenButton />
        <Box className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-3 bg-gray-400/20" />
        <Stack align="center" justify="center" h="100%" gap={4}>
          <Text fw={600}>Fullscreen exit zone is mounted</Text>
          <Text size="xs" c="dimmed">
            The shaded strip visualizes the actual top hit area rendered by the component.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  ),
}

export const DesktopDownloadReminderState: StoryObj = {
  name: 'Desktop download reminder web floating prompt state',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/layout/DesktopDownloadReminder'],
  },
  render: () => (
    <StoryRouter>
      <Stack gap="lg">
        <SurfaceLabel
          title="DesktopDownloadReminder"
          description="Actual web-only floating reminder that promotes the desktop app outside settings routes."
        />
        <WebPlatformFixture />
        <Paper withBorder radius="md" h={260} pos="relative" style={{ overflow: 'hidden' }}>
          <Box p="md">
            <Text fw={600}>Web chat viewport</Text>
            <Text size="sm" c="dimmed">
              The real fixed reminder is rendered at the bottom right of this iframe viewport.
            </Text>
          </Box>
          <DesktopDownloadReminder />
        </Paper>
      </Stack>
    </StoryRouter>
  ),
}

function SeedLayoutAtoms({
  platformType,
  fullscreen,
  maximized,
}: {
  platformType: string
  fullscreen: boolean
  maximized: boolean
}) {
  useEffect(() => {
    const store = getDefaultStore()
    store.set(platformTypeAtom, platformType)
    store.set(isFullscreenAtom, fullscreen)
    store.set(windowMaximizedAtom, maximized)
    uiStore.setState({
      showSidebar: false,
      widthFull: false,
      openSearchDialog: false,
    })
  }, [fullscreen, maximized, platformType])

  return null
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

function WebPlatformFixture() {
  useEffect(() => {
    const originalType = platform.type
    const originalOpenLink = platform.openLink
    platform.type = 'web'
    platform.openLink = async () => undefined
    settingsStore.setState((state) => ({
      ...state,
      chatboxAIDesktopPromptDismissed: false,
    }))

    return () => {
      platform.type = originalType
      platform.openLink = originalOpenLink
    }
  }, [])

  return null
}

function FullscreenPlatformFixture() {
  useEffect(() => {
    const originalIsFullscreen = platform.isFullscreen
    const originalSetFullscreen = platform.setFullscreen
    platform.isFullscreen = async () => true
    platform.setFullscreen = async () => undefined

    const store = getDefaultStore()
    store.set(isFullscreenAtom, true)

    window.dispatchEvent(new Event('resize'))
    return () => {
      platform.isFullscreen = originalIsFullscreen
      platform.setFullscreen = originalSetFullscreen
      store.set(isFullscreenAtom, false)
    }
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
