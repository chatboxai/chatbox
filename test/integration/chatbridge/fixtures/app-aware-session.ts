import type { Message, Session, SessionThread } from '@shared/types'

type ToolCallState = 'call' | 'result' | 'error'
type AppLifecycle = 'ready' | 'active' | 'complete' | 'stale' | 'error'

type AppLifecycleMessageOptions = {
  appId?: string
  appName?: string
  toolCallId: string
  lifecycle: AppLifecycle
  state?: ToolCallState
  partial?: boolean
  attachmentName?: string
  summary?: string
  summaryForModel?: string
  values?: Record<string, unknown>
  error?: string
  title?: string
  description?: string
  statusText?: string
  fallbackTitle?: string
  fallbackText?: string
}

const APP_ID = 'story-builder'
const APP_NAME = 'Story Builder'

export function createAppLifecycleMessage(
  id: string,
  role: Message['role'],
  text: string,
  options: AppLifecycleMessageOptions
): Message {
  const appId = options.appId ?? APP_ID
  const appName = options.appName ?? APP_NAME
  const lifecycle = options.lifecycle
  const summary = options.summary ?? `${appName} lifecycle: ${lifecycle}`
  const appInstanceId = `app-instance-${options.toolCallId}`
  const bridgeSessionId = `bridge-${options.toolCallId}`
  const route = `/apps/${appId}`

  return {
    id,
    role,
    timestamp: 1,
    contentParts: [
      { type: 'text', text },
      {
        type: 'app',
        appId,
        appName,
        appInstanceId,
        lifecycle,
        summary,
        ...(options.summaryForModel ? { summaryForModel: options.summaryForModel } : {}),
        toolCallId: options.toolCallId,
        bridgeSessionId,
        ...(options.values ? { values: options.values } : {}),
        ...(options.error ? { error: options.error } : {}),
        ...(options.title ? { title: options.title } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(options.statusText ? { statusText: options.statusText } : {}),
        ...(options.fallbackTitle ? { fallbackTitle: options.fallbackTitle } : {}),
        ...(options.fallbackText ? { fallbackText: options.fallbackText } : {}),
        snapshot: {
          route,
          status: lifecycle,
        },
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
                snapshot: {
                  route,
                  status: lifecycle,
                },
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
            storageKey: `fixture:${id}:attachment`,
          },
        ]
      : undefined,
  }
}

export function buildAppAwareSessionFixture(): {
  sessionInput: Omit<Session, 'id'>
  historyThread: SessionThread
  currentMessageIds: string[]
  historyMessageIds: string[]
} {
  const systemMessage: Message = {
    id: 'msg-system',
    role: 'system',
    contentParts: [{ type: 'text', text: 'Keep host-owned app lifecycle state explicit and recoverable.' }],
    timestamp: 1,
  }

  const currentUserMessage: Message = {
    id: 'msg-current-user',
    role: 'user',
    contentParts: [{ type: 'text', text: 'Resume my Story Builder draft and keep the draft summary attached.' }],
    timestamp: 2,
  }

  const currentAssistantMessage = createAppLifecycleMessage(
    'msg-current-assistant',
    'assistant',
    'Story Builder resumed with the latest draft checkpoint.',
    {
      toolCallId: 'tool-current-assistant',
      lifecycle: 'active',
      attachmentName: 'story-builder-state.json',
      summary: 'Restored the active story draft and preserved the exportable checkpoint.',
    }
  )

  const historyThread: SessionThread = {
    id: 'thread-story-builder-history',
    name: 'Story Builder Draft',
    createdAt: 1,
    messages: [
      {
        id: 'msg-history-user',
        role: 'user',
        contentParts: [{ type: 'text', text: 'Open Story Builder and summarize the current scene.' }],
        timestamp: 1,
      },
      createAppLifecycleMessage(
        'msg-history-assistant',
        'assistant',
        'Story Builder completed the previous draft summary.',
        {
          toolCallId: 'tool-history-assistant',
          lifecycle: 'complete',
          summary: 'Saved the previous draft summary for later follow-up questions.',
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
      {
        id: 'msg-partial-user',
        role: 'user',
        contentParts: [{ type: 'text', text: 'Try to resume the last Story Builder state even if the snapshot is stale.' }],
        timestamp: 1,
      },
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
        }
      ),
    ],
  }
}

export function buildRecoveryCheckpointSessionFixture(): Omit<Session, 'id'> {
  return {
    name: 'ChatBridge Recovery Checkpoint Session',
    type: 'chat',
    messages: [
      {
        id: 'msg-recovery-user',
        role: 'user',
        contentParts: [
          {
            type: 'text',
            text: 'Keep writing chapter four, then save the draft back to Drive.',
          },
        ],
        timestamp: 1,
      },
      createAppLifecycleMessage(
        'msg-recovery-assistant',
        'assistant',
        'Story Builder paused before export finished, but the host preserved the last safe checkpoint.',
        {
          toolCallId: 'tool-recovery-assistant',
          lifecycle: 'error',
          state: 'result',
          summary: 'Saved the latest draft checkpoint even though the export did not finish cleanly.',
          title: 'Story Builder checkpoint',
          description: 'The host kept the last safe draft checkpoint in-thread.',
          statusText: 'Needs recovery',
          fallbackTitle: 'Recovery available',
          fallbackText: 'Resume the Story Builder session from the last safe checkpoint.',
          values: {
            chatbridgeUserGoal: 'Keep writing chapter four, then save the draft back to Drive.',
            chatbridgeCompletion: {
              schemaVersion: 1,
              status: 'interrupted',
              reason: 'Drive auth expired before export finished.',
              resumability: {
                resumable: true,
                checkpointId: 'draft-42',
                resumeHint: 'Reconnect Google Drive before resuming export.',
              },
            },
          },
          error: 'Drive auth expired before export finished.',
        }
      ),
    ],
  }
}

export function buildDebateArenaContextInjectionFixture(): Omit<Session, 'id'> {
  const completedDebate = createAppLifecycleMessage(
    'msg-debate-complete',
    'assistant',
    'Debate Arena completed the latest classroom round and kept the structured result in-thread.',
    {
      appId: 'debate-arena',
      appName: 'Debate Arena',
      toolCallId: 'tool-debate-complete',
      lifecycle: 'complete',
      summary: 'Debate Arena finished the rubric pass and preserved the classroom result.',
      values: {
        chatbridgeDebateArena: {
          schemaVersion: 1,
          phase: 'complete',
          motion: 'Uniforms improve classroom focus.',
          teams: [
            {
              id: 'team-affirmative',
              name: 'Team Cedar',
              stance: 'affirmative',
              score: 91,
            },
            {
              id: 'team-negative',
              name: 'Team River',
              stance: 'negative',
              score: 84,
            },
          ],
          rubricFocus: ['claim support', 'rebuttal discipline'],
          result: {
            winnerTeamId: 'team-affirmative',
            decision:
              'The affirmative team grounded each claim in classroom evidence and answered every rebuttal directly.',
            nextStep: 'Write a reflection comparing the strongest rebuttal from each side.',
          },
        },
        chatbridgeCompletion: {
          schemaVersion: 1,
          status: 'success',
          suggestedSummary: {
            text: 'Debate Arena completed the rubric pass and preserved the winning side for later follow-up.',
          },
          outcomeData: {
            winner: 'Team Cedar',
          },
        },
      },
    }
  )

  const summaryMessage: Message = {
    id: 'msg-debate-summary',
    role: 'assistant',
    isSummary: true,
    contentParts: [{ type: 'text', text: 'Conversation summary before the next classroom follow-up.' }],
    timestamp: 3,
  }

  return {
    name: 'ChatBridge Debate Arena Session',
    type: 'chat',
    messages: [
      {
        id: 'msg-debate-system',
        role: 'system',
        contentParts: [{ type: 'text', text: 'Keep debate-state continuity host-owned and explicit.' }],
        timestamp: 1,
      },
      completedDebate,
      {
        id: 'msg-debate-boundary',
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'Boundary after the completed debate round.' }],
        timestamp: 2,
      },
      {
        id: 'msg-debate-follow-up',
        role: 'user',
        contentParts: [{ type: 'text', text: 'What was the strongest rebuttal from the winning side?' }],
        timestamp: 4,
      },
      summaryMessage,
    ],
    compactionPoints: [
      {
        summaryMessageId: summaryMessage.id,
        boundaryMessageId: 'msg-debate-boundary',
        createdAt: 5,
      },
    ],
  }
}

