import { createFileRoute } from '@tanstack/react-router'
import ChatBridgeSeedLab from '@/components/dev/ChatBridgeSeedLab'

export const Route = createFileRoute('/dev/chatbridge')({
  component: ChatBridgeSeedLab,
})
