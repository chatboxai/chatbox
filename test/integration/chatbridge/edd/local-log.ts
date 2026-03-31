import fs from 'node:fs/promises'
import path from 'node:path'

export interface ChatBridgeEvalEvent {
  type: string
  at: string
  data?: Record<string, unknown>
}

export interface ChatBridgeEvalRecord {
  scenarioId: string
  storyIds: string[]
  startedAt: string
  finishedAt: string
  metadata?: Record<string, unknown>
  outputs?: Record<string, unknown>
  error?: string
  events: ChatBridgeEvalEvent[]
}

const OUTPUT_DIR = path.resolve(process.cwd(), 'test/output/chatbridge-edd')

function normalizeFileSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function writeChatBridgeEvalRecord(record: ChatBridgeEvalRecord) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const fileName = `${normalizeFileSegment(record.scenarioId)}-${Date.now()}.json`
  const outputPath = path.join(OUTPUT_DIR, fileName)

  await fs.writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

  return outputPath
}
