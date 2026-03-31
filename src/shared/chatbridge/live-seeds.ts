import type { Message, Session, SessionThread } from '../types'

type ToolCallState = 'call' | 'result' | 'error'
type AppLifecycle = 'launching' | 'ready' | 'active' | 'complete' | 'stale' | 'error'

type AppLifecycleMessageOptions = {
  appId?: string
  appName?: string
  toolCallId: string
  lifecycle: AppLifecycle
  state?: ToolCallState
  partial?: boolean
  attachmentName?: string
  summary?: string
  error?: string
  title?: string
  description?: string
  statusText?: string
  fallbackTitle?: string
  fallbackText?: string
  snapshot?: Record<string, unknown>
}

export type ChatBridgeLiveSeedAuditStep = {
  action: string
  expected: string
}

export type ChatBridgeLiveSeedFixture = {
  id: string
  name: string
  description: string
  coverage: string[]
  auditSteps: ChatBridgeLiveSeedAuditStep[]
  sessionInput: Omit<Session, 'id'>
  blobEntries?: Array<{
    key: string
    value: string
  }>
}

const APP_ID = 'story-builder'
const APP_NAME = 'Story Builder'
export const CHATBRIDGE_LIVE_SEED_PREFIX = '[Seeded] ChatBridge:'

function buildAttachmentStorageKey(messageId: string) {
  return `fixture:${messageId}:attachment`
}

function createTextMessage(id: string, role: Message['role'], text: string, timestamp: number): Message {
  return {
    id,
    role,
    timestamp,
    contentParts: [{ type: 'text', text }],
  }
}

export function createAppLifecycleMessage(
  id: string,
  role: Message['role'],
  text: string,
  options: AppLifecycleMessageOptions & { timestamp?: number }
): Message {
  const appId = options.appId ?? APP_ID
  const appName = options.appName ?? APP_NAME
  const lifecycle = options.lifecycle
  const summary = options.summary ?? `${appName} lifecycle: ${lifecycle}`
  const appInstanceId = `app-instance-${options.toolCallId}`
  const bridgeSessionId = `bridge-${options.toolCallId}`
  const timestamp = options.timestamp ?? 1
  const snapshot = options.snapshot ?? {
    route: '/apps/story-builder',
    status: lifecycle,
  }

  return {
    id,
    role,
    timestamp,
    contentParts: [
      { type: 'text', text },
      {
        type: 'app',
        appId,
        appName,
        appInstanceId,
        lifecycle,
        summary,
        toolCallId: options.toolCallId,
        bridgeSessionId,
        title: options.title,
        description: options.description,
        statusText: options.statusText,
        fallbackTitle: options.fallbackTitle,
        fallbackText: options.fallbackText,
        error: options.error,
        snapshot,
      },
      {
        type: 'tool-call',
        state: options.state ?? 'result',
        toolCallId: options.toolCallId,
        toolName: 'chatbridge_app_state',
        args: {
          appId,
          lifecycle,
          bridgeSessionId,
        },
        ...(options.partial
          ? {}
          : {
              result: {
                appId,
                appName,
                appInstanceId,
                lifecycle,
                summary,
                snapshot,
              },
            }),
      },
    ],
    files: options.attachmentName
      ? [
          {
            id: `file-${id}`,
            name: options.attachmentName,
            fileType: 'application/json',
            storageKey: buildAttachmentStorageKey(id),
          },
        ]
      : undefined,
  }
}

