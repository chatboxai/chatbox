import type { Message, Session } from '@shared/types'
import {
  buildAppAwareSessionFixture,
  buildChatBridgeChessMidGameSessionFixture,
  buildPartialLifecycleSessionFixture,
  createAppLifecycleMessage as createSeedAppLifecycleMessage,
} from '@shared/chatbridge/live-seeds'

export {
  buildAppAwareSessionFixture,
  buildChatBridgeChessMidGameSessionFixture,
  buildPartialLifecycleSessionFixture,
}

type CreateSeedAppLifecycleMessageOptions = Parameters<typeof createSeedAppLifecycleMessage>[3]

type AppLifecycleMessageOptions = CreateSeedAppLifecycleMessageOptions & {
  summaryForModel?: string
}

export function createAppLifecycleMessage(
  id: string,
  role: Message['role'],
  text: string,
  options: AppLifecycleMessageOptions
): Message {
  const message = createSeedAppLifecycleMessage(id, role, text, options)

  if (!options.summaryForModel) {
    return message
  }

  return {
    ...message,
    contentParts: message.contentParts.map((part) =>
      part.type === 'app'
        ? {
            ...part,
            summaryForModel: options.summaryForModel,
          }
        : part
    ),
  }
}

function createTextMessage(id: string, role: Message['role'], text: string, timestamp: number): Message {
  return {
    id,
    role,
    timestamp,
    contentParts: [{ type: 'text', text }],
  }
}

export function buildRecoveryCheckpointSessionFixture(): Omit<Session, 'id'> {
  return {
    name: 'ChatBridge Recovery Checkpoint Session',
    type: 'chat',
    messages: [
      createTextMessage(
        'msg-recovery-user',
        'user',
        'Keep writing chapter four, then save the draft back to Drive.',
        1
      ),
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
          timestamp: 2,
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
      timestamp: 2,
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
      createTextMessage(
        'msg-debate-system',
        'system',
        'Keep debate-state continuity host-owned and explicit.',
        1
      ),
      completedDebate,
      createTextMessage('msg-debate-boundary', 'assistant', 'Boundary after the completed debate round.', 2),
      createTextMessage(
        'msg-debate-follow-up',
        'user',
        'What was the strongest rebuttal from the winning side?',
        4
      ),
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
      createTextMessage(
        'msg-multi-app-system',
        'system',
        'Keep active and recent app continuity attributable.',
        1
      ),
      createAppLifecycleMessage('msg-story-complete', 'assistant', 'Story Builder saved the latest draft outline.', {
        toolCallId: 'tool-story-complete',
        lifecycle: 'complete',
        summaryForModel: 'Story Builder saved the latest draft outline for later revision.',
        timestamp: 2,
      }),
      createAppLifecycleMessage('msg-debate-active', 'assistant', 'Debate Arena is still running the rebuttal round.', {
        appId: 'debate-arena',
        appName: 'Debate Arena',
        toolCallId: 'tool-debate-active',
        lifecycle: 'active',
        summaryForModel: 'Debate Arena is still running the rebuttal round on school uniforms.',
        timestamp: 3,
      }),
      createTextMessage('msg-multi-app-boundary', 'assistant', 'Boundary after the mixed-app handoff.', 4),
      createTextMessage(
        'msg-multi-app-follow-up',
        'user',
        'Which app is still active, and what did the other one finish?',
        6
      ),
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
      createTextMessage(
        'msg-superseded-system',
        'system',
        'Only keep continuity for the latest valid instance state.',
        1
      ),
      createAppLifecycleMessage(
        'msg-story-active-old',
        'assistant',
        'Story Builder had an older active draft session.',
        {
          toolCallId: 'tool-story-active-old',
          lifecycle: 'active',
          summaryForModel: 'This older Story Builder draft should no longer be injected.',
          timestamp: 2,
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
          timestamp: 3,
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
          timestamp: 4,
        }
      ),
      createTextMessage('msg-superseded-boundary', 'assistant', 'Boundary after the superseded instance state.', 5),
      createTextMessage('msg-superseded-follow-up', 'user', 'What app context is still safe to use?', 6),
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
      createTextMessage(
        'msg-malformed-debate-system',
        'system',
        'Reject malformed Debate Arena state instead of guessing.',
        1
      ),
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
          timestamp: 2,
        }
      ),
      createTextMessage('msg-malformed-debate-boundary', 'assistant', 'Boundary after malformed debate state.', 3),
      createTextMessage(
        'msg-malformed-debate-follow-up',
        'user',
        'Can you keep helping without inventing the result?',
        4
      ),
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
