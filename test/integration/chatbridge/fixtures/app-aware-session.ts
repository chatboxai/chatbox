import type { Message, Session, SessionThread } from '@shared/types'

type ToolCallState = 'call' | 'result' | 'error'
type AppLifecycle = 'ready' | 'active' | 'complete' | 'stale'

type AppLifecycleMessageOptions = {
  appId?: string
  appName?: string
  toolCallId: string
  lifecycle: AppLifecycle
  state?: ToolCallState
  partial?: boolean
  attachmentName?: string
  summary?: string
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

  return {
    id,
    role,
    timestamp: 1,
    contentParts: [
      { type: 'text', text },
      {
        type: 'info',
        text: `${appName} status: ${lifecycle}`,
        values: {
          appId,
          lifecycle,
          summary,
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
          bridgeSessionId: `bridge-${options.toolCallId}`,
        },
        ...(options.partial
          ? {}
          : {
              result: {
                appId,
                appName,
                lifecycle,
                summary,
                snapshot: {
                  route: '/apps/story-builder',
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
