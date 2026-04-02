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
import {
  createChatBridgeBridgeRejectionRecoveryContract,
  createChatBridgeMalformedBridgeRecoveryContract,
  createChatBridgeRuntimeCrashRecoveryContract,
  createChatBridgeTimeoutRecoveryContract,
  writeChatBridgeRecoveryContractValues,
} from './recovery-contract'
import {
  ChatBridgeStoryBuilderStateSchema,
  type ChatBridgeStoryBuilderMode,
} from './story-builder'
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

function createStoryBuilderState(options: {
  mode: ChatBridgeStoryBuilderMode
  driveStatus: 'needs-auth' | 'connecting' | 'connected' | 'expired'
  driveStatusLabel: string
  driveDetail: string
  chapterLabel: string
  title: string
  summary: string
  excerpt: string
  wordCount: number
  saveState: 'saved' | 'saving' | 'attention'
  saveLabel: string
  connectedAs?: string
  folderLabel?: string
  lastSyncedLabel?: string
  calloutTitle?: string
  calloutDescription?: string
  checkpoints?: Array<{
    checkpointId: string
    label: string
    description: string
    savedAtLabel: string
    status: 'latest' | 'saved' | 'attention'
    locationLabel?: string
  }>
  completion?: {
    title: string
    description: string
    handoffLabel?: string
    nextStepLabel?: string
  }
  userGoal?: string
}) {
  return ChatBridgeStoryBuilderStateSchema.parse({
    schemaVersion: 1,
    mode: options.mode,
    drive: {
      provider: 'google-drive',
      status: options.driveStatus,
      statusLabel: options.driveStatusLabel,
      detail: options.driveDetail,
      connectedAs: options.connectedAs,
      folderLabel: options.folderLabel,
      lastSyncedLabel: options.lastSyncedLabel,
    },
    draft: {
      title: options.title,
      chapterLabel: options.chapterLabel,
      summary: options.summary,
      excerpt: options.excerpt,
      wordCount: options.wordCount,
      saveState: options.saveState,
      saveLabel: options.saveLabel,
      userGoal: options.userGoal,
    },
    checkpoints: options.checkpoints ?? [],
    callout:
      options.calloutTitle && options.calloutDescription
        ? {
            eyebrow: 'Host guidance',
            title: options.calloutTitle,
            description: options.calloutDescription,
          }
        : undefined,
    completion: options.completion,
  })
}

function createStoryBuilderActiveState() {
  return createStoryBuilderState({
    mode: 'active',
    driveStatus: 'connected',
    driveStatusLabel: 'Drive connected',
    driveDetail: 'Host-issued Drive access is active for the classroom writing folder.',
    connectedAs: 'student.writer@example.edu',
    folderLabel: 'Creative Writing / Chapter 4',
    lastSyncedLabel: '2 minutes ago',
    chapterLabel: 'Chapter 4',
    title: 'Storm Lantern',
    summary: 'Mara hides the storm lantern before the flood siren starts and the library doors lock.',
    excerpt:
      'Mara tucked the lantern beneath the library desk and counted the sirens again before she dared to breathe.',
    wordCount: 812,
    saveState: 'saved',
    saveLabel: 'Saved to Drive 2 minutes ago',
    userGoal: 'Finish chapter four and keep the latest checkpoint in Drive.',
    calloutTitle: 'Resume stays explicit',
    calloutDescription: 'The host can reopen this checkpoint without exposing a raw Drive token to the app runtime.',
    checkpoints: [
      {
        checkpointId: 'draft-42',
        label: 'Checkpoint 42',
        description: 'Latest draft with the lantern reveal and flood siren beat.',
        savedAtLabel: '2 minutes ago',
        status: 'latest',
        locationLabel: 'Creative Writing / Chapter 4',
      },
      {
        checkpointId: 'draft-41',
        label: 'Checkpoint 41',
        description: 'Previous chapter pass before the flood siren escalation.',
        savedAtLabel: 'Yesterday',
        status: 'saved',
        locationLabel: 'Creative Writing / Archive',
      },
    ],
  })
}

