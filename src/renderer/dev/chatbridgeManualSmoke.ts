import { getChatBridgeLiveSeedFixtures, type ChatBridgeLiveSeedFixture } from '@shared/chatbridge/live-seeds'
import {
  CHATBRIDGE_LANGSMITH_PROJECT_NAME,
  createChatBridgeTraceMetadata,
  createChatBridgeTraceName,
  createChatBridgeTraceTags,
  type ChatBridgeTraceRuntimeTarget,
  type ChatBridgeTraceDescriptor,
} from '@shared/models/tracing'
import type { LangSmithRunHandle } from '@shared/utils/langsmith_adapter'
import { langsmith } from '@/adapters/langsmith'

type LangSmithStatusPayload = {
  enabled?: boolean
  projectName?: string
  reason?: string
}

type ManualSmokeFixtureMode =
  | {
      support: 'supported'
      reasonCode: 'supported'
      descriptor: Omit<ChatBridgeTraceDescriptor, 'surface'>
      message: string
    }
  | {
      support: 'legacy'
      reasonCode: 'legacy-reference'
      message: string
    }
  | {
      support: 'unsupported'
      reasonCode: 'unsupported-fixture'
      message: string
    }

type ChatBridgeManualSmokeSupportState = 'legacy-reference' | 'supported' | 'unsupported-fixture'

export type ChatBridgeManualSmokeTraceSupport = {
  enabled: boolean
  projectName: string
  runtimeTarget: ChatBridgeTraceRuntimeTarget
  supportState: ChatBridgeManualSmokeSupportState
  reasonCode:
    | 'enabled'
    | 'langsmith-disabled'
    | 'legacy-reference'
    | 'renderer-ipc-unavailable'
    | 'status-unavailable'
    | 'unsupported-fixture'
  message: string
}

export type ChatBridgeManualSmokeActiveRun = {
  fixtureId: string
  fixtureName: string
  sessionId: string
  runId: string
  traceName: string
  projectName: string
  startedAt: string
}

export type ChatBridgeManualSmokeStartResult =
  | {
      status: 'started'
      support: ChatBridgeManualSmokeTraceSupport
      traceId: string
      traceLabel: string
      run: ChatBridgeManualSmokeActiveRun
    }
  | {
      status: 'unsupported'
      support: ChatBridgeManualSmokeTraceSupport
      traceId: null
      traceLabel: null
    }

type ActiveRunEntry = {
  handle: LangSmithRunHandle
  run: ChatBridgeManualSmokeActiveRun
}

const activeManualSmokeRuns = new Map<string, ActiveRunEntry>()
const MANUAL_SMOKE_RUNTIME_TARGET: ChatBridgeTraceRuntimeTarget = 'desktop-electron'

const manualSmokeTraceDescriptors: Record<
  string,
  Extract<ManualSmokeFixtureMode, { support: 'supported' }>['descriptor']
> = {
  'lifecycle-tour': {
    slug: 'chatbridge-lifecycle-tour',
    primaryFamily: 'reviewed-app-launch',
    evidenceFamilies: ['recovery'],
    runtimeTarget: MANUAL_SMOKE_RUNTIME_TARGET,
    smokeSupport: 'supported',
    storyId: 'CB-006',
  },
  'degraded-completion-recovery': {
    slug: 'chatbridge-degraded-completion-recovery',
    primaryFamily: 'recovery',
    runtimeTarget: MANUAL_SMOKE_RUNTIME_TARGET,
    smokeSupport: 'supported',
    storyId: 'CB-006',
  },
  'platform-recovery': {
    slug: 'chatbridge-platform-recovery',
    primaryFamily: 'recovery',
    evidenceFamilies: ['bridge'],
    runtimeTarget: MANUAL_SMOKE_RUNTIME_TARGET,
    smokeSupport: 'supported',
    storyId: 'CB-006',
  },
  'chess-mid-game-board-context': {
    slug: 'chatbridge-chess-mid-game-board-context',
    primaryFamily: 'reviewed-app-launch',
    evidenceFamilies: ['board-context'],
    runtimeTarget: MANUAL_SMOKE_RUNTIME_TARGET,
    smokeSupport: 'supported',
    storyId: 'CB-006',
  },
  'drawing-kit-doodle-dare': {
    slug: 'chatbridge-drawing-kit-doodle-dare',
    primaryFamily: 'reviewed-app-launch',
    evidenceFamilies: ['persistence'],
    runtimeTarget: MANUAL_SMOKE_RUNTIME_TARGET,
    smokeSupport: 'supported',
    storyId: 'CB-509',
  },
  'chess-runtime': {
    slug: 'chatbridge-chess-runtime',
    primaryFamily: 'reviewed-app-launch',
    evidenceFamilies: ['persistence'],
    runtimeTarget: MANUAL_SMOKE_RUNTIME_TARGET,
    smokeSupport: 'supported',
    storyId: 'CB-006',
  },
}

