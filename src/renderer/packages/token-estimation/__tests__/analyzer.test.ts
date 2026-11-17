import { describe, expect, it } from 'vitest'
import type { Message } from '@shared/types/session'
import { analyzeCurrentInputTokens } from '../analyzer'

const draft: Message = { id: 'draft', role: 'user', contentParts: [{ type: 'text', text: 'Draft text' }] }
const options = { tokenizerType: 'default' as const, modelSupportToolUseForFile: false }

describe('draft token analysis', () => {
  it('uses the current worker result and never schedules message text writes', () => {
    const result = analyzeCurrentInputTokens({ ...options, constructedMessage: draft, currentInputTextTokens: 17 })
    expect(result.breakdown.text).toBe(17)
    expect(result.pendingTasks).toEqual([])
  })
  it('only requests unresolved attachments belonging to this draft', () => {
    const result = analyzeCurrentInputTokens({
      ...options,
      constructedMessage: {
        ...draft,
        files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'blob:file' }],
      },
    })
    expect(result.pendingTasks).toEqual([
      expect.objectContaining({ type: 'attachment', messageId: 'draft', attachmentId: 'file' }),
    ])
  })
  it('clears draft totals when the composer is empty', () => {
    expect(analyzeCurrentInputTokens({ ...options, constructedMessage: undefined })).toEqual({
      breakdown: { text: 0, attachments: 0, toolCalls: 0 },
      pendingTasks: [],
      hasApproximateText: false,
    })
  })
})
