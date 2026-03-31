import type { Message } from '../types'
import type { ReviewedAppCatalogEntry } from './manifest'
import {
  CHATBRIDGE_CHESS_APP_ID,
  CHATBRIDGE_CHESS_TOOL_NAME,
  getDefaultReviewedAppCatalogEntries,
} from './reviewed-app-catalog'

const EXPLICIT_CHESS_TERMS = ['chess', 'fen', 'pgn', 'checkmate', 'castling', 'kingside', 'queenside', 'sicilian']
const GENERIC_BOARD_GAME_TERMS = ['board', 'position', 'move', 'moves', 'game']

export type ReviewedSingleAppSelection =
  | {
      status: 'matched'
      appId: string
      appName: string
      toolName: string
      matchedTerms: string[]
      promptText: string
      catalogEntry: ReviewedAppCatalogEntry
    }
  | {
      status: 'chat-only'
      promptText: string
    }
  | {
      status: 'ambiguous'
      promptText: string
      reason: 'generic_board_game_request'
      matchedTerms: string[]
    }

function getLatestUserPrompt(messages: Message[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUserMessage) {
    return ''
  }

  return latestUserMessage.contentParts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .trim()
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
}

export function resolveReviewedSingleAppSelection(
  messages: Message[],
  entries: ReviewedAppCatalogEntry[] = getDefaultReviewedAppCatalogEntries()
): ReviewedSingleAppSelection {
  const promptText = getLatestUserPrompt(messages)
  const promptTokens = new Set(tokenize(promptText))
  const matchedChessTerms = EXPLICIT_CHESS_TERMS.filter((term) => promptTokens.has(term))

  if (matchedChessTerms.length > 0) {
    const chessEntry = entries.find((entry) => entry.manifest.appId === CHATBRIDGE_CHESS_APP_ID)
    if (!chessEntry) {
      return {
        status: 'chat-only',
        promptText,
      }
    }

    return {
      status: 'matched',
      appId: chessEntry.manifest.appId,
      appName: chessEntry.manifest.name,
      toolName: chessEntry.manifest.toolSchemas[0]?.name ?? CHATBRIDGE_CHESS_TOOL_NAME,
      matchedTerms: matchedChessTerms,
      promptText,
      catalogEntry: chessEntry,
    }
  }

  const genericBoardGameTerms = GENERIC_BOARD_GAME_TERMS.filter((term) => promptTokens.has(term))
  if (genericBoardGameTerms.length > 0) {
    return {
      status: 'ambiguous',
      promptText,
      reason: 'generic_board_game_request',
      matchedTerms: genericBoardGameTerms,
    }
  }

  return {
    status: 'chat-only',
    promptText,
  }
}
