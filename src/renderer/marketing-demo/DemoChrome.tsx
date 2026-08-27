import { Box, CssBaseline, Grid, ThemeProvider } from '@mui/material'
import { createTheme } from '@mui/material/styles'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import MessageList from '@/components/chat/MessageList'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import InputBox from '@/components/InputBox/InputBox'
import Header from '@/components/layout/Header'
import { getThemeDesign } from '@/hooks/useAppTheme'
import { useSidebarWidth } from '@/hooks/useScreenChange'
import { applyDemoLayout, useDemoIsMobile } from '@/marketing-demo/demo-layout'
import { getDemoModel } from '@/marketing-demo/demo-sessions'
import { ImageCreatorPage } from '@/routes/image-creator/index'
import Sidebar from '@/Sidebar'
import { useLanguage } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

function DemoSessionView() {
  const { sessionId } = demoSessionRoute.useParams()
  const { session } = rendererApplication.sessionHooks.useSession(sessionId)
  const model = getDemoModel()

  if (!session) return null

  return (
    <div className="flex h-full flex-col">
      <Header session={session} />
      <div className="min-h-0 flex-1">
        <MessageList key={`message-list-${session.id}`} currentSession={session} className="pt-[2px]" />
      </div>
      <ErrorBoundary name="demo-inputbox">
        <InputBox
          key={`input-box-${session.id}`}
          sessionId={session.id}
          sessionType={session.type}
          model={model}
          onSubmit={async () => undefined}
          onSelectModel={() => undefined}
          onClickSessionSettings={() => true}
        />
      </ErrorBoundary>
    </div>
  )
}

function DemoLayout() {
  const showSidebar = useUIStore((state) => state.showSidebar)
  const sidebarWidth = useSidebarWidth()
  const language = useLanguage()
  const isMobileLayout = useDemoIsMobile()

  useEffect(() => {
    applyDemoLayout(isMobileLayout ? 'mobile' : 'desktop')
  }, [isMobileLayout])

  return (
    <Box
      className="App relative box-border h-full bg-chatbox-background-primary"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <Grid container className="relative z-[1] h-full">
        <Sidebar />
        <Box
          className="relative box-border h-full w-full"
          sx={{
            flexGrow: 1,
            ...(showSidebar
              ? language === 'ar'
                ? { paddingRight: { sm: `${sidebarWidth}px` } }
                : { paddingLeft: { sm: `${sidebarWidth}px` } }
              : {}),
          }}
        >
          <Box
            className="box-border h-full"
            sx={{
              padding: { xs: 0, sm: showSidebar ? '10px 10px 10px 0' : '5px' },
            }}
          >
            <Box
              className="h-full overflow-hidden bg-chatbox-background-primary"
              sx={{
                borderRadius: isMobileLayout ? 0 : { xs: 0, sm: '16px' },
                boxShadow: { xs: 'none', sm: '0 0 22px rgba(0, 0, 0, 0.11)' },
              }}
            >
              <Outlet />
            </Box>
          </Box>
        </Box>
      </Grid>
    </Box>
  )
}

const demoRootRoute = createRootRoute({
  component: DemoLayout,
})

const demoSessionRoute = createRoute({
  getParentRoute: () => demoRootRoute,
  path: '/session/$sessionId',
  component: DemoSessionView,
})

const demoImageCreatorRoute = createRoute({
  getParentRoute: () => demoRootRoute,
  path: '/image-creator',
  component: ImageCreatorPage,
})

export function createDemoRouter(initialPath: string) {
  return createRouter({
    routeTree: demoRootRoute.addChildren([demoSessionRoute, demoImageCreatorRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
}

export function DemoMuiTheme({ children }: { children: ReactNode }) {
  const theme = useMemo(() => createTheme(getThemeDesign('light', 'en')), [])
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

export function DemoRouter({ router }: { router: ReturnType<typeof createDemoRouter> }) {
  return <RouterProvider router={router} />
}