export function buildMultiAppContinuitySessionFixture(): Omit<Session, 'id'> {
  const summaryMessage: Message = {
    id: 'msg-multi-app-summary',
    role: 'assistant',
    isSummary: true,
    contentParts: [{ type: 'text', text: 'Summary before the mixed-app follow-up.' }],
    timestamp: 5,
  }

  return {
    name: 'ChatBridge Multi App Continuity Session',
    type: 'chat',
    messages: [
      {
        id: 'msg-multi-app-system',
        role: 'system',
        contentParts: [{ type: 'text', text: 'Keep active and recent app continuity attributable.' }],
        timestamp: 1,
      },
      createAppLifecycleMessage(
        'msg-story-complete',
        'assistant',
        'Story Builder saved the latest draft outline.',
        {
          toolCallId: 'tool-story-complete',
          lifecycle: 'complete',
          summaryForModel: 'Story Builder saved the latest draft outline for later revision.',
        }
      ),
      createAppLifecycleMessage(
        'msg-debate-active',
        'assistant',
        'Debate Arena is still running the rebuttal round.',
        {
          appId: 'debate-arena',
          appName: 'Debate Arena',
          toolCallId: 'tool-debate-active',
          lifecycle: 'active',
          summaryForModel: 'Debate Arena is still running the rebuttal round on school uniforms.',
        }
      ),
      {
        id: 'msg-multi-app-boundary',
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'Boundary after the mixed-app handoff.' }],
        timestamp: 4,
      },
      {
        id: 'msg-multi-app-follow-up',
        role: 'user',
        contentParts: [{ type: 'text', text: 'Which app is still active, and what did the other one finish?' }],
        timestamp: 6,
      },
      summaryMessage,
    ],
    compactionPoints: [
      {
        summaryMessageId: summaryMessage.id,
        boundaryMessageId: 'msg-multi-app-boundary',
        createdAt: 7,
      },
    ],
  }
}

