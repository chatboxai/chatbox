import type { ToolSet } from 'ai'
import { z } from 'zod'
import {
  CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
  createChatBridgeHostTool,
} from '@shared/chatbridge/tools'
import {
  CHATBRIDGE_CHESS_APP_ID,
  CHATBRIDGE_CHESS_TOOL_NAME,
  ensureDefaultReviewedAppsRegistered,
} from '@shared/chatbridge/reviewed-app-catalog'
import {
  resolveReviewedSingleAppSelection,
  type ReviewedSingleAppSelection,
} from '@shared/chatbridge/single-app-discovery'
import type { Message } from '@shared/types'

const ChessPrepareSessionInputSchema = z.object({
  request: z.string().trim().min(1),
  fen: z.string().trim().min(1).optional(),
  pgn: z.string().trim().min(1).optional(),
})

type ChessPrepareSessionInput = z.infer<typeof ChessPrepareSessionInputSchema>

type CreateReviewedSingleAppToolSetOptions = {
  messages: Message[]
  executors?: {
    chess_prepare_session?: (input: ChessPrepareSessionInput) => Promise<unknown> | unknown
  }
}

function createChessPrepareSessionTool(
  execute?: (input: ChessPrepareSessionInput) => Promise<unknown> | unknown
) {
  return createChatBridgeHostTool({
    description:
      'Prepare the reviewed Chess capability for explicit chess, FEN, PGN, opening, and move-analysis requests.',
    appId: CHATBRIDGE_CHESS_APP_ID,
    schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
    effect: 'read',
    retryClassification: 'safe',
    inputSchema: ChessPrepareSessionInputSchema,
    execute: async (input) =>
      execute?.(input) ?? {
        appId: CHATBRIDGE_CHESS_APP_ID,
        appName: 'Chess',
        capability: 'prepare-session',
        launchReady: true,
        summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
        request: input.request,
        fen: input.fen,
        pgn: input.pgn,
      },
  })
}

export function createReviewedSingleAppToolSet(options: CreateReviewedSingleAppToolSetOptions): {
  selection: ReviewedSingleAppSelection
  tools: ToolSet
} {
  const selection = resolveReviewedSingleAppSelection(options.messages, ensureDefaultReviewedAppsRegistered())

  if (selection.status !== 'matched') {
    return {
      selection,
      tools: {},
    }
  }

  if (selection.toolName === CHATBRIDGE_CHESS_TOOL_NAME) {
    return {
      selection,
      tools: {
        [CHATBRIDGE_CHESS_TOOL_NAME]: createChessPrepareSessionTool(options.executors?.chess_prepare_session),
      },
    }
  }

  return {
    selection,
    tools: {},
  }
}
