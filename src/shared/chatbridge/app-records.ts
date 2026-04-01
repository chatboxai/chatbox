import { z } from 'zod'
import { ChatBridgeAppEventSchema } from './events'
import { ChatBridgeAppInstanceSchema } from './instance'

export const ChatBridgeAppRecordSnapshotSchema = z.object({
  instances: z.array(ChatBridgeAppInstanceSchema),
  events: z.array(ChatBridgeAppEventSchema),
})

export type ChatBridgeAppRecordSnapshot = z.infer<typeof ChatBridgeAppRecordSnapshotSchema>
