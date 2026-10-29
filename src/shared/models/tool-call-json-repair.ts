import type { LanguageModelV4ToolCall } from '@ai-sdk/provider'
import { parsePartialJson, type ToolCallRepairFunction, type ToolSet } from 'ai'

function stripCodeFence(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : trimmed
}

function extractJsonObject(input: string): string | undefined {
  const start = input.indexOf('{')
  const end = input.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return undefined
  return input.slice(start, end + 1).trim()
}

function removeTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, '$1')
}

function buildRepairCandidates(input: string): string[] {
  const candidates = [input.trim(), stripCodeFence(input), removeTrailingCommas(stripCodeFence(input))]
  const extracted = extractJsonObject(stripCodeFence(input))
  if (extracted) {
    candidates.push(extracted, removeTrailingCommas(extracted))
  }
  return Array.from(new Set(candidates.filter(Boolean)))
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function repairToolCallJsonInput(
  toolCall: LanguageModelV4ToolCall
): Promise<LanguageModelV4ToolCall | null> {
  for (const candidate of buildRepairCandidates(toolCall.input)) {
    const result = await parsePartialJson(candidate)
    if ((result.state === 'successful-parse' || result.state === 'repaired-parse') && isJsonObject(result.value)) {
      return {
        ...toolCall,
        input: JSON.stringify(result.value),
      }
    }
  }
  return null
}

export const repairToolCallJson: ToolCallRepairFunction<ToolSet> = async ({ toolCall, tools }) => {
  const tool = tools[toolCall.toolName]
  if (!tool) return null
  const repaired = await repairToolCallJsonInput(toolCall)
  if (!repaired || repaired.input === toolCall.input) return null
  // The SDK validates this candidate again before execution, including after JSON syntax repair.
  return repaired
}
