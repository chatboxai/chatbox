import { Stack, Transition } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { type ModelProvider, ModelProviderEnum } from 'src/shared/types'
import useChatboxAIModels from '@/hooks/useChatboxAIModels'
import { useLanguage, useProviderSettings, useSettingsStore } from '@/stores/settingsStore'
import { VIEW_TRANSITION_DURATION, VIEW_TRANSITION_TIMING } from './-components/constants'
import { LicenseKeyView } from './-components/LicenseKeyView'
import { LicenseSelectionModal } from './-components/LicenseSelectionModal'
import { LoggedInView } from './-components/LoggedInView'
import { LoginView } from './-components/LoginView'
import { ModelManagement } from './-components/ModelManagement'
import type { ViewMode } from './-components/types'
import { useAuthTokens } from './-components/useAuthTokens'

export const Route = createFileRoute('/settings/provider/chatbox-ai/')({
  component: RouteComponent,
})

export function RouteComponent() {
  const language = useLanguage()
  const providerId: ModelProvider = ModelProviderEnum.ChatboxAI
  const { providerSettings, setProviderSettings } = useProviderSettings(providerId)

  const licenseActivationMethod = useSettingsStore((state) => state.licenseActivationMethod)

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (licenseActivationMethod === 'manual') {
      return 'licenseKey'
    }
    if (licenseActivationMethod === 'login') {
      return 'login'
    }
    return 'login'
  })

  const { isLoggedIn, clearAuthTokens, saveAuthTokens } = useAuthTokens()
  const licenseKey = useSettingsStore((state) => state.licenseKey)

  const { allChatboxAIModels, chatboxAIModels, refetch: refetchChatboxAIModels } = useChatboxAIModels()

  const deleteModel = (modelId: string) => {
    setProviderSettings({
      excludedModels: [...(providerSettings?.excludedModels || []), modelId],
    })
  }

  const resetModels = () => {
    setProviderSettings({
      models: [],
      excludedModels: [],
    })
  }

  const [licenseModalState, setLicenseModalState] = useState<{
    show: boolean
    licenses: any[]
    onConfirm?: (licenseKey: string) => void
    onCancel?: () => void
  }>({
    show: false,
    licenses: [],
  })

  const showLicenseSelectionModal = useCallback(
    (params: { licenses: any[]; onConfirm: (licenseKey: string) => void; onCancel: () => void }) => {
      setLicenseModalState({
        show: true,
        ...params,
      })
    },
    []
  )

  const handleLicenseModalConfirm = (licenseKey: string) => {
    licenseModalState.onConfirm?.(licenseKey)
    setLicenseModalState({ show: false, licenses: [] })
  }

  const handleLicenseModalCancel = () => {
    licenseModalState.onCancel?.()
    setLicenseModalState({ show: false, licenses: [] })
  }

  // Dynamic height management for view transitions
  const containerRef = useRef<HTMLDivElement>(null)
  const loginViewRef = useRef<HTMLDivElement>(null)
  const licenseKeyViewRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState<number>(0)

  useLayoutEffect(() => {
    const targetRef = viewMode === 'login' ? loginViewRef : licenseKeyViewRef

    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const updateHeight = () => {
      if (targetRef.current) {
        setContainerHeight(targetRef.current.scrollHeight)
      }
    }

    const setupObservers = () => {
      const targetElement = targetRef.current
      if (!targetElement) return

      resizeObserver = new ResizeObserver(updateHeight)
      resizeObserver.observe(targetElement)

      mutationObserver = new MutationObserver(updateHeight)
      mutationObserver.observe(targetElement, {
        childList: true,
        subtree: true,
        attributes: true,
      })
    }

    if (!targetRef.current) {
      // Element not ready yet, wait and then setup observers
      timer = setTimeout(() => {
        updateHeight()
        setupObservers()
      }, 50)
    } else {
      updateHeight()
      setupObservers()
    }

    return () => {
      if (timer) clearTimeout(timer)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [viewMode, isLoggedIn, licenseKey])

  return (
    <Stack gap="xxl">
      {/* License Selection Modal */}
      <LicenseSelectionModal
        opened={licenseModalState.show}
        licenses={licenseModalState.licenses}
        onConfirm={handleLicenseModalConfirm}
        onCancel={handleLicenseModalCancel}
      />

      {/* View Transition Container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          height: containerHeight,
          transition: `height ${VIEW_TRANSITION_DURATION}ms ${VIEW_TRANSITION_TIMING}`,
          overflow: 'hidden',
        }}
      >
        <Transition
          mounted={viewMode === 'login'}
          transition="slide-right"
          duration={VIEW_TRANSITION_DURATION}
          timingFunction={VIEW_TRANSITION_TIMING}
        >
          {(styles) => (
            <div style={{ ...styles, position: 'absolute', top: 0, left: 0, right: 0 }}>
              {isLoggedIn ? (
                <LoggedInView
                  ref={loginViewRef}
                  onLogout={clearAuthTokens}
                  language={language}
                  onShowLicenseSelectionModal={showLicenseSelectionModal}
                  onSwitchToLicenseKey={() => setViewMode('licenseKey')}
                />
              ) : (
                <LoginView
                  ref={loginViewRef}
                  language={language}
                  saveAuthTokens={saveAuthTokens}
                  onSwitchToLicenseKey={() => setViewMode('licenseKey')}
                />
              )}
            </div>
          )}
        </Transition>

        <Transition
          mounted={viewMode === 'licenseKey'}
          transition="slide-left"
          duration={VIEW_TRANSITION_DURATION}
          timingFunction={VIEW_TRANSITION_TIMING}
        >
          {(styles) => (
            <div style={{ ...styles, position: 'absolute', top: 0, left: 0, right: 0 }}>
              <LicenseKeyView
                ref={licenseKeyViewRef}
                language={language}
                onSwitchToLogin={() => setViewMode('login')}
              />
            </div>
          )}
        </Transition>
      </div>

      <ModelManagement
        chatboxAIModels={chatboxAIModels}
        allChatboxAIModels={allChatboxAIModels}
        onDeleteModel={deleteModel}
        onResetModels={resetModels}
        onFetchModels={refetchChatboxAIModels}
        onAddModel={(model) =>
          setProviderSettings({
            excludedModels: (providerSettings?.excludedModels || []).filter((m) => m !== model.modelId),
          })
        }
        onRemoveModel={(modelId) =>
          setProviderSettings({
            excludedModels: [...(providerSettings?.excludedModels || []), modelId],
          })
        }
      />
    </Stack>
  )
}