function getProjectName(payload?: LangSmithStatusPayload) {
  return String(payload?.projectName ?? CHATBRIDGE_LANGSMITH_PROJECT_NAME)
}

export function getChatBridgeManualSmokeFixtureMode(fixtureId: string): ManualSmokeFixtureMode {
  const descriptor = manualSmokeTraceDescriptors[fixtureId]
  if (descriptor) {
    return {
      support: 'supported',
      reasonCode: 'supported',
      descriptor,
      message:
        fixtureId === 'chess-runtime'
          ? 'Supported desktop smoke fixture covering Chess runtime moves and persistence.'
          : fixtureId === 'chess-mid-game-board-context'
            ? 'Supported desktop smoke fixture covering Chess follow-up reasoning context.'
            : fixtureId === 'drawing-kit-doodle-dare'
              ? 'Supported desktop smoke fixture covering the Drawing Kit doodle game, checkpoint continuity, and follow-up chat.'
            : fixtureId === 'platform-recovery'
              ? 'Supported desktop smoke fixture covering platform-side failure recovery.'
              : fixtureId === 'degraded-completion-recovery'
                ? 'Supported desktop smoke fixture covering degraded completion recovery.'
                : 'Supported desktop smoke fixture covering launch shells and recovery states.',
    }
  }

  const fixture = getChatBridgeLiveSeedFixtures().find((entry) => entry.id === fixtureId)
  if (fixture?.smokeSupport === 'legacy-reference') {
    return {
      support: 'legacy',
      reasonCode: 'legacy-reference',
      message:
        'Legacy Story Builder reference fixture. It remains available for historical inspection, not active CB-006 smoke evidence.',
    }
  }

  return {
    support: 'unsupported',
    reasonCode: 'unsupported-fixture',
    message: 'Fixture is not part of the supported active smoke path.',
  }
}

function createChatBridgeManualSmokeTraceSupport(
  overrides: Omit<ChatBridgeManualSmokeTraceSupport, 'projectName' | 'runtimeTarget'> & {
    projectName?: string
  }
): ChatBridgeManualSmokeTraceSupport {
  return {
    projectName: overrides.projectName ?? CHATBRIDGE_LANGSMITH_PROJECT_NAME,
    runtimeTarget: MANUAL_SMOKE_RUNTIME_TARGET,
    enabled: overrides.enabled,
    supportState: overrides.supportState,
    reasonCode: overrides.reasonCode,
    message: overrides.message,
  }
}

