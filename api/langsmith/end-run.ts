import type { LangSmithRunEndInput } from '../../src/shared/utils/langsmith_adapter'
import {
  endLangSmithWebRun,
  ensurePost,
  readJsonBody,
  writeJson,
} from './_shared'

export default async function handler(req: { method?: string; body?: unknown }, res: any) {
  if (!ensurePost(req, res)) {
    return
  }

  try {
    const payload = readJsonBody<{ runId: string; result?: LangSmithRunEndInput }>(req)
    const result = await endLangSmithWebRun(payload.runId, payload.result)
    writeJson(res, 200, result)
  } catch (error) {
    writeJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
