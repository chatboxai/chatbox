import type { LangSmithRunStartInput } from '../../src/shared/utils/langsmith_adapter'
import {
  ensurePost,
  readJsonBody,
  startLangSmithWebRun,
  writeJson,
} from './_shared'

export default async function handler(req: { method?: string; body?: unknown }, res: any) {
  if (!ensurePost(req, res)) {
    return
  }

  try {
    const payload = readJsonBody<LangSmithRunStartInput>(req)
    const result = await startLangSmithWebRun(payload)
    writeJson(res, 200, result)
  } catch (error) {
    writeJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
