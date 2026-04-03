import { z } from 'zod'

export const CHATBRIDGE_REVIEWED_APP_LAUNCH_SCHEMA_VERSION = 1 as const
export const CHATBRIDGE_REVIEWED_APP_LAUNCH_VALUES_KEY = 'chatbridgeReviewedAppLaunch' as const

export const ChatBridgeReviewedAppLaunchSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_REVIEWED_APP_LAUNCH_SCHEMA_VERSION),
  appId: z.string().trim().min(1),
  appName: z.string().trim().min(1),
  appVersion: z.string().trim().min(1),
  toolName: z.string().trim().min(1),
  capability: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1),
  request: z.string().trim().min(1).optional(),
  fen: z.string().trim().min(1).optional(),
  pgn: z.string().trim().min(1).optional(),
  uiEntry: z.string().trim().min(1).optional(),
  origin: z.string().trim().min(1).optional(),
})

export type ChatBridgeReviewedAppLaunch = z.infer<typeof ChatBridgeReviewedAppLaunchSchema>

export function readChatBridgeReviewedAppLaunch(values: Record<string, unknown> | undefined) {
  if (!values || typeof values !== 'object') {
    return null
  }

  const parsed = ChatBridgeReviewedAppLaunchSchema.safeParse(values[CHATBRIDGE_REVIEWED_APP_LAUNCH_VALUES_KEY])
  return parsed.success ? parsed.data : null
}

export function writeChatBridgeReviewedAppLaunchValues(
  values: Record<string, unknown> | undefined,
  launch: ChatBridgeReviewedAppLaunch
) {
  return {
    ...(values || {}),
    [CHATBRIDGE_REVIEWED_APP_LAUNCH_VALUES_KEY]: ChatBridgeReviewedAppLaunchSchema.parse(launch),
  }
}
