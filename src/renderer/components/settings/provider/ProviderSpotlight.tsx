import { createSpotlight, Spotlight, type SpotlightActionData, type SpotlightActionGroupData } from '@mantine/spotlight'
import type { BuiltinProviderBaseInfo } from '@shared/types'
import { IconFileImport, IconSearch, IconSquareRoundedPlusFilled } from '@tabler/icons-react'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import platform from '@/platform'
import classes from './ProviderSpotlight.module.css'
import { FEATURED_PROVIDER_IDS, ProviderIconImage } from './providerIcons'

export const [providerSpotlightStore, providerSpotlight] = createSpotlight()

const ProviderSpotlight: FC<{
  allSystemProviders: BuiltinProviderBaseInfo[]
  onSelectProvider: (providerId: string) => void
  onAddCustomProvider: () => void
  onImportProvider: () => void
  isImporting: boolean
}> = ({ allSystemProviders, onSelectProvider, onAddCustomProvider, onImportProvider, isImporting }) => {
  const { t } = useTranslation()

  const actions = useMemo<SpotlightActionGroupData[]>(() => {
    const featured = allSystemProviders.filter((p) => FEATURED_PROVIDER_IDS.includes(p.id))
    const others = allSystemProviders.filter((p) => !FEATURED_PROVIDER_IDS.includes(p.id))

    const quickActions: SpotlightActionData[] = [
      {
        id: 'add-custom',
        label: String(t('Add Custom Provider')),
        description: String(t('Configure a custom OpenAI-compatible provider')),
        onClick: () => {
          providerSpotlight.close()
          onAddCustomProvider()
        },
        leftSection: (
          <ScalableIcon icon={IconSquareRoundedPlusFilled} size={24} className="text-workspaice-tint-brand" />
        ),
      },
    ]

    quickActions.push({
      id: 'import-clipboard',
      label: isImporting ? String(t('Importing...')) : String(t('Import from clipboard')),
      description: String(t('Import provider config from clipboard')),
      onClick: () => {
        if (isImporting) return
        providerSpotlight.close()
        onImportProvider()
      },
      leftSection: <ScalableIcon icon={IconFileImport} size={24} className="text-workspaice-tint-brand" />,
    })

    return [
      {
        group: String(t('Quick Actions')),
        actions: quickActions,
      },
      {
        group: String(t('Popular')),
        actions: featured.map((p) => ({
          id: `provider-${p.id}`,
          label: String(t(p.name)),
          onClick: () => {
            providerSpotlight.close()
            onSelectProvider(p.id)
          },
          leftSection: <ProviderIconImage providerId={p.id} size={24} />,
        })),
      },
      {
        group: String(t('More Providers')),
        actions: others.map((p) => ({
          id: `provider-${p.id}`,
          label: String(t(p.name)),
          onClick: () => {
            providerSpotlight.close()
            onSelectProvider(p.id)
          },
          leftSection: <ProviderIconImage providerId={p.id} size={24} />,
        })),
      },
    ]
  }, [allSystemProviders, onSelectProvider, onAddCustomProvider, onImportProvider, isImporting, t])

  return (
    <Spotlight
      store={providerSpotlightStore}
      actions={actions}
      nothingFound={String(t('Nothing found...'))}
      scrollable
      maxHeight="min(600px, calc(100vh - 180px))"
      shortcut={null}
      classNames={{ actionsList: classes.actionsList }}
      searchProps={{
        leftSection: <ScalableIcon icon={IconSearch} size={20} stroke={1.5} />,
        placeholder: String(t('Search providers...')),
      }}
    />
  )
}

export default ProviderSpotlight
