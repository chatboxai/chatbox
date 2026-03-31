import { Client } from 'langsmith'
import { traceable } from 'langsmith/traceable'

export interface ChatBridgeLangSmithConfig {
  enabled: boolean
  project: string | null
  endpoint: string | null
  apiKey: string | null
  workspaceId: string | null
}

type TraceStepOptions = {
  baseMetadata?: Record<string, unknown>
  env?: NodeJS.ProcessEnv
}

function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function isEnabledFlag(value: string | undefined) {
  return value === 'true' || value === '1'
}

export function getChatBridgeLangSmithConfig(
  env: NodeJS.ProcessEnv = process.env
): ChatBridgeLangSmithConfig {
  const project = normalizeEnvValue(env.LANGSMITH_PROJECT ?? env.LANGCHAIN_PROJECT) ?? 'chatbox-chatbridge'
  const endpoint = normalizeEnvValue(env.LANGSMITH_ENDPOINT ?? env.LANGCHAIN_ENDPOINT)
  const apiKey = normalizeEnvValue(env.LANGSMITH_API_KEY ?? env.LANGCHAIN_API_KEY)
  const workspaceId = normalizeEnvValue(env.LANGSMITH_WORKSPACE_ID ?? env.LANGCHAIN_WORKSPACE_ID)
  const tracingEnabled = isEnabledFlag(env.LANGSMITH_TRACING ?? env.LANGCHAIN_TRACING_V2)
  const eddEnabled = env.CHATBRIDGE_EDD_ENABLED !== 'false'
  const testTrackingEnabled = isEnabledFlag(env.LANGSMITH_TEST_TRACKING)

  return {
    enabled: tracingEnabled && eddEnabled && testTrackingEnabled && apiKey !== null && project !== null,
    project,
    endpoint,
    apiKey,
    workspaceId,
  }
}

export function createChatBridgeLangSmithClient(
  env: NodeJS.ProcessEnv = process.env
) {
  const config = getChatBridgeLangSmithConfig(env)

  return new Client({
    apiKey: config.apiKey ?? undefined,
    apiUrl: config.endpoint ?? undefined,
    workspaceId: config.workspaceId ?? undefined,
  })
}

export function createChatBridgeTraceStepRunner(options: TraceStepOptions = {}) {
  const config = getChatBridgeLangSmithConfig(options.env)
  const client = config.enabled ? createChatBridgeLangSmithClient(options.env) : null

  return async function traceStep<T>(
    name: string,
    metadata: Record<string, unknown>,
    fn: () => Promise<T> | T
  ): Promise<T> {
    if (!config.enabled || !client) {
      return await fn()
    }

    const tracedFn = traceable(async () => await fn(), {
      name,
      run_type: 'chain',
      project_name: config.project ?? undefined,
      metadata: {
        ...(options.baseMetadata ?? {}),
        ...metadata,
      },
      client,
    })

    return await tracedFn()
  }
}
