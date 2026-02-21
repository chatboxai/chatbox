import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/settings/provider/chatbox-ai/')({
  component: RouteComponent,
})

export function RouteComponent() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate({ to: '/settings/provider', replace: true })
  }, [navigate])

  return null
}
