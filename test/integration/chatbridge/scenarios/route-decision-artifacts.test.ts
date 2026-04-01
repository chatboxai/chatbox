import '../setup'

import { beforeEach, describe, expect, it } from 'vitest'
import { clearReviewedAppRegistry, defineReviewedApps } from '@shared/chatbridge/registry'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'
import { createReviewedAppRouteArtifact, getReviewedAppRouteDecision } from '@/packages/chatbridge/router'

describe('ChatBridge route decision artifacts', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('creates a clarify artifact when more than one reviewed app plausibly matches the request', () => {
    defineReviewedApps([
      createReviewedAppCatalogEntryFixture({
        manifest: {
          appId: 'story-builder',
          name: 'Story Builder',
          tenantAvailability: {
            default: 'enabled',
            allow: [],
            deny: [],
          },
          safetyMetadata: {
            reviewed: true,
            sandbox: 'hosted-iframe',
            handlesStudentData: true,
            requiresTeacherApproval: false,
          },
          toolSchemas: [
            {
              name: 'story_builder_resume',
              description: 'Resume a story draft, outline, or chapter revision.',
              schemaVersion: 1,
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      }),
      createReviewedAppCatalogEntryFixture({
        manifest: {
          appId: 'debate-arena',
          name: 'Debate Arena',
          uiEntry: 'https://apps.example.com/debate-arena',
          authMode: 'none',
          permissions: [],
          supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete'],
          safetyMetadata: {
            reviewed: true,
            sandbox: 'hosted-iframe',
            handlesStudentData: false,
            requiresTeacherApproval: false,
          },
          tenantAvailability: {
            default: 'enabled',
            allow: [],
            deny: [],
          },
          toolSchemas: [
            {
              name: 'debate_arena_round',
              description: 'Open a debate round and draft claims, rebuttals, or opening statements.',
              schemaVersion: 1,
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      }),
    ])

    const result = getReviewedAppRouteDecision({
      promptInput: 'Help me draft an opening statement for class.',
      contextInput: {
        tenantId: 'k12-demo',
        teacherApproved: true,
        grantedPermissions: ['drive.read'],
      },
    })
    const artifact = createReviewedAppRouteArtifact(result.decision)

    expect(result.decision.kind).toBe('clarify')
    expect(result.decision.matches.map((match) => match.appId)).toContain('debate-arena')
    expect(artifact.values?.chatbridgeRouteDecision).toMatchObject({
      kind: 'clarify',
      prompt: 'Help me draft an opening statement for class.',
    })
    expect(artifact.title).toBe('Choose the next step')
  })

  it('creates a chat-only artifact when no reviewed app is a confident fit', () => {
    defineReviewedApps([
      createReviewedAppCatalogEntryFixture({
        manifest: {
          tenantAvailability: {
            default: 'enabled',
            allow: [],
            deny: [],
          },
          safetyMetadata: {
            reviewed: true,
            sandbox: 'hosted-iframe',
            handlesStudentData: true,
            requiresTeacherApproval: false,
          },
        },
      }),
    ])

    const result = getReviewedAppRouteDecision({
      promptInput: 'What should I cook for dinner tonight?',
      contextInput: {
        tenantId: 'k12-demo',
        teacherApproved: true,
        grantedPermissions: ['drive.read'],
      },
    })
    const artifact = createReviewedAppRouteArtifact(result.decision)

    expect(result.decision.kind).toBe('refuse')
    expect(result.decision.reasonCode).toBe('no-confident-match')
    expect(artifact.values?.chatbridgeRouteDecision).toMatchObject({
      kind: 'refuse',
      prompt: 'What should I cook for dinner tonight?',
    })
    expect(artifact.title).toBe('Keep this in chat')
  })
})