function createStoryBuilderResumeReadyState() {
  return createStoryBuilderState({
    mode: 'resume-ready',
    driveStatus: 'connected',
    driveStatusLabel: 'Checkpoint ready',
    driveDetail: 'The host already has permission to reopen the latest Drive-backed draft.',
    connectedAs: 'student.writer@example.edu',
    folderLabel: 'Creative Writing / Chapter 4',
    lastSyncedLabel: '12 minutes ago',
    chapterLabel: 'Chapter 4',
    title: 'Storm Lantern',
    summary: 'The latest checkpoint is ready to reopen without leaving the thread.',
    excerpt:
      'Mara stopped at the stairwell and read the warning light again before deciding whether to go back for the lantern.',
    wordCount: 788,
    saveState: 'saved',
    saveLabel: 'Checkpoint ready to resume',
    calloutTitle: 'Resume from the latest safe save',
    calloutDescription: 'Story Builder can reopen the latest checkpoint immediately from the host shell.',
    checkpoints: [
      {
        checkpointId: 'draft-42',
        label: 'Checkpoint 42',
        description: 'Latest Drive-backed draft ready to resume.',
        savedAtLabel: '12 minutes ago',
        status: 'latest',
        locationLabel: 'Creative Writing / Chapter 4',
      },
    ],
  })
}

