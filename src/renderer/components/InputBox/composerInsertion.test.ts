import { describe, expect, it } from 'vitest'
import type { ProviderInfo } from '../../../shared/types'
import {
  findProviderModelInfo,
  getUnsupportedFileMessage,
  MAX_LINKS,
  planLinkInsertion,
  resolveModelDisplayText,
} from './composerInsertion'

// Minimal interpolating i18n stub so assertions read against raw keys.
const t = (key: string, options?: Record<string, unknown>) =>
  options?.fileName ? key.replace('{{fileName}}', String(options.fileName)) : key

function provider(overrides: Record<string, unknown>): ProviderInfo {
  return overrides as unknown as ProviderInfo
}

describe('planLinkInsertion', () => {
  it('appends new links and preprocesses them', () => {
    const plan = planLinkInsertion([{ url: 'https://a' }], ['https://b'])
    expect(plan.links).toEqual([{ url: 'https://a' }, { url: 'https://b' }])
    expect(plan.droppedSome).toBe(false)
    expect(plan.urlsToPreprocess).toEqual(['https://b'])
  })

  it('dedups against existing links and within the request', () => {
    const plan = planLinkInsertion([{ url: 'https://a' }], ['https://a', 'https://b', 'https://b'])
    expect(plan.links).toEqual([{ url: 'https://a' }, { url: 'https://b' }])
    expect(plan.droppedSome).toBe(false)
    // Faithful to the original loop: every requested occurrence of a kept url
    // triggers preprocessing, duplicates included.
    expect(plan.urlsToPreprocess).toEqual(['https://a', 'https://b', 'https://b'])
  })

  it('keeps the first MAX_LINKS and drops the extras', () => {
    const existing = Array.from({ length: MAX_LINKS - 1 }, (_, i) => ({ url: `https://e${i}` }))
    const plan = planLinkInsertion(existing, ['https://x', 'https://y'])
    expect(plan.links).toHaveLength(MAX_LINKS)
    expect(plan.links.at(-1)).toEqual({ url: 'https://x' })
    expect(plan.droppedSome).toBe(true)
    // The trimmed url must not be preprocessed.
    expect(plan.urlsToPreprocess).toEqual(['https://x'])
  })

  it('tolerates a null/undefined existing list', () => {
    expect(planLinkInsertion(null, ['https://a']).links).toEqual([{ url: 'https://a' }])
    expect(planLinkInsertion(undefined, []).links).toEqual([])
  })
})

describe('getUnsupportedFileMessage', () => {
  it('maps each known classification to its message', () => {
    expect(getUnsupportedFileMessage('iwork', 'x.pages', t)).toBe(
      'iWork files (Pages, Keynote) are not supported. Please export to PDF or Office format.'
    )
    expect(getUnsupportedFileMessage('audio', 'x.mp3', t)).toBe('Audio files are not supported')
    expect(getUnsupportedFileMessage('video', 'x.mp4', t)).toBe('Video files are not supported')
    expect(getUnsupportedFileMessage('binary', 'x.exe', t)).toBe('Binary/executable files are not supported')
    expect(getUnsupportedFileMessage('archive', 'x.zip', t)).toBe(
      'Archive files are not supported. Please extract and upload individual files.'
    )
    expect(getUnsupportedFileMessage('image', 'x.heic', t)).toBe(
      'Advanced image formats are not supported. Please convert to JPG or PNG.'
    )
  })

  it('falls back to the generic message with the file name for unknown types', () => {
    expect(getUnsupportedFileMessage(null, 'weird.xyz', t)).toBe('Unsupported file type: weird.xyz')
    expect(getUnsupportedFileMessage('something-new', 'a.b', t)).toBe('Unsupported file type: a.b')
  })
})

describe('findProviderModelInfo / resolveModelDisplayText', () => {
  const providers: ProviderInfo[] = [
    provider({ id: 'p1', models: [{ modelId: 'm1', nickname: 'Nick' }, { modelId: 'm2' }] }),
    provider({ id: 'p2', defaultSettings: { models: [{ modelId: 'm3', nickname: 'Default Nick' }] } }),
    provider({
      id: 'p3',
      models: [{ modelId: 'm4', nickname: 'Custom' }],
      defaultSettings: { models: [{ modelId: 'm4', nickname: 'ShouldLose' }] },
    }),
  ]

  it('finds a model in the provider models list', () => {
    expect(findProviderModelInfo(providers, { provider: 'p1', modelId: 'm1' })?.nickname).toBe('Nick')
  })

  it('falls back to defaultSettings models when the provider has none', () => {
    expect(findProviderModelInfo(providers, { provider: 'p2', modelId: 'm3' })?.nickname).toBe('Default Nick')
  })

  it('prefers the configured models list over defaultSettings', () => {
    expect(findProviderModelInfo(providers, { provider: 'p3', modelId: 'm4' })?.nickname).toBe('Custom')
  })

  it('returns undefined for unknown provider or model', () => {
    expect(findProviderModelInfo(providers, { provider: 'nope', modelId: 'm1' })).toBeUndefined()
    expect(findProviderModelInfo(providers, { provider: 'p1', modelId: 'nope' })).toBeUndefined()
  })

  it('resolveModelDisplayText: prompt, nickname, and raw-id fallbacks', () => {
    expect(resolveModelDisplayText(providers, undefined, t)).toBe('Select Model')
    expect(resolveModelDisplayText(providers, { provider: 'p1', modelId: 'm1' }, t)).toBe('Nick')
    expect(resolveModelDisplayText(providers, { provider: 'p1', modelId: 'm2' }, t)).toBe('m2')
    expect(resolveModelDisplayText(providers, { provider: 'gone', modelId: 'raw-id' }, t)).toBe('raw-id')
  })
})
