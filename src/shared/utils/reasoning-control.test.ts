import { describe, expect, it } from 'vitest'
import { isDeepSeekReasoningModel } from '../models/utils/deepseek'
import { ModelProviderEnum, type ProviderModelInfo } from '../types'
import {
  getLegacyOpenAICompatibleThinkingType,
  getOpenAIReasoningEffort,
  getReasoningControlCapabilities,
  getReasoningControlLevel,
  getReasoningControlOptions,
  getReasoningProviderOptions,
  isClaudeAdaptiveThinkingModel,
  isOpenAIReasoningEffortSupported,
  normalizeClaudeReasoningOptions,
  normalizeOpenAIReasoningOptions,
  resolveReasoningProviderOptions,
  resolveReasoningReplayPolicy,
  setReasoningProviderOptionsForModel,
  shouldDisableClaudeThinkingForUnsignedResume,
  shouldPreserveDeepSeekReasoning,
  stripReasoningProviderOptions,
  usesClaudeEffortControl,
} from './reasoning-control'

const model = (modelId: string, apiStyle?: ProviderModelInfo['apiStyle']): ProviderModelInfo => ({
  modelId,
  apiStyle,
})

describe('reasoning-control', () => {
  it('maps Claude levels to thinking token budgets', () => {
    const options = getReasoningProviderOptions(ModelProviderEnum.Claude, model('claude-sonnet-4-5'), 'medium')

    expect(options?.claude?.thinking).toEqual({ type: 'enabled', budgetTokens: 4096 })
    expect(getReasoningControlLevel(ModelProviderEnum.Claude, model('claude-sonnet-4-5'), options)).toBe('medium')
  })

  it('maps GPT reasoning models to reasoning effort', () => {
    const options = getReasoningProviderOptions(ModelProviderEnum.OpenAIResponses, model('gpt-5.1'), 'high')

    expect(options?.openai).toEqual({
      reasoningEffort: 'high',
      reasoningSummary: 'auto',
      include: ['reasoning.encrypted_content'],
      forceReasoning: true,
    })
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAIResponses, model('gpt-5.1')).supported).toBe(true)
  })

  it('writes Responses reasoning options for Copilot GPT-5.6 Luna once apiStyle is routed', () => {
    const luna = model('gpt-5.6-luna', 'openai-responses')
    luna.capabilities = ['reasoning']

    const options = getReasoningProviderOptions('github-copilot', luna, 'high')

    expect(options?.openai).toEqual({
      reasoningEffort: 'high',
      reasoningSummary: 'auto',
      include: ['reasoning.encrypted_content'],
      forceReasoning: true,
    })
  })

  it('does not offer reasoning controls for non-reasoning GPT-5 chat models', () => {
    const openaiCapabilities = getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('gpt-5-chat-latest'))
    expect(openaiCapabilities.supported).toBe(false)
    expect(openaiCapabilities.disabledReason).toBeUndefined()
    expect(getReasoningControlCapabilities(ModelProviderEnum.ChatboxAI, model('gpt-5-chat', 'openai')).supported).toBe(
      false
    )
    expect(getReasoningControlCapabilities('my-openai-proxy', model('openai/gpt-5-chat', 'openai')).supported).toBe(
      false
    )
    // Versioned chat variants ship in the registry too (gpt-5.1-chat, gpt-5.2-chat-latest).
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('gpt-5.1-chat-latest')).supported).toBe(
      false
    )
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('gpt-5.2-chat')).supported).toBe(false)
    expect(
      getReasoningControlCapabilities(ModelProviderEnum.ChatboxAI, model('gpt-5.2-chat', 'openai')).supported
    ).toBe(false)
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenRouter, model('openai/gpt-5.1-chat')).supported).toBe(
      false
    )
    // Real GPT-5 reasoning models keep effort controls.
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('gpt-5.5')).supported).toBe(true)
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('gpt-5-mini')).supported).toBe(true)
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('gpt-5')).supported).toBe(true)
  })

  it('maps Gemini budget and level models differently', () => {
    const budgetOptions = getReasoningProviderOptions(ModelProviderEnum.Gemini, model('gemini-2.5-flash'), 'low')
    const levelOptions = getReasoningProviderOptions(ModelProviderEnum.Gemini, model('gemini-3-pro-preview'), 'high')

    expect(budgetOptions?.google?.thinkingConfig).toEqual({ thinkingBudget: 1024, includeThoughts: true })
    expect(levelOptions?.google?.thinkingConfig).toEqual({ thinkingLevel: 'high', includeThoughts: true })
  })

  it('does not offer thinking controls for Gemini image generation models', () => {
    expect(getReasoningControlCapabilities(ModelProviderEnum.Gemini, model('gemini-2.5-flash-image')).supported).toBe(
      false
    )
    expect(
      getReasoningControlCapabilities(ModelProviderEnum.Gemini, model('gemini-3-pro-image-preview')).supported
    ).toBe(false)
    expect(
      getReasoningControlCapabilities(ModelProviderEnum.Gemini, model('gemini-2.5-flash-image')).disabledReason
    ).toBeUndefined()
  })

  it('maps DeepSeek effort levels and Qwen budget reasoning', () => {
    const deepseek = getReasoningProviderOptions(ModelProviderEnum.DeepSeek, model('deepseek-reasoner'), 'low')
    const deepseekV4 = getReasoningProviderOptions(ModelProviderEnum.DeepSeek, model('deepseek-v4-pro'), 'medium')
    const deepseekV32 = getReasoningProviderOptions(ModelProviderEnum.DeepSeek, model('deepseek-v3.2-thinking'), 'high')
    const qwen = getReasoningProviderOptions(ModelProviderEnum.Qwen, model('qwen3.7-max'), 'high')

    expect(deepseek?.deepseek).toEqual({ thinking: { type: 'enabled' } })
    expect(deepseekV4?.deepseek).toEqual({ thinking: { type: 'enabled' }, reasoningEffort: 'high' })
    expect(deepseekV32?.deepseek).toEqual({ thinking: { type: 'enabled' } })
    expect(getReasoningControlLevel(ModelProviderEnum.DeepSeek, model('deepseek-v3.2-thinking'), deepseekV32)).toBe(
      'high'
    )
    expect(qwen?.openaiCompatible).toEqual({ enable_thinking: true, thinking_budget: 8192 })
  })

  it('adapts selectable levels to the model thinking format', () => {
    expect(getReasoningControlOptions(ModelProviderEnum.DeepSeek, model('deepseek-reasoner'))).toEqual([
      { level: 'default', label: 'default' },
      { level: 'off', label: 'off' },
      { level: 'high', label: 'on' },
    ])
    expect(getReasoningControlOptions(ModelProviderEnum.OpenAIResponses, model('gpt-5.5'))).toEqual([
      { level: 'default', label: 'default' },
      { level: 'off', label: 'off' },
      { level: 'low', label: 'low' },
      { level: 'medium', label: 'medium' },
      { level: 'high', label: 'high' },
    ])
  })

  it('omits the off option for models whose thinking cannot be force-disabled', () => {
    // Gemini 2.5 Pro rejects thinkingBudget: 0 (minimum budget is 128).
    expect(getReasoningControlOptions(ModelProviderEnum.Gemini, model('gemini-2.5-pro'))).toEqual([
      { level: 'default', label: 'default' },
      { level: 'low', label: 'low' },
      { level: 'medium', label: 'medium' },
      { level: 'high', label: 'high' },
    ])
    // Claude effort/adaptive models are controlled via the effort param only; an explicit
    // thinking disable never reaches the wire, so no off option is offered.
    expect(getReasoningControlOptions(ModelProviderEnum.Claude, model('claude-opus-4-5'))).toEqual([
      { level: 'default', label: 'default' },
      { level: 'low', label: 'low' },
      { level: 'medium', label: 'medium' },
      { level: 'high', label: 'high' },
    ])
    expect(getReasoningControlOptions(ModelProviderEnum.Claude, model('claude-opus-4-8'))).toEqual([
      { level: 'default', label: 'default' },
      { level: 'low', label: 'low' },
      { level: 'medium', label: 'medium' },
      { level: 'high', label: 'high' },
    ])
    expect(getReasoningControlOptions(ModelProviderEnum.Claude, model('claude-opus-5'))).toEqual([
      { level: 'default', label: 'default' },
      { level: 'low', label: 'low' },
      { level: 'medium', label: 'medium' },
      { level: 'high', label: 'high' },
    ])
    // Budget-style Claude and Gemini Flash keep their explicit off.
    expect(getReasoningControlOptions(ModelProviderEnum.Claude, model('claude-sonnet-4-6'))[1]).toEqual({
      level: 'off',
      label: 'off',
    })
    expect(getReasoningControlOptions(ModelProviderEnum.Gemini, model('gemini-2.5-flash'))[1]).toEqual({
      level: 'off',
      label: 'off',
    })
    // Registry id variants and proxied google apiStyle must also lose the off option.
    for (const id of ['gemini-2.5-pro-preview-06-05', 'models/gemini-2.5-pro']) {
      const levels = getReasoningControlOptions(ModelProviderEnum.Gemini, model(id)).map((o) => o.level)
      expect(levels).not.toContain('off')
    }
    const proxied = getReasoningControlOptions(ModelProviderEnum.ChatboxAI, model('gemini-2.5-pro', 'google'))
    expect(proxied.map((o) => o.level)).not.toContain('off')
  })

  it('reads stale off-style options as default on models without an off option', () => {
    // Old versions offered off for Gemini 2.5 Pro and persisted thinkingBudget: 0;
    // the displayed level must remain one of the offered options.
    const staleGoogle = { google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } }
    const geminiPro = model('gemini-2.5-pro')
    const level = getReasoningControlLevel(ModelProviderEnum.Gemini, geminiPro, staleGoogle)
    expect(level).toBe('default')
    expect(getReasoningControlOptions(ModelProviderEnum.Gemini, geminiPro).map((o) => o.level)).toContain(level)
    // Gemini Flash keeps reading the same options as an explicit off.
    expect(getReasoningControlLevel(ModelProviderEnum.Gemini, model('gemini-2.5-flash'), staleGoogle)).toBe('off')
  })

  it('reads explicit disable options as off across providers', () => {
    expect(
      getReasoningControlLevel(ModelProviderEnum.Qwen, model('qwen3.7-max'), {
        openaiCompatible: { enable_thinking: false },
      })
    ).toBe('off')
    expect(
      getReasoningControlLevel(ModelProviderEnum.DeepSeek, model('deepseek-reasoner'), {
        deepseek: { thinking: { type: 'disabled' } },
      })
    ).toBe('off')
    expect(
      getReasoningControlLevel(ModelProviderEnum.ChatboxAI, model('deepseek-v4-pro', 'openai'), {
        openaiCompatible: { reasoning: { enabled: false } },
      })
    ).toBe('off')
    expect(getReasoningControlLevel(ModelProviderEnum.XAI, model('grok-4.3'), undefined)).toBe('default')
    expect(
      getReasoningControlLevel(ModelProviderEnum.XAI, model('grok-4.3'), {
        openai: { reasoningEffort: 'none', forceReasoning: true },
      })
    ).toBe('off')
  })

  it('drops mismatched-generation Claude options at the request edge', () => {
    // Budget-style thinking persisted under a Sonnet session must not be sent to an
    // adaptive effort model after a model switch (and vice versa).
    expect(
      normalizeClaudeReasoningOptions('claude-opus-4-8', { thinking: { type: 'enabled', budgetTokens: 8192 } })
    ).toBeUndefined()
    expect(normalizeClaudeReasoningOptions('claude-opus-4-5', { effort: 'high' })).toEqual({ effort: 'high' })
    expect(normalizeClaudeReasoningOptions('claude-opus-5', { effort: 'high' })).toEqual({ effort: 'high' })
    expect(
      normalizeClaudeReasoningOptions('claude-opus-4-7', {
        effort: 'low',
        thinking: { type: 'enabled', budgetTokens: 1024 },
      })
    ).toEqual({ effort: 'low' })
    expect(normalizeClaudeReasoningOptions('claude-sonnet-4-6', { effort: 'high' })).toBeUndefined()
    expect(
      normalizeClaudeReasoningOptions('claude-sonnet-4-6', { thinking: { type: 'disabled', budgetTokens: 0 } })
    ).toEqual({ thinking: { type: 'disabled', budgetTokens: 0 } })
    expect(normalizeClaudeReasoningOptions('claude-sonnet-4-6', undefined)).toBeUndefined()
    expect(usesClaudeEffortControl('claude-opus-4-5')).toBe(true)
    expect(usesClaudeEffortControl('claude-opus-4-8')).toBe(true)
    expect(usesClaudeEffortControl('claude-opus-5')).toBe(true)
    expect(usesClaudeEffortControl('claude-sonnet-4-6')).toBe(false)
  })

  it('offers effort controls for OpenAI o-series models without an off option', () => {
    for (const provider of [ModelProviderEnum.OpenAI, ModelProviderEnum.OpenAIResponses, ModelProviderEnum.Azure]) {
      expect(getReasoningControlCapabilities(provider, model('o3'))).toEqual({
        supported: true,
        kind: 'openai-effort',
      })
    }
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('o4-mini')).supported).toBe(true)
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('o1')).supported).toBe(true)
    // o1-preview/o1-mini predate reasoning_effort — the API rejects the parameter, so
    // they must not get effort controls (and no disabledReason: they are simply unsupported).
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('o1-preview'))).toEqual({
      supported: false,
      kind: 'toggle',
    })
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('o1-mini')).supported).toBe(false)
    // o-series only accepts low/medium/high — no minimal/none, so no off option.
    expect(getReasoningControlOptions(ModelProviderEnum.OpenAI, model('o3')).map((o) => o.level)).toEqual([
      'default',
      'low',
      'medium',
      'high',
    ])
    // ChatboxAI / custom providers route o-series by API style.
    expect(getReasoningControlCapabilities(ModelProviderEnum.ChatboxAI, model('o3', 'openai')).kind).toBe(
      'openai-effort'
    )
    expect(getReasoningControlCapabilities('my-openai-proxy', model('o3', 'openai-responses')).supported).toBe(true)
    expect(getReasoningControlCapabilities('acme-llm', model('o3', 'anthropic')).supported).toBe(false)
    // Requesting off falls back to stripping; levels map to plain reasoning effort.
    expect(
      getReasoningProviderOptions(ModelProviderEnum.OpenAI, model('o3'), 'off', {
        openai: { reasoningEffort: 'high' },
      })
    ).toBeUndefined()
    expect(getReasoningProviderOptions(ModelProviderEnum.OpenAI, model('o3'), 'medium')?.openai?.reasoningEffort).toBe(
      'medium'
    )
    // A stale minimal effort reads back as default (off is not representable).
    expect(
      getReasoningControlLevel(ModelProviderEnum.OpenAI, model('o3'), { openai: { reasoningEffort: 'minimal' } })
    ).toBe('default')
    // gpt-4o must not be classified as an o-series reasoning model.
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenAI, model('gpt-4o')).supported).toBe(false)
    // OpenRouter keeps its off state for o-series (reasoning.enabled=false works there),
    // and o1-preview stays reasoning-capable there (OpenRouter maps params per model).
    expect(getReasoningControlOptions(ModelProviderEnum.OpenRouter, model('openai/o3')).map((o) => o.level)).toContain(
      'off'
    )
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenRouter, model('openai/o1-preview')).supported).toBe(
      true
    )
  })

  it('strips reasoning efforts the target OpenAI model rejects at the request edge', () => {
    // Stale GPT-5 off state (minimal/none) carried onto o-series via a model switch.
    expect(normalizeOpenAIReasoningOptions('o3', { reasoningEffort: 'minimal', forceReasoning: true })).toBeUndefined()
    expect(normalizeOpenAIReasoningOptions('o4-mini', { reasoningEffort: 'none' })).toBeUndefined()
    // Valid efforts pass through untouched for o-series and GPT-5 models.
    expect(normalizeOpenAIReasoningOptions('o3', { reasoningEffort: 'medium' })).toEqual({ reasoningEffort: 'medium' })
    expect(normalizeOpenAIReasoningOptions('gpt-5', { reasoningEffort: 'minimal', forceReasoning: true })).toEqual({
      reasoningEffort: 'minimal',
      forceReasoning: true,
    })
    // o1-preview/o1-mini reject the parameter entirely — everything is dropped.
    expect(normalizeOpenAIReasoningOptions('o1-preview', { reasoningEffort: 'medium' })).toBeUndefined()
    expect(normalizeOpenAIReasoningOptions('o1-mini', { reasoningSummary: 'auto' })).toBeUndefined()
    expect(normalizeOpenAIReasoningOptions('o1', { reasoningEffort: 'high' })).toEqual({ reasoningEffort: 'high' })
    expect(normalizeOpenAIReasoningOptions('gpt-5.1', undefined)).toBeUndefined()
    expect(isOpenAIReasoningEffortSupported('o3', 'minimal')).toBe(false)
    expect(isOpenAIReasoningEffortSupported('o3', 'high')).toBe(true)
    expect(isOpenAIReasoningEffortSupported('o1-preview', 'high')).toBe(false)
    expect(isOpenAIReasoningEffortSupported('gpt-5.1', 'none')).toBe(true)
  })

  it('reads legacy session-settings modal budgets back as the originally chosen level', () => {
    // The deleted modal wrote presets 2048/5120/10240 for Gemini; the readback
    // boundaries must map them to Low/Medium/High, same as the new 1024/8192/24576.
    const geminiLevel = (budget: number) =>
      getReasoningControlLevel(ModelProviderEnum.Gemini, model('gemini-2.5-flash'), {
        google: { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } },
      })
    expect(geminiLevel(2048)).toBe('low')
    expect(geminiLevel(5120)).toBe('medium')
    expect(geminiLevel(10240)).toBe('high')
    expect(geminiLevel(1024)).toBe('low')
    expect(geminiLevel(8192)).toBe('medium')
    expect(geminiLevel(24576)).toBe('high')
    // Claude thresholds (1024/4096/8192) already map the legacy presets correctly.
    const claudeLevel = (budget: number) =>
      getReasoningControlLevel(ModelProviderEnum.Claude, model('claude-sonnet-4-6'), {
        claude: { thinking: { type: 'enabled', budgetTokens: budget } },
      })
    expect(claudeLevel(2048)).toBe('low')
    expect(claudeLevel(5120)).toBe('medium')
    expect(claudeLevel(10240)).toBe('high')
  })

  it('sends none-style off effort for all dotted gpt-5.x generations', () => {
    for (const id of ['gpt-5.1', 'gpt-5.2', 'gpt-5.3', 'gpt-5.4', 'gpt-5.5', 'gpt-5.10']) {
      expect(getOpenAIReasoningEffort(id, 'off')).toBe('none')
    }
    expect(getOpenAIReasoningEffort('gpt-5', 'off')).toBe('minimal')
    expect(getOpenAIReasoningEffort('gpt-5-mini', 'off')).toBe('minimal')
  })

  it('treats missing reasoning options as the default level and strips them on selection', () => {
    // No persisted options → default (nothing is sent, the provider default applies).
    expect(getReasoningControlLevel(ModelProviderEnum.OpenAIResponses, model('gpt-5.1'), undefined)).toBe('default')
    expect(getReasoningControlLevel(ModelProviderEnum.Claude, model('claude-sonnet-4-6'), undefined)).toBe('default')
    expect(getReasoningControlLevel(ModelProviderEnum.Claude, model('claude-opus-4-8'), undefined)).toBe('default')
    expect(getReasoningControlLevel(ModelProviderEnum.Gemini, model('gemini-2.5-flash'), undefined)).toBe('default')
    expect(getReasoningControlLevel(ModelProviderEnum.DeepSeek, model('deepseek-reasoner'), undefined)).toBe('default')
    expect(getReasoningControlLevel(ModelProviderEnum.Qwen, model('qwen3.7-max'), undefined)).toBe('default')
    expect(getReasoningControlLevel(ModelProviderEnum.OpenRouter, model('deepseek/deepseek-v4-pro'), undefined)).toBe(
      'default'
    )
    expect(getReasoningControlLevel(ModelProviderEnum.ChatboxAI, model('deepseek-v4-pro', 'openai'), undefined)).toBe(
      'default'
    )

    // Selecting default removes every reasoning namespace but keeps nothing else behind.
    expect(
      getReasoningProviderOptions(ModelProviderEnum.OpenAIResponses, model('gpt-5.1'), 'default', {
        openai: { reasoningEffort: 'high', reasoningSummary: 'auto' },
      })
    ).toBeUndefined()
    expect(
      getReasoningProviderOptions(ModelProviderEnum.Claude, model('claude-sonnet-4-6'), 'default', {
        claude: { thinking: { type: 'enabled', budgetTokens: 4096 } },
      })
    ).toBeUndefined()
    expect(getReasoningProviderOptions(ModelProviderEnum.Gemini, model('gemini-2.5-flash'), 'default')).toBeUndefined()

    // Explicit off states still read back as off, not default.
    expect(
      getReasoningControlLevel(ModelProviderEnum.OpenAIResponses, model('gpt-5.1'), {
        openai: { reasoningEffort: 'none', forceReasoning: true },
      })
    ).toBe('off')
    expect(
      getReasoningControlLevel(ModelProviderEnum.Claude, model('claude-sonnet-4-6'), {
        claude: { thinking: { type: 'disabled', budgetTokens: 0 } },
      })
    ).toBe('off')
  })

  it('maps off to explicit disable or minimum reasoning parameters per provider', () => {
    expect(getReasoningProviderOptions(ModelProviderEnum.Claude, model('claude-sonnet-4-6'), 'off')).toEqual({
      claude: { thinking: { type: 'disabled', budgetTokens: 0 } },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.Claude, model('claude-opus-4-8'), 'off')).toBeUndefined()
    expect(getReasoningProviderOptions(ModelProviderEnum.OpenAIResponses, model('gpt-5.5'), 'off')).toEqual({
      openai: { reasoningEffort: 'none', forceReasoning: true },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.OpenAIResponses, model('gpt-5'), 'off')).toEqual({
      openai: { reasoningEffort: 'minimal', forceReasoning: true },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.Gemini, model('gemini-2.5-flash'), 'off')).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.Gemini, model('gemini-3-pro-preview'), 'off')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'low', includeThoughts: false } },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.Gemini, model('gemini-3-flash-preview'), 'off')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.DeepSeek, model('deepseek-v4-pro'), 'off')).toEqual({
      deepseek: { thinking: { type: 'disabled' } },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.Qwen, model('qwen3.7-max'), 'off')).toEqual({
      openaiCompatible: { enable_thinking: false },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.XAI, model('grok-4.3'), 'off')).toEqual({
      openai: { reasoningEffort: 'none', forceReasoning: true },
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.OpenRouter, model('deepseek/deepseek-v4-pro'), 'off')).toEqual(
      {
        openrouter: { reasoning: { enabled: false, exclude: true } },
      }
    )
    expect(getReasoningProviderOptions(ModelProviderEnum.ChatboxAI, model('deepseek-v4-pro', 'openai'), 'off')).toEqual(
      {
        deepseek: { thinking: { type: 'disabled' } },
      }
    )
  })

  it('keeps native DeepSeek provider enabled even when UI fallback adds openai apiStyle', () => {
    const reasoner = model('deepseek-reasoner', 'openai')
    const v4 = model('deepseek-v4-pro', 'openai')
    const options = getReasoningProviderOptions(ModelProviderEnum.DeepSeek, reasoner, 'high')

    expect(getReasoningControlCapabilities(ModelProviderEnum.DeepSeek, reasoner)).toEqual({
      supported: true,
      kind: 'toggle',
    })
    expect(getReasoningControlCapabilities(ModelProviderEnum.DeepSeek, v4)).toEqual({
      supported: true,
      kind: 'deepseek-effort',
    })
    expect(getReasoningControlOptions(ModelProviderEnum.DeepSeek, v4)).toEqual([
      { level: 'default', label: 'default' },
      { level: 'off', label: 'off' },
      { level: 'low', label: 'low' },
      { level: 'medium', label: 'medium' },
      { level: 'high', label: 'high' },
    ])
    expect(options?.deepseek).toEqual({ thinking: { type: 'enabled' } })
  })

  it.each([
    {
      apiStyle: 'openai' as const,
      low: { deepseek: { thinking: { type: 'enabled' as const }, reasoningEffort: 'low' as const } },
      medium: { deepseek: { thinking: { type: 'enabled' as const }, reasoningEffort: 'high' as const } },
      high: { deepseek: { thinking: { type: 'enabled' as const }, reasoningEffort: 'max' as const } },
      off: { deepseek: { thinking: { type: 'disabled' as const } } },
    },
    {
      apiStyle: 'anthropic' as const,
      low: { claude: { thinking: { type: 'enabled' as const }, effort: 'low' as const } },
      medium: { claude: { thinking: { type: 'enabled' as const }, effort: 'high' as const } },
      high: { claude: { thinking: { type: 'enabled' as const }, effort: 'max' as const } },
      off: { claude: { thinking: { type: 'disabled' as const } } },
    },
    {
      apiStyle: 'openai-responses' as const,
      low: { openai: { reasoningEffort: 'low' as const, forceReasoning: true } },
      medium: { openai: { reasoningEffort: 'high' as const, forceReasoning: true } },
      high: { openai: { reasoningEffort: 'max' as const, forceReasoning: true } },
      off: { openai: { reasoningEffort: 'none' as const, forceReasoning: true } },
    },
  ])('supports ChatboxAI DeepSeek effort through $apiStyle API style', ({ apiStyle, low, medium, high, off }) => {
    const modelInfo: ProviderModelInfo = {
      modelId: 'deepseek-v4-pro',
      apiStyle,
      capabilities: ['tool_use'],
    }

    expect(getReasoningControlCapabilities(ModelProviderEnum.ChatboxAI, modelInfo)).toEqual({
      supported: true,
      kind: 'deepseek-effort',
    })
    expect(getReasoningControlOptions(ModelProviderEnum.ChatboxAI, modelInfo).map((option) => option.level)).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
    ])
    expect(getReasoningProviderOptions(ModelProviderEnum.ChatboxAI, modelInfo, 'low')).toEqual(low)
    expect(getReasoningProviderOptions(ModelProviderEnum.ChatboxAI, modelInfo, 'medium')).toEqual(medium)
    expect(getReasoningProviderOptions(ModelProviderEnum.ChatboxAI, modelInfo, 'high')).toEqual(high)
    expect(getReasoningProviderOptions(ModelProviderEnum.ChatboxAI, modelInfo, 'off')).toEqual(off)
    expect(getReasoningControlLevel(ModelProviderEnum.ChatboxAI, modelInfo, low)).toBe('low')
    expect(getReasoningControlLevel(ModelProviderEnum.ChatboxAI, modelInfo, medium)).toBe('medium')
    expect(getReasoningControlLevel(ModelProviderEnum.ChatboxAI, modelInfo, high)).toBe('high')
    expect(getReasoningControlLevel(ModelProviderEnum.ChatboxAI, modelInfo, off)).toBe('off')
  })

  it('reads missing or invalid V4 effort as default instead of inventing a level', () => {
    const v4 = model('deepseek-v4-pro', 'openai')

    expect(
      getReasoningControlLevel(ModelProviderEnum.ChatboxAI, v4, {
        deepseek: { thinking: { type: 'enabled' } },
      })
    ).toBe('default')
    expect(
      getReasoningControlLevel(ModelProviderEnum.ChatboxAI, v4, {
        deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'medium' },
      })
    ).toBe('default')
  })

  it('keeps older DeepSeek models on toggle controls without sending V4 effort', () => {
    const reasoner = model('deepseek-reasoner', 'anthropic')

    expect(getReasoningControlCapabilities(ModelProviderEnum.ChatboxAI, reasoner)).toEqual({
      supported: true,
      kind: 'toggle',
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.ChatboxAI, reasoner, 'high')).toEqual({
      claude: { thinking: { type: 'enabled' } },
    })
  })

  it('replaces stale ChatboxAI DeepSeek options when the server changes API style', () => {
    const anthropicModel = model('deepseek-v4-pro', 'anthropic')
    const responsesModel = model('deepseek-v4-pro', 'openai-responses')
    const anthropicOptions = getReasoningProviderOptions(ModelProviderEnum.ChatboxAI, anthropicModel, 'low', {
      deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'max' },
    })
    const responsesOptions = getReasoningProviderOptions(
      ModelProviderEnum.ChatboxAI,
      responsesModel,
      'high',
      anthropicOptions
    )

    expect(anthropicOptions).toEqual({
      claude: { thinking: { type: 'enabled' }, effort: 'low' },
    })
    expect(responsesOptions).toEqual({
      openai: { reasoningEffort: 'max', forceReasoning: true },
    })
  })

  it('does not use unreliable capabilities to enable unknown DeepSeek model ids', () => {
    const modelInfo: ProviderModelInfo = {
      modelId: 'deepseek-next-reasoning',
      capabilities: ['reasoning'],
    }

    expect(getReasoningControlCapabilities(ModelProviderEnum.DeepSeek, modelInfo).supported).toBe(false)
  })

  it('maps xAI Grok 4.3 to OpenAI-compatible reasoning effort', () => {
    const offOptions = getReasoningProviderOptions(ModelProviderEnum.XAI, model('grok-4.3'), 'off')
    const lowOptions = getReasoningProviderOptions(ModelProviderEnum.XAI, model('grok-4.3'), 'low')
    const aliasOptions = getReasoningProviderOptions(ModelProviderEnum.XAI, model('grok-4-1-fast'), 'medium')

    expect(offOptions?.openai).toEqual({ reasoningEffort: 'none', forceReasoning: true })
    expect(lowOptions?.openai).toEqual({
      reasoningEffort: 'low',
      include: ['reasoning.encrypted_content'],
      forceReasoning: true,
    })
    expect(aliasOptions?.openai).toEqual({
      reasoningEffort: 'medium',
      include: ['reasoning.encrypted_content'],
      forceReasoning: true,
    })
    expect(getReasoningControlCapabilities(ModelProviderEnum.XAI, model('grok-4')).supported).toBe(true)
    expect(getReasoningControlCapabilities(ModelProviderEnum.XAI, model('grok-4-fast')).supported).toBe(true)
    expect(getReasoningControlCapabilities(ModelProviderEnum.XAI, model('grok-4-1-fast')).supported).toBe(true)
    expect(getReasoningControlCapabilities(ModelProviderEnum.XAI, model('grok-4-1-fast-non-reasoning')).supported).toBe(
      false
    )
  })

  it('keeps generation-specific Claude and OpenAI effort formats', () => {
    const claudeEffort = getReasoningProviderOptions(ModelProviderEnum.Claude, model('claude-opus-4-5'), 'medium')
    const claudeAdaptive = getReasoningProviderOptions(ModelProviderEnum.Claude, model('claude-opus-4-8'), 'high')
    const gpt51Off = getReasoningProviderOptions(ModelProviderEnum.OpenAIResponses, model('gpt-5.1'), 'off')
    const gpt5Off = getReasoningProviderOptions(ModelProviderEnum.OpenAIResponses, model('gpt-5'), 'off')

    expect(claudeEffort?.claude).toEqual({ effort: 'medium' })
    expect(claudeAdaptive?.claude).toEqual({ effort: 'high' })
    expect(gpt51Off?.openai?.reasoningEffort).toBe('none')
    expect(gpt51Off?.openai?.forceReasoning).toBe(true)
    expect(gpt5Off?.openai?.reasoningEffort).toBe('minimal')
    expect(gpt5Off?.openai?.forceReasoning).toBe(true)
  })

  it('uses ChatboxAI apiStyle to select the backend mapping', () => {
    const anthropicOptions = getReasoningProviderOptions(
      ModelProviderEnum.ChatboxAI,
      model('claude-sonnet-4-5', 'anthropic'),
      'low'
    )
    const googleOptions = getReasoningProviderOptions(
      ModelProviderEnum.ChatboxAI,
      model('gemini-2.5-pro', 'google'),
      'medium'
    )

    expect(anthropicOptions?.claude?.thinking?.budgetTokens).toBe(1024)
    expect(googleOptions?.google?.thinkingConfig?.thinkingBudget).toBe(8192)
  })

  it('disables thinking controls when the model id does not match the provider API style', () => {
    const thirdPartyAnthropic = getReasoningControlCapabilities(
      ModelProviderEnum.Custom,
      model('claude-sonnet-4-6', 'anthropic')
    )
    const chatboxClaudeAsOpenAI = getReasoningControlCapabilities(
      ModelProviderEnum.ChatboxAI,
      model('claude-sonnet-4-5', 'openai')
    )
    const chatboxGeminiAsAnthropic = getReasoningControlCapabilities(
      ModelProviderEnum.ChatboxAI,
      model('gemini-2.5-flash', 'anthropic')
    )
    const chatboxDeepSeekAsOpenAI = getReasoningControlCapabilities(
      ModelProviderEnum.ChatboxAI,
      model('deepseek-v4-pro', 'openai')
    )

    expect(thirdPartyAnthropic.supported).toBe(true)
    expect(chatboxClaudeAsOpenAI.supported).toBe(false)
    expect(chatboxClaudeAsOpenAI.disabledReason).toBe('requires-anthropic-api-style')
    expect(chatboxGeminiAsAnthropic.supported).toBe(false)
    expect(chatboxGeminiAsAnthropic.disabledReason).toBe('requires-google-api-style')
    expect(chatboxDeepSeekAsOpenAI.supported).toBe(true)
  })

  it('judges custom providers (arbitrary ids) by API style + model id', () => {
    // A user-created provider has an arbitrary id, not the literal 'custom' enum value.
    // Reasoning support must still resolve via its API style (provider type) + model id.
    const customOpenAIGpt5 = getReasoningControlCapabilities('my-openai-proxy', model('gpt-5.1', 'openai'))
    const customAnthropicClaude = getReasoningControlCapabilities('acme-llm', model('claude-opus-4-8', 'anthropic'))
    const customOpenAIDeepSeek = getReasoningControlCapabilities(
      'my-openai-proxy',
      model('deepseek-reasoner', 'openai')
    )
    const customOpenAIPlainChat = getReasoningControlCapabilities('my-openai-proxy', model('some-chat-model', 'openai'))
    const customAnthropicMismatch = getReasoningControlCapabilities('acme-llm', model('claude-opus-4-8', 'openai'))

    expect(customOpenAIGpt5.supported).toBe(true)
    expect(customOpenAIGpt5.kind).toBe('openai-effort')
    expect(customAnthropicClaude.supported).toBe(true)
    expect(customOpenAIDeepSeek.supported).toBe(true)
    expect(customOpenAIDeepSeek.kind).toBe('toggle')
    // A non-reasoning model on a custom provider stays unsupported (no stale params sent).
    expect(customOpenAIPlainChat.supported).toBe(false)
    // Claude model id behind an OpenAI-style custom endpoint is flagged, like ChatboxAI.
    expect(customAnthropicMismatch.supported).toBe(false)
    expect(customAnthropicMismatch.disabledReason).toBe('requires-anthropic-api-style')
  })

  it('uses OpenRouter reasoning controls for reasoning-capable OpenRouter models', () => {
    const modelInfo: ProviderModelInfo = {
      modelId: 'anthropic/claude-sonnet-4.6',
    }
    const options = getReasoningProviderOptions(ModelProviderEnum.OpenRouter, modelInfo, 'high')

    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenRouter, modelInfo)).toEqual({
      supported: true,
      kind: 'openrouter-reasoning',
    })
    expect(options?.openrouter).toEqual({ reasoning: { effort: 'high', exclude: false } })
    expect(getReasoningControlLevel(ModelProviderEnum.OpenRouter, modelInfo, options)).toBe('high')
  })

  it('uses OpenRouter enabled=false rather than unsupported minimal effort for off state', () => {
    const modelInfo: ProviderModelInfo = {
      modelId: 'deepseek/deepseek-v4-pro',
    }
    const options = getReasoningProviderOptions(ModelProviderEnum.OpenRouter, modelInfo, 'off')

    // Latest DeepSeek V4 routed via OpenRouter must still be detected as reasoning-capable.
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenRouter, modelInfo)).toEqual({
      supported: true,
      kind: 'openrouter-reasoning',
    })
    expect(options?.openrouter).toEqual({ reasoning: { enabled: false, exclude: true } })
    expect(getReasoningControlLevel(ModelProviderEnum.OpenRouter, modelInfo, options)).toBe('off')
  })

  it('reads the selected level only from the current model api style', () => {
    const claudeBudgetModel = model('claude-sonnet-4-6')
    const claudeAdaptiveModel = model('claude-opus-4-8')
    const gptModel = model('gpt-5.5')

    // Options written for a different model format are not interpreted as a level;
    // they read back as the untouched default state.
    expect(
      getReasoningControlLevel(ModelProviderEnum.Claude, claudeBudgetModel, {
        claude: { effort: 'high' },
      })
    ).toBe('default')
    expect(
      getReasoningControlLevel(ModelProviderEnum.Claude, claudeAdaptiveModel, {
        claude: { thinking: { type: 'enabled', budgetTokens: 8192 } },
      })
    ).toBe('default')
    expect(
      getReasoningControlLevel(ModelProviderEnum.OpenAIResponses, gptModel, {
        claude: { thinking: { type: 'enabled', budgetTokens: 8192 } },
      })
    ).toBe('default')
  })

  it('falls back to stripping options when off is requested for effort-style Claude', () => {
    const modelInfo = model('claude-opus-4-8')
    const options = getReasoningProviderOptions(ModelProviderEnum.Claude, modelInfo, 'off', {
      claude: { effort: 'high' },
    })

    expect(options?.claude).toBeUndefined()
    expect(getReasoningControlLevel(ModelProviderEnum.Claude, modelInfo, options)).toBe('default')
  })

  it('falls back to stripping options when off is requested for Gemini 2.5 Pro', () => {
    const modelInfo = model('gemini-2.5-pro')
    const options = getReasoningProviderOptions(ModelProviderEnum.Gemini, modelInfo, 'off', {
      google: { thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } },
    })

    expect(options).toBeUndefined()
    expect(getReasoningControlLevel(ModelProviderEnum.Gemini, modelInfo, options)).toBe('default')
  })

  it('treats Azure like other OpenAI-style providers', () => {
    const gptModel = model('gpt-5.1')
    const onOptions = getReasoningProviderOptions(ModelProviderEnum.Azure, gptModel, 'medium')
    const offOptions = getReasoningProviderOptions(ModelProviderEnum.Azure, gptModel, 'off')

    expect(getReasoningControlCapabilities(ModelProviderEnum.Azure, gptModel)).toEqual({
      supported: true,
      kind: 'openai-effort',
    })
    expect(onOptions?.openai).toEqual({ reasoningEffort: 'medium' })
    expect(offOptions?.openai).toEqual({ reasoningEffort: 'none', forceReasoning: true })
    expect(getReasoningControlLevel(ModelProviderEnum.Azure, gptModel, onOptions)).toBe('medium')
    expect(getReasoningControlLevel(ModelProviderEnum.Azure, gptModel, offOptions)).toBe('off')
  })

  it('interprets legacy openaiCompatible reasoning options as a thinking toggle', () => {
    expect(getLegacyOpenAICompatibleThinkingType(undefined)).toBeUndefined()
    expect(getLegacyOpenAICompatibleThinkingType({})).toBeUndefined()
    expect(getLegacyOpenAICompatibleThinkingType({ enabled: true })).toBe('enabled')
    expect(getLegacyOpenAICompatibleThinkingType({ enabled: false })).toBe('disabled')
    expect(getLegacyOpenAICompatibleThinkingType({ exclude: true })).toBe('disabled')
    expect(getLegacyOpenAICompatibleThinkingType({ enabled: true, exclude: true })).toBe('disabled')
  })

  it('shares model-id matchers between capability detection and providers', () => {
    expect(isDeepSeekReasoningModel('deepseek-reasoner')).toBe(true)
    expect(isDeepSeekReasoningModel('deepseek/deepseek-r1:free')).toBe(true)
    expect(isDeepSeekReasoningModel('deepseek-v3.2-thinking')).toBe(true)
    expect(isDeepSeekReasoningModel('deepseek-chat')).toBe(false)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-7')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-8')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-5')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-5')).toBe(false)
    // Dated ids keep matching; larger version numbers must not false-match.
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-7-20260115')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-5-20260601')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-70')).toBe(false)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-50')).toBe(false)
    expect(usesClaudeEffortControl('claude-opus-4-5-20251101')).toBe(true)
    expect(usesClaudeEffortControl('claude-opus-4-50')).toBe(false)
  })

  it('treats OpenCode Go as a mixed-style gateway for reasoning controls', () => {
    const deepseek = model('deepseek-v4-pro', 'openai')
    const luna = model('gpt-5.6-luna', 'openai-responses')
    const qwen = model('qwen3.8-max', 'anthropic')
    const grok = model('grok-4.5', 'openai-responses')

    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeGo, deepseek)).toEqual({
      supported: true,
      kind: 'deepseek-effort',
    })
    expect(getReasoningProviderOptions(ModelProviderEnum.OpenCodeGo, deepseek, 'off')).toEqual({
      deepseek: { thinking: { type: 'disabled' } },
    })
    expect(shouldPreserveDeepSeekReasoning(ModelProviderEnum.OpenCodeGo, deepseek)).toBe(true)
    expect(shouldPreserveDeepSeekReasoning(ModelProviderEnum.OpenCodeGo, { modelId: 'deepseek-v4-pro' })).toBe(true)

    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeGo, luna)).toEqual({
      supported: true,
      kind: 'openai-effort',
    })
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeGo, qwen)).toEqual({
      supported: false,
      kind: 'toggle',
    })
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeGo, grok)).toEqual({
      supported: false,
      kind: 'toggle',
    })
  })

  it('treats OpenCode Zen as a mixed-style gateway for reasoning controls', () => {
    const deepseek = model('deepseek-v4-pro', 'openai')
    const sol = model('gpt-5.6-sol', 'openai-responses')
    const claude = model('claude-opus-5', 'anthropic')
    const gemini = model('gemini-3.7-flash', 'google')

    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeZen, deepseek)).toEqual({
      supported: true,
      kind: 'deepseek-effort',
    })
    expect(shouldPreserveDeepSeekReasoning(ModelProviderEnum.OpenCodeZen, deepseek)).toBe(true)

    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeZen, sol)).toEqual({
      supported: true,
      kind: 'openai-effort',
    })
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeZen, claude).kind).toBe(
      'anthropic-adaptive-effort'
    )
    expect(getReasoningControlCapabilities(ModelProviderEnum.OpenCodeZen, gemini)).toEqual({
      supported: true,
      kind: 'level',
    })
  })

  describe('stripReasoningProviderOptions', () => {
    it('returns undefined/empty inputs unchanged', () => {
      expect(stripReasoningProviderOptions(undefined)).toBeUndefined()
      expect(stripReasoningProviderOptions({})).toEqual({})
    })

    it('removes all reasoning provider option namespaces', () => {
      expect(
        stripReasoningProviderOptions({
          openai: { reasoningEffort: 'none', forceReasoning: true },
        })
      ).toBeUndefined()
      expect(
        stripReasoningProviderOptions({
          claude: { thinking: { type: 'enabled', budgetTokens: 1024 } },
          google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
          openaiCompatible: { enable_thinking: true },
        })
      ).toBeUndefined()
    })

    it('returns the same reference when there is nothing to strip', () => {
      const input = {}
      expect(stripReasoningProviderOptions(input)).toBe(input)
    })
  })

  describe('per-model reasoning provider options', () => {
    const deepseekOptions = { claude: { thinking: { type: 'enabled' as const }, effort: 'max' as const } }
    const claudeOptions = { claude: { thinking: { type: 'enabled' as const, budgetTokens: 4096 } } }

    it('scopes options to the provider+model they were written for', () => {
      const written = setReasoningProviderOptionsForModel(
        undefined,
        ModelProviderEnum.ChatboxAI,
        'deepseek-v4-pro',
        deepseekOptions
      )

      // The legacy shared field is cleared; the map is the single source of truth.
      expect(written.providerOptions).toBeUndefined()
      expect(written.providerOptionsByModel).toEqual({ 'chatbox-ai:deepseek-v4-pro': deepseekOptions })
      expect(resolveReasoningProviderOptions(written, ModelProviderEnum.ChatboxAI, 'deepseek-v4-pro')).toEqual(
        deepseekOptions
      )
      // A switched model must not inherit another model's parameters.
      expect(
        resolveReasoningProviderOptions(written, ModelProviderEnum.ChatboxAI, 'claude-sonnet-4-20250514')
      ).toBeUndefined()
      expect(resolveReasoningProviderOptions(written, ModelProviderEnum.OpenAI, 'gpt-5.5')).toBeUndefined()
    })

    it('keeps entries of other models and removes an entry on the default level', () => {
      const first = setReasoningProviderOptionsForModel(
        undefined,
        ModelProviderEnum.ChatboxAI,
        'deepseek-v4-pro',
        deepseekOptions
      )
      const second = setReasoningProviderOptionsForModel(
        first,
        ModelProviderEnum.ChatboxAI,
        'claude-sonnet-4-20250514',
        claudeOptions
      )

      expect(second.providerOptionsByModel).toEqual({
        'chatbox-ai:deepseek-v4-pro': deepseekOptions,
        'chatbox-ai:claude-sonnet-4-20250514': claudeOptions,
      })

      const cleared = setReasoningProviderOptionsForModel(
        second,
        ModelProviderEnum.ChatboxAI,
        'deepseek-v4-pro',
        undefined
      )
      expect(cleared.providerOptions).toBeUndefined()
      expect(cleared.providerOptionsByModel).toEqual({ 'chatbox-ai:claude-sonnet-4-20250514': claudeOptions })
      expect(resolveReasoningProviderOptions(cleared, ModelProviderEnum.ChatboxAI, 'deepseek-v4-pro')).toBeUndefined()
    })

    it('never reads the legacy shared field', () => {
      expect(
        resolveReasoningProviderOptions(
          { providerOptions: claudeOptions },
          ModelProviderEnum.Claude,
          'claude-sonnet-4-5'
        )
      ).toBeUndefined()
      expect(
        resolveReasoningProviderOptions(
          { providerOptions: claudeOptions, providerOptionsByModel: {} },
          ModelProviderEnum.Claude,
          'claude-sonnet-4-5'
        )
      ).toBeUndefined()
      expect(resolveReasoningProviderOptions(undefined, ModelProviderEnum.Claude, 'claude-sonnet-4-5')).toBeUndefined()
    })
  })

  describe('request-edge hardening for cross-model DeepSeek values', () => {
    it('drops enabled Claude thinking without budgetTokens on budget-style models', () => {
      // Shape only the DeepSeek-Anthropic writer produces; real Anthropic budget models
      // reject enabled thinking without budget_tokens.
      expect(
        normalizeClaudeReasoningOptions('claude-sonnet-4-20250514', { thinking: { type: 'enabled' }, effort: 'max' })
      ).toBeUndefined()
      expect(
        normalizeClaudeReasoningOptions('claude-sonnet-4-20250514', {
          thinking: { type: 'enabled', budgetTokens: 1024 },
        })
      ).toEqual({ thinking: { type: 'enabled', budgetTokens: 1024 } })
    })

    it('clamps DeepSeek-only Claude effort values on effort-style models', () => {
      expect(normalizeClaudeReasoningOptions('claude-opus-4-5', { effort: 'max' })).toEqual({ effort: 'high' })
      expect(normalizeClaudeReasoningOptions('claude-opus-4-8', { effort: 'xhigh' })).toEqual({ effort: 'high' })
    })

    it('rejects the DeepSeek-only max effort for OpenAI models', () => {
      expect(isOpenAIReasoningEffortSupported('gpt-5.5', 'max')).toBe(false)
      expect(
        normalizeOpenAIReasoningOptions('gpt-5.5', { reasoningEffort: 'max', forceReasoning: true })
      ).toBeUndefined()
    })
  })

  describe('resolveReasoningReplayPolicy', () => {
    it('turns on signed all-turns replay for Anthropic Messages routes only', () => {
      expect(resolveReasoningReplayPolicy(ModelProviderEnum.Claude, model('claude-sonnet-4-5', 'anthropic'))).toEqual({
        preserveReasoning: 'all-turns',
        signedReasoningOnly: true,
      })
      expect(resolveReasoningReplayPolicy('acme-llm', model('claude-opus-4-8', 'anthropic'))).toEqual({
        preserveReasoning: 'all-turns',
        signedReasoningOnly: true,
      })
      // Bedrock speaks the Converse protocol: same apiStyle, different wire format.
      expect(resolveReasoningReplayPolicy(ModelProviderEnum.Bedrock, model('claude-sonnet-4-5', 'anthropic'))).toEqual({
        preserveReasoning: false,
        signedReasoningOnly: false,
      })
      // DeepSeek thinking mode keeps its plain-text all-turns channel.
      expect(resolveReasoningReplayPolicy(ModelProviderEnum.DeepSeek, model('deepseek-reasoner', 'openai'))).toEqual({
        preserveReasoning: 'all-turns',
        signedReasoningOnly: false,
      })
      expect(resolveReasoningReplayPolicy(ModelProviderEnum.OpenAI, model('gpt-5.1', 'openai'))).toEqual({
        preserveReasoning: false,
        signedReasoningOnly: false,
      })
    })
  })

  describe('shouldDisableClaudeThinkingForUnsignedResume', () => {
    const signed = {
      type: 'reasoning' as const,
      text: 'signed plan',
      providerMetadata: { anthropic: { signature: 'sig_1' } },
    }
    const redacted = {
      type: 'reasoning' as const,
      text: '',
      providerMetadata: { anthropic: { redactedData: 'encrypted' } },
      protocolOnly: true as const,
    }
    const unsigned = { type: 'reasoning' as const, text: 'foreign leftover' }
    const tool = (id: string, state: 'result' | 'error' | 'paused' = 'result') => ({
      type: 'tool-call' as const,
      toolCallId: id,
      toolName: 'run_code',
      args: {},
      state,
    })
    it('keeps thinking on when the resumed turn opens with signed thinking', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [signed, tool('t1')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('keeps thinking on for non-interleaved multi-step turns where only the first step is signed', () => {
      // Documented shape: without interleaved thinking, Claude thinks once at
      // the start of the turn; later loop steps ship bare tool_use blocks.
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [signed, tool('t1'), tool('t2')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [signed, tool('t1'), unsigned, tool('t2')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('counts redacted thinking behind skipped protocol-only parts as a valid turn start', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          {
            role: 'assistant',
            contentParts: [{ type: 'text', text: '', protocolOnly: true }, redacted, tool('t1')],
          },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('disables thinking when the resumed turn cannot open with signed thinking', () => {
      // Legacy data: reasoning text persisted without a signature.
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [unsigned, tool('t1')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(true)
      // A turn minted by another provider starts with text or a bare tool call.
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [{ type: 'text', text: 'gpt narration' }, signed, tool('t1')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(true)
    })

    it('never fires on fresh user turns, whatever the earlier history holds', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'user', contentParts: [{ type: 'text', text: 'new question' }] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
      expect(shouldDisableClaudeThinkingForUnsignedResume(undefined, true, 'claude-haiku-4-5')).toBe(false)
    })

    it('requires a completed tool call before treating the tail as a resumed exchange', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [unsigned, tool('t1', 'paused')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('leaves effort/adaptive models untouched: the turn-start rule is manual-mode-only', () => {
      // Adaptive thinking drops the "turn must open with a thinking block"
      // requirement, and effort models never receive manual thinking config,
      // so an unsigned resume is already a valid request for them.
      for (const modelId of ['claude-opus-4-5', 'claude-opus-4-7', 'claude-opus-5']) {
        expect(
          shouldDisableClaudeThinkingForUnsignedResume(
            { role: 'assistant', contentParts: [unsigned, tool('t1')] },
            true,
            modelId
          )
        ).toBe(false)
      }
    })

    it('stays inert outside the signed replay channel', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [unsigned, tool('t1')] },
          false,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })
  })
})
