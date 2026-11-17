/**
 * Utility functions for Guide Session
 */

import { settingsStore } from '@/stores/settingsStore'
import type { GuideToolPart } from './types'

interface ShouldGuideEnterCompletedInput {
  onboardingCompleted: boolean
  isLoggedIn: boolean
  hasValidConfig: boolean
}

/**
 * Check if user has valid configuration (license or provider)
 */
export function checkHasValidConfig(): boolean {
  const settings = settingsStore.getState()

  // Has valid license (same check as needEditSetting in settingActions.ts)
  if (settings.licenseKey) {
    return true
  }

  // Has any provider with API key configured
  if (settings.providers && Object.keys(settings.providers).length > 0) {
    const providers = settings.providers
    const keys = Object.keys(providers)

    // Any provider with API key
    if (keys.some((key) => !!providers[key].apiKey)) {
      return true
    }

    // Ollama / LMStudio / custom provider with at least one model
    if (
      keys.some(
        (key) =>
          (key === 'Ollama' || key === 'LM Studio' || key.startsWith('custom-provider')) &&
          providers[key].models?.length
      )
    ) {
      return true
    }
  }

  return false
}

/**
 * Determine whether guide should directly enter completed state.
 */
export function shouldGuideEnterCompleted(input: ShouldGuideEnterCompletedInput): boolean {
  return input.onboardingCompleted || input.isLoggedIn || input.hasValidConfig
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `guide-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createImportConversationsToolPart(toolCallId: string, allowSkip: boolean): GuideToolPart {
  return {
    type: 'tool-show_import_conversations',
    toolCallId,
    toolName: 'show_import_conversations',
    state: 'result',
    result: { allowSkip },
  }
}

/**
 * Check if guide language is fully ready before rendering fixed onboarding text.
 * We need both settings hydration and i18n runtime language switch to be complete.
 */
export function isGuideLanguageReady(
  languageInited: boolean | undefined,
  settingsLanguage: string,
  i18nLanguage: string
): boolean {
  return Boolean(languageInited) && settingsLanguage === i18nLanguage
}

/**
 * Create a tool part for rendering the suggested questions list in guide UI.
 */
export function createSuggestedQuestionsToolPart(toolCallId: string): GuideToolPart {
  return {
    type: 'tool-show_suggested_questions',
    toolCallId,
    toolName: 'show_suggested_questions',
    state: 'result',
    result: { displayed: true },
  }
}

/**
 * Create a tool part for rendering the New Chat CTA in guide UI.
 */
export function createNewChatButtonToolPart(toolCallId: string, options?: { label?: string }): GuideToolPart {
  return {
    type: 'tool-show_new_chat_button',
    toolCallId,
    toolName: 'show_new_chat_button',
    state: 'result',
    result: {
      displayed: true,
      ...(options?.label ? { label: options.label } : {}),
    },
  }
}

/**
 * Create a tool part for rendering the automatic transition into a normal chat.
 */
export function createAutoNewChatLoadingToolPart(
  toolCallId: string,
  options?: { waitForWindowFocusBeforeAutoNavigate?: boolean }
): GuideToolPart {
  return {
    type: 'tool-show_auto_new_chat_loading',
    toolCallId,
    toolName: 'show_auto_new_chat_loading',
    state: 'result',
    result: {
      displayed: true,
      ...(options?.waitForWindowFocusBeforeAutoNavigate ? { waitForWindowFocusBeforeAutoNavigate: true } : {}),
    },
  }
}