function createHtmlPreviewMessage(id: string, timestamp: number): Message {
  const htmlPreviewMarkdown = [
    'Here is the seeded HTML preview runtime for live inspection.',
    '',
    '```html',
    '<main class="preview-card">',
    '  <p class="eyebrow">ChatBridge Seed</p>',
    '  <h1 id="title">Host-owned preview runtime</h1>',
    '  <p id="detail">The seeded runtime is mounted inside the message shell.</p>',
    '  <button id="advance" type="button">Advance state</button>',
    '</main>',
    '```',
    '',
    '```css',
    'body {',
    '  margin: 0;',
    '  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;',
    '  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);',
    '  color: #0f172a;',
    '}',
    '.preview-card {',
    '  min-height: 100vh;',
    '  display: grid;',
    '  gap: 16px;',
    '  align-content: center;',
    '  padding: 32px;',
    '}',
    '.eyebrow {',
    '  margin: 0;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.18em;',
    '  font-size: 12px;',
    '  color: #475569;',
    '}',
    'h1 {',
    '  margin: 0;',
    '  font-size: 32px;',
    '}',
    '#detail {',
    '  margin: 0;',
    '  max-width: 42ch;',
    '  color: #334155;',
    '}',
    'button {',
    '  width: fit-content;',
    '  border: 0;',
    '  border-radius: 999px;',
    '  background: #0f172a;',
    '  color: white;',
    '  padding: 12px 18px;',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    '```',
    '',
    '```javascript',
    'const detail = document.getElementById("detail")',
    'const advance = document.getElementById("advance")',
    'advance?.addEventListener("click", () => {',
    '  if (detail) {',
    '    detail.textContent = "The runtime updated inside the bridge session without leaving the host shell."',
    '  }',
    '  if (advance) {',
    '    advance.textContent = "State advanced"',
    '  }',
    '})',
    '```',
  ].join('\n')

  return createTextMessage(id, 'assistant', htmlPreviewMarkdown, timestamp)
}

export function buildAppAwareSessionFixture(): {
  sessionInput: Omit<Session, 'id'>
  historyThread: SessionThread
  currentMessageIds: string[]
  historyMessageIds: string[]
} {
  const systemMessage = createTextMessage(
    'msg-system',
    'system',
    'Keep host-owned app lifecycle state explicit and recoverable.',
    1
  )

  const currentUserMessage = createTextMessage(
    'msg-current-user',
    'user',
    'Resume my Story Builder draft and keep the draft summary attached.',
    2
  )

  const currentAssistantMessage = createAppLifecycleMessage(
    'msg-current-assistant',
    'assistant',
    'Story Builder resumed with the latest draft checkpoint.',
    {
      toolCallId: 'tool-current-assistant',
      lifecycle: 'active',
      attachmentName: 'story-builder-state.json',
      summary: 'Restored the active story draft and preserved the exportable checkpoint.',
      timestamp: 3,
    }
  )

  const historyThread: SessionThread = {
    id: 'thread-story-builder-history',
    name: 'Story Builder Draft',
    createdAt: 1,
    messages: [
      createTextMessage(
        'msg-history-user',
        'user',
        'Open Story Builder and summarize the current scene.',
        1
      ),
      createAppLifecycleMessage(
        'msg-history-assistant',
        'assistant',
        'Story Builder completed the previous draft summary.',
        {
          toolCallId: 'tool-history-assistant',
          lifecycle: 'complete',
          summary: 'Saved the previous draft summary for later follow-up questions.',
          timestamp: 2,
        }
      ),
    ],
  }

  return {
    sessionInput: {
      name: 'ChatBridge Story Session',
      type: 'chat',
      threadName: 'Story Builder Active',
      messages: [systemMessage, currentUserMessage, currentAssistantMessage],
      threads: [historyThread],
    },
    historyThread,
    currentMessageIds: [systemMessage.id, currentUserMessage.id, currentAssistantMessage.id],
    historyMessageIds: historyThread.messages.map((message) => message.id),
  }
}

export function buildPartialLifecycleSessionFixture(): Omit<Session, 'id'> {
  return {
    name: 'ChatBridge Partial Lifecycle Session',
    type: 'chat',
    messages: [
      createTextMessage(
        'msg-partial-user',
        'user',
        'Try to resume the last Story Builder state even if the snapshot is stale.',
        1
      ),
      createAppLifecycleMessage(
        'msg-partial-assistant',
        'assistant',
        'Cached app state expired. Resume should stay explicit without inventing a recovered result.',
        {
          toolCallId: 'tool-partial-assistant',
          lifecycle: 'stale',
          state: 'call',
          partial: true,
          summary: 'Cached app state expired before a fresh checkpoint arrived.',
          timestamp: 2,
        }
      ),
    ],
  }
}

