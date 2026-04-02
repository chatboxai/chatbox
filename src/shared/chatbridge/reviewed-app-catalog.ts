import type { ReviewedAppCatalogEntry } from './manifest'
import { ReviewedAppCatalogEntrySchema } from './manifest'
import { defineReviewedApps, getReviewedAppCatalog } from './registry'
import { CHATBRIDGE_STORY_BUILDER_APP_ID } from './story-builder'

export type ReviewedAppCatalogTrack = 'active-flagship' | 'legacy-reference'

type ReviewedAppCatalogDescriptor = {
  track: ReviewedAppCatalogTrack
  entry: ReviewedAppCatalogEntry
}

export const CHATBRIDGE_CHESS_APP_ID = 'chess'
export const CHATBRIDGE_CHESS_TOOL_NAME = 'chess_prepare_session'
export const CHATBRIDGE_DRAWING_KIT_APP_ID = 'drawing-kit'
export const CHATBRIDGE_DRAWING_KIT_TOOL_NAME = 'drawing_kit_open'
export const CHATBRIDGE_WEATHER_DASHBOARD_APP_ID = 'weather-dashboard'
export const CHATBRIDGE_WEATHER_DASHBOARD_TOOL_NAME = 'weather_dashboard_open'
export const CHATBRIDGE_DEBATE_ARENA_APP_ID = 'debate-arena'
export const CHATBRIDGE_DEBATE_ARENA_TOOL_NAME = 'debate_arena_round'
export const CHATBRIDGE_STORY_BUILDER_TOOL_NAME = 'story_builder_resume'

function parseCatalogEntry(entry: ReviewedAppCatalogEntry): ReviewedAppCatalogEntry {
  return ReviewedAppCatalogEntrySchema.parse(entry)
}

function cloneCatalogEntry(entry: ReviewedAppCatalogEntry): ReviewedAppCatalogEntry {
  return ReviewedAppCatalogEntrySchema.parse(structuredClone(entry))
}

