import { Box, Flex } from '@mantine/core'
import { SystemProviders } from '@shared/defaults'
import type { ModelProviderEnum, ProviderInfo, ProviderSettings } from '@shared/types'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { AddProviderModal } from '@/components/settings/provider/AddProviderModal'
import { ImportProviderModal } from '@/components/settings/provider/ImportProviderModal'
import { ProviderList } from '@/components/settings/provider/ProviderList'
import ProviderSpotlight, { providerSpotlight } from '@/components/settings/provider/ProviderSpotlight'
import { useProviderImport } from '@/hooks/useProviderImport'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { decodeBase64 } from '@/utils/base64'
import { parseProviderFromJson } from '@/utils/provider-config'

const searchSchema = z.object({
  import: z.string().optional(), // base64 encoded config
  custom: z.boolean().optional(),
})

export const Route = createFileRoute('/settings/provider')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
})

export function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isSmallScreen = useIsSmallScreen()
  const routerState = useRouterState()
  const customProviders = useSettingsStore((state) => state.customProviders)
  const providersMap = useSettingsStore((state) => state.providers)
  const { isExceeded } = useVersion()

  const providers = useMemo<ProviderInfo[]>(() => {
    const systemProviders = SystemProviders().filter(
      (p) => !(isExceeded && p.name.toLocaleLowerCase().match(/openai|claude|gemini/i))
    )
    // Put ChatboxAI first
    const chatboxAI = systemProviders.find((p) => p.id === 'chatbox-ai')
    const others = systemProviders.filter((p) => p.id !== 'chatbox-ai')
    return [...(chatboxAI ? [chatboxAI] : []), ...others, ...(customProviders || [])].map((p) => ({
      ...p,
      ...(providersMap?.[p.id] || {}),
    }))
  }, [customProviders, isExceeded, providersMap])

  const allSystemProviders = useMemo(() => {
    return providers.filter((p) => !p.isCustom)
  }, [providers])

  const [newProviderModalOpened, setNewProviderModalOpened] = useState(false)

  const handleOpenSpotlight = useCallback(() => {
    providerSpotlight.open()
  }, [])

  const handleAddCustomProvider = useCallback(() => {
    setNewProviderModalOpened(true)
  }, [])

  const handleSelectProvider = useCallback(
    (providerId: string) => {
      navigate({
        to: providerId === 'chatbox-ai' ? '/settings/provider/chatbox-ai' : '/settings/provider/$providerId',
        params: { providerId },
      })
    },
    [navigate]
  )

  // Import hook
  const {
    importModalOpened,
    setImportModalOpened,
    importedConfig,
    setImportedConfig,
    importError,
    setImportError,
    isImporting,
    existingProvider,
    checkExistingProvider,
    handleClipboardImport,
    handleCancelImport,
  } = useProviderImport(providers)

  const searchParams = Route.useSearch()

  // Show toast for import errors
  useEffect(() => {
    if (importError) {
      addToast(`${t('Import Error')}: ${importError}`)
      setImportError(null) // Clear the error after showing toast
    }
  }, [importError, t, setImportError])

  useEffect(() => {
    if (searchParams.custom) {
      setNewProviderModalOpened(true)
    }
  }, [searchParams.custom])
  // Handle deep link import
  const [deepLinkConfig, setDeepLinkConfig] = useState<
    ProviderInfo | (ProviderSettings & { id: ModelProviderEnum }) | null
  >(null)

  useEffect(() => {
    if (searchParams.import) {
      try {
        const decoded = decodeBase64(searchParams.import)
        setDeepLinkConfig(parseProviderFromJson(decoded) || null)
      } catch (err) {
        console.error('Failed to parse deep link config:', err)
        setImportError(t('Invalid deep link config format'))
        setDeepLinkConfig(null)
      } finally {
        // 暂时禁用了，会导致页面路径不对，获取不到assets
        // 保证移动端能够后退到settings页面
        // window.history.replaceState(null, '', '/settings')
        navigate({
          to: '/settings/provider',
          search: {},
          replace: true,
        })
      }
    }
  }, [searchParams.import, setImportError, t, navigate])

  useEffect(() => {
    if (deepLinkConfig) {
      checkExistingProvider(deepLinkConfig.id)
      setImportedConfig(deepLinkConfig)
      setImportModalOpened(true)
    }
  }, [deepLinkConfig, checkExistingProvider, setImportedConfig, setImportModalOpened])

  const handleImportModalClose = () => {
    handleCancelImport()
    setDeepLinkConfig(null)
  }

  return (
    <Flex h="100%" w="100%">
      {(!isSmallScreen || routerState.location.pathname === '/settings/provider') && (
        <ProviderList providers={providers} onAddProvider={handleOpenSpotlight} />
      )}
      {!(isSmallScreen && routerState.location.pathname === '/settings/provider') && (
        <Box flex="1 1 75%" className="overflow-auto">
          <Outlet />
        </Box>
      )}

      <AddProviderModal opened={newProviderModalOpened} onClose={() => setNewProviderModalOpened(false)} />

      <ImportProviderModal
        opened={importModalOpened}
        onClose={handleImportModalClose}
        importedConfig={importedConfig}
        existingProvider={existingProvider}
      />

      <ProviderSpotlight
        allSystemProviders={allSystemProviders}
        onSelectProvider={handleSelectProvider}
        onAddCustomProvider={handleAddCustomProvider}
        onImportProvider={handleClipboardImport}
        isImporting={isImporting}
      />
    </Flex>
  )
}
