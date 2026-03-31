import { Box } from '@mantine/core'
import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import DevHeader from '@/components/dev/DevHeader'
import { FORCE_ENABLE_DEV_PAGES } from '@/dev/devToolsConfig'

export const Route = createFileRoute('/dev')({
  component: DevLayout,
})

function DevLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  // Check if we're in production and redirect if so
  const shouldShowDevTools = FORCE_ENABLE_DEV_PAGES

  useEffect(() => {
    if (!shouldShowDevTools) {
      navigate({ to: '/' })
    }
  }, [shouldShowDevTools, navigate])

  // Don't render dev UI in production
  if (!shouldShowDevTools) {
    return null
  }

  // Determine page title based on current route
  const getPageTitle = () => {
    const path = location.pathname
    if (path === '/dev' || path === '/dev/') return 'Dev Tools'
    if (path.includes('chatbridge')) return 'ChatBridge Seed Lab'
    if (path.includes('model-selector')) return 'ModelSelector Preview'
    if (path.includes('context-generator')) return 'Context Generator'
    return 'Dev Tools'
  }

  return (
    <Box w="100%" h="100vh" style={{ display: 'flex', flexDirection: 'column' }}>
      <DevHeader title={getPageTitle()} />
      <Box style={{ flex: 1, overflowY: 'auto' }}>
        <Outlet />
      </Box>
    </Box>
  )
}

export default DevLayout
