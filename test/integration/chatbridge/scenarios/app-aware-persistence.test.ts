import '../setup'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageAppPart, MessageToolCallPart } from '@shared/types/session'
import platform from '@/platform'
import type TestPlatform from '@/platform/test_platform'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import { exportSessionChat } from '@/stores/session/export'
import { switchThread } from '@/stores/session/threads'
import {
  buildAppAwareSessionFixture,
  buildPartialLifecycleSessionFixture,
  buildRecoveryCheckpointSessionFixture,
} from '../fixtures/app-aware-session'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function getToolCall(message: { contentParts: Array<{ type: string }> }): MessageToolCallPart {
  const toolCall = message.contentParts.find((part) => part.type === 'tool-call')
  expect(toolCall).toBeDefined()
  return toolCall as MessageToolCallPart
}

function getAppPart(message: { contentParts: Array<{ type: string }> }): MessageAppPart {
  const appPart = message.contentParts.find((part) => part.type === 'app')
  expect(appPart).toBeDefined()
  return appPart as MessageAppPart
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-persistence-and-shell-artifacts',
      primaryFamily: 'persistence',
      evidenceFamilies: ['reviewed-app-launch'],
      legacy: true,
    },
    testCase,
    execute
  )
}

describe('ChatBridge app-aware persistence regression coverage', () => {
  const testPlatform = platform as TestPlatform

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    queryClient.clear()
    testPlatform.clear()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    queryClient.clear()
    testPlatform.clear()
  })

  it('reloads persisted app-aware sessions without dropping lifecycle artifacts or thread history', () =>
    traceScenario(
      'reloads persisted app-aware sessions without dropping lifecycle artifacts or thread history',
      async () => {
        const fixture = buildAppAwareSessionFixture()
        const createdSession = await chatStore.createSession(fixture.sessionInput)

        queryClient.clear()
        const reloadedSession = await chatStore.getSession(createdSession.id)

        expect(reloadedSession).not.toBeNull()
        expect(reloadedSession?.messages.map((message) => message.id)).toEqual(fixture.currentMessageIds)
        expect(reloadedSession?.threads?.map((thread) => thread.id)).toEqual([fixture.historyThread.id])
        expect(reloadedSession?.threads?.[0].messages.map((message) => message.id)).toEqual(fixture.historyMessageIds)

        const currentToolCall = getToolCall(reloadedSession!.messages[2])
        const currentAppPart = getAppPart(reloadedSession!.messages[2])

        expect(currentAppPart).toMatchObject({
          appId: 'story-builder',
          appName: 'Story Builder',
          lifecycle: 'active',
          summary: 'Restored the active story draft and preserved the exportable checkpoint.',
        })
        expect(currentToolCall).toMatchObject({
          toolName: 'chatbridge_app_state',
          state: 'result',
        })
        expect(currentToolCall.result).toMatchObject({
          appId: 'story-builder',
          lifecycle: 'active',
        })
        expect(reloadedSession?.messages[2].files?.[0]?.name).toBe('story-builder-state.json')
      }
    ))

  it('preserves app-aware message continuity when switching to a historical thread', () =>
    traceScenario('preserves app-aware message continuity when switching to a historical thread', async () => {
      const fixture = buildAppAwareSessionFixture()
      const createdSession = await chatStore.createSession(fixture.sessionInput)

      await switchThread(createdSession.id, fixture.historyThread.id)
      vi.runOnlyPendingTimers()

      queryClient.clear()
      const switchedSession = await chatStore.getSession(createdSession.id)

      expect(switchedSession?.threadName).toBe(fixture.historyThread.name)
      expect(switchedSession?.messages.map((message) => message.id)).toEqual(fixture.historyMessageIds)
      expect(switchedSession?.threads).toHaveLength(1)
      expect(switchedSession?.threads?.[0].messages.map((message) => message.id)).toEqual(fixture.currentMessageIds)

      const archivedAppPart = getAppPart(switchedSession!.threads![0].messages[2])
      const archivedToolCall = getToolCall(switchedSession!.threads![0].messages[2])
      expect(archivedAppPart).toMatchObject({
        lifecycle: 'active',
        summary: 'Restored the active story draft and preserved the exportable checkpoint.',
      })
      expect(archivedToolCall.result).toMatchObject({
        lifecycle: 'active',
        summary: 'Restored the active story draft and preserved the exportable checkpoint.',
      })
    }))

  it('exports app-aware conversations with stable tool-call summaries and attachments across formats', () =>
    traceScenario(
      'exports app-aware conversations with stable tool-call summaries and attachments across formats',
      async () => {
        const fixture = buildAppAwareSessionFixture()
        const createdSession = await chatStore.createSession(fixture.sessionInput)

        await exportSessionChat(createdSession.id, 'all_threads', 'Markdown')
        await exportSessionChat(createdSession.id, 'all_threads', 'TXT')
        await exportSessionChat(createdSession.id, 'all_threads', 'HTML')

        const markdown = testPlatform.exporter.getExport('ChatBridge Story Session.md') as string
        const text = testPlatform.exporter.getExport('ChatBridge Story Session.txt') as string
        const html = testPlatform.exporter.getExport('ChatBridge Story Session.html') as string

        expect(markdown).toContain('Tool Call: chatbridge_app_state (state: result)')
        expect(markdown).toContain('story-builder-state.json')
        expect(markdown).toContain('Restored the active story draft and preserved the exportable checkpoint.')
        expect(markdown).toContain('Story Builder resumed with the latest draft checkpoint.')

        expect(text).toContain('Tool Call: chatbridge_app_state (state: result)')
        expect(text).toContain('Attachments:')
        expect(text).toContain('story-builder-state.json')
        expect(text).toContain('Restored the active story draft and preserved the exportable checkpoint.')

        expect(html).toContain('chatbridge_app_state')
        expect(html).toContain('story-builder-state.json')
        expect(html).toContain('Restored the active story draft and preserved the exportable checkpoint.')
      }
    ))

  it('keeps stale or partial lifecycle records explicit without inventing missing result data', () =>
    traceScenario(
      'keeps stale or partial lifecycle records explicit without inventing missing result data',
      async () => {
        const createdSession = await chatStore.createSession(buildPartialLifecycleSessionFixture())

        queryClient.clear()
        const reloadedSession = await chatStore.getSession(createdSession.id)
        const partialAppPart = getAppPart(reloadedSession!.messages[1])
        const partialToolCall = getToolCall(reloadedSession!.messages[1])

        expect(partialAppPart).toMatchObject({
          lifecycle: 'stale',
          summary: 'Cached app state expired before a fresh checkpoint arrived.',
        })
        expect(partialToolCall).toMatchObject({
          toolName: 'chatbridge_app_state',
          state: 'call',
        })
        expect(partialToolCall.result).toBeUndefined()

        await exportSessionChat(createdSession.id, 'current_thread', 'Markdown')
        const markdown = testPlatform.exporter.getExport('ChatBridge Partial Lifecycle Session.md') as string

        expect(markdown).toContain('Tool Call: chatbridge_app_state (state: call)')
        expect(markdown).toContain(
          'Cached app state expired. Resume should stay explicit without inventing a recovered result.'
        )
        expect(markdown).not.toContain('Result:')
      }
    ))

  it('reloads degraded recovery checkpoints without dropping host-owned recovery inputs', () =>
    traceScenario('reloads degraded recovery checkpoints without dropping host-owned recovery inputs', async () => {
      const createdSession = await chatStore.createSession(buildRecoveryCheckpointSessionFixture())

      queryClient.clear()
      const reloadedSession = await chatStore.getSession(createdSession.id)
      const recoveryAppPart = getAppPart(reloadedSession!.messages[1])

      expect(recoveryAppPart).toMatchObject({
        lifecycle: 'error',
        title: 'Story Builder checkpoint',
        description: 'The host kept the last safe draft checkpoint in-thread.',
        statusText: 'Needs recovery',
        fallbackTitle: 'Recovery available',
        fallbackText: 'Resume the Story Builder session from the last safe checkpoint.',
        error: 'Drive auth expired before export finished.',
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
      })
    }))
})
