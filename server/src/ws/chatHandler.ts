import Anthropic from '@anthropic-ai/sdk'
import type { Prisma } from '@prisma/client'
import WebSocket from 'ws'
import { z } from 'zod'
import { anthropic } from '../lib/anthropic'
import { prisma } from '../lib/prisma'

const AppContextSchema = z.object({
  activeApps: z.array(z.string()).optional(),
  states: z.record(z.unknown()).optional(),
  previousApps: z.array(z.string()).optional(),
})

const UserMessageSchema = z.object({
  type: z.literal('user_message'),
  conversationId: z.string(),
  content: z.string(),
  appContext: AppContextSchema.optional(),
})

const ToolResultMessageSchema = z.object({
  type: z.literal('tool_result'),
  toolCallId: z.string(),
  result: z.unknown(),
})

const ClientMessageSchema = z.discriminatedUnion('type', [UserMessageSchema, ToolResultMessageSchema])

type IncomingUserMessage = z.infer<typeof UserMessageSchema>
type AppContext = z.infer<typeof AppContextSchema>

const MAX_TOOL_LOOP_DEPTH = 5
const TOOL_RESULT_TIMEOUT_MS = 60_000

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

async function loadHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })

  return messages
    .filter((m) => m.content !== null && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }))
}

async function ensureConversation(conversationId: string, userId: string): Promise<void> {
  const existing = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  })

  if (!existing) {
    await prisma.conversation.create({
      data: { id: conversationId, userId },
    })
  }
}

async function persistUserMessage(conversationId: string, content: string): Promise<void> {
  await prisma.message.create({
    data: { conversationId, role: 'user', content },
  })
}

async function persistAssistantMessage(conversationId: string, content: string): Promise<void> {
  if (!content) return
  await prisma.message.create({
    data: { conversationId, role: 'assistant', content },
  })
}

async function persistToolCall(
  conversationId: string,
  toolCallId: string,
  toolName: string,
  toolParams: unknown
): Promise<void> {
  await prisma.message.create({
    data: {
      conversationId,
      role: 'assistant',
      toolCallId,
      toolName,
      toolParams: toolParams as Prisma.InputJsonValue,
    },
  })
}

async function persistToolResult(conversationId: string, toolCallId: string, result: unknown): Promise<void> {
  await prisma.message.create({
    data: {
      conversationId,
      role: 'tool',
      toolCallId,
      content: JSON.stringify(result),
    },
  })
}

function buildSystemPrompt(appContext?: AppContext): string {
  let prompt = 'You are a helpful AI assistant on ChatBridge, an educational platform.'

  if (appContext?.activeApps?.length) {
    prompt += `\n\nActive application: ${appContext.activeApps[0]}.`
    if (appContext.states) {
      for (const [app, state] of Object.entries(appContext.states)) {
        prompt += `\n${app} current state: ${JSON.stringify(state)}`
      }
    }
    prompt += '\n\nYou can use the available tools to interact with this application.'
  }

  if (appContext?.previousApps?.length) {
    prompt += `\n\nPreviously used apps (available to switch back to): ${appContext.previousApps.join(', ')}.`
  }

  return prompt
}

function getAnthropicTools(activeApps?: string[]): Anthropic.Tool[] | undefined {
  if (!activeApps || activeApps.length === 0) return undefined

  const allTools: Record<string, Anthropic.Tool[]> = {
    'Test App': [
      {
        name: 'dummy_action',
        description:
          'A test tool that always succeeds. Call this when the user asks to use the test app or perform a dummy action.',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'A message to echo back' },
          },
        },
      },
    ],
    Chess: [
      {
        name: 'start_game',
        description:
          'Start a new chess game. Call this when the user wants to play chess.',
        input_schema: {
          type: 'object',
          properties: {
            color: {
              type: 'string',
              enum: ['white', 'black'],
              description: 'The color the user wants to play as. Defaults to white.',
            },
          },
        },
      },
      {
        name: 'make_move',
        description:
          'Make a chess move on the board using square coordinates. Use this to make moves for the AI opponent or when the user asks you to move a piece.',
        input_schema: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'Source square in algebraic notation, e.g. e2',
            },
            to: {
              type: 'string',
              description: 'Destination square in algebraic notation, e.g. e4',
            },
            promotion: {
              type: 'string',
              enum: ['q', 'r', 'b', 'n'],
              description: 'Piece to promote to (only needed for pawn promotion)',
            },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'get_board_state',
        description:
          'Get the current chess board position, whose turn it is, and game status. Use this to analyze the position when the user asks for help or suggestions.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
    ],
    Weather: [
      {
        name: 'get_current_weather',
        description:
          'Get the current weather conditions for a location. Returns temperature, humidity, wind speed, and description.',
        input_schema: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name, e.g. "Tokyo", "New York", "London"',
            },
          },
          required: ['location'],
        },
      },
      {
        name: 'get_forecast',
        description: 'Get a multi-day weather forecast for a location.',
        input_schema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
            days: { type: 'number', description: 'Number of forecast days (default 4)' },
          },
          required: ['location'],
        },
      },
    ],
    Spotify: [
      {
        name: 'search_tracks',
        description:
          'Search for music tracks on Spotify. Returns track names, artists, album, and preview info. Use this to find songs before creating a playlist.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query, e.g. "jazz piano", "Miles Davis", "upbeat pop 2020"',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default 5, max 20)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'create_playlist',
        description:
          'Create a Spotify playlist and populate it with tracks. Searches for each track query and adds the best match. Requires Spotify to be connected first.',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Playlist name, e.g. "Morning Jazz Vibes"',
            },
            description: {
              type: 'string',
              description: 'Optional playlist description',
            },
            trackQueries: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Search queries for tracks to add, e.g. ["Miles Davis So What", "John Coltrane Giant Steps"]',
            },
          },
          required: ['name', 'trackQueries'],
        },
      },
    ],
  }

  const tools = activeApps.flatMap((app) => allTools[app] ?? [])
  return tools.length > 0 ? tools : undefined
}