const REVIEWED_APP_CATALOG_DESCRIPTORS: ReviewedAppCatalogDescriptor[] = [
  {
    track: 'active-flagship',
    entry: parseCatalogEntry({
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
          sandbox: 'native-shell',
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
        catalogVersion: 2,
      },
    }),
  },
  {
    track: 'active-flagship',
    entry: parseCatalogEntry({
      manifest: {
        appId: CHATBRIDGE_DRAWING_KIT_APP_ID,
        name: 'Drawing Kit',
        version: '0.1.0',
        protocolVersion: 1,
        origin: 'https://apps.example.com',
        uiEntry: 'https://apps.example.com/drawing-kit',
        authMode: 'none',
        permissions: [
          {
            id: 'session.context.read',
            resource: 'chat.session',
            access: 'read',
            required: true,
            purpose: 'Open Drawing Kit with the bounded prompt context for the current sketch request.',
          },
        ],
        toolSchemas: [
          {
            name: CHATBRIDGE_DRAWING_KIT_TOOL_NAME,
            title: 'Open Drawing Kit',
            description: 'Launch Drawing Kit to sketch, annotate, doodle, or diagram directly inside the thread.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {
                request: {
                  type: 'string',
                  description: 'The user-facing request that should open Drawing Kit.',
                  minLength: 1,
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
          sandbox: 'native-shell',
          handlesStudentData: false,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: [],
        },
        healthcheck: {
          url: 'https://apps.example.com/drawing-kit/healthz',
          intervalMs: 30_000,
          timeoutMs: 2_000,
        },
      },
      approval: {
        status: 'approved',
        reviewedAt: 1_711_930_000_000,
        reviewedBy: 'platform-review',
        catalogVersion: 2,
      },
    }),
  },
  {
    track: 'active-flagship',
    entry: parseCatalogEntry({
      manifest: {
        appId: CHATBRIDGE_WEATHER_DASHBOARD_APP_ID,
        name: 'Weather Dashboard',
        version: '0.1.0',
        protocolVersion: 1,
        origin: 'https://apps.example.com',
        uiEntry: 'https://apps.example.com/weather-dashboard',
        authMode: 'none',
        permissions: [
          {
            id: 'weather.read',
            resource: 'weather',
            access: 'read',
            required: true,
            purpose: 'Open Weather Dashboard through the host-owned weather data boundary for the requested location.',
          },
        ],
        toolSchemas: [
          {
            name: CHATBRIDGE_WEATHER_DASHBOARD_TOOL_NAME,
            title: 'Open Weather Dashboard',
            description:
              'Launch Weather Dashboard to inspect current conditions, forecast changes, and degraded upstream weather states.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {
                request: {
                  type: 'string',
                  description: 'The user-facing request that should open Weather Dashboard.',
                  minLength: 1,
                },
                location: {
                  type: 'string',
                  description: 'Optional normalized location hint for the dashboard.',
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
          sandbox: 'native-shell',
          handlesStudentData: false,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: [],
        },
        healthcheck: {
          url: 'https://apps.example.com/weather-dashboard/healthz',
          intervalMs: 30_000,
          timeoutMs: 2_000,
        },
      },
      approval: {
        status: 'approved',
        reviewedAt: 1_711_930_000_000,
        reviewedBy: 'platform-review',
        catalogVersion: 2,
      },
    }),
  },
  {
    track: 'legacy-reference',
    entry: parseCatalogEntry({
      manifest: {
        appId: CHATBRIDGE_DEBATE_ARENA_APP_ID,
        name: 'Debate Arena',
        version: '0.1.0',
        protocolVersion: 1,
        origin: 'https://apps.example.com',
        uiEntry: 'https://apps.example.com/debate-arena',
        authMode: 'none',
        permissions: [
          {
            id: 'session.context.read',
            resource: 'chat.session',
            access: 'read',
            required: true,
            purpose: 'Open Debate Arena with the bounded classroom context for the reviewed debate round.',
          },
        ],
        toolSchemas: [
          {
            name: CHATBRIDGE_DEBATE_ARENA_TOOL_NAME,
            title: 'Open Debate Arena',
            description: 'Open a debate round, draft claims, rebuttals, and opening statements.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {
                request: {
                  type: 'string',
                  description: 'The user-facing request that should open Debate Arena.',
                  minLength: 1,
                },
              },
              required: ['request'],
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
          sandbox: 'native-shell',
          handlesStudentData: false,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'disabled',
          allow: [],
          deny: [],
        },
        healthcheck: {
          url: 'https://apps.example.com/debate-arena/healthz',
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
  },
  {
    track: 'legacy-reference',
    entry: parseCatalogEntry({
      manifest: {
        appId: CHATBRIDGE_STORY_BUILDER_APP_ID,
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
            purpose: 'Resume the latest Story Builder draft through the host-managed drive connector.',
          },
          {
            id: 'drive.write',
            resource: 'drive',
            access: 'write',
            required: true,
            purpose: 'Save Story Builder checkpoints through the host-managed drive connector.',
          },
        ],
        toolSchemas: [
          {
            name: CHATBRIDGE_STORY_BUILDER_TOOL_NAME,
            title: 'Resume Story Builder',
            description: 'Resume a story draft, chapter outline, or narrative revision.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {
                draftId: { type: 'string', description: 'Optional Story Builder draft identifier to resume.' },
                request: { type: 'string', description: 'The user-facing request that should open Story Builder.' },
              },
            },
          },
        ],
        supportedEvents: [
          'host.init',
          'host.invokeTool',
          'app.ready',
          'app.state',
          'app.complete',
          'app.error',
          'app.requestAuth',
        ],
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
          default: 'disabled',
          allow: [],
          deny: [],
        },
        healthcheck: {
          url: 'https://apps.example.com/story-builder/healthz',
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
  },
]

function getReviewedAppCatalogEntriesByTrack(track: ReviewedAppCatalogTrack): ReviewedAppCatalogEntry[] {
  return REVIEWED_APP_CATALOG_DESCRIPTORS.filter((descriptor) => descriptor.track === track).map((descriptor) =>
    cloneCatalogEntry(descriptor.entry)
  )
}

export function getDefaultReviewedAppCatalogEntries(): ReviewedAppCatalogEntry[] {
  return getReviewedAppCatalogEntriesByTrack('active-flagship')
}

export function getLegacyReviewedAppCatalogEntries(): ReviewedAppCatalogEntry[] {
  return getReviewedAppCatalogEntriesByTrack('legacy-reference')
}

export function ensureDefaultReviewedAppsRegistered(): ReviewedAppCatalogEntry[] {
  const existingCatalog = getReviewedAppCatalog()
  if (existingCatalog.length > 0) {
    return existingCatalog
  }

  return defineReviewedApps(getDefaultReviewedAppCatalogEntries())
}
