import { describe, expect, test, vi } from 'vitest'
import type { ChatboxAIModelList } from '@/packages/remote'
import {
  buildChatboxAIGroupViews,
  isChatboxAIModelLocked,
  isChatboxAIProPlan,
  isChatboxAIProTrialActive,
  modelMatchesSearch,
} from './chatboxCatalog'

function createCatalog(plan: string): ChatboxAIModelList {
  return {
    provider: { id: 'chatbox-ai', name: 'Chatbox AI' },
    license: { plan },
    groups: [
      {
        id: 'advanced',
        modelIds: ['chatboxai-4', 'gpt-5.5', 'claude-opus-4.8'],
        featuredModelIds: ['chatboxai-4'],
      },
      {
        id: 'basic',
        modelIds: ['chatboxai-3.5', 'deepseek-v4-pro'],
      },
    ],
    models: {
      'chatboxai-4': {
        modelId: 'chatboxai-4',
        modelName: 'Chatbox AI 4',
        access: { available: true },
        costLevel: '',
        description: '',
      },
      'gpt-5.5': {
        modelId: 'gpt-5.5',
        modelName: 'GPT 5.5',
        access: { available: true },
        costLevel: 'high',
        description: '',
      },
      'claude-opus-4.8': {
        modelId: 'claude-opus-4.8',
        modelName: 'Claude Opus 4.8',
        access: { available: true },
        costLevel: 'high',
        description: '',
      },
      'chatboxai-3.5': {
        modelId: 'chatboxai-3.5',
        modelName: 'Chatbox AI 3.5',
        access: { available: true },
        costLevel: '',
        description: '',
      },
      'deepseek-v4-pro': {
        modelId: 'deepseek-v4-pro',
        modelName: 'DeepSeek V4 Pro',
        access: { available: true },
        costLevel: '',
        description: '',
      },
    },
    imageModels: [],
    links: { modelPricing: 'https://chatboxai.app/en/model-pricing', upgrade: 'https://chatboxai.app/en/#pricing' },
  }
}

describe('chatboxCatalog', () => {
  test('treats only pro and pro_plus as advanced plans', () => {
    expect(isChatboxAIProPlan('free')).toBe(false)
    expect(isChatboxAIProPlan('lite')).toBe(false)
    expect(isChatboxAIProPlan('unknown')).toBe(false)
    expect(isChatboxAIProPlan(undefined)).toBe(false)
    expect(isChatboxAIProPlan('pro')).toBe(true)
    expect(isChatboxAIProPlan('pro_plus')).toBe(true)
  })

  test('locks advanced models for low-tier plans', () => {
    expect(isChatboxAIModelLocked('advanced', { plan: 'free' })).toBe(true)
    expect(isChatboxAIModelLocked('advanced', { plan: 'lite' })).toBe(true)
    expect(isChatboxAIModelLocked('advanced', { plan: 'pro' })).toBe(false)
    expect(isChatboxAIModelLocked('basic', { plan: 'free' })).toBe(false)
  })

  test('unlocks advanced models only during an active Lite Pro trial', () => {
    const now = Date.parse('2026-10-30T00:00:00Z')
    const trial = { canClaim: false, startsAt: '2026-10-28T00:00:00Z', expiresAt: '2026-11-04T00:00:00Z' }
    expect(isChatboxAIProTrialActive({ plan: 'lite', proTrial: trial }, now)).toBe(true)
    expect(isChatboxAIProTrialActive({ plan: 'lite', proTrial: trial }, Date.parse(trial.expiresAt))).toBe(false)
    expect(isChatboxAIProTrialActive({ plan: 'lite', proTrial: { canClaim: true } }, now)).toBe(false)
    // An expired or refunded license reports Free while still returning its old trial dates.
    expect(isChatboxAIProTrialActive({ plan: 'free', proTrial: trial }, now)).toBe(false)
    vi.useFakeTimers({ now })
    try {
      expect(isChatboxAIModelLocked('advanced', { plan: 'lite', proTrial: trial })).toBe(false)
      expect(isChatboxAIModelLocked('advanced', { plan: 'free', proTrial: trial })).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  test('shows featured advanced models by default for low-tier plans', () => {
    const views = buildChatboxAIGroupViews({
      catalog: createCatalog('free'),
      search: '',
      expandedAdvanced: false,
      collapsedGroupIds: new Set(),
    })

    expect(views[0]).toMatchObject({
      id: 'advanced',
      modelIds: ['chatboxai-4'],
      isFeaturedOnly: true,
      isLocked: true,
    })
  })

  test('shows all advanced models when expanded or searching', () => {
    const expanded = buildChatboxAIGroupViews({
      catalog: createCatalog('free'),
      search: '',
      expandedAdvanced: true,
      collapsedGroupIds: new Set(),
    })
    const searched = buildChatboxAIGroupViews({
      catalog: createCatalog('free'),
      search: 'claude',
      expandedAdvanced: false,
      collapsedGroupIds: new Set(),
    })

    expect(expanded[0].modelIds).toEqual(['chatboxai-4', 'gpt-5.5', 'claude-opus-4.8'])
    expect(searched[0].modelIds).toEqual(['claude-opus-4.8'])
  })

  test('collapses groups and preserves total count', () => {
    const views = buildChatboxAIGroupViews({
      catalog: createCatalog('pro'),
      search: '',
      expandedAdvanced: false,
      collapsedGroupIds: new Set(['basic']),
    })

    expect(views[1].modelIds).toEqual([])
    expect(views[1].total).toBe(2)
  })

  test('applies modelFilter to visible models and totals', () => {
    const views = buildChatboxAIGroupViews({
      catalog: createCatalog('pro'),
      search: '',
      expandedAdvanced: false,
      collapsedGroupIds: new Set(),
      modelFilter: (modelId) => modelId !== 'gpt-5.5',
    })

    expect(views[0].modelIds).toEqual(['chatboxai-4', 'claude-opus-4.8'])
    expect(views[0].total).toBe(2)
  })

  test('matches search against provider, model id, and model name', () => {
    const model = { modelId: 'deepseek-v4-pro', modelName: 'DeepSeek V4 Pro' }
    expect(modelMatchesSearch(model, 'chatbox', 'Chatbox AI')).toBe(true)
    expect(modelMatchesSearch(model, 'v4')).toBe(true)
    expect(modelMatchesSearch(model, 'deepseek')).toBe(true)
    expect(modelMatchesSearch(model, 'missing')).toBe(false)
  })
})
