import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useEffect } from 'react'
import { z } from 'zod'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

const searchSchema = z.object({
  settings: z.string().optional(), // b64 encoded config
})

export const Route = createFileRoute('/settings/')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
})

export function RouteComponent() {
  const isSmallScreen = useIsSmallScreen()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isSmallScreen) {
      navigate({ to: '/settings/provider', replace: true })
    }
  }, [isSmallScreen, navigate])

  return null
}
