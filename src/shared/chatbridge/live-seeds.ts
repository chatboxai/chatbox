import { normalizeChatBridgeChessRuntimeSnapshot } from './chess'
import {
  CHESS_APP_ID,
  CHESS_APP_NAME,
  createInitialChessAppSnapshot,
  getChessDescription,
  getChessFallbackText,
  getChessStatusLabel,
  getChessSummary,
} from './apps/chess'
import {
  CHATBRIDGE_DEGRADED_COMPLETION_SCHEMA_VERSION,
  writeChatBridgeDegradedCompletionValues,
} from './degraded-completion'
import { createChatBridgeAppEvent, applyChatBridgeAppEvent } from './events'
import { createChatBridgeAppInstance } from './instance'
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
  values?: Record<string, unknown>
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
const CHESS_MID_GAME_FEN = 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6'

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
        values: options.values,
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

function createDegradedCompletionValues(options: {
  kind: 'partial-completion' | 'missing-completion' | 'invalid-completion'
  statusLabel: string
  title: string
  description: string
  supportTitle: string
  supportDescription: string
  supportItems: Array<{
    label: string
    description: string
    tone: 'safe' | 'blocked' | 'warning'
  }>
  actions: Array<{
    id:
      | 'retry-completion'
      | 'continue-in-chat'
      | 'dismiss-runtime'
      | 'inspect-invalid-fields'
    label: string
    variant: 'primary' | 'secondary'
  }>
}) {
  return writeChatBridgeDegradedCompletionValues(undefined, {
    schemaVersion: CHATBRIDGE_DEGRADED_COMPLETION_SCHEMA_VERSION,
    kind: options.kind,
    statusLabel: options.statusLabel,
    title: options.title,
    description: options.description,
    supportPanel: {
      eyebrow: 'Trust rail',
      title: options.supportTitle,
      description: options.supportDescription,
      items: options.supportItems,
    },
    actions: options.actions,
  })
}

