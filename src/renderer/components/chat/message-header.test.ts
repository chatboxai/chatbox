import { describe, expect, test } from 'vitest'
import {
  formatMessageTimestamp,
  getMessageHeader,
  getMessageHeaderTitle,
  getSessionAssistantName,
} from './message-header'

const deepseek = {
  aiProvider: 'deepseek',
  aiProviderName: 'DeepSeek',
  model: 'DeepSeek (DS Chat)',
  modelId: 'deepseek-chat',
}
const on = { fallbackLabel: 'Assistant', showModelName: true, showTime: true }

describe('Message header', () => {
  test('names the provider and puts the model id after it', () => {
    expect(getMessageHeader(deepseek, { ...on, showTime: false })).toEqual({
      name: 'DeepSeek',
      meta: { provider: undefined, model: 'deepseek-chat', time: undefined },
      detail: 'deepseek-chat',
    })
  })

  test('names the copilot and puts the provider before the model', () => {
    const header = getMessageHeader({ ...deepseek, timestamp: Date.now() }, { ...on, assistantName: 'Mover' })
    expect(header.name).toBe('Mover')
    expect(header.meta).toMatchObject({ provider: 'DeepSeek', model: 'deepseek-chat' })
    expect(header.detail).toMatch(/^DeepSeek · deepseek-chat · \d{2}:\d{2}$/)
  })

  test('reads replies from before provider names and model ids were recorded', () => {
    expect(getMessageHeader({ model: 'OpenAI (GPT-4o nick)' }, on)).toMatchObject({
      name: 'OpenAI',
      meta: { model: 'GPT-4o nick' },
    })
    expect(getMessageHeader({ model: 'Chatbox AI 4' }, on)).toMatchObject({
      name: 'Chatbox AI 4',
      meta: { model: undefined },
    })
    expect(getMessageHeader({}, on).name).toBe('Assistant')
    expect(
      getMessageHeader({ aiProvider: 'custom-1', modelId: 'm' }, { ...on, lookupProviderName: () => 'Gateway' }).name
    ).toBe('Gateway')
  })

  test('drops only the segments whose settings are off', () => {
    const off = { ...on, showModelName: false, showTime: false }
    expect(getMessageHeader({ ...deepseek, timestamp: Date.now() }, off).meta).toEqual({
      provider: undefined,
      model: undefined,
      time: undefined,
    })
    expect(getMessageHeader(deepseek, { ...off, assistantName: 'Mover' }).meta.provider).toBe('DeepSeek')
  })

  test('hover text puts the name over every detail', () => {
    expect(getMessageHeaderTitle(getMessageHeader(deepseek, { ...on, showModelName: false }))).toBe(
      'DeepSeek\ndeepseek-chat'
    )
    expect(getMessageHeaderTitle(getMessageHeader({}, on))).toBe('Assistant')
  })
})

describe('Session assistant name', () => {
  test('names only chats started from a copilot', () => {
    const copilots = [{ id: 'c1', name: 'Translator' }]
    expect(getSessionAssistantName({}, copilots)).toBeUndefined()
    expect(getSessionAssistantName({ copilotId: 'c1' }, copilots)).toBe('Translator')
  })

  test('prefers the session name over the copilot, and the copilot over the provider', () => {
    const copilots = [{ id: 'c1', name: 'Translator' }]
    const name = (session: { assistantName?: string; copilotId?: string }) =>
      getMessageHeader(deepseek, { ...on, showTime: false, assistantName: getSessionAssistantName(session, copilots) })
    expect(name({ assistantName: ' Mover ', copilotId: 'c1' })).toMatchObject({
      name: 'Mover',
      detail: 'DeepSeek · deepseek-chat',
    })
    expect(name({ assistantName: '  ', copilotId: 'c1' })).toMatchObject({ name: 'Translator' })
    expect(name({})).toMatchObject({ name: 'DeepSeek', detail: 'deepseek-chat' })
  })

  test('never takes the chat title for a copilot without a saved definition', () => {
    // A renamed chat whose copilot was deleted, never saved, or not imported.
    const session = { copilotId: 'missing', name: 'October expenses' }
    expect(getSessionAssistantName(session, [{ id: 'c1', name: 'Translator' }])).toBeUndefined()
    expect(getMessageHeader(deepseek, { ...on, assistantName: getSessionAssistantName(session, []) }).name).toBe(
      'DeepSeek'
    )
  })
})

describe('Message timestamp', () => {
  test('keeps the existing today / this year / older formats', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5).getTime()
    expect(formatMessageTimestamp(today)).toBe('09:05')
    expect(formatMessageTimestamp(new Date(2001, 2, 4, 7, 8).getTime())).toBe('2001-03-04 07:08')
  })
})
