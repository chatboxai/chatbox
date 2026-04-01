import type { ReviewedAppCatalogEntry } from './manifest'
import { ReviewedAppCatalogEntrySchema } from './manifest'
import { defineReviewedApps, getReviewedAppCatalog } from './registry'

export const CHATBRIDGE_CHESS_APP_ID = 'chess'
export const CHATBRIDGE_CHESS_TOOL_NAME = 'chess_prepare_session'

const DEFAULT_REVIEWED_APP_CATALOG_ENTRIES: ReviewedAppCatalogEntry[] = [
  ReviewedAppCatalogEntrySchema.parse({
    manifest: {
      appId: CHATBRIDGE_CHESS_APP_ID,
      name: 'Chess',
      version: '0.1.0',
      protocolVersion: 1,
      origin: 'https://apps.example.com',
      uiEntry: 'https://apps.example.com/chess',
      authMode: 'host-session',
      permissions: [
        {
          id: 'session.context.read',
          resource: 'chat.session',
          access: 'read',
          required: true,
          purpose: 'Prepare a reviewed Chess session from the current conversation context.',
        },
      ],
      toolSchemas: [
        {
          name: CHATBRIDGE_CHESS_TOOL_NAME,
          title: 'Prepare Chess Session',
          description:
            'Prepare a reviewed Chess session for chess, FEN, PGN, opening, board, and move-analysis requests.',
          schemaVersion: 1,
          inputSchema: {
            type: 'object',
            properties: {
              request: {
                type: 'string',
                description: 'The user-facing Chess request to prepare.',
                minLength: 1,
              },
              fen: {
                type: 'string',
                description: 'Optional FEN board state to preload into the prepared Chess session.',
              },
              pgn: {
                type: 'string',
                description: 'Optional PGN move history to preload into the prepared Chess session.',
              },
            },
            required: ['request'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              appId: { type: 'string' },
              appName: { type: 'string' },
              capability: { type: 'string' },
              launchReady: { type: 'boolean' },
              summary: { type: 'string' },
            },
            required: ['appId', 'appName', 'capability', 'launchReady', 'summary'],
          },
        },
      ],
      supportedEvents: ['host.init', 'host.invokeTool', 'app.ready', 'app.state', 'app.complete', 'app.error'],
      completionModes: ['summary', 'state'],
      timeouts: {
        launchMs: 10_000,
        idleMs: 120_000,
        completionMs: 10_000,
      },
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
      healthcheck: {
        url: 'https://apps.example.com/chess/healthz',
        intervalMs: 30_000,
        timeoutMs: 2_000,
      },
    },
    approval: {
      status: 'approved',
      reviewedAt: 1_711_930_000_000,
      reviewedBy: 'platform-review',
      catalogVersion: 1,
    },
  }),
]

export function getDefaultReviewedAppCatalogEntries(): ReviewedAppCatalogEntry[] {
  return DEFAULT_REVIEWED_APP_CATALOG_ENTRIES.map((entry) => ReviewedAppCatalogEntrySchema.parse(structuredClone(entry)))
}

export function ensureDefaultReviewedAppsRegistered(): ReviewedAppCatalogEntry[] {
  const existingCatalog = getReviewedAppCatalog()
  if (existingCatalog.length > 0) {
    return existingCatalog
  }

  return defineReviewedApps(getDefaultReviewedAppCatalogEntries())
}
