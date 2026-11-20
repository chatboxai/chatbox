import type { Settings } from '@shared/types'
import { describe, expect, test } from 'vitest'
import { getDefaultEmbeddingModelString, getDefaultRerankModelString, toRagModelString } from './rag-default-models'

function settingsWithFallbacks(overrides: Partial<Settings> = {}): Settings {
  return {
    providers: {},
    customProviders: [],
    theme: 0,
    language: 'en',
    fontSize: 14,
    shortcuts: {
      quickToggle: 'Alt+`',
      inputBoxFocus: 'mod+i',
      inputBoxWebBrowsingMode: 'mod+e',
      newChat: 'mod+n',
      newPictureChat: '',
      sessionListNavNext: 'mod+tab',
      sessionListNavPrev: 'mod+shift+tab',
      sessionListNavTargetIndex: 'mod',
      messageListRefreshContext: 'mod+shift+n',
      dialogOpenSearch: 'mod+k',
      inputBoxSendMessage: 'Enter',
      inputBoxSendMessageWithoutResponse: 'Ctrl+Enter',
      optionNavUp: 'up',
      optionNavDown: 'down',
      optionSelect: 'enter',
    },
    extension: {
      webSearch: {
        provider: 'build-in',
      },
    },
    mcp: {
      servers: [],
      enabledBuiltinServers: [],
    },
    skills: {
      enabledSkillNames: ['chatbox-product-info'],
      translationEnabled: true,
      builtinDefaultsInitialized: true,
    },
    showTokenUsed: true,
    showAvatar: true,
    defaultPrompt: 'You are a helpful assistant.',
    allowReportingAndTracking: true,
    chatboxAIDesktopPromptDismissed: false,
    enableMarkdownRendering: true,
    enableLaTeXRendering: true,
    enableMermaidRendering: true,
    injectDefaultMetadata: true,
    autoPreviewArtifacts: false,
    autoCollapseCodeBlock: true,
    pasteLongTextAsAFile: true,
    autoGenerateTitle: true,
    autoCompaction: true,
    compactionThreshold: 0.6,
    autoLaunch: false,
    autoUpdate: true,
    betaUpdate: false,
    ...overrides,
  } as Settings
}

describe('RAG default model helpers', () => {
  test('formats settings model selection for RAG providers', () => {
    expect(toRagModelString({ provider: 'openai', model: 'text-embedding-3-small' })).toBe(
      'openai:text-embedding-3-small'
    )
  })

  test('returns undefined when no embedding fallback is configured', () => {
    expect(getDefaultEmbeddingModelString(settingsWithFallbacks())).toBeUndefined()
  })

  test('returns default embedding model string when configured', () => {
    expect(
      getDefaultEmbeddingModelString(
        settingsWithFallbacks({
          defaultEmbeddingModel: {
            provider: 'openai',
            model: 'text-embedding-3-small',
          },
        })
      )
    ).toBe('openai:text-embedding-3-small')
  })

  test('returns default rerank model string when configured', () => {
    expect(
      getDefaultRerankModelString(
        settingsWithFallbacks({
          defaultRerankModel: {
            provider: 'cohere',
            model: 'rerank-v3.5',
          },
        })
      )
    ).toBe('cohere:rerank-v3.5')
  })

  test('explicit model wins over default fallback', () => {
    const explicitModel = 'openai:kb-specific-embedding'
    const fallback = getDefaultEmbeddingModelString(
      settingsWithFallbacks({
        defaultEmbeddingModel: {
          provider: 'openai',
          model: 'global-embedding',
        },
      })
    )

    expect(explicitModel || fallback).toBe('openai:kb-specific-embedding')
  })

  test('empty explicit model can fall back to default rerank model', () => {
    const explicitModel = ''
    const fallback = getDefaultRerankModelString(
      settingsWithFallbacks({
        defaultRerankModel: {
          provider: 'cohere',
          model: 'global-rerank',
        },
      })
    )

    expect(explicitModel || fallback).toBe('cohere:global-rerank')
  })
})