export async function getChatBridgeManualSmokeTraceSupport(): Promise<ChatBridgeManualSmokeTraceSupport> {
  if (typeof window === 'undefined' || typeof window.electronAPI?.invoke !== 'function') {
    return createChatBridgeManualSmokeTraceSupport({
      enabled: false,
      supportState: 'supported',
      reasonCode: 'renderer-ipc-unavailable',
      message: 'Trace capture requires the desktop Electron runtime because LangSmith access stays main-process-owned.',
    })
  }

  try {
    const status = (await window.electronAPI.invoke('langsmith:get-status')) as LangSmithStatusPayload
    if (!status.enabled) {
      return createChatBridgeManualSmokeTraceSupport({
        enabled: false,
        projectName: getProjectName(status),
        supportState: 'supported',
        reasonCode: 'langsmith-disabled',
        message:
          'LangSmith tracing is disabled in the desktop runtime. Set LANGSMITH_API_KEY and LANGSMITH_TRACING=true before running the traced smoke flow.',
      })
    }

    return createChatBridgeManualSmokeTraceSupport({
      enabled: true,
      projectName: getProjectName(status),
      supportState: 'supported',
      reasonCode: 'enabled',
      message: `Desktop manual smoke traces will land in the ${getProjectName(status)} project.`,
    })
  } catch {
    return createChatBridgeManualSmokeTraceSupport({
      enabled: false,
      supportState: 'supported',
      reasonCode: 'status-unavailable',
      message: 'LangSmith trace status is unavailable from the desktop bridge.',
    })
  }
}

export async function startChatBridgeManualSmokeTrace(
  fixture: ChatBridgeLiveSeedFixture,
  sessionId: string
): Promise<ChatBridgeManualSmokeStartResult> {
  const fixtureMode = getChatBridgeManualSmokeFixtureMode(fixture.id)
  if (fixtureMode.support !== 'supported') {
    return {
      status: 'unsupported',
      traceId: null,
      traceLabel: null,
      support: createChatBridgeManualSmokeTraceSupport({
        enabled: false,
        supportState: fixtureMode.reasonCode,
        reasonCode: fixtureMode.reasonCode,
        message: fixtureMode.message,
      }),
    }
  }

  const traceSupport = await getChatBridgeManualSmokeTraceSupport()
  if (!traceSupport.enabled) {
    return {
      status: 'unsupported',
      traceId: null,
      traceLabel: null,
      support: traceSupport,
    }
  }

  const startedAt = new Date().toISOString()
  const traceDescriptor: ChatBridgeTraceDescriptor = {
    ...fixtureMode.descriptor,
    surface: 'manual_smoke',
  }
  const traceName = createChatBridgeTraceName(traceDescriptor, sessionId)
  const runHandle = await langsmith.startRun({
    name: traceName,
    projectName: traceSupport.projectName,
    runType: 'chain',
    inputs: {
      fixtureId: fixture.id,
      fixtureName: fixture.name,
      sessionId,
      coverage: fixture.coverage,
      auditSteps: fixture.auditSteps,
      startedAt,
    },
    metadata: createChatBridgeTraceMetadata(traceDescriptor, {
      fixtureId: fixture.id,
      fixtureName: fixture.name,
      sessionId,
      supportedPath: 'desktop-seed-lab',
    }),
    tags: createChatBridgeTraceTags(traceDescriptor, ['seed-lab']),
  })

  const activeRun: ChatBridgeManualSmokeActiveRun = {
    fixtureId: fixture.id,
    fixtureName: fixture.name,
    sessionId,
    runId: runHandle.runId,
    traceName,
    projectName: traceSupport.projectName,
    startedAt,
  }

  activeManualSmokeRuns.set(runHandle.runId, {
    handle: runHandle,
    run: activeRun,
  })

  return {
    status: 'started',
    support: traceSupport,
    traceId: runHandle.runId,
    traceLabel: traceName,
    run: activeRun,
  }
}

export async function finishChatBridgeManualSmokeTrace(runId: string, outcome: 'failed' | 'passed' | 'superseded') {
  const activeRun = activeManualSmokeRuns.get(runId)
  if (!activeRun) {
    return false
  }

  await activeRun.handle.end({
    outputs: {
      outcome,
      fixtureId: activeRun.run.fixtureId,
      fixtureName: activeRun.run.fixtureName,
      sessionId: activeRun.run.sessionId,
      completedAt: new Date().toISOString(),
    },
  })
  activeManualSmokeRuns.delete(runId)

  return true
}