function waitForToolResult(ws: WebSocket, toolCallId: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ error: `Tool call ${toolCallId} timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    const handler = (data: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString()) as Record<string, unknown>
        if (msg.type === 'tool_result' && msg.toolCallId === toolCallId) {
          cleanup()
          resolve(msg.result)
        }
      } catch {
        // ignore non-JSON messages
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      ws.removeListener('message', handler)
    }

    ws.on('message', handler)
  })
}

async function streamWithToolLoop(
  ws: WebSocket,
  conversationId: string,
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  tools: Anthropic.Tool[] | undefined,
  depth: number = 0
): Promise<void> {
  if (depth > MAX_TOOL_LOOP_DEPTH) {
    send(ws, { type: 'error', message: 'Too many tool call rounds' })
    send(ws, { type: 'done' })
    return
  }

  const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = []

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    ...(tools ? { tools } : {}),
  })

  stream.on('text', (text) => {
    if (text) {
      send(ws, { type: 'token', data: text })
    }
  })

  stream.on('contentBlock', (block) => {
    if (block.type === 'tool_use') {
      toolUseBlocks.push({ id: block.id, name: block.name, input: block.input })
    }
  })

  const finalMessage = await stream.finalMessage()

  if (finalMessage.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
    // Send all tool calls to client and collect results concurrently
    const resultPromises = toolUseBlocks.map((tc) => {
      send(ws, {
        type: 'tool_call',
        toolCallId: tc.id,
        toolName: tc.name,
        params: tc.input as Record<string, unknown>,
      })
      return waitForToolResult(ws, tc.id, TOOL_RESULT_TIMEOUT_MS)
    })

    const results = await Promise.all(resultPromises)

    // Persist tool calls and results in order
    for (let i = 0; i < toolUseBlocks.length; i++) {
      const tc = toolUseBlocks[i]
      await persistToolCall(conversationId, tc.id, tc.name, tc.input)
      await persistToolResult(conversationId, tc.id, results[i])
    }

    // Build Anthropic continuation messages (exact format required by the API)
    const toolResultContent: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((tc, i) => ({
      type: 'tool_result' as const,
      tool_use_id: tc.id,
      content: JSON.stringify(results[i]),
    }))

    const continuationMessages: Anthropic.MessageParam[] = [
      ...messages,
      { role: 'assistant' as const, content: finalMessage.content as Anthropic.ContentBlockParam[] },
      { role: 'user' as const, content: toolResultContent },
    ]

    await streamWithToolLoop(ws, conversationId, continuationMessages, systemPrompt, tools, depth + 1)
    return
  }

  // Extract final text for persistence
  const finalText = finalMessage.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  await persistAssistantMessage(conversationId, finalText)

  send(ws, { type: 'done' })
}

async function handleUserMessage(ws: WebSocket, msg: IncomingUserMessage, userId: string): Promise<void> {
  const { conversationId, content, appContext } = msg

  await ensureConversation(conversationId, userId)
  await persistUserMessage(conversationId, content)

  // loadHistory includes the user message we just persisted
  const history = await loadHistory(conversationId)
  const systemPrompt = buildSystemPrompt(appContext)
  const tools = getAnthropicTools(appContext?.activeApps)

  try {
    await streamWithToolLoop(ws, conversationId, history, systemPrompt, tools)
  } catch (error) {
    console.error('Generation failed', { conversationId, userId, error })
    send(ws, { type: 'error', message: 'Generation failed. Please try again.' })
    send(ws, { type: 'done' })
  }
}

export function handleWebSocketConnection(ws: WebSocket, userId: string): void {
  ws.on('error', (error) => {
    console.error('WebSocket error', { userId, error })
  })

  ws.on('message', (rawData) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawData.toString())
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    const result = ClientMessageSchema.safeParse(parsed)
    if (!result.success) {
      send(ws, { type: 'error', message: 'Unknown message type' })
      return
    }

    if (result.data.type === 'tool_result') {
      // Handled by waitForToolResult listeners — no action needed here
      return
    }

    // Fire-and-forget — errors handled inside handleUserMessage
    handleUserMessage(ws, result.data, userId).catch((error) => {
      console.error('Unhandled error in handleUserMessage', { userId, error })
      send(ws, { type: 'error', message: 'Generation failed. Please try again.' })
    })
  })

  ws.on('close', () => {
    console.log(`WebSocket closed for user ${userId}`)
  })
}
