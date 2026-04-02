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

type LangSmithRunTreeLike = {
  postRun(): Promise<void>
  end(outputs?: Record<string, unknown>, error?: string, endTime?: number, metadata?: Record<string, unknown>): Promise<void>
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

type MainLangSmithAdapter = LangSmithAdapter & {
  endRun(runId: string, result?: LangSmithRunEndInput): Promise<void>
}

function resolveTracingEnabled(options: CreateMainLangSmithAdapterOptions) {
  if (typeof options.tracingEnabled === 'boolean') {
    return options.tracingEnabled
  }

  if (process.env.NODE_ENV === 'test' && process.env.LANGSMITH_TRACING !== 'true') {
    return false
  }

  return Boolean(options.apiKey ?? process.env.LANGSMITH_API_KEY) && process.env.LANGSMITH_TRACING !== 'false'
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
    project_name: input.projectName ?? options.projectName ?? process.env.LANGSMITH_PROJECT ?? 'chatbox-chatbridge',
    client,
    inputs: sanitizeLangSmithRecord(input.inputs),
    metadata: sanitizeLangSmithRecord(input.metadata),
    tags: input.tags,
    ...(parentRun ? { parent_run: parentRun as never } : input.parentRunId ? { parent_run_id: input.parentRunId } : {}),
  } as ConstructorParameters<typeof RunTree>[0]
}

export function createMainLangSmithAdapter(options: CreateMainLangSmithAdapterOptions = {}): MainLangSmithAdapter {
  const enabled = resolveTracingEnabled(options)
  if (!enabled) {
    const noop = createNoopLangSmithAdapter()
    return {
      ...noop,
      async endRun(_runId, _result) {},
    }
  }

  const client = createLangSmithClient(options)
  const createRunTree = options.createRunTree ?? ((config: ConstructorParameters<typeof RunTree>[0]) => new RunTree(config))
  const createId = options.createId ?? (() => crypto.randomUUID())
  const activeRuns = new Map<string, LangSmithRunTreeLike>()

  async function endRun(runId: string, result: LangSmithRunEndInput = {}) {
    const run = activeRuns.get(runId)
    if (!run) {
      return
    }

    await run.end(sanitizeLangSmithRecord(result.outputs), result.error, undefined, sanitizeLangSmithRecord(result.metadata))
    await run.patchRun()
    activeRuns.delete(runId)
  }

  const adapter: MainLangSmithAdapter = {
    enabled,
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
  }

  return adapter
}

export const langsmith = createMainLangSmithAdapter()

export function registerLangSmithIpcHandlers(adapter: MainLangSmithAdapter = langsmith) {
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
