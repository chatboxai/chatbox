import type { AgentModeEntry } from '@shared/types'
import { describe, expect, test, vi } from 'vitest'

const platformMock = vi.hoisted(() => ({ type: 'desktop' as string, isDesktopLike: true }))
vi.mock('@/platform', () => ({ default: platformMock }))

import { getAgentModeUIState } from './agentModeState'

function createEntry(value: AgentModeEntry['value']): AgentModeEntry {
  return { value, locked: false, lockReason: null }
}

describe('getAgentModeUIState', () => {
  test('shows auto mode as chat mode but keeps capabilities disabled on desktop', () => {
    platformMock.type = 'desktop'
    expect(getAgentModeUIState(createEntry('auto'), true)).toEqual({
      displayValue: 'off',
      isActive: false,
      capabilitiesDisabled: true,
      modelUnsupported: false,
    })
  })

  test('treats on mode as active and fully enabled on desktop', () => {
    platformMock.type = 'desktop'
    expect(getAgentModeUIState(createEntry('on'), true)).toEqual({
      displayValue: 'on',
      isActive: true,
      capabilitiesDisabled: false,
      modelUnsupported: false,
    })
  })

  test('treats unsupported auto mode as effectively off and inactive', () => {
    platformMock.type = 'desktop'
    expect(getAgentModeUIState(createEntry('auto'), false)).toEqual({
      displayValue: 'off',
      isActive: false,
      capabilitiesDisabled: true,
      modelUnsupported: true,
    })
  })

  test('treats unsupported on mode as effectively off and inactive', () => {
    platformMock.type = 'desktop'
    expect(getAgentModeUIState(createEntry('on'), false)).toEqual({
      displayValue: 'off',
      isActive: false,
      capabilitiesDisabled: true,
      modelUnsupported: true,
    })
  })

  test('keeps explicit off inactive', () => {
    platformMock.type = 'desktop'
    expect(getAgentModeUIState(createEntry('off'), true)).toEqual({
      displayValue: 'off',
      isActive: false,
      capabilitiesDisabled: true,
      modelUnsupported: false,
    })
  })

  test('treats HarmonyOS as an Electron-backed platform', () => {
    platformMock.type = 'harmony'
    platformMock.isDesktopLike = true
    expect(getAgentModeUIState(createEntry('on'), true)).toEqual({
      displayValue: 'on',
      isActive: true,
      capabilitiesDisabled: false,
      modelUnsupported: false,
    })
  })

  test('enables selected work mode on mobile with a capable model', () => {
    platformMock.type = 'mobile'
    platformMock.isDesktopLike = false
    expect(getAgentModeUIState(createEntry('on'), true)).toEqual({
      displayValue: 'on',
      isActive: true,
      capabilitiesDisabled: false,
      modelUnsupported: false,
    })
  })

  test('forces off and inactive on web even when agent mode is on', () => {
    platformMock.type = 'web'
    platformMock.isDesktopLike = false
    expect(getAgentModeUIState(createEntry('on'), true)).toEqual({
      displayValue: 'off',
      isActive: false,
      capabilitiesDisabled: true,
      modelUnsupported: false,
    })
  })
})
