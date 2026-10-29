import type { SessionTextTokenRead, SessionTextTokenResult } from '../../ports/session-text-tokens'
import type { Message } from '../../types/session'
import { getSessionMessageTokenizationText } from './message-derived-data'

export function withoutEstimatedTextTokens(message: Message): Message {
  const {
    tokenCountMap: _counts,
    tokenCalculatedAt: _clocks,
    tokenCountApproximate: _approximate,
    ...content
  } = message
  return content
}

export function mergeSessionTextTokenResults(
  read: SessionTextTokenRead,
  incoming: readonly SessionTextTokenResult[]
): SessionTextTokenRead {
  const results = new Map<string, SessionTextTokenResult>()
  for (const result of [...read.results, ...incoming]) {
    const source = read.sources[result.source.messageId]
    if (
      !source ||
      source.sessionId !== result.source.sessionId ||
      source.payloadId !== result.source.payloadId ||
      source.calculationVersion !== result.source.calculationVersion ||
      source.textDigest !== result.source.textDigest
    )
      continue
    const key = `${source.messageId}:${result.value.tokenizerType}`
    if (result.value.calculatedAt >= (results.get(key)?.value.calculatedAt ?? 0)) results.set(key, result)
  }
  return { ...read, results: [...results.values()] }
}

export function restoreMessageTextTokens(message: Message, original: Message): Message {
  const content = withoutEstimatedTextTokens(message)
  if (
    message.contentParts !== original.contentParts &&
    getSessionMessageTokenizationText(message) !== getSessionMessageTokenizationText(original)
  )
    return content
  const restored = {
    ...content,
    tokenCountMap: original.tokenCountMap,
    tokenCalculatedAt: original.tokenCalculatedAt,
    tokenCountApproximate: original.tokenCountApproximate,
  }
  const keys = Object.keys({ ...original, ...restored }) as (keyof Message)[]
  return keys.every((key) => restored[key] === original[key]) ? original : restored
}
