import { Box, Flex } from '@mantine/core'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemProviders } from 'src/shared/defaults'
import type { ModelProviderEnum, ProviderInfo, ProviderSettings } from 'src/shared/types'
import { z } from 'zod'
import { AddProviderModal } from '@/components/settings/provider/AddProviderModal'
import { ImportProviderModal } from '@/components/settings/provider/ImportProviderModal'
import { ProviderList } from '@/components/settings/provider/ProviderList'
import { useProviderImport } from '@/hooks/useProviderImport'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSettings } from '@/hooks/useSettings'
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

function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isSmallScreen = useIsSmallScreen()
  const routerState = useRouterState()
  const { settings } = useSettings()

  const providers = useMemo<ProviderInfo[]>(
    () =>
      [
        ...SystemProviders,
        ...(settings.customProviders || []),
      ].map((p) => ({
        ...p,
        ...(settings.providers?.[p.id] || {}),
      })),
    [settings.customProviders, settings.providers]
  )

  const [newProviderModalOpened, setNewProviderModalOpened] = useState(false)

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
        <ProviderList
          providers={providers}
          onAddProvider={() => setNewProviderModalOpened(true)}
          onImportProvider={handleClipboardImport}
          isImporting={isImporting}
        />
      )}
      {!(isSmallScreen && routerState.location.pathname === '/settings/provider') && (
        <Box flex="1 1 75%" p="md" className="overflow-auto">
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
    </Flex>
  )
}
