/**
 * Core hook for managing the Guide Session
 * Handles message state, API communication, and UI interactions
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { cancelConfetti, confetti } from '@/components/Confetti'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import { onboardingStore, useOnboardingStore } from '@/stores/onboardingStore'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { GUIDE_CONFIG } from '../-utils/config'
import { type GuideMessage, sendGuideMessage } from '../-utils/guideApi'
import type {
  GuideMessagePart,
  GuideToolPart,
  GuideUIMessage,
  OnboardingStep,
  UseGuideSessionReturn,
  UserType,
} from './types'
import { parseStreamResponse } from './useStreamParser'
import {
  checkHasValidConfig,
  createAutoNewChatLoadingToolPart,
  createNewChatButtonToolPart,
  createSuggestedQuestionsToolPart,
  generateMessageId,
  isGuideLanguageReady,
  shouldGuideEnterCompleted,
} from './utils'

// Re-export types for consumers
export type { GuideMessagePart, GuideTextPart, GuideToolName, GuideToolPart, GuideUIMessage, UserType } from './types'

/**
 * Creates a delay promise that can be tracked and cancelled.
 * The timeout ID is added to the provided Set and removed when completed.
 */
function createTrackedDelay(ms: number, pendingTimeouts: Set<ReturnType<typeof setTimeout>>): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingTimeouts.delete(timeoutId)
      resolve()
    }, ms)
    pendingTimeouts.add(timeoutId)
  })
}

