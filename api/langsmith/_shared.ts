import { Client } from 'langsmith'
import { CHATBRIDGE_LANGSMITH_PROJECT_NAME } from '../../src/shared/models/tracing'
import type {
  LangSmithBridgeStartRunResponse,
  LangSmithBridgeStatusPayload,
} from '../../src/shared/utils/langsmith_bridge'
import {
  sanitizeLangSmithRecord,
  type LangSmithRunEndInput,
  type LangSmithRunStartInput,
} from '../../src/shared/utils/langsmith_adapter'

type ServerlessRequest = {
  method?: string
  body?: unknown
}

type ServerlessResponse = {
  setHeader(name: string, value: string): void
  status(code: number): ServerlessResponse
  json(payload: unknown): void
}

function resolveProjectName(projectName?: string) {
  return projectName ?? process.env.LANGSMITH_PROJECT ?? CHATBRIDGE_LANGSMITH_PROJECT_NAME
}

function resolveStatus(projectName?: string): LangSmithBridgeStatusPayload {
  const resolvedProjectName = resolveProjectName(projectName)

  if (process.env.NODE_ENV === 'test' && process.env.LANGSMITH_TRACING !== 'true') {
    return {
      enabled: false,
      projectName: resolvedProjectName,
      reason: 'tracing-disabled',
    }
  }

  if (!process.env.LANGSMITH_API_KEY) {
    return {
      enabled: false,
      projectName: resolvedProjectName,
      reason: 'missing-api-key',
    }
  }

  if (process.env.LANGSMITH_TRACING === 'false') {
    return {
      enabled: false,
      projectName: resolvedProjectName,
      reason: 'tracing-disabled',
    }
  }

  return {
    enabled: true,
    projectName: resolvedProjectName,
    reason: 'enabled',
  }
}

function createLangSmithClient() {
  return new Client({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT,
    workspaceId: process.env.LANGSMITH_WORKSPACE_ID,
    autoBatchTracing: false,
    tracingSamplingRate: 1,
  })
}

function toRunCreate(input: LangSmithRunStartInput, runId: string, projectName: string) {
  const metadata = sanitizeLangSmithRecord(input.metadata)

  return {
    id: runId,
    name: input.name,
    run_type: input.runType ?? 'chain',
    parent_run_id: input.parentRunId,
    project_name: input.projectName ?? projectName,
    inputs: sanitizeLangSmithRecord(input.inputs) ?? {},
    tags: input.tags,
    start_time: Date.now(),
    ...(metadata ? { extra: { metadata } } : {}),
  }
}

function toRunUpdate(result: LangSmithRunEndInput = {}) {
  const metadata = sanitizeLangSmithRecord(result.metadata)

  return {
    end_time: Date.now(),
    outputs: sanitizeLangSmithRecord(result.outputs),
    error: result.error,
    ...(metadata ? { extra: { metadata } } : {}),
  }
}

export function ensurePost(req: ServerlessRequest, res: ServerlessResponse) {
  if (req.method === 'POST') {
    return true
  }

  res.setHeader('Allow', 'POST')
  res.status(405).json({ error: 'Method Not Allowed' })
  return false
}

export function readJsonBody<T>(req: ServerlessRequest): T {
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as T
  }

  return (req.body ?? {}) as T
}

export function writeJson(res: ServerlessResponse, statusCode: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json')
  res.status(statusCode).json(payload)
}

export async function startLangSmithWebRun(input: LangSmithRunStartInput): Promise<LangSmithBridgeStartRunResponse> {
  const status = resolveStatus(input.projectName)
  if (!status.enabled) {
    return {
      ...status,
      runId: null,
    }
  }

  const runId = crypto.randomUUID()
  const client = createLangSmithClient()
  await client.createRun(toRunCreate(input, runId, status.projectName))

  return {
    ...status,
    runId,
  }
}

export async function endLangSmithWebRun(runId: string, result?: LangSmithRunEndInput): Promise<LangSmithBridgeStatusPayload> {
  const status = resolveStatus()
  if (!status.enabled) {
    return status
  }

  const client = createLangSmithClient()
  await client.updateRun(runId, toRunUpdate(result))
  return status
}

export async function recordLangSmithWebEvent(
  input: LangSmithRunStartInput & LangSmithRunEndInput
): Promise<LangSmithBridgeStartRunResponse> {
  const started = await startLangSmithWebRun(input)
  if (!started.enabled || !started.runId) {
    return started
  }

  await endLangSmithWebRun(started.runId, {
    outputs: input.outputs,
    error: input.error,
    metadata: input.metadata,
  })

  return started
}