export function buildChatBridgeLifecycleTourSessionFixture(): Omit<Session, 'id'> {
  return {
    name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Lifecycle tour`,
    type: 'chat',
    threadName: 'Lifecycle Tour',
    messages: [
      createTextMessage(
        'msg-tour-system',
        'system',
        'Keep the host shell visible for every app lifecycle state, including stale and error recovery.',
        1
      ),
      createTextMessage(
        'msg-tour-user',
        'user',
        'Show me every host-owned ChatBridge lifecycle state in one place.',
        2
      ),
      createAppLifecycleMessage(
        'msg-tour-launching',
        'assistant',
        'Story Builder is still restoring the draft runtime.',
        {
          toolCallId: 'tool-tour-launching',
          lifecycle: 'launching',
          summary: 'Story Builder is booting the saved runtime.',
          timestamp: 3,
        }
      ),
      createAppLifecycleMessage(
        'msg-tour-ready',
        'assistant',
        'Story Builder is ready to reopen from the thread.',
        {
          toolCallId: 'tool-tour-ready',
          lifecycle: 'ready',
          summary: 'Story Builder is staged and waiting for the next action.',
          timestamp: 4,
        }
      ),
      createAppLifecycleMessage(
        'msg-tour-active',
        'assistant',
        'Story Builder is active and still owned by the host shell.',
        {
          toolCallId: 'tool-tour-active',
          lifecycle: 'active',
          summary: 'The runtime is live inside the conversation.',
          timestamp: 5,
        }
      ),
      createAppLifecycleMessage(
        'msg-tour-complete',
        'assistant',
        'Story Builder finished without leaving a separate summary receipt.',
        {
          toolCallId: 'tool-tour-complete',
          lifecycle: 'complete',
          summary: 'Completion stays inline in the same host shell.',
          timestamp: 6,
        }
      ),
      createAppLifecycleMessage(
        'msg-tour-stale',
        'assistant',
        'The cached checkpoint expired before the runtime could resume.',
        {
          toolCallId: 'tool-tour-stale',
          lifecycle: 'stale',
          state: 'call',
          partial: true,
          summary: 'The host kept the stale state explicit instead of inventing a successful resume.',
          fallbackText: 'The runtime could not resume from the cached checkpoint, so the host is keeping recovery inline.',
          timestamp: 7,
        }
      ),
      createAppLifecycleMessage(
        'msg-tour-error',
        'assistant',
        'The bridge handshake failed after the shell requested a resume.',
        {
          toolCallId: 'tool-tour-error',
          lifecycle: 'error',
          state: 'error',
          summary: 'Bridge session expired before resume completed.',
          error: 'Bridge session expired before resume completed.',
          fallbackText: 'The host keeps the failure and recovery path in the same thread instead of dropping context.',
          timestamp: 8,
        }
      ),
    ],
  }
}

export function buildChatBridgeHistoryAndPreviewSessionFixture(): {
  sessionInput: Omit<Session, 'id'>
  blobEntries: Array<{
    key: string
    value: string
  }>
} {
  const appAware = buildAppAwareSessionFixture()
  const htmlPreviewUserMessage = createTextMessage(
    'msg-preview-user',
    'user',
    'Render a previewable review app inside the thread and keep it host-owned.',
    4
  )
  const htmlPreviewAssistantMessage = createHtmlPreviewMessage('msg-preview-assistant', 5)

  return {
    sessionInput: {
      ...appAware.sessionInput,
      name: `${CHATBRIDGE_LIVE_SEED_PREFIX} History + preview`,
      threadName: 'Story Builder Review',
      messages: [...appAware.sessionInput.messages, htmlPreviewUserMessage, htmlPreviewAssistantMessage],
    },
    blobEntries: [
      {
        key: buildAttachmentStorageKey('msg-current-assistant'),
        value: JSON.stringify(
          {
            draftId: 'seeded-story-draft-001',
            checkpoint: 'active-shell',
            summary: 'Restored the active story draft and preserved the exportable checkpoint.',
          },
          null,
          2
        ),
      },
    ],
  }
}

export function buildChatBridgeChessMidGameSessionFixture(): Omit<Session, 'id'> {
  return {
    name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Chess mid-game board context`,
    type: 'chat',
    threadName: 'Chess Mid-game',
    messages: [
      createTextMessage(
        'msg-chess-system',
        'system',
        'Keep Chess reasoning grounded in the host-owned board summary rather than partner-authored prose.',
        1
      ),
      createTextMessage(
        'msg-chess-user-open',
        'user',
        'Open Chess and keep the board visible in the thread while I think.',
        2
      ),
      createAppLifecycleMessage(
        'msg-chess-assistant-board',
        'assistant',
        'Chess is open in the thread with the current mid-game position restored.',
        {
          appId: 'chess',
          appName: 'Chess',
          toolCallId: 'tool-chess-mid-game',
          lifecycle: 'active',
          summary: 'White to move in an Italian Game structure after ...e5.',
          snapshot: {
            route: '/apps/chess',
            status: 'active',
            boardContext: {
              schemaVersion: 1,
              fen: 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
              sideToMove: 'white',
              fullmoveNumber: 6,
              legalMovesCount: 33,
              positionStatus: 'in_progress',
              lastMove: {
                san: '...e5',
                uci: 'e7e5',
              },
              summary: 'White to move in an Italian Game structure after ...e5.',
            },
          },
          timestamp: 3,
        }
      ),
      createTextMessage(
        'msg-chess-user-follow-up',
        'user',
        'What should White focus on here?',
        4
      ),
    ],
  }
}