export function useGuideSession(): UseGuideSessionReturn {
  const { t, i18n } = useTranslation()

  const [messages, setMessages] = useState<GuideUIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasValidConfig, setHasValidConfig] = useState(checkHasValidConfig)
  const [userTypeSelected, setUserTypeSelected] = useState<UserType | null>(null)
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('greeting')
  const [forceSelectionOnce, setForceSelectionOnce] = useState(false)
  const [isAutoRedirectingToNewChat, setIsAutoRedirectingToNewChat] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingUpdateRef = useRef<number | null>(null)
  /** markGuideCompleted body has run once. */
  const completionTriggeredRef = useRef(false)
  /** awaiting-card has been pushed once (idempotency for repeated Claim Free Plan clicks). */
  const claimWaitingShownRef = useRef(false)
  /** celebration message has been pushed once (terminal). */
  const celebrationShownRef = useRef(false)
  const greetingInitializedRef = useRef(false)
  const greetingCancelRef = useRef<(() => void) | null>(null)
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const onboardingCompleted = useOnboardingStore((s) => s.completed)
  const language = useSettingsStore((s) => s.language)
  const languageInited = useSettingsStore((s) => s.languageInited)
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const refreshToken = useAuthInfoStore((s) => s.refreshToken)
  const isLoggedIn = Boolean(accessToken && refreshToken)

  const isLanguageReady = useMemo(
    () => isGuideLanguageReady(languageInited, language, i18n.language),
    [languageInited, language, i18n.language]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current)
        pendingUpdateRef.current = null
      }
      if (greetingCancelRef.current) {
        greetingCancelRef.current()
        greetingCancelRef.current = null
      }
      // Clear all pending timeouts
      for (const timeoutId of pendingTimeoutsRef.current) {
        clearTimeout(timeoutId)
      }
      pendingTimeoutsRef.current.clear()
      // Cancel any active confetti animations
      cancelConfetti()
      // Reset greeting state so it can re-initialize on remount (React Strict Mode)
      greetingInitializedRef.current = false
    }
  }, [])

  // Calculate user message count for abuse prevention
  const userMessageCount = useMemo(() => messages.filter((m) => m.role === 'user').length, [messages])

  // Check if user can send messages (7-round limit for all users)
  const canSendMessage = useMemo(() => {
    return !isAutoRedirectingToNewChat && userMessageCount < GUIDE_CONFIG.maxRounds
  }, [isAutoRedirectingToNewChat, userMessageCount])

  // Check if guide is in progress (has interactions)
  const isGuideInProgress = useMemo(
    () => messages.length > 1 || userTypeSelected !== null,
    [messages, userTypeSelected]
  )

  // Show temporary hint before language is fully initialized/switched.
  useEffect(() => {
    if (!isLanguageReady && messages.length === 0 && !greetingInitializedRef.current) {
      const hint = 'Detecting your language...'
      setMessages([
        {
          id: generateMessageId(),
          role: 'assistant',
          content: hint,
          parts: [{ type: 'text', text: hint }],
        },
      ])
    }
  }, [isLanguageReady, messages.length])

  // Initialize with greeting message when entering the guide
  // biome-ignore lint/correctness/useExhaustiveDependencies: greetingInitializedRef prevents re-execution
  useEffect(() => {
    if (!isLanguageReady || greetingInitializedRef.current) {
      return
    }
    greetingInitializedRef.current = true

    // Check config status first
    const configValid = checkHasValidConfig()
    setHasValidConfig(configValid)

    const enterCompleted =
      !forceSelectionOnce &&
      shouldGuideEnterCompleted({
        onboardingCompleted,
        isLoggedIn,
        hasValidConfig: configValid,
      })

    if (enterCompleted) {
      // User already has valid config, show completion message
      const configCompleteMsg = t(
        "You've already completed the setup and can use Chatbox normally.\n\nIf you have any questions about Chatbox AI, feel free to ask me here."
      )
      setMessages([
        {
          id: generateMessageId(),
          role: 'assistant',
          content: configCompleteMsg,
          parts: [
            { type: 'text', text: configCompleteMsg },
            createNewChatButtonToolPart(`new-chat-btn-${Date.now()}`, {
              label: t('Click here to start a new chat') ?? undefined,
            }),
            createSuggestedQuestionsToolPart(`suggested-${Date.now()}`),
          ],
        },
      ])
      onboardingStore.getState().markCompleted()
      setOnboardingStep('completed')
    } else {
      if (forceSelectionOnce) {
        setForceSelectionOnce(false)
        setHasValidConfig(false)
      }
      // Show initial greeting with cards using fast streaming
      const isChinese = language.startsWith('zh')
      const guideUrl = buildChatboxUrl('/redirect_app/guide')
      const helpCenterUrl = buildChatboxUrl('/redirect_app/help_center')

      const greeting = isChinese
        ? [
            t(`## 👋 Hey! I'm Boxy, your setup guide assistant.

Chatbox is an **all-in-one AI chat client** that supports 30+ mainstream models including ChatGPT, Claude, DeepSeek, and more.

### ✨ Key Features
- 🔐 **Local First** — Your data stays on your device, ensuring privacy and security
- 🎯 **Multi-Model Support** — One app, chat with all AI models
- 📚 **Knowledge Base** — Let AI understand your private documents

### 📖 Get Help
- 🎬 [Xiaohongshu Setup Guide](https://www.xiaohongshu.com/user/profile/67b581b6000000000e01d11f) — Step-by-step tutorial (Recommended)
- 📕 [Product Manual](`),
            guideUrl,
            t(`) — Detailed feature documentation
- 🆘 [Help Center](`),
            helpCenterUrl,
            t(`) — FAQs
- 📮 Contact us: hi@chatboxai.com

💡 Follow Chatbox on [Xiaohongshu](https://www.xiaohongshu.com/user/profile/67b581b6000000000e01d11f) for the latest updates and tips

---

**Now, let me help you get set up!** First, tell me about your AI experience:`),
          ].join('')
        : [
            t(`## 👋 Hey! I'm Boxy, your setup guide assistant.

Chatbox is an **all-in-one AI chat client** that supports 30+ mainstream models including ChatGPT, Claude, DeepSeek, and more.

### ✨ Key Features
- 🔐 **Local First** — Your data stays on your device, ensuring privacy and security
- 🎯 **Multi-Model Support** — One app, chat with all AI models
- 📚 **Knowledge Base** — Let AI understand your private documents

### 📖 Get Help
- 📕 [Product Manual](`),
            guideUrl,
            t(`) — Detailed feature documentation
- 🆘 [Help Center](`),
            helpCenterUrl,
            t(`) — FAQs
- 📮 Contact us: hi@chatboxai.com

---

**Now, let me help you get set up!** First, tell me about your AI experience:`),
          ].join('')

      // Stream greeting with fast speed
      const messageId = generateMessageId()
      const userTypeCardsPart: GuideToolPart = {
        type: 'tool-show_user_type_cards',
        toolCallId: 'initial-cards',
        toolName: 'show_user_type_cards',
        state: 'result',
        result: { displayed: true },
      }

      // Create placeholder message
      setMessages([
        {
          id: messageId,
          role: 'assistant',
          content: '',
          parts: [],
          isStreaming: true,
        },
      ])

      // Stream greeting asynchronously with cancellation support
      let cancelled = false

      void (async () => {
        const words = greeting.split(/(\s+)/)
        let accumulated = ''

        for (let i = 0; i < words.length; i++) {
          if (cancelled) return

          accumulated += words[i]
          const currentText = accumulated

          setMessages([
            {
              id: messageId,
              role: 'assistant',
              content: currentText,
              parts: [{ type: 'text', text: currentText }],
              isStreaming: true,
            },
          ])

          // Fast speed: 5-12ms per word
          await createTrackedDelay(5 + Math.random() * 7, pendingTimeoutsRef.current)
        }

        if (cancelled) return

        // Finalize with tool parts
        setMessages([
          {
            id: messageId,
            role: 'assistant',
            content: greeting,
            parts: [{ type: 'text', text: greeting }, userTypeCardsPart],
            isStreaming: false,
          },
        ])
      })()

      setOnboardingStep('selection') // Waiting for user to select a card

      // Store cancel function in ref for cleanup on unmount
      greetingCancelRef.current = () => {
        cancelled = true
      }
    }
  }, [isLanguageReady, t, resetKey, onboardingCompleted, isLoggedIn, forceSelectionOnce])

  /**
   * Append a fixed message to the conversation (instant, no streaming)
   */
  const appendFixedMessage = useCallback(
    (content: string, toolParts?: GuideToolPart[], role: 'user' | 'assistant' = 'assistant') => {
      const parts: GuideMessagePart[] = [{ type: 'text', text: content }]
      if (toolParts) {
        parts.push(...toolParts)
      }

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role,
          content,
          parts,
        },
      ])
    },
    []
  )

  /**
   * Stream a fixed message to simulate typing effect
   */
  const streamFixedMessage = useCallback(
    async (content: string, toolParts?: GuideToolPart[], options?: { speed?: 'normal' | 'fast' }) => {
      const messageId = generateMessageId()
      const speed = options?.speed ?? 'normal'

      // Create placeholder message with streaming state
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          role: 'assistant',
          content: '',
          parts: [],
          isStreaming: true,
        },
      ])

      // Helper to find and update message by ID (not by position)
      const updateMessageById = (
        updater: (msg: GuideUIMessage) => Partial<GuideUIMessage>
      ): ((prev: GuideUIMessage[]) => GuideUIMessage[]) => {
        return (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId)
          if (idx === -1) return prev
          return [...prev.slice(0, idx), { ...prev[idx], ...updater(prev[idx]) }, ...prev.slice(idx + 1)]
        }
      }

      // Simulate streaming by revealing characters progressively
      const words = content.split(/(\s+)/)
      let accumulated = ''

      // Speed settings: fast (10-25ms) for greeting, normal (30-70ms) for other messages
      const delayBase = speed === 'fast' ? 10 : 30
      const delayRange = speed === 'fast' ? 15 : 40

      for (let i = 0; i < words.length; i++) {
        accumulated += words[i]
        const currentText = accumulated

        setMessages(
          updateMessageById(() => ({
            content: currentText,
            parts: [{ type: 'text', text: currentText }],
          }))
        )

        await createTrackedDelay(delayBase + Math.random() * delayRange, pendingTimeoutsRef.current)
      }

      // Finalize message with tool parts
      const finalParts: GuideMessagePart[] = [{ type: 'text', text: content }]
      if (toolParts) {
        finalParts.push(...toolParts)
      }

      setMessages(
        updateMessageById(() => ({
          content,
          parts: finalParts,
          isStreaming: false,
        }))
      )
    },
    []
  )

  /**
   * Handle user type card selection
   */
  const selectUserType = useCallback(
    async (type: UserType) => {
      setUserTypeSelected(type)

      trackJkClickEvent(JK_EVENTS.ONBOARDING_CHOICE_CLICK, {
        pageName: JK_PAGE_NAMES.HELP_PAGE,
        content: type === 'novice' ? 'new_user' : 'skip_guide',
      })

      // Add user selection as a message (instant)
      const userContent = type === 'novice' ? t("I'm new to this") : t('Skip guide')
      appendFixedMessage(userContent, undefined, 'user')

      // Get the response content
      const responseContent =
        type === 'novice'
          ? t(
              'Great! Chatbox AI is our all-in-one service designed for new users - it works out of the box with no complex setup required.\n\nClick the login button below, then enter your email and verification code in the popup to sign in.'
            )
          : t(
              "Excellent! You're ready to explore.\n\nClick the button below to configure your API directly. If you need help later, just click the **Help** button in the sidebar. Enjoy!"
            )

      // Create appropriate tool parts based on selection
      let toolParts: GuideToolPart[] = []
      let shouldShowConfetti = false

      if (type === 'novice') {
        toolParts = [
          {
            type: 'tool-show_login_button',
            toolCallId: `login-btn-${Date.now()}`,
            toolName: 'show_login_button',
            state: 'result',
            result: { displayed: true },
          },
        ]
        setOnboardingStep('login_flow')
      } else {
        toolParts = [
          {
            type: 'tool-show_provider_settings_button',
            toolCallId: `provider-settings-btn-${Date.now()}`,
            toolName: 'show_provider_settings_button',
            state: 'result',
            result: { displayed: true },
          },
        ]
        // Expert/skip users configure on their own - mark as completed
        onboardingStore.getState().markCompleted()
        setOnboardingStep('completed')
        shouldShowConfetti = true
      }

      // Stream assistant response with typing effect
      await streamFixedMessage(responseContent, toolParts)

      // Show confetti after streaming completes
      if (shouldShowConfetti) {
        const timeoutId = setTimeout(() => {
          pendingTimeoutsRef.current.delete(timeoutId)
          confetti()
        }, 200)
        pendingTimeoutsRef.current.add(timeoutId)
      }
    },
    [appendFixedMessage, streamFixedMessage, t]
  )

  /**
   * Stream the terminal "you're all set" celebration message + CTAs + confetti.
   * Idempotent: subsequent calls are no-ops.
   */
  const renderCelebration = useCallback(
    async (options?: { waitForWindowFocusBeforeAutoNavigate?: boolean }) => {
      if (celebrationShownRef.current) return
      celebrationShownRef.current = true

      setOnboardingStep('completed')
      setIsAutoRedirectingToNewChat(true)
      const baseTimestamp = Date.now()

      await streamFixedMessage(t("Awesome, everything is ready! Let's start your first Chatbox AI chat."), [
        createAutoNewChatLoadingToolPart(`auto-new-chat-${baseTimestamp}`, {
          waitForWindowFocusBeforeAutoNavigate: options?.waitForWindowFocusBeforeAutoNavigate,
        }),
      ])

      const timeoutId = setTimeout(() => {
        pendingTimeoutsRef.current.delete(timeoutId)
        confetti()
      }, 200)
      pendingTimeoutsRef.current.add(timeoutId)
    },
    [streamFixedMessage, t]
  )

  /**
   * Mark the guide flow as completed.
   *
   * Always sets onboardingStore.completed = true so the app does not re-enter the guide on next launch
   * (regardless of whether the user actually has a license — they have explicitly finished the flow).
   *
   * Branches the rendered UI:
   * - has license: stream celebration immediately (terminal state).
   * - no license: stream the Claim Free Plan CTA. Polling and waiting only kicks in if/when the user
   *   actually clicks Claim — see onClaimStart below.
   */
  const markGuideCompleted = useCallback(async () => {
    if (completionTriggeredRef.current) return
    completionTriggeredRef.current = true

    // Finalize any in-flight streaming message (e.g., AI preamble that preceded an activate_license tool call)
    setMessages((prev) => {
      const lastIdx = prev.length - 1
      if (lastIdx >= 0 && prev[lastIdx]?.isStreaming) {
        return [...prev.slice(0, lastIdx), { ...prev[lastIdx], isStreaming: false }]
      }
      return prev
    })

    setHasValidConfig(true)
    onboardingStore.getState().markCompleted()

    const hasLicense = Boolean(settingsStore.getState().licenseKey)
    if (hasLicense) {
      await renderCelebration()
    } else {
      await streamFixedMessage(
        t(
          "You're logged in! Claim your **free plan** below to unlock Chatbox AI features. If you have any questions, feel free to click the Help button in the bottom left corner anytime."
        ),
        [
          {
            type: 'tool-show_free_trial_link',
            toolCallId: `free-trial-link-${Date.now()}`,
            toolName: 'show_free_trial_link',
            state: 'result',
            result: { displayed: true },
          },
        ]
      )
    }
  }, [streamFixedMessage, t, renderCelebration])

  /**
   * Triggered by FreeTrialLink after the claim page successfully opens. Streams the awaiting card
   * which owns the polling lifecycle. Idempotent: re-clicking Claim does not stack cards.
   */
  const onClaimStart = useCallback(async () => {
    if (claimWaitingShownRef.current) return
    claimWaitingShownRef.current = true

    await streamFixedMessage(t("We're waiting for you to finish on chatboxai.app..."), [
      {
        type: 'tool-show_claim_waiting',
        toolCallId: `claim-waiting-${Date.now()}`,
        toolName: 'show_claim_waiting',
        state: 'result',
        result: { displayed: true },
      },
    ])
  }, [streamFixedMessage, t])

  /**
   * Triggered by useClaimPolling when a license appears in the user's account. Activates locally
   * and runs the celebration. Activation failure is logged but does not block the celebration —
   * the license is real, the user can re-validate via Settings later.
   */
  const onClaimDetected = useCallback(
    async (license: import('@/packages/remote').UserLicense, email: string) => {
      try {
        await premiumActions.activate(license.key, 'login', { accountEmail: email })
      } catch (err) {
        console.error('[guide] auto-activate after free-plan claim failed:', err)
      }
      await renderCelebration({ waitForWindowFocusBeforeAutoNavigate: true })
    },
    [renderCelebration]
  )

  /**
   * Handle config completion (for expert users returning from settings)
   */
  const handleConfigComplete = useCallback(() => {
    // Prevent duplicate completion
    if (completionTriggeredRef.current) return

    // Check if config is now valid
    const configValid = checkHasValidConfig()
    if (configValid && !hasValidConfig) {
      completionTriggeredRef.current = true
      setHasValidConfig(true)
      onboardingStore.getState().markCompleted()
      setOnboardingStep('completed')
      appendFixedMessage(
        t(
          "You've already completed the setup and can use Chatbox normally.\n\nIf you have any questions about Chatbox AI, feel free to ask me here."
        ),
        [
          createNewChatButtonToolPart(`new-chat-btn-${Date.now()}`, {
            label: t('Click here to start a new chat') ?? undefined,
          }),
          createSuggestedQuestionsToolPart(`suggested-${Date.now()}`),
        ]
      )
    }
  }, [hasValidConfig, appendFixedMessage, t])

  /**
   * Send a free-form message to the backend API
   */
  const sendMessage = useCallback(
    async (content: string) => {
      // Add user message first
      const userMessage: GuideUIMessage = {
        id: generateMessageId(),
        role: 'user',
        content,
        parts: [{ type: 'text', text: content }],
      }
      setMessages((prev) => [...prev, userMessage])

      // Check if this message triggers the limit
      if (userMessageCount + 1 >= GUIDE_CONFIG.maxRounds) {
        if (hasValidConfig) {
          await streamFixedMessage(
            t(
              "I'm a bit tired now. Please click the **New Chat** button in the sidebar or below to start a new conversation."
            ),
            [
              {
                type: 'tool-show_new_chat_button',
                toolCallId: `new-chat-btn-limit-${Date.now()}`,
                toolName: 'show_new_chat_button',
                state: 'result',
                result: { displayed: true },
              },
            ]
          )
        } else {
          await streamFixedMessage(
            t(
              "We've been chatting for a while now. To conserve resources, please complete the setup before continuing our conversation."
            )
          )
        }
        return
      }

      // Create assistant placeholder message
      const assistantMessage: GuideUIMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: '',
        parts: [],
        isStreaming: true,
      }
      setMessages((prev) => [...prev, assistantMessage])

      setIsLoading(true)
      setError(null)

      // Create abort controller
      abortControllerRef.current = new AbortController()

      try {
        // Prepare messages for API
        const apiMessages: GuideMessage[] = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role,
            content: m.content,
          }))
        apiMessages.push({ role: 'user', content })

        // Send request with current onboarding step
        const { uuid: deviceId } = await platform.getConfig()
        const response = await sendGuideMessage(apiMessages, deviceId, {
          onboardingStep,
          isLoggedIn,
          signal: abortControllerRef.current.signal,
        })

        if (!response.body) {
          throw new Error('No response body')
        }

        // Parse streaming response
        await parseStreamResponse(response.body.getReader(), {
          setMessages,
          setOnboardingStep,
          pendingUpdateRef,
          pendingTimeouts: pendingTimeoutsRef.current,
          markGuideCompleted,
          t,
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // User cancelled, just mark streaming as done
          setMessages((prev) => {
            const lastIdx = prev.length - 1
            if (prev[lastIdx]?.isStreaming) {
              return [
                ...prev.slice(0, lastIdx),
                {
                  ...prev[lastIdx],
                  isStreaming: false,
                },
              ]
            }
            return prev
          })
        } else {
          console.error('Guide API error:', err)
          setError((err as Error).message || 'Failed to get response')
          // Remove only the assistant streaming placeholder, keep user messages
          setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.isStreaming)))
        }
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
      }
    },
    [userMessageCount, hasValidConfig, messages, onboardingStep, streamFixedMessage, markGuideCompleted, t]
  )

  /**
   * Stop the current generation
   */
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  /**
   * Clear the guide session and start fresh
   */
  const clearSession = useCallback(() => {
    // Cancel any ongoing streaming
    if (greetingCancelRef.current) {
      greetingCancelRef.current()
      greetingCancelRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    // Reset all state
    setMessages([])
    setUserTypeSelected(null)
    setError(null)
    setIsLoading(false)
    setIsAutoRedirectingToNewChat(false)
    setOnboardingStep('greeting')
    completionTriggeredRef.current = false
    claimWaitingShownRef.current = false
    celebrationShownRef.current = false
    greetingInitializedRef.current = false
    // Trigger re-initialization
    setResetKey((k) => k + 1)
  }, [])

  /**
   * Debug: Reset guide and force entering selection step once.
   */
  const debugResetGuide = useCallback(() => {
    // Also reset auth/config to simulate a real new-user state.
    authInfoStore.getState().clearTokens()
    settingsStore.getState().setSettings((draft) => {
      draft.licenseKey = ''
      draft.licenseDetail = undefined
      draft.licenseActivationMethod = undefined
      draft.licenseInstances = undefined
      draft.memorizedManualLicenseKey = ''
      draft.providers = {}
    })

    onboardingStore.getState().reset()
    setHasValidConfig(false)
    setForceSelectionOnce(true)
    clearSession()
  }, [clearSession])

  /**
   * Debug: Skip directly to login success state for testing
   */
  const debugSkipToLoginSuccess = useCallback(() => {
    // Cancel any ongoing streaming
    if (greetingCancelRef.current) {
      greetingCancelRef.current()
      greetingCancelRef.current = null
    }
    // Clear current state
    setMessages([])
    setUserTypeSelected('novice')
    setHasValidConfig(true)
    setOnboardingStep('completed')
    setIsAutoRedirectingToNewChat(true)
    completionTriggeredRef.current = true

    // Add the success message
    const successText = t("Awesome, everything is ready! Let's start your first Chatbox AI chat.")
    const successMessage: GuideUIMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: successText,
      parts: [
        { type: 'text', text: successText },
        createAutoNewChatLoadingToolPart(`auto-new-chat-debug-${Date.now()}`),
      ],
    }

    setMessages([successMessage])
  }, [t])

  /**
   * Debug: Set state to just before round limit
   */
  const debugTriggerRoundLimit = useCallback(() => {
    // Cancel any ongoing streaming
    if (greetingCancelRef.current) {
      greetingCancelRef.current()
      greetingCancelRef.current = null
    }
    // Create fake user messages to reach the limit
    const fakeMessages: GuideUIMessage[] = []

    // Add greeting
    fakeMessages.push({
      id: generateMessageId(),
      role: 'assistant',
      content: t('Welcome to Chatbox!'),
      parts: [{ type: 'text', text: t('Welcome to Chatbox!') }],
    })

    // Add maxRounds - 1 user messages, so next send triggers limit message
    for (let i = 0; i < GUIDE_CONFIG.maxRounds - 1; i++) {
      fakeMessages.push({
        id: generateMessageId(),
        role: 'user',
        content: `Test message ${i + 1}`,
        parts: [{ type: 'text', text: `Test message ${i + 1}` }],
      })
      fakeMessages.push({
        id: generateMessageId(),
        role: 'assistant',
        content: `Response ${i + 1}`,
        parts: [{ type: 'text', text: `Response ${i + 1}` }],
      })
    }

    setMessages(fakeMessages)
    setUserTypeSelected('novice')
    setOnboardingStep('login_flow')
  }, [t])

  return {
    messages,
    isLoading,
    error,
    onboardingStep,
    sendMessage,
    stopGeneration,
    selectUserType,
    markGuideCompleted,
    onClaimStart,
    onClaimDetected,
    handleConfigComplete,
    clearSession,
    debugResetGuide,
    debugSkipToLoginSuccess,
    debugTriggerRoundLimit,
    canSendMessage,
    hasValidConfig,
    userMessageCount,
    isGuideInProgress,
  }
}
