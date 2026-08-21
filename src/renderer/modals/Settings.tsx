import { Box, Button, Flex, Text, Title } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useLocation,
} from '@tanstack/react-router'
import clsx from 'clsx'
import { type FC, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import { z } from 'zod'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SettingsKnowledgeBaseRouteComponent from '@/components/knowledge-base/KnowledgeBase'
import { Modal } from '@/components/layout/Overlay'
import { getThemeDesign } from '@/hooks/useAppTheme'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { router } from '@/router'
import { RouteComponent as SettingsArchiveRouteComponent } from '@/routes/settings/archive'
import { RouteComponent as SettingsChatRouteComponent } from '@/routes/settings/chat'
import { RouteComponent as SettingsChatboxAiRouteComponent } from '@/routes/settings/chatbox-ai'
import { RouteComponent as SettingsDefaultModelsRouteComponent } from '@/routes/settings/default-models'
import { RouteComponent as SettingsDocumentParserRouteComponent } from '@/routes/settings/document-parser'
import { RouteComponent as SettingsGeneralRouteComponent } from '@/routes/settings/general'
import { RouteComponent as SettingsHotkeysRouteComponent } from '@/routes/settings/hotkeys'
import { RouteComponent as SettingsIndexRouteComponent } from '@/routes/settings/index'
import { RouteComponent as SettingsMcpRouteComponent } from '@/routes/settings/mcp'
import { RouteComponent as SettingsProviderProviderIdRouteComponent } from '@/routes/settings/provider/$providerId'
import { RouteComponent as SettingsProviderChatboxAiRouteComponent } from '@/routes/settings/provider/chatbox-ai'
import { RouteComponent as SettingsProviderIndexRouteComponent } from '@/routes/settings/provider/index'
import { RouteComponent as SettingsProviderRouteRouteComponent } from '@/routes/settings/provider/route'
import { SettingsRoot } from '@/routes/settings/route'
import { RouteComponent as SettingsSkillsRouteComponent } from '@/routes/settings/skills'
import { RouteComponent as SettingsWebSearchRouteComponent } from '@/routes/settings/web-search'

export type SettingsModalProps = {}

export const SettingsModal: FC<SettingsModalProps> = (props) => {
  const { t } = useTranslation()
  const location = useLocation()
  const search = location.search as { settings?: string }
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  useEffect(() => {
    if (search.settings) {
      settingsModalHistory.replace(search.settings)
    }
  }, [search.settings])

  const onClose = useCallback(() => {
    const currentSearch = router.state.location.search as { settings?: string }
    const { settings: _, ...otherSearch } = currentSearch
    router.navigate({
      to: router.state.location.pathname as '/',
      search: otherSearch,
    })
  }, [])

  return (
    <Modal
      opened={!!search.settings}
      onClose={onClose}
      // size="1200"
      fullScreen={true}
      centered
      size="100%"
      // title={<Title order={3}>{t('Settings')}</Title>}
      withCloseButton={false}
      classNames={{
        content: clsx('h-full'),
        header: 'hidden',
        body: clsx('!p-0 flex-1  flex flex-col h-full'),
      }}
      transitionProps={{ transition: 'fade-up' }}
    >
      <Flex
        h={48}
        align="center"
        flex="0 0 48px"
        className="title-bar border-0 border-b border-chatbox-border-primary border-solid"
      >
        <div className={clsx('flex-[1_1_0]', needRoomForMacWindowControls ? 'min-w-16' : '')} />
        <Flex px="sm" align="center" h="100%" w={'100%'} maw={1200} gap="xs">
          <Title order={4} fz={18} lh="24px" fw={600} lineClamp={1} flex={1}>
            {t('Settings')}
          </Title>

          <Text c="chatbox-tertiary" size="xs">
            ESC
          </Text>
          <Button
            className="controls"
            color="chatbox-secondary"
            variant="light"
            h={32}
            w={32}
            p={0}
            radius="md"
            onClick={onClose}
            autoFocus={false}
          >
            <ScalableIcon icon={IconX} size={20} />
          </Button>
        </Flex>
        <div className={clsx('flex-[1_1_0]')} />
      </Flex>
      <Box flex={1} w="100%" maw={1200} mx="auto" className="overflow-auto">
        <RouterProvider router={modalRouter} />
      </Box>
      <Toaster richColors position="bottom-center" style={{ zIndex: 2147483647 }} />
    </Modal>
  )
}

export default SettingsModal

export function navigateToSettings(path?: string) {
  if (window.matchMedia(`(max-width:${getThemeDesign('light', 'en').breakpoints?.values?.sm || 640}px)`).matches) {
    router.navigate({
      to: `/settings${path ? (path.startsWith('/') ? path : `/${path}`) : ''}` as '/settings',
    })
  } else {
    router.navigate({
      to: router.state.location.pathname as '/',
      search: {
        settings: `/settings${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`,
      },
      mask: {
        to: '/settings',
      },
    })
  }
}

const RootRoute = createRootRoute({
  validateSearch: z.object({}),
  component: SettingsRoot,
})

const SettingsIndexRoute = createRoute({
  component: SettingsIndexRouteComponent,
  path: '/settings/',
  getParentRoute: () => RootRoute,
})

const SettingsChatboxAiRoute = createRoute({
  component: SettingsChatboxAiRouteComponent,
  path: '/settings/chatbox-ai',
  getParentRoute: () => RootRoute,
})

const SettingsGeneralRoute = createRoute({
  component: SettingsGeneralRouteComponent,
  path: '/settings/general',
  getParentRoute: () => RootRoute,
})

const SettingsChatRoute = createRoute({
  component: SettingsChatRouteComponent,
  path: '/settings/chat',
  getParentRoute: () => RootRoute,
})

const SettingsArchiveRoute = createRoute({
  component: SettingsArchiveRouteComponent,
  path: '/settings/archive',
  getParentRoute: () => RootRoute,
})

const SettingsWebSearchRoute = createRoute({
  component: SettingsWebSearchRouteComponent,
  path: '/settings/web-search',
  getParentRoute: () => RootRoute,
})

const SettingsMcpRoute = createRoute({
  component: SettingsMcpRouteComponent,
  path: '/settings/mcp',
  getParentRoute: () => RootRoute,
})

const SettingsSkillsRoute = createRoute({
  component: SettingsSkillsRouteComponent,
  path: '/settings/skills',
  getParentRoute: () => RootRoute,
})

const SettingsKnowledgeBaseRoute = createRoute({
  component: SettingsKnowledgeBaseRouteComponent,
  path: '/settings/knowledge-base',
  getParentRoute: () => RootRoute,
})

const SettingsDocumentParserRoute = createRoute({
  component: SettingsDocumentParserRouteComponent,
  path: '/settings/document-parser',
  getParentRoute: () => RootRoute,
})

const SettingsHotkeysRoute = createRoute({
  component: SettingsHotkeysRouteComponent,
  path: '/settings/hotkeys',
  getParentRoute: () => RootRoute,
})

const SettingsDefaultModelsRoute = createRoute({
  component: SettingsDefaultModelsRouteComponent,
  path: '/settings/default-models',
  getParentRoute: () => RootRoute,
})

const SettingsProviderRouteRoute = createRoute({
  component: SettingsProviderRouteRouteComponent,
  path: '/settings/provider',
  getParentRoute: () => RootRoute,
})

const SettingsProviderIndexRoute = createRoute({
  component: SettingsProviderIndexRouteComponent,
  path: '/',
  getParentRoute: () => SettingsProviderRouteRoute,
})

const SettingsProviderChatboxAiRoute = createRoute({
  component: SettingsProviderChatboxAiRouteComponent,
  path: '/chatbox-ai',
  getParentRoute: () => SettingsProviderRouteRoute,
})

const SettingsProviderProviderIdRoute = createRoute({
  component: SettingsProviderProviderIdRouteComponent,
  path: '/$providerId',
  getParentRoute: () => SettingsProviderRouteRoute,
})

SettingsProviderRouteRoute.addChildren([
  SettingsProviderIndexRoute,
  SettingsProviderChatboxAiRoute,
  SettingsProviderProviderIdRoute,
])

const routeTree = RootRoute.addChildren([
  SettingsIndexRoute,
  SettingsChatboxAiRoute,
  SettingsGeneralRoute,
  SettingsChatRoute,
  SettingsArchiveRoute,
  SettingsWebSearchRoute,
  SettingsMcpRoute,
  SettingsSkillsRoute,
  SettingsKnowledgeBaseRoute,
  SettingsDocumentParserRoute,
  SettingsHotkeysRoute,
  SettingsDefaultModelsRoute,
  SettingsProviderRouteRoute,
])

const settingsModalHistory = createMemoryHistory()

// memoryHistory.location.href = '/about'
const modalRouter = createRouter({
  routeTree,
  history: settingsModalHistory,
  defaultPreload: 'intent',
  scrollRestoration: true,
})