export function buildChatBridgeDegradedCompletionRecoverySessionFixture(): Omit<Session, 'id'> {
  return {
    name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Degraded completion recovery`,
    type: 'chat',
    threadName: 'Degraded Recovery',
    messages: [
      createTextMessage(
        'msg-degraded-system',
        'system',
        'Keep degraded completion endings explicit, recoverable, and bounded to validated host-owned state.',
        1
      ),
      createTextMessage(
        'msg-degraded-user',
        'user',
        'Show me the degraded completion states and the safe recovery actions the host keeps inline.',
        2
      ),
      createAppLifecycleMessage(
        'msg-degraded-partial',
        'assistant',
        'Story Builder streamed part of the completion, but the host refused to treat the incomplete ending as final output.',
        {
          toolCallId: 'tool-degraded-partial',
          lifecycle: 'error',
          summary: 'Partial completion stayed bounded inside the host shell.',
          title: 'Story Builder recovery',
          description: 'Partial completion stayed inline so the thread can recover without inventing a final result.',
          statusText: 'Partial completion',
          fallbackTitle: 'Partial completion fallback',
          fallbackText: 'Only the validated draft fragment remains available until a safe retry or chat continuation happens.',
          values: createDegradedCompletionValues({
            kind: 'partial-completion',
            statusLabel: 'Partial completion',
            title: 'Completion stopped after a partial draft',
            description:
              'The host captured the validated fragment, blocked the missing tail from model memory, and kept recovery in the same message.',
            supportTitle: 'What still holds',
            supportDescription: 'Only the validated fragment and host diagnostics remain trusted.',
            supportItems: [
              {
                label: 'Validated fragment is still visible',
                description: 'The host can continue from the confirmed partial draft.',
                tone: 'safe',
              },
              {
                label: 'Missing completion tail stays blocked',
                description: 'No synthetic ending is promoted as if the app actually finished.',
                tone: 'blocked',
              },
            ],
            actions: [
              { id: 'retry-completion', label: 'Retry completion', variant: 'primary' },
              { id: 'continue-in-chat', label: 'Continue safely', variant: 'secondary' },
            ],
          }),
          timestamp: 3,
        }
      ),
      createAppLifecycleMessage(
        'msg-degraded-missing',
        'assistant',
        'Form Runner finished its runtime step without producing a completion payload, so the host fell back to an explicit recovery state.',
        {
          appId: 'form-runner',
          appName: 'Form Runner',
          toolCallId: 'tool-degraded-missing',
          lifecycle: 'error',
          summary: 'Missing completion payload stayed explicit in the thread.',
          title: 'Form Runner recovery',
          description: 'The host kept the missing completion visible instead of pretending the runtime returned a final answer.',
          statusText: 'Missing completion',
          fallbackTitle: 'Missing completion fallback',
          fallbackText: 'The runtime returned no completion payload, so the host kept the next safe action inline.',
          values: createDegradedCompletionValues({
            kind: 'missing-completion',
            statusLabel: 'Missing completion',
            title: 'Completion payload never arrived',
            description:
              'The runtime ended without a valid completion payload. The host preserved the verified state and exposed a bounded next step.',
            supportTitle: 'Trust rail',
            supportDescription: 'The conversation can continue safely from the last validated host-owned state.',
            supportItems: [
              {
                label: 'Latest validated state is preserved',
                description: 'The host retained the last safe checkpoint for follow-up work.',
                tone: 'safe',
              },
              {
                label: 'Missing payload remains unavailable',
                description: 'Nothing is inferred or reconstructed from absent runtime output.',
                tone: 'warning',
              },
            ],
            actions: [
              { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
              { id: 'dismiss-runtime', label: 'Dismiss runtime', variant: 'secondary' },
            ],
          }),
          error: 'Completion payload missing from runtime response.',
          timestamp: 4,
        }
      ),
      createAppLifecycleMessage(
        'msg-degraded-invalid',
        'assistant',
        'Insight Board returned malformed completion fields, so the host quarantined them and kept a bounded inspection path in the thread.',
        {
          appId: 'insight-board',
          appName: 'Insight Board',
          toolCallId: 'tool-degraded-invalid',
          lifecycle: 'error',
          summary: 'Invalid completion fields remained quarantined.',
          title: 'Insight Board recovery',
          description: 'Malformed completion fields are blocked from model memory until the host or user chooses a safe follow-up.',
          statusText: 'Invalid completion',
          fallbackTitle: 'Invalid completion fallback',
          fallbackText: 'The runtime responded with malformed completion fields, so the host kept diagnostics inline instead of trusting them.',
          values: createDegradedCompletionValues({
            kind: 'invalid-completion',
            statusLabel: 'Invalid completion',
            title: 'Completion fields failed validation',
            description:
              'The host kept only validated state, quarantined malformed fields, and exposed a safe explanation path instead of leaking broken output.',
            supportTitle: 'Trust rail',
            supportDescription: 'Only validated fields remain available to the conversation.',
            supportItems: [
              {
                label: 'Validated state remains available',
                description: 'The thread can continue from safe host-owned fields.',
                tone: 'safe',
              },
              {
                label: 'Malformed fields stay quarantined',
                description: 'Invalid data is blocked from model memory and user-visible summaries.',
                tone: 'blocked',
              },
            ],
            actions: [
              { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
              { id: 'inspect-invalid-fields', label: 'Inspect invalid fields', variant: 'secondary' },
            ],
          }),
          error: 'Completion fields failed schema validation.',
          timestamp: 5,
        }
      ),
    ],
  }
}

function createChessRuntimeMessage(id: string, timestamp: number): Message {
  const snapshot = createInitialChessAppSnapshot(timestamp)
  const appInstanceId = 'chess-instance-seeded-runtime'
  const bridgeSessionId = 'bridge-chess-seeded-runtime'

  return {
    id,
    role: 'assistant',
    timestamp,
    contentParts: [
      {
        type: 'text',
        text: 'The chess runtime is live in-thread. Try an illegal move first, then a legal opening move, and confirm the host keeps the latest position on reload.',
      },
      {
        type: 'app',
        appId: CHESS_APP_ID,
        appName: CHESS_APP_NAME,
        appInstanceId,
        lifecycle: 'active',
        summary: getChessSummary(snapshot),
        toolCallId: 'tool-chess-runtime-seeded',
        bridgeSessionId,
        title: 'Chess board',
        description: getChessDescription(snapshot),
        statusText: getChessStatusLabel(snapshot),
        fallbackTitle: 'Chess fallback',
        fallbackText: getChessFallbackText(snapshot),
        snapshot,
      },
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'tool-chess-runtime-seeded',
        toolName: 'chatbridge_app_state',
        args: {
          appId: CHESS_APP_ID,
          lifecycle: 'active',
          bridgeSessionId,
        },
        result: {
          appId: CHESS_APP_ID,
          appName: CHESS_APP_NAME,
          appInstanceId,
          lifecycle: 'active',
          summary: getChessSummary(snapshot),
          snapshot,
        },
      },
    ],
  }
}

function createSeededChessAppRecords() {
  const snapshot = createInitialChessAppSnapshot(3)
  const baseInstance = createChatBridgeAppInstance({
    id: 'chess-instance-seeded-runtime',
    appId: CHESS_APP_ID,
    appVersion: '1.0.0',
    bridgeSessionId: 'bridge-chess-seeded-runtime',
    owner: {
      authority: 'host',
      conversationSessionId: 'seeded-chess-runtime-session',
      initiatedBy: 'assistant',
    },
    resumability: {
      mode: 'resumable',
      resumeKey: 'chess-instance-seeded-runtime',
    },
    createdAt: 3,
  })

  const createdEvent = createChatBridgeAppEvent({
    id: 'event-chess-created',
    appInstanceId: baseInstance.id,
    kind: 'instance.created',
    actor: 'host',
    sequence: 1,
    createdAt: 3,
    bridgeSessionId: 'bridge-chess-seeded-runtime',
    nextStatus: 'launching',
    payload: {
      initiatedBy: 'assistant',
    },
  })

  const createdTransition = applyChatBridgeAppEvent(baseInstance, createdEvent)
  if (!createdTransition.accepted) {
    throw new Error(`Unable to seed chess created event: ${createdTransition.reason}`)
  }

  const readyEvent = createChatBridgeAppEvent({
    id: 'event-chess-ready',
    appInstanceId: baseInstance.id,
    kind: 'bridge.ready',
    actor: 'host',
    sequence: 2,
    createdAt: 3,
    bridgeSessionId: 'bridge-chess-seeded-runtime',
    nextStatus: 'ready',
    snapshot,
    payload: {
      source: 'seeded-runtime',
    },
  })

  const readyTransition = applyChatBridgeAppEvent(createdTransition.instance, readyEvent)
  if (!readyTransition.accepted) {
    throw new Error(`Unable to seed chess ready event: ${readyTransition.reason}`)
  }

  const activeEvent = createChatBridgeAppEvent({
    id: 'event-chess-active',
    appInstanceId: baseInstance.id,
    kind: 'state.updated',
    actor: 'host',
    sequence: 3,
    createdAt: 3,
    bridgeSessionId: 'bridge-chess-seeded-runtime',
    nextStatus: 'active',
    snapshot,
    payload: {
      moveCount: 0,
      turn: snapshot.turn,
      phase: snapshot.status.phase,
      lastAction: snapshot.lastAction,
    },
    summaryForModel: getChessSummary(snapshot),
  })

  const activeTransition = applyChatBridgeAppEvent(readyTransition.instance, activeEvent)
  if (!activeTransition.accepted) {
    throw new Error(`Unable to seed chess active event: ${activeTransition.reason}`)
  }

  return {
    instances: [activeTransition.instance],
    events: [createdEvent, readyEvent, activeEvent],
  }
}

function createStoryBuilderAppRecords(options: {
  appInstanceId: string
  bridgeSessionId: string
  conversationSessionId: string
  status: 'active' | 'complete' | 'stale'
  summaryForModel?: string
  createdAt: number
  updatedAt: number
}) {
  const baseInstance = createChatBridgeAppInstance({
    id: options.appInstanceId,
    appId: APP_ID,
    appVersion: '1.0.0',
    bridgeSessionId: options.bridgeSessionId,
    owner: {
      authority: 'host',
      conversationSessionId: options.conversationSessionId,
      initiatedBy: 'assistant',
    },
    resumability: {
      mode: 'resumable',
      resumeKey: options.appInstanceId,
    },
    createdAt: options.createdAt,
  })

  const createdEvent = createChatBridgeAppEvent({
    id: `event-created-${options.appInstanceId}`,
    appInstanceId: baseInstance.id,
    kind: 'instance.created',
    actor: 'host',
    sequence: 1,
    createdAt: options.createdAt,
    bridgeSessionId: options.bridgeSessionId,
    nextStatus: 'launching',
    payload: {
      initiatedBy: 'assistant',
    },
  })

  const createdTransition = applyChatBridgeAppEvent(baseInstance, createdEvent)
  if (!createdTransition.accepted) {
    throw new Error(`Unable to seed Story Builder created event: ${createdTransition.reason}`)
  }

  if (options.status === 'stale') {
    const staleEvent = createChatBridgeAppEvent({
      id: `event-stale-${options.appInstanceId}`,
      appInstanceId: baseInstance.id,
      kind: 'instance.marked-stale',
      actor: 'host',
      sequence: 2,
      createdAt: options.updatedAt,
      bridgeSessionId: options.bridgeSessionId,
      nextStatus: 'stale',
    })

    const staleTransition = applyChatBridgeAppEvent(createdTransition.instance, staleEvent)
    if (!staleTransition.accepted) {
      throw new Error(`Unable to seed Story Builder stale event: ${staleTransition.reason}`)
    }

    return {
      instances: [staleTransition.instance],
      events: [createdEvent, staleEvent],
    }
  }

  const readyEvent = createChatBridgeAppEvent({
    id: `event-ready-${options.appInstanceId}`,
    appInstanceId: baseInstance.id,
    kind: 'bridge.ready',
    actor: 'host',
    sequence: 2,
    createdAt: options.createdAt + 1,
    bridgeSessionId: options.bridgeSessionId,
    nextStatus: 'ready',
    payload: {
      source: 'seeded-runtime',
    },
  })

  const readyTransition = applyChatBridgeAppEvent(createdTransition.instance, readyEvent)
  if (!readyTransition.accepted) {
    throw new Error(`Unable to seed Story Builder ready event: ${readyTransition.reason}`)
  }

  if (options.status === 'active') {
    const activeEvent = createChatBridgeAppEvent({
      id: `event-active-${options.appInstanceId}`,
      appInstanceId: baseInstance.id,
      kind: 'state.updated',
      actor: 'host',
      sequence: 3,
      createdAt: options.updatedAt,
      bridgeSessionId: options.bridgeSessionId,
      nextStatus: 'active',
      payload: {
        route: '/apps/story-builder',
      },
      summaryForModel: options.summaryForModel,
    })

    const activeTransition = applyChatBridgeAppEvent(readyTransition.instance, activeEvent)
    if (!activeTransition.accepted) {
      throw new Error(`Unable to seed Story Builder active event: ${activeTransition.reason}`)
    }

    return {
      instances: [activeTransition.instance],
      events: [createdEvent, readyEvent, activeEvent],
    }
  }

  const completionEvent = createChatBridgeAppEvent({
    id: `event-complete-${options.appInstanceId}`,
    appInstanceId: baseInstance.id,
    kind: 'completion.recorded',
    actor: 'host',
    sequence: 3,
    createdAt: options.updatedAt,
    bridgeSessionId: options.bridgeSessionId,
    nextStatus: 'complete',
    payload: {
      route: '/apps/story-builder',
    },
    summaryForModel: options.summaryForModel,
  })

  const completionTransition = applyChatBridgeAppEvent(readyTransition.instance, completionEvent)
  if (!completionTransition.accepted) {
    throw new Error(`Unable to seed Story Builder completion event: ${completionTransition.reason}`)
  }

  return {
    instances: [completionTransition.instance],
    events: [createdEvent, readyEvent, completionEvent],
  }
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
      createTextMessage('msg-history-user', 'user', 'Open Story Builder and summarize the current scene.', 1),
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
      chatBridgeAppRecords: createStoryBuilderAppRecords({
        appInstanceId: 'app-instance-tool-current-assistant',
        bridgeSessionId: 'bridge-tool-current-assistant',
        conversationSessionId: 'seeded-story-builder-session',
        status: 'active',
        summaryForModel: 'Restored the active story draft and preserved the exportable checkpoint.',
        createdAt: 3,
        updatedAt: 3,
      }),
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
    chatBridgeAppRecords: createStoryBuilderAppRecords({
      appInstanceId: 'app-instance-tool-partial-assistant',
      bridgeSessionId: 'bridge-tool-partial-assistant',
      conversationSessionId: 'seeded-partial-story-builder-session',
      status: 'stale',
      createdAt: 2,
      updatedAt: 2,
    }),
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
      createAppLifecycleMessage('msg-tour-ready', 'assistant', 'Story Builder is ready to reopen from the thread.', {
        toolCallId: 'tool-tour-ready',
        lifecycle: 'ready',
        summary: 'Story Builder is staged and waiting for the next action.',
        timestamp: 4,
      }),
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
          fallbackText:
            'The runtime could not resume from the cached checkpoint, so the host is keeping recovery inline.',
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
  const seededChessSnapshot = normalizeChatBridgeChessRuntimeSnapshot({
    route: '/apps/chess',
    status: 'active',
    startingFen: CHESS_MID_GAME_FEN,
    moveHistory: [],
    boardContext: {
      schemaVersion: 1,
      fen: CHESS_MID_GAME_FEN,
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
    feedback: {
      kind: 'info',
      title: 'Host snapshot',
      message: 'White to move in an Italian Game structure after ...e5.',
    },
  })

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
          snapshot: seededChessSnapshot,
          timestamp: 3,
        }
      ),
      createTextMessage('msg-chess-user-follow-up', 'user', 'What should White focus on here?', 4),
    ],
  }
}

export function buildChatBridgeChessRuntimeSessionFixture(): Omit<Session, 'id'> {
  return {
    name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Chess runtime`,
    type: 'chat',
    threadName: 'Chess Runtime',
    messages: [
      createTextMessage(
        'msg-chess-system',
        'system',
        'Keep the live chess runtime inside the host shell and persist the legal board state after every relevant move attempt.',
        1
      ),
      createTextMessage(
        'msg-chess-user',
        'user',
        'Open the chess board in the thread and let me test legal and illegal moves.',
        2
      ),
      createChessRuntimeMessage('msg-chess-assistant', 3),
    ],
    chatBridgeAppRecords: createSeededChessAppRecords(),
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
      id: 'degraded-completion-recovery',
      name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Degraded completion recovery`,
      description:
        'Seeds partial, missing, and invalid completion endings so you can verify the host-owned recovery UI, trust rail, and inline action acknowledgements in the live chat timeline.',
      coverage: ['Degraded completion states', 'Inline recovery actions', 'Trust rail'],
      auditSteps: [
        {
          action: 'Open the seeded degraded recovery session and inspect the three assistant recovery messages.',
          expected:
            'Each degraded ending stays inside the host shell with an explicit recovery banner and a separate trust rail instead of collapsing into a generic error card.',
        },
        {
          action: 'On the `Completion payload never arrived` message, click `Continue safely`.',
          expected:
            'The same message updates inline to an acknowledgement state, the status badge changes to the requested action, and the selected action becomes disabled.',
        },
        {
          action: 'On the `Completion fields failed validation` message, click `Inspect invalid fields`.',
          expected:
            'The message stays in place, the acknowledgement text explains that invalid fields remain quarantined, and no extra summary receipt appears below it.',
        },
      ],
      sessionInput: buildChatBridgeDegradedCompletionRecoverySessionFixture(),
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
          expected:
            'The message stays inside the host shell and exposes a live Chess runtime instead of a detached completion receipt.',
        },
        {
          action: 'Play a legal move such as `Bxf7+` directly on the seeded board.',
          expected: 'The move is accepted inline and the host-owned app snapshot updates without leaving the thread.',
        },
        {
          action: 'Ask a follow-up such as `What should White focus on here?` from the seeded thread.',
          expected:
            'The reply stays grounded in the current host-owned board summary and does not invent board details outside the validated snapshot.',
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
    {
      id: 'chess-runtime',
      name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Chess runtime`,
      description:
        'Seeds a playable chess board in the real host shell so you can verify legal move acceptance, illegal move rejection, and reload continuity against live session storage.',
      coverage: ['Chess runtime', 'Legal + illegal moves', 'Host state persistence'],
      auditSteps: [
        {
          action: 'Open the seeded chess session, click `E2`, then click `E5`.',
          expected: 'The board rejects the illegal move inline and keeps the legal opening position unchanged.',
        },
        {
          action: 'Click `E2`, then click `E4`.',
          expected:
            'The board updates to the legal move, the move ledger shows `1. e4`, and the host sync card reflects the new position key.',
        },
        {
          action: 'Reload the session route or switch away and back to the seeded session.',
          expected:
            'The pawn remains on `E4`; the board does not reset to the opening position because the host persisted the latest chess snapshot.',
        },
      ],
      sessionInput: buildChatBridgeChessRuntimeSessionFixture(),
    },
  ]
}
