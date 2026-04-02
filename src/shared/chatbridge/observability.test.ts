import { beforeEach, describe, expect, it } from 'vitest'
import type { ReviewedAppCatalogEntry } from './manifest'
import {
  applyChatBridgeAppKillSwitch,
  clearChatBridgeAppKillSwitch,
  clearChatBridgeObservabilityState,
  evaluateReviewedAppActiveSessionDisposition,
  evaluateReviewedAppLaunchControl,
  getChatBridgeAppHealthRecord,
  getChatBridgeAppKillSwitch,
  listChatBridgeAppKillSwitches,
  listChatBridgeObservabilityEvents,
  recordChatBridgeObservabilityEvent,
  setChatBridgeAppHealthRecord,
} from './observability'

function createReviewedAppCatalogEntry(overrides: Partial<ReviewedAppCatalogEntry> = {}): ReviewedAppCatalogEntry {
  const base: ReviewedAppCatalogEntry = {
    manifest: {
      appId: 'story-builder',
      name: 'Story Builder',
      version: '1.2.3',
      protocolVersion: 1,
      origin: 'https://apps.example.com',
      uiEntry: 'https://apps.example.com/story-builder',
      authMode: 'oauth',
      permissions: [
        {
          id: 'drive.read',
          resource: 'drive',
          access: 'read',
          required: true,
          purpose: 'Resume a reviewed draft.',
        },
      ],
      toolSchemas: [
        {
          name: 'story_builder_resume',
          description: 'Resume the latest reviewed draft.',
          schemaVersion: 1,
          inputSchema: {
            type: 'object',
            properties: {
              draftId: { type: 'string' },
            },
            required: ['draftId'],
          },
        },
      ],
      supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete', 'app.requestAuth'],
      completionModes: ['summary', 'handoff'],
      timeouts: {
        launchMs: 15_000,
        idleMs: 120_000,
        completionMs: 10_000,
      },
      safetyMetadata: {
        reviewed: true,
        sandbox: 'hosted-iframe',
        handlesStudentData: true,
        requiresTeacherApproval: true,
      },
      tenantAvailability: {
        default: 'enabled',
        allow: [],
        deny: [],
      },
      healthcheck: {
        url: 'https://apps.example.com/story-builder/healthz',
      },
    },
    approval: {
      status: 'approved',
      reviewedAt: 1_711_930_000_000,
      reviewedBy: 'platform-review',
      catalogVersion: 3,
    },
  }

  return {
    ...base,
    ...overrides,
    manifest: {
      ...base.manifest,
      ...overrides.manifest,
    },
    approval: {
      ...base.approval,
      ...overrides.approval,
    },
  }
}

describe('chatbridge observability and operator controls', () => {
  beforeEach(() => {
    clearChatBridgeObservabilityState()
  })

  it('records lifecycle observability events and derives per-app health', () => {
    recordChatBridgeObservabilityEvent({
      eventId: 'event-ready',
      occurredAt: 100,
      kind: 'session-ready',
      severity: 'info',
      status: 'healthy',
      appId: 'story-builder',
      version: '1.2.3',
      appInstanceId: 'app-instance-1',
      bridgeSessionId: 'bridge-session-1',
      summary: 'Story Builder bridge session is ready.',
    })

    recordChatBridgeObservabilityEvent({
      eventId: 'event-recovery',
      occurredAt: 200,
      kind: 'recovery-required',
      severity: 'error',
      status: 'degraded',
      appId: 'story-builder',
      version: '1.2.3',
      appInstanceId: 'app-instance-1',
      bridgeSessionId: 'bridge-session-1',
      traceCode: 'recovery.timeout',
      summary: 'Story Builder timed out and recovery stayed inline.',
      details: ['waitedMs: 500'],
    })

    expect(listChatBridgeObservabilityEvents({ appId: 'story-builder' })).toHaveLength(2)
    expect(getChatBridgeAppHealthRecord('story-builder', '1.2.3')).toMatchObject({
      status: 'degraded',
      lastEventKind: 'recovery-required',
      summary: 'Story Builder timed out and recovery stayed inline.',
    })
  })

  it('blocks new launches through version-scoped kill switches while keeping active-session posture explicit', () => {
    const entry = createReviewedAppCatalogEntry()
    applyChatBridgeAppKillSwitch({
      controlId: 'control-story-builder',
      appId: 'story-builder',
      version: '1.2.3',
      reason: 'Rollback after partner regression.',
      disabledAt: 250,
      disabledBy: 'ops-oncall',
      activeSessionBehavior: 'allow-to-complete',
    })

    const launch = evaluateReviewedAppLaunchControl(entry)
    const activeSession = evaluateReviewedAppActiveSessionDisposition({
      appId: 'story-builder',
      version: '1.2.3',
      appName: 'Story Builder',
    })

    expect(launch).toMatchObject({
      allowed: false,
      reasonCode: 'app-version-disabled',
      activeSessionBehavior: 'allow-to-complete',
    })
    expect(activeSession).toMatchObject({
      action: 'continue',
    })
    expect(getChatBridgeAppKillSwitch('story-builder', '1.2.3')).toMatchObject({
      controlId: 'control-story-builder',
    })
    expect(getChatBridgeAppHealthRecord('story-builder', '1.2.3')).toMatchObject({
      status: 'disabled',
    })
  })

  it('supports app-wide disablement with recover-inline posture and explicit clear operations', () => {
    setChatBridgeAppHealthRecord({
      appId: 'story-builder',
      status: 'healthy',
      updatedAt: 100,
      summary: 'Story Builder passed the latest health check.',
    })

    applyChatBridgeAppKillSwitch({
      controlId: 'control-app-wide',
      appId: 'story-builder',
      reason: 'Security review requires temporary disablement.',
      disabledAt: 150,
      disabledBy: 'safety-ops',
      activeSessionBehavior: 'recover-inline',
    })

    const activeSession = evaluateReviewedAppActiveSessionDisposition({
      appId: 'story-builder',
      version: '1.2.3',
      appName: 'Story Builder',
    })
    const cleared = clearChatBridgeAppKillSwitch({
      appId: 'story-builder',
      clearedAt: 300,
      clearedBy: 'safety-ops',
    })

    expect(activeSession).toMatchObject({
      action: 'recover-inline',
    })
    expect(cleared).toMatchObject({
      controlId: 'control-app-wide',
    })
    expect(listChatBridgeAppKillSwitches()).toEqual([])
    expect(getChatBridgeAppHealthRecord('story-builder')).toMatchObject({
      status: 'healthy',
      lastEventKind: 'kill-switch-cleared',
    })
    expect(listChatBridgeObservabilityEvents({ appId: 'story-builder' }).map((event) => event.kind)).toEqual([
      'kill-switch-applied',
      'kill-switch-cleared',
    ])
  })
})
