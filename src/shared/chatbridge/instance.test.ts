import { describe, expect, it } from 'vitest'
import {
  canResumeChatBridgeAppInstance,
  createChatBridgeAppInstance,
  isTerminalChatBridgeAppInstanceStatus,
} from './instance'

describe('ChatBridge app instance contract', () => {
  it('creates a host-owned instance with explicit resumability, completion, and auth placeholders', () => {
    const instance = createChatBridgeAppInstance(
      {
        id: 'instance-1',
        appId: 'story-builder',
        appVersion: '1.0.0',
        owner: {
          authority: 'host',
          conversationSessionId: 'session-1',
          initiatedBy: 'assistant',
        },
        resumability: {
          mode: 'resumable',
          resumeKey: 'resume-1',
        },
      },
      {
        now: () => 1_000,
      }
    )

    expect(instance).toMatchObject({
      id: 'instance-1',
      appId: 'story-builder',
      appVersion: '1.0.0',
      status: 'launching',
      owner: {
        authority: 'host',
        conversationSessionId: 'session-1',
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'resumable',
        resumeKey: 'resume-1',
      },
      completion: {
        status: 'pending',
      },
      auth: {
        status: 'not-required',
        grantIds: [],
      },
      createdAt: 1_000,
      updatedAt: 1_000,
      lastEventSequence: 0,
    })
  })

  it('only treats error and stale instances as resumable lifecycle states', () => {
    const resumable = createChatBridgeAppInstance({
      id: 'instance-2',
      appId: 'story-builder',
      appVersion: '1.0.0',
      owner: {
        authority: 'host',
        conversationSessionId: 'session-1',
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'resumable',
      },
      createdAt: 1_000,
    })

    expect(canResumeChatBridgeAppInstance(resumable)).toBe(false)
    expect(isTerminalChatBridgeAppInstanceStatus('complete')).toBe(true)
    expect(isTerminalChatBridgeAppInstanceStatus('cancelled')).toBe(true)
    expect(isTerminalChatBridgeAppInstanceStatus('active')).toBe(false)
  })
})