export function buildSupersededInstanceContinuityFixture(): Omit<Session, 'id'> {
  const summaryMessage: Message = {
    id: 'msg-superseded-summary',
    role: 'assistant',
    isSummary: true,
    contentParts: [{ type: 'text', text: 'Summary after the superseded instance.' }],
    timestamp: 5,
  }

  return {
    name: 'ChatBridge Superseded Instance Session',
    type: 'chat',
    messages: [
      {
        id: 'msg-superseded-system',
        role: 'system',
        contentParts: [{ type: 'text', text: 'Only keep continuity for the latest valid instance state.' }],
        timestamp: 1,
      },
      createAppLifecycleMessage(
        'msg-story-active-old',
        'assistant',
        'Story Builder had an older active draft session.',
        {
          toolCallId: 'tool-story-active-old',
          lifecycle: 'active',
          summaryForModel: 'This older Story Builder draft should no longer be injected.',
        }
      ),
      createAppLifecycleMessage(
        'msg-story-stale-new',
        'assistant',
        'The newer Story Builder instance went stale before the host received a safe checkpoint.',
        {
          toolCallId: 'tool-story-active-old',
          lifecycle: 'stale',
          state: 'call',
          partial: true,
          summary: 'The newer Story Builder state is stale and should suppress continuity for that instance.',
        }
      ),
      createAppLifecycleMessage(
        'msg-debate-complete-recent',
        'assistant',
        'Debate Arena completed a recent round that should stay attributable.',
        {
          appId: 'debate-arena',
          appName: 'Debate Arena',
          toolCallId: 'tool-debate-complete-recent',
          lifecycle: 'complete',
          summaryForModel: 'Debate Arena completed a recent round that should remain available for follow-up.',
        }
      ),
      {
        id: 'msg-superseded-boundary',
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'Boundary after the superseded instance state.' }],
        timestamp: 4,
      },
      {
        id: 'msg-superseded-follow-up',
        role: 'user',
        contentParts: [{ type: 'text', text: 'What app context is still safe to use?' }],
        timestamp: 6,
      },
      summaryMessage,
    ],
    compactionPoints: [
      {
        summaryMessageId: summaryMessage.id,
        boundaryMessageId: 'msg-superseded-boundary',
        createdAt: 7,
      },
    ],
  }
}

export function buildMalformedDebateArenaContextFixture(): Omit<Session, 'id'> {
  const summaryMessage: Message = {
    id: 'msg-malformed-debate-summary',
    role: 'assistant',
    isSummary: true,
    contentParts: [{ type: 'text', text: 'Summary after a malformed debate state.' }],
    timestamp: 3,
  }

  return {
    name: 'ChatBridge Malformed Debate Arena Session',
    type: 'chat',
    messages: [
      {
        id: 'msg-malformed-debate-system',
        role: 'system',
        contentParts: [{ type: 'text', text: 'Reject malformed Debate Arena state instead of guessing.' }],
        timestamp: 1,
      },
      createAppLifecycleMessage(
        'msg-malformed-debate',
        'assistant',
        'Debate Arena reported malformed state and should not inject host-approved continuity from it.',
        {
          appId: 'debate-arena',
          appName: 'Debate Arena',
          toolCallId: 'tool-malformed-debate',
          lifecycle: 'complete',
          summary: 'Malformed Debate Arena state should stay explicit.',
          values: {
            chatbridgeDebateArena: {
              schemaVersion: 1,
              phase: 'complete',
              motion: 'Malformed state',
              teams: [
                {
                  id: 'team-affirmative',
                  name: 'Team Solo',
                  stance: 'affirmative',
                },
              ],
            },
          },
        }
      ),
      {
        id: 'msg-malformed-debate-boundary',
        role: 'assistant',
        contentParts: [{ type: 'text', text: 'Boundary after malformed debate state.' }],
        timestamp: 2,
      },
      {
        id: 'msg-malformed-debate-follow-up',
        role: 'user',
        contentParts: [{ type: 'text', text: 'Can you keep helping without inventing the result?' }],
        timestamp: 4,
      },
      summaryMessage,
    ],
    compactionPoints: [
      {
        summaryMessageId: summaryMessage.id,
        boundaryMessageId: 'msg-malformed-debate-boundary',
        createdAt: 5,
      },
    ],
  }
}
