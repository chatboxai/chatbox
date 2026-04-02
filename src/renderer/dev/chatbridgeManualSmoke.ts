import type { ChatBridgeLiveSeedFixture } from '@shared/chatbridge/live-seeds'
import {
  CHATBRIDGE_LANGSMITH_PROJECT_NAME,
  createChatBridgeTraceMetadata,
  createChatBridgeTraceName,
  createChatBridgeTraceTags,
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

export type ChatBridgeManualSmokeTraceSupport = {
  enabled: boolean
  projectName: string
  reasonCode: 'enabled' | 'langsmith-disabled' | 'renderer-ipc-unavailable' | 'status-unavailable'
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

type ChatBridgeManualSmokeStartResult =
  | {
      status: 'started'
      run: ChatBridgeManualSmokeActiveRun
    }
  | {
      status: 'unsupported'
      support: ChatBridgeManualSmokeTraceSupport
    }

type ActiveRunEntry = {
  handle: LangSmithRunHandle
  run: ChatBridgeManualSmokeActiveRun
}

const activeManualSmokeRuns = new Map<string, ActiveRunEntry>()

const manualSmokeFixtureModes: Record<string, ManualSmokeFixtureMode> = {
  'lifecycle-tour': {
    support: 'supported',
    reasonCode: 'supported',
    descriptor: {
      slug: 'chatbridge-lifecycle-tour',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['recovery'],
      storyId: 'CB-006',
    },
    message: 'Supported desktop smoke fixture covering launch shells and recovery states.',
  },
  'degraded-completion-recovery': {
    support: 'supported',
    reasonCode: 'supported',
    descriptor: {
      slug: 'chatbridge-degraded-completion-recovery',
      primaryFamily: 'recovery',
      storyId: 'CB-006',
    },
    message: 'Supported desktop smoke fixture covering degraded completion recovery.',
  },
  'platform-recovery': {
    support: 'supported',
    reasonCode: 'supported',
    descriptor: {
      slug: 'chatbridge-platform-recovery',
      primaryFamily: 'recovery',
      evidenceFamilies: ['bridge'],
      storyId: 'CB-006',
    },
    message: 'Supported desktop smoke fixture covering platform-side failure recovery.',
  },
  'chess-mid-game-board-context': {
    support: 'supported',
    reasonCode: 'supported',
    descriptor: {
      slug: 'chatbridge-chess-mid-game-board-context',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['board-context'],
      storyId: 'CB-006',
    },
    message: 'Supported desktop smoke fixture covering Chess follow-up reasoning context.',
  },
  'chess-runtime': {
    support: 'supported',
    reasonCode: 'supported',
    descriptor: {
      slug: 'chatbridge-chess-runtime',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['persistence'],
      storyId: 'CB-006',
    },
    message: 'Supported desktop smoke fixture covering Chess runtime moves and persistence.',
  },
  'history-and-preview': {
    support: 'legacy',
    reasonCode: 'legacy-reference',
    message:
      'Legacy Story Builder reference fixture. It remains available for historical inspection, not active CB-006 smoke evidence.',
  },
}

function getProjectName(payload?: LangSmithStatusPayload) {
  return String(payload?.projectName ?? CHATBRIDGE_LANGSMITH_PROJECT_NAME)
}

export function getChatBridgeManualSmokeFixtureMode(fixtureId: string): ManualSmokeFixtureMode {
  return (
    manualSmokeFixtureModes[fixtureId] ?? {
      support: 'legacy',
      reasonCode: 'legacy-reference',
      message: 'Fixture is not part of the supported active smoke path.',
    }
  )
}

export async function getChatBridgeManualSmokeTraceSupport(): Promise<ChatBridgeManualSmokeTraceSupport> {
  if (typeof window === 'undefined' || typeof window.electronAPI?.invoke !== 'function') {
    return {
      enabled: false,
      projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME,
      reasonCode: 'renderer-ipc-unavailable',
      message: 'Trace capture requires the desktop Electron runtime because LangSmith access stays main-process-owned.',
    }
  }

  try {
    const status = (await window.electronAPI.invoke('langsmith:get-status')) as LangSmithStatusPayload
    if (!status.enabled) {
      return {
        enabled: false,
        projectName: getProjectName(status),
        reasonCode: 'langsmith-disabled',
        message:
          'LangSmith tracing is disabled in the desktop runtime. Set LANGSMITH_API_KEY and LANGSMITH_TRACING=true before running the traced smoke flow.',
      }
    }

    return {
      enabled: true,
      projectName: getProjectName(status),
      reasonCode: 'enabled',
      message: `Desktop manual smoke traces will land in the ${getProjectName(status)} project.`,
    }
  } catch {
    return {
      enabled: false,
      projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME,
      reasonCode: 'status-unavailable',
      message: 'LangSmith trace status is unavailable from the desktop bridge.',
    }
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
      support: {
        enabled: false,
        projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME,
        reasonCode: 'langsmith-disabled',
        message: fixtureMode.message,
      },
    }
  }

  const traceSupport = await getChatBridgeManualSmokeTraceSupport()
  if (!traceSupport.enabled) {
    return {
      status: 'unsupported',
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