function createStoryBuilderCompletionState() {
  return createStoryBuilderState({
    mode: 'complete',
    driveStatus: 'connected',
    driveStatusLabel: 'Drive synced',
    driveDetail: 'The finished draft and checkpoint trail are saved in the host-approved Drive folder.',
    connectedAs: 'student.writer@example.edu',
    folderLabel: 'Creative Writing / Chapter 4',
    lastSyncedLabel: 'Just now',
    chapterLabel: 'Chapter 4',
    title: 'Storm Lantern',
    summary: 'The completed chapter draft is back in chat with the latest checkpoint and next revision cue.',
    excerpt:
      'When the lights returned, Mara lifted the lantern from beneath the desk and saw her own reflection in the wet brass.',
    wordCount: 1048,
    saveState: 'saved',
    saveLabel: 'Final draft saved to Drive',
    calloutTitle: 'Completion stays in-thread',
    calloutDescription: 'The draft handoff, checkpoint trail, and next step remain visible in the host shell.',
    checkpoints: [
      {
        checkpointId: 'draft-43',
        label: 'Final checkpoint',
        description: 'Completed chapter pass with resolved lantern reveal.',
        savedAtLabel: 'Just now',
        status: 'latest',
        locationLabel: 'Creative Writing / Chapter 4',
      },
      {
        checkpointId: 'draft-42',
        label: 'Checkpoint 42',
        description: 'Latest resumable draft before the final pass.',
        savedAtLabel: '18 minutes ago',
        status: 'saved',
        locationLabel: 'Creative Writing / Chapter 4',
      },
    ],
    completion: {
      title: 'Draft returned to chat',
      description: 'The host preserved the completed chapter, Drive save, and revision cue for the next conversation turn.',
      handoffLabel: 'Ask for revision notes or continue with chapter five.',
      nextStepLabel: 'Continue the writing session from the final checkpoint if you want another pass.',
    },
  })
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

function createRecoveryContractValues(
  contract: Parameters<typeof writeChatBridgeRecoveryContractValues>[1]
) {
  return writeChatBridgeRecoveryContractValues(undefined, contract)
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

export function buildChatBridgePlatformRecoverySessionFixture(): Omit<Session, 'id'> {
  return {
    name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Platform recovery`,
    type: 'chat',
    threadName: 'Platform Recovery',
    messages: [
      createTextMessage(
        'msg-platform-recovery-system',
        'system',
        'Keep platform failures explicit, host-owned, and recoverable from the thread instead of hiding them inside generic runtime errors.',
        1
      ),
      createTextMessage(
        'msg-platform-recovery-user',
        'user',
        'Show me how the host handles timeouts, crashes, invalid tool calls, and malformed bridge events.',
        2
      ),
      createAppLifecycleMessage(
        'msg-platform-timeout',
        'assistant',
        'Story Builder did not respond before the host timeout, so the host preserved only the last safe checkpoint and kept recovery inline.',
        {
          toolCallId: 'tool-platform-timeout',
          lifecycle: 'stale',
          summary: 'Story Builder timed out before resume could be trusted.',
          title: 'Story Builder recovery',
          description: 'The host kept the timeout explicit instead of inventing a resumed runtime state.',
          statusText: 'Timed out',
          fallbackTitle: 'Timed out',
          fallbackText: 'Continue in chat from the last validated checkpoint or ask for a bounded explanation before retrying.',
          values: createRecoveryContractValues(
            createChatBridgeTimeoutRecoveryContract({
              appId: 'story-builder',
              appName: 'Story Builder',
              appInstanceId: 'story-builder-timeout',
              bridgeSessionId: 'bridge-story-builder-timeout',
              waitedMs: 10_000,
            })
          ),
          timestamp: 3,
        }
      ),
      createAppLifecycleMessage(
        'msg-platform-crash',
        'assistant',
        'Debate Arena crashed mid-round, so the host kept only validated round state and a bounded recovery path inside the thread.',
        {
          appId: 'debate-arena',
          appName: 'Debate Arena',
          toolCallId: 'tool-platform-crash',
          lifecycle: 'error',
          summary: 'Debate Arena crashed before the final rebuttal could be trusted.',
          title: 'Debate Arena recovery',
          description: 'The host caught the crash and kept the thread usable from preserved host-owned state.',
          statusText: 'Runtime crash',
          fallbackTitle: 'Recovery available',
          fallbackText: 'Continue safely from preserved state or dismiss the failed runtime.',
          error: 'Worker process exited during round three rebuttal.',
          values: createRecoveryContractValues(
            createChatBridgeRuntimeCrashRecoveryContract({
              appId: 'debate-arena',
              appName: 'Debate Arena',
              appInstanceId: 'debate-arena-crash',
              bridgeSessionId: 'bridge-debate-arena-crash',
              error: 'Worker process exited during round three rebuttal.',
              code: 'worker_exit',
            })
          ),
          timestamp: 4,
        }
      ),
      createAppLifecycleMessage(
        'msg-platform-tool',
        'assistant',
        'Story Builder asked the host to save a draft without the required idempotency key, so the host blocked the tool call and kept the validation gap bounded.',
        {
          toolCallId: 'tool-platform-tool',
          lifecycle: 'error',
          summary: 'The host rejected the invalid save request before it could mutate Drive state.',
          title: 'Story Builder recovery',
          description: 'The invalid tool call stayed bounded to host validation output instead of becoming a side effect.',
          statusText: 'Invalid tool call',
          fallbackTitle: 'Tool blocked',
          fallbackText: 'Continue in chat or inspect the bounded validation diagnostics before retrying the save action.',
          values: createRecoveryContractValues({
            schemaVersion: 1,
            failureClass: 'invalid-tool-call',
            source: 'tool',
            severity: 'recoverable',
            title: 'save_story did not pass host validation',
            description: 'The host refused the tool call, kept the failure bounded, and preserved conversation continuity without executing an unsafe save.',
            statusLabel: 'Invalid tool call',
            summary: 'save_story failed host validation, so the request stayed explicit instead of becoming an unsafe side effect.',
            fallbackTitle: 'Tool blocked',
            fallbackText: 'Continue in chat or inspect the bounded validation diagnostics before retrying the tool call.',
            supportPanel: {
              eyebrow: 'Trust rail',
              title: 'What still holds',
              description: 'The host blocked the invalid save request before it could change Drive state.',
              items: [
                {
                  label: 'No side effect was executed',
                  description: 'Host validation stopped the invalid save before it could mutate external state.',
                  tone: 'safe',
                },
                {
                  label: 'Rejected inputs remain bounded',
                  description: 'Only safe validation diagnostics remain visible to the user and operator.',
                  tone: 'blocked',
                },
              ],
            },
            actions: [
              { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
              { id: 'inspect-invalid-fields', label: 'Inspect invalid fields', variant: 'secondary' },
            ],
            observability: {
              traceCode: 'recovery.invalid-tool-call',
              auditCategory: 'lifecycle.recovery',
              outcome: 'missing_idempotency_key',
              details: ['toolName: save_story', 'outcome: rejected', 'errorCode: missing_idempotency_key'],
            },
            correlation: {
              appId: 'story-builder',
              toolName: 'save_story',
            },
          }),
          timestamp: 5,
        }
      ),
      createAppLifecycleMessage(
        'msg-platform-bridge',
        'assistant',
        'Chess sent malformed bridge state, so the host rejected the runtime update and kept recovery bounded to trusted context.',
        {
          appId: 'chess',
          appName: 'Chess',
          toolCallId: 'tool-platform-bridge',
          lifecycle: 'error',
          summary: 'Malformed bridge traffic stayed blocked from host-owned state.',
          title: 'Chess recovery',
          description: 'The host failed closed on malformed bridge data and kept the thread usable from validated state.',
          statusText: 'Malformed event',
          fallbackTitle: 'Runtime blocked',
          fallbackText: 'Dismiss the runtime or ask for a bounded explanation while the host keeps invalid bridge data quarantined.',
          values: createRecoveryContractValues(
            createChatBridgeMalformedBridgeRecoveryContract({
              appId: 'chess',
              appName: 'Chess',
              appInstanceId: 'chess-bridge-invalid',
              bridgeSessionId: 'bridge-chess-invalid',
              rawKind: 'app.state',
              issues: ['snapshot.boardContext: Required', 'idempotencyKey: Required'],
            })
          ),
          timestamp: 6,
        }
      ),
      createAppLifecycleMessage(
        'msg-platform-reject',
        'assistant',
        'A replayed Debate Arena bridge event was rejected, so the host kept the runtime quarantined and preserved safe continuity from the last trusted state.',
        {
          appId: 'debate-arena',
          appName: 'Debate Arena',
          toolCallId: 'tool-platform-reject',
          lifecycle: 'error',
          summary: 'The host rejected a replayed bridge event instead of applying duplicate state.',
          title: 'Debate Arena recovery',
          description: 'Bridge-session validation stayed host-owned and fail-closed after the replay attempt.',
          statusText: 'Bridge rejected',
          fallbackTitle: 'Runtime rejected',
          fallbackText: 'Dismiss the runtime or ask for a bounded explanation while the host keeps replayed bridge events out of state.',
          values: createRecoveryContractValues(
            createChatBridgeBridgeRejectionRecoveryContract({
              appId: 'debate-arena',
              appName: 'Debate Arena',
              reason: 'replayed-sequence',
              event: {
                kind: 'app.state',
                appInstanceId: 'debate-replayed-state',
                bridgeSessionId: 'bridge-debate-replayed',
              },
            })
          ),
          timestamp: 7,
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
      values: {
        chatbridgeStoryBuilder: createStoryBuilderActiveState(),
      },
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
          values: {
            chatbridgeStoryBuilder: createStoryBuilderCompletionState(),
          },
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
        values: {
          chatbridgeStoryBuilder: createStoryBuilderResumeReadyState(),
        },
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
          values: {
            chatbridgeStoryBuilder: createStoryBuilderActiveState(),
          },
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
          values: {
            chatbridgeStoryBuilder: createStoryBuilderCompletionState(),
          },
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
      id: 'platform-recovery',
      name: `${CHATBRIDGE_LIVE_SEED_PREFIX} Platform recovery`,
      description:
        'Seeds timeout, crash, invalid tool call, malformed bridge event, and bridge rejection recoveries so you can inspect the unified host-owned failure model in the live thread.',
      coverage: ['Timeout recovery', 'Crash recovery', 'Invalid tool handling', 'Bridge failure recovery'],
      auditSteps: [
        {
          action: 'Open the seeded Platform recovery session and inspect the five assistant recovery messages.',
          expected:
            'Each failure class stays inside the host shell with a bounded recovery banner and trust rail instead of collapsing into a generic error card.',
        },
        {
          action: 'Compare the `Timed out`, `Runtime crash`, `Invalid tool call`, and `Malformed event` badges.',
          expected:
            'Each message explains a distinct host-owned failure class with a matching safe next action rather than reusing one generic fallback string.',
        },
        {
          action: 'Open the `save_story did not pass host validation` message and verify the trust rail.',
          expected:
            'The trust rail makes it explicit that no side effect executed and that the rejected inputs remain bounded to safe diagnostics.',
        },
      ],
      sessionInput: buildChatBridgePlatformRecoverySessionFixture(),
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
