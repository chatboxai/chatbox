import { createFileRoute } from '@tanstack/react-router'
import { ChatboxAISettings } from './provider/chatbox-ai/-components/ChatboxAISettings'

export const Route = createFileRoute('/settings/chatbox-ai')({ component: RouteComponent })

export function RouteComponent() {
  return <ChatboxAISettings padded />
}