export function getChatBridgeLiveSeedFixtures(): ChatBridgeLiveSeedFixture[] {
  const historyAndPreview = buildChatBridgeHistoryAndPreviewSessionFixture()

  return [
    {
      id: 'lifecycle-tour',
      name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Lifecycle tour`,
      description:
        'Seeds every host-owned lifecycle shell state so you can inspect loading, ready, active, complete, stale, and error handling in the real message timeline.',
      coverage: ['Host shell states', 'Inline completion', 'Stale + error recovery'],
      auditSteps: [
        {
          action: 'Open the seeded session and scroll through the assistant messages.',
          expected: 'Each lifecycle state renders through the host shell, not a raw status card or detached receipt.',
        },
        {
          action: 'Inspect the `Complete`, `Stale`, and `Error` states.',
          expected: 'Completion stays inline, and stale/error states keep fallback text visible in the thread.',
        },
      ],
      sessionInput: buildChatBridgeLifecycleTourSessionFixture(),
    },
    {
      id: 'chess-mid-game-board-context',
      name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Chess mid-game board context`,
      description:
        'Seeds a live Chess session with a validated host-owned board summary so you can ask a follow-up and confirm the assistant sees bounded mid-game context instead of raw app prose.',
      coverage: ['Chess board context', 'Mid-game follow-up reasoning', 'Host-owned normalized summary'],
      auditSteps: [
        {
          action: 'Open the seeded Chess session and inspect the active app message.',
          expected: 'The message stays inside the host shell and exposes a live Chess runtime instead of a detached completion receipt.',
        },
        {
          action: 'Ask a follow-up such as `What should White focus on here?` from the seeded thread.',
          expected: 'The reply stays grounded in the current host-owned board summary and does not invent board details outside the validated snapshot.',
        },
      ],
      sessionInput: buildChatBridgeChessMidGameSessionFixture(),
    },
    {
      id: 'history-and-preview',
      name: `${CHATBRIDGE_LIVE_SEED_PREFIX} History + preview`,
      description:
        'Seeds a real Story Builder session with thread history, a persisted attachment checkpoint, and a renderable HTML artifact preview you can open and refresh live.',
      coverage: ['Thread history', 'Attachment presence', 'HTML preview runtime'],
      auditSteps: [
        {
          action: 'Open the seeded session and use the normal thread-history control in the chat UI.',
          expected: 'The older complete Story Builder thread is still present and explicit.',
        },
        {
          action: 'In the current thread, find the HTML preview message and click `Preview`, then `Refresh`.',
          expected: 'The runtime opens inside the host shell, and refresh keeps it in the same inline surface.',
        },
      ],
      sessionInput: historyAndPreview.sessionInput,
      blobEntries: historyAndPreview.blobEntries,
    },
  ]
}
