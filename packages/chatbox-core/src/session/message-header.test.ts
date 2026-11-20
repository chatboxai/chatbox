import { describe, expect, it } from 'vitest'
import {
  getAssistantMessageHeader,
  getAssistantMessageSource,
  getSessionAssistantName,
  parseModelDisplaySnapshot,
} from './message-header'

describe('getSessionAssistantName', () => {
  const copilots = [{ id: 'c1', name: ' Translator ' }]

  it('prefers the session name, then the saved copilot name', () => {
    expect(getSessionAssistantName({ assistantName: ' Mover ', copilotId: 'c1' }, copilots)).toBe('Mover')
    expect(getSessionAssistantName({ assistantName: '  ', copilotId: 'c1' }, copilots)).toBe('Translator')
    expect(getSessionAssistantName({ copilotId: 'missing' }, copilots)).toBeUndefined()
    expect(getSessionAssistantName({}, copilots)).toBeUndefined()
  })
})

describe('parseModelDisplaySnapshot', () => {
  it('splits a "Provider (model)" snapshot', () => {
    expect(parseModelDisplaySnapshot('DeepSeek (deepseek-chat)')).toEqual({
      providerName: 'DeepSeek',
      modelLabel: 'deepseek-chat',
    })
    expect(parseModelDisplaySnapshot('My (EU) Gateway (gpt-4o)')).toEqual({
      providerName: 'My (EU) Gateway',
      modelLabel: 'gpt-4o',
    })
  })

  it('keeps a snapshot without a model part as the name', () => {
    expect(parseModelDisplaySnapshot('Chatbox AI 4')).toEqual({ providerName: 'Chatbox AI 4' })
    expect(parseModelDisplaySnapshot('  ')).toEqual({})
    expect(parseModelDisplaySnapshot(undefined)).toEqual({})
  })
})

describe('getAssistantMessageSource', () => {
  const lookup = (id: string) => ({ deepseek: 'DeepSeek', 'custom-1': 'Renamed Gateway' })[id]

  it('prefers the stored provider name and the raw model id', () => {
    expect(
      getAssistantMessageSource(
        { aiProvider: 'custom-1', aiProviderName: 'Gateway', model: 'Gateway (Nick)', modelId: 'gpt-4o' },
        lookup
      )
    ).toEqual({ providerName: 'Gateway', modelLabel: 'gpt-4o' })
  })

  it('falls back to the display snapshot, which survives a deleted or renamed provider', () => {
    expect(getAssistantMessageSource({ aiProvider: 'custom-1', model: 'Old Gateway (Nick)' }, lookup)).toEqual({
      providerName: 'Old Gateway',
      modelLabel: 'Nick',
    })
    expect(
      getAssistantMessageSource({ aiProvider: 'gone', model: 'Gone (m)', modelId: 'm-1' }, () => undefined)
    ).toEqual({ providerName: 'Gone', modelLabel: 'm-1' })
  })

  it('looks the provider up by id when nothing else names it', () => {
    expect(getAssistantMessageSource({ aiProvider: 'deepseek', modelId: 'deepseek-chat' }, lookup)).toEqual({
      providerName: 'DeepSeek',
      modelLabel: 'deepseek-chat',
    })
    expect(getAssistantMessageSource({})).toEqual({ providerName: undefined, modelLabel: undefined })
  })
})

describe('getAssistantMessageHeader', () => {
  const source = { providerName: 'DeepSeek', modelLabel: 'deepseek-chat' }
  const base = { fallbackLabel: 'Assistant', showModelName: true, time: '13:20', showTime: true }

  it('shows the provider as the name and model · time after it', () => {
    expect(getAssistantMessageHeader(source, base)).toEqual({
      name: 'DeepSeek',
      meta: { provider: undefined, model: 'deepseek-chat', time: '13:20' },
      detail: 'deepseek-chat · 13:20',
    })
  })

  it('shows the copilot as the name and provider · model · time after it', () => {
    expect(getAssistantMessageHeader(source, { ...base, assistantName: ' Mover ' })).toEqual({
      name: 'Mover',
      meta: { provider: 'DeepSeek', model: 'deepseek-chat', time: '13:20' },
      detail: 'DeepSeek · deepseek-chat · 13:20',
    })
  })

  it('drops the model and time segments when their settings are off but keeps them in the detail', () => {
    const off = { ...base, showModelName: false, showTime: false }
    expect(getAssistantMessageHeader(source, off)).toMatchObject({
      name: 'DeepSeek',
      meta: { provider: undefined, model: undefined, time: undefined },
      detail: 'deepseek-chat · 13:20',
    })
    expect(getAssistantMessageHeader(source, { ...off, assistantName: 'Mover' }).meta).toEqual({
      provider: 'DeepSeek',
      model: undefined,
      time: undefined,
    })
  })

  it('names replies without a provider with the fallback label', () => {
    expect(getAssistantMessageHeader({}, { ...base, time: undefined })).toEqual({
      name: 'Assistant',
      meta: { provider: undefined, model: undefined, time: undefined },
      detail: '',
    })
  })
})
