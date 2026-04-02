import { Client, RunTree } from 'langsmith'
import { ipcMain } from 'electron'
import {
  createNoopLangSmithAdapter,
  sanitizeLangSmithRecord,
  type LangSmithAdapter,
  type LangSmithRunEndInput,
  type LangSmithRunHandle,
  type LangSmithRunStartInput,
  type LangSmithRunType,
} from '../../shared/utils/langsmith_adapter'
import { CHATBRIDGE_LANGSMITH_PROJECT_NAME } from '../../shared/models/tracing'

type LangSmithRunTreeLike = {
  postRun(): Promise<void>
  end(
    outputs?: Record<string, unknown>,
    error?: string,
    endTime?: number,
    metadata?: Record<string, unknown>
  ): Promise<void>
  patchRun(options?: { excludeInputs?: boolean }): Promise<void>
}

type CreateMainLangSmithAdapterOptions = {
  tracingEnabled?: boolean
  apiKey?: string
  apiUrl?: string
  workspaceId?: string
  projectName?: string
  createId?: () => string
  createRunTree?: (config: ConstructorParameters<typeof RunTree>[0]) => LangSmithRunTreeLike
}

type MainLangSmithStatus = {
  enabled: boolean
  projectName: string
  reason: 'enabled' | 'missing-api-key' | 'tracing-disabled'
}

type MainLangSmithAdapter = LangSmithAdapter & {
  endRun(runId: string, result?: LangSmithRunEndInput): Promise<void>
  getStatus(): MainLangSmithStatus
}

function resolveProjectName(projectName?: string) {
  return projectName ?? process.env.LANGSMITH_PROJECT ?? CHATBRIDGE_LANGSMITH_PROJECT_NAME
}

function resolveTracingStatus(options: CreateMainLangSmithAdapterOptions): MainLangSmithStatus {
  const projectName = resolveProjectName(options.projectName)

  if (typeof options.tracingEnabled === 'boolean') {
    return {
      enabled: options.tracingEnabled,
      projectName,
      reason: options.tracingEnabled ? 'enabled' : 'tracing-disabled',
    }
  }

  if (process.env.NODE_ENV === 'test' && process.env.LANGSMITH_TRACING !== 'true') {
    return {
      enabled: false,
      projectName,
      reason: 'tracing-disabled',
    }
  }

  if (!Boolean(options.apiKey ?? process.env.LANGSMITH_API_KEY)) {
    return {
      enabled: false,
      projectName,
      reason: 'missing-api-key',
    }
  }

  if (process.env.LANGSMITH_TRACING === 'false') {
    return {
      enabled: false,
      projectName,
      reason: 'tracing-disabled',
    }
  }

  return {
    enabled: true,
    projectName,
    reason: 'enabled',
  }
}

function createLangSmithClient(options: CreateMainLangSmithAdapterOptions) {
  return new Client({
    apiKey: options.apiKey ?? process.env.LANGSMITH_API_KEY,
    apiUrl: options.apiUrl ?? process.env.LANGSMITH_ENDPOINT,
    workspaceId: options.workspaceId ?? process.env.LANGSMITH_WORKSPACE_ID,
    autoBatchTracing: true,
    tracingSamplingRate: 1,
  })
}

function buildRunConfig(
  input: LangSmithRunStartInput,
  options: CreateMainLangSmithAdapterOptions,
  client: Client,
  createId: () => string,
  activeRuns: Map<string, LangSmithRunTreeLike>
) {
  const runId = createId()
  const parentRun = input.parentRunId ? activeRuns.get(input.parentRunId) : undefined

  return {
    id: runId,
    name: input.name,
    run_type: (input.runType ?? 'chain') as LangSmithRunType,
    project_name: input.projectName ?? resolveProjectName(options.projectName),
    client,
    inputs: sanitizeLangSmithRecord(input.inputs),
    metadata: sanitizeLangSmithRecord(input.metadata),
    tags: input.tags,
    ...(parentRun ? { parent_run: parentRun as never } : input.parentRunId ? { parent_run_id: input.parentRunId } : {}),
  } as ConstructorParameters<typeof RunTree>[0]
}

export function createMainLangSmithAdapter(options: CreateMainLangSmithAdapterOptions = {}): MainLangSmithAdapter {
  const status = resolveTracingStatus(options)

  if (!status.enabled) {
    const noop = createNoopLangSmithAdapter()
    return {
      ...noop,
      async endRun(_runId, _result) {},
      getStatus() {
        return status
      },
    }
  }

  const client = createLangSmithClient(options)
  const createRunTree =
    options.createRunTree ?? ((config: ConstructorParameters<typeof RunTree>[0]) => new RunTree(config))
  const createId = options.createId ?? (() => crypto.randomUUID())
  const activeRuns = new Map<string, LangSmithRunTreeLike>()

  async function endRun(runId: string, result: LangSmithRunEndInput = {}) {
    const run = activeRuns.get(runId)
    if (!run) {
      return
    }

    await run.end(
      sanitizeLangSmithRecord(result.outputs),
      result.error,
      undefined,
      sanitizeLangSmithRecord(result.metadata)
    )
    await run.patchRun()
    activeRuns.delete(runId)
  }

  const adapter: MainLangSmithAdapter = {
    enabled: status.enabled,
    async startRun(input): Promise<LangSmithRunHandle> {
      const config = buildRunConfig(input, options, client, createId, activeRuns)
      const runTree = createRunTree(config)
      activeRuns.set(config.id!, runTree)
      await runTree.postRun()

      return {
        runId: config.id!,
        async end(result) {
          await endRun(config.id!, result)
        },
      }
    },
    async endRun(runId, result) {
      await endRun(runId, result)
    },
    async recordEvent(input) {
      const run = await this.startRun(input)
      await run.end({
        outputs: input.outputs,
        error: input.error,
        metadata: input.metadata,
      })
    },
    getStatus() {
      return status
    },
  }

  return adapter
}

export const langsmith = createMainLangSmithAdapter()

export function registerLangSmithIpcHandlers(adapter: MainLangSmithAdapter = langsmith) {
  ipcMain.handle('langsmith:get-status', async () => adapter.getStatus())

  ipcMain.handle('langsmith:start-run', async (_event, input: LangSmithRunStartInput) => {
    const run = await adapter.startRun(input)
    return {
      runId: run.runId,
    }
  })

  ipcMain.handle('langsmith:end-run', async (_event, payload: { runId: string; result?: LangSmithRunEndInput }) => {
    await adapter.endRun(payload.runId, payload.result)
    return true
  })

  ipcMain.handle('langsmith:record-event', async (_event, input: LangSmithRunStartInput & LangSmithRunEndInput) => {
    await adapter.recordEvent(input)
    return true
  })
}
