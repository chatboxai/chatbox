import { describe, expect, it } from 'vitest'
import type { ReviewedAppRouterCandidate } from './eligibility'
import type { ReviewedAppCatalogEntry } from './manifest'
import { createChatBridgeRouteMessagePart, resolveReviewedAppRouteDecision } from './routing'

function createCandidate(overrides: {
  manifest?: Partial<ReviewedAppCatalogEntry['manifest']>
  approval?: Partial<ReviewedAppCatalogEntry['approval']>
  matchedContexts?: string[]
} = {}): ReviewedAppRouterCandidate {
  const base: ReviewedAppRouterCandidate = {
    entry: {
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
            purpose: 'Resume and save reviewed story drafts.',
          },
        ],
        toolSchemas: [
          {
            name: 'story_builder_resume',
            title: 'Story Builder resume',
            description: 'Resume a story draft, chapter outline, or narrative revision.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {},
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
      },
      approval: {
        status: 'approved',
        reviewedAt: 1_711_930_000_000,
        reviewedBy: 'platform-review',
        catalogVersion: 3,
      },
    },
    matchedContexts: [],
  }

  return {
    ...base,
    entry: {
      ...base.entry,
      manifest: {
        ...base.entry.manifest,
        ...overrides.manifest,
      },
      approval: {
        ...base.entry.approval,
        ...overrides.approval,
      },
    },
    matchedContexts: overrides.matchedContexts ?? base.matchedContexts,
  }
}

describe('resolveReviewedAppRouteDecision', () => {
  it('returns invoke when the user explicitly names a reviewed app', () => {
    const decision = resolveReviewedAppRouteDecision(
      [createCandidate()],
      'Open Story Builder and continue the chapter draft.'
    )

    expect(decision.kind).toBe('invoke')
    expect(decision.reasonCode).toBe('explicit-app-match')
    expect(decision.selectedAppId).toBe('story-builder')
    expect(decision.matches[0]?.appName).toBe('Story Builder')
  })

  it('returns clarify when the prompt could fit multiple reviewed apps', () => {
    const decision = resolveReviewedAppRouteDecision(
      [
        createCandidate(),
        createCandidate({
          manifest: {
            appId: 'debate-arena',
            name: 'Debate Arena',
            uiEntry: 'https://apps.example.com/debate-arena',
            authMode: 'none',
            permissions: [],
            toolSchemas: [
              {
                name: 'debate_arena_round',
                title: 'Debate Arena round',
                description: 'Open a debate round, draft claims, rebuttals, and opening statements.',
                schemaVersion: 1,
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
            ],
            supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete'],
            safetyMetadata: {
              reviewed: true,
              sandbox: 'hosted-iframe',
              handlesStudentData: false,
              requiresTeacherApproval: false,
            },
          },
        }),
      ],
      'Help me draft an opening statement and rebuttal for class.'
    )

    expect(decision.kind).toBe('clarify')
    expect(decision.reasonCode).toBe('ambiguous-match')
    expect(decision.selectedAppId).toBe('debate-arena')
    expect(decision.matches.map((match) => match.appId)).toEqual(['debate-arena', 'story-builder'])
  })

  it('returns refuse when no reviewed app is a confident fit', () => {
    const decision = resolveReviewedAppRouteDecision(
      [createCandidate()],
      'What should I cook for dinner tonight?'
    )

    expect(decision.kind).toBe('refuse')
    expect(decision.reasonCode).toBe('no-confident-match')
    expect(decision.selectedAppId).toBeUndefined()
  })

  it('can build a host-owned message artifact from the routing decision', () => {
    const decision = resolveReviewedAppRouteDecision(
      [createCandidate()],
      'Maybe Story Builder can help with this outline.'
    )

    const part = createChatBridgeRouteMessagePart(decision)

    expect(part.type).toBe('app')
    expect(part.lifecycle).toBe('ready')
    expect(part.values?.chatbridgeRouteDecision).toMatchObject({
      kind: decision.kind,
      prompt: decision.prompt,
    })
    expect(part.statusText).toBe('Launch app')
  })
})
