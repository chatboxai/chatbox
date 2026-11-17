import { convertToModelMessages } from '@shared/services/model-message-converter'
import type { CompactionPoint, Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildContext } from './builder'
import { buildCompactionHandoff, getContextHistoryStartNote } from './compaction-handoff'
import {
  CONTEXT_HISTORY_START_MESSAGE_ID,
  getContextProjectionText,
  projectContextMessagesForModel,
} from './model-projection'

function message(id: string, role: Message['role'], text = id, extra: Partial<Message> = {}): Message {
  return { id, role, contentParts: [{ type: 'text', text }], ...extra }
}

const system = message('sys', 'system', 'System')
const summary = message('summary', 'assistant', 'Summary text', {
  isSummary: true,
  tokenCountMap: { default: 3 },
  tokenCalculatedAt: { default: 1 },
})

describe('projectContextMessagesForModel', () => {
  it('merges the summary into the user turn that follows it', () => {
    const user = message('u1', 'user', 'Next question', { tokenCountMap: { default: 2 } })
    const result = projectContextMessagesForModel([system, summary, user])

    expect(result.map((m) => [m.id, m.role])).toEqual([
      ['sys', 'system'],
      ['u1', 'user'],
    ])
    expect(result[1].contentParts).toEqual([
      { type: 'text', text: buildCompactionHandoff('Summary text', 'reference').text },
      { type: 'text', text: 'Next question' },
    ])
    expect(result[1].tokenCountMap).toBeUndefined()
  })

  it('resumes an unfinished run before retained assistant and tool turns', () => {
    const assistant = message('a1', 'assistant', 'partial')
    const tool = message('t1', 'tool', 'result')
    const result = projectContextMessagesForModel([system, summary, assistant, tool])

    expect(result.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(result[1]).toMatchObject({
      id: 'summary',
      role: 'user',
      contentParts: [{ type: 'text', text: buildCompactionHandoff('Summary text', 'resume').text }],
      tokenCountMap: undefined,
      tokenCalculatedAt: undefined,
    })
  })

  it('uses neutral wording when nothing follows the summary', () => {
    const result = projectContextMessagesForModel([system, summary])
    expect(result[1].contentParts[0]).toEqual({
      type: 'text',
      text: buildCompactionHandoff('Summary text', 'reference').text,
    })
  })

  it('opens a truncated window that starts with an assistant turn with a user note', () => {
    const result = projectContextMessagesForModel([system, message('a1', 'assistant'), message('u2', 'user')])

    expect(result.map((m) => [m.id, m.role])).toEqual([
      ['sys', 'system'],
      [CONTEXT_HISTORY_START_MESSAGE_ID, 'user'],
      ['a1', 'assistant'],
      ['u2', 'user'],
    ])
    expect(result[1].contentParts).toEqual([{ type: 'text', text: getContextHistoryStartNote() }])
  })

  it('frames an earlier summary as plain history for a new summary', () => {
    const user = message('u1', 'user', 'Next question')
    const result = projectContextMessagesForModel([summary, user], { purpose: 'summarize' })
    const text = buildCompactionHandoff('Summary text', 'history').text

    expect(result[0].contentParts[0]).toEqual({ type: 'text', text })
    expect(text).not.toMatch(/Continue|respond/i)
  })

  it('follows the session language', () => {
    const result = projectContextMessagesForModel([summary, message('a1', 'assistant')], { language: 'zh-Hans' })
    expect(result[0].contentParts[0]).toEqual({
      type: 'text',
      text: buildCompactionHandoff('Summary text', 'resume', 'zh-Hans').text,
    })
    expect(JSON.stringify(result[0].contentParts)).toMatch(/继续完成尚未完成的任务/)
  })

  it('leaves the stored messages unchanged', () => {
    const user = message('u1', 'user')
    const selection = [system, summary, user]
    const snapshot = structuredClone(selection)
    projectContextMessagesForModel(selection)
    expect(selection).toEqual(snapshot)
  })
})

describe('getContextProjectionText', () => {
  it('returns exactly the wording the projection adds', () => {
    const selection = [summary, message('a1', 'assistant')]
    expect(getContextProjectionText(selection)).toBe(buildCompactionHandoff('', 'resume').instruction)
    expect(getContextProjectionText([message('u1', 'user')])).toBe('')
  })

  it('derives the same wording from row facts alone', () => {
    const selection = [system, message('a0', 'assistant'), summary, message('u1', 'user')]
    const entries = selection.map(({ role, isSummary }) => ({ role, isSummary }))
    const projected = projectContextMessagesForModel(selection, { language: 'ja' })
    const added = projected
      .flatMap((entry) => entry.contentParts)
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')

    const text = getContextProjectionText(entries, { language: 'ja' })
    expect(text).toBe(
      [buildCompactionHandoff('', 'reference', 'ja').instruction, getContextHistoryStartNote('ja')].join('\n\n')
    )
    for (const wording of text.split('\n\n')) expect(added).toContain(wording)
  })
})

describe('model request role order', () => {
  const noImage = async () => null
  const toolCallAssistant = message('a1', 'assistant', 'Working', {
    contentParts: [
      { type: 'text', text: 'Working' },
      { type: 'tool-call', state: 'result', toolCallId: 'call-1', toolName: 'search', args: {}, result: 'found' },
    ],
  })

  async function buildRequest(
    messages: Message[],
    compactionPoints: CompactionPoint[],
    maxContextMessageCount?: number
  ) {
    const context = await buildContext(messages, {
      compactionPoints,
      maxContextMessageCount,
      attachmentResolver: { read: async () => '' },
    })
    const output = await convertToModelMessages(context, noImage)
    return { context, roles: output.map((entry) => entry.role) }
  }

  it('resumes a generation compaction whose tail starts with a tool call', async () => {
    const { context, roles } = await buildRequest(
      [system, message('task', 'user'), message('old', 'assistant'), summary, toolCallAssistant],
      [{ summaryMessageId: 'summary', boundaryMessageId: 'old', createdAt: 1 }]
    )

    expect(roles).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(context[1].contentParts[0]).toEqual({
      type: 'text',
      text: buildCompactionHandoff('Summary text', 'resume').text,
    })
  })

  it('sends a compaction between turns as a single user turn', async () => {
    const { roles } = await buildRequest(
      [system, message('task', 'user'), message('old', 'assistant'), summary, message('next', 'user')],
      [{ summaryMessageId: 'summary', boundaryMessageId: 'old', createdAt: 1 }]
    )

    expect(roles).toEqual(['system', 'user'])
  })

  it('opens a window trimmed to an assistant turn by the message limit with a user turn', async () => {
    const { roles } = await buildRequest(
      [system, message('u1', 'user'), toolCallAssistant, message('u2', 'user')],
      [],
      2
    )

    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'user'])
  })
})
