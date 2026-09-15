import { createFileRoute } from '@tanstack/react-router'
import { ChatboxAISettings } from './-components/ChatboxAISettings'

export const Route = createFileRoute('/settings/provider/chatbox-ai/')({ component: RouteComponent })

export function RouteComponent() {
  return <ChatboxAISettings />
}
