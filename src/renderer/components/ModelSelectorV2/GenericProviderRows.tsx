import type { ProviderModelInfo } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { modelMatchesSearch } from './chatboxCatalog'
import { groupFavorites } from './helpers'
import { ModelRow } from './ModelRow'
import { ProviderRowHeader } from './ProviderRowHeader'
import type { DetailModel, FavoriteModel, FilteredProvider } from './types'

function ByokSectionDivider({ mobile }: { mobile: boolean }) {
  const { t, i18n } = useTranslation()
  const language = i18n.language.toLowerCase()
  const byokLabel = language === 'zh-hans' || language.startsWith('zh-cn') ? '自带API KEY' : 'BYOK'

  return (
    <div
      className={clsx(
        'sticky top-0 z-20 flex h-9 items-center gap-2 border-0 border-y border-solid border-chatbox-border-primary bg-chatbox-background-secondary px-2.5',
        mobile ? 'mt-1 px-3' : 'mt-1'
      )}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-chatbox-tint-secondary">
        {t('More Providers')}
      </span>
      <span className="text-[11px] font-semibold text-chatbox-tint-tertiary">{byokLabel}</span>
    </div>
  )
}

export function GenericProviderRows({
  favoriteOnly,
  hasChatboxCatalog,
  favoritedModels,
  genericProviders,
  collapsedProviders,
  search,
  selectedProviderId,
  selectedModelId,
  isMobile,
  modelFilter,
  modelDisabledCheck,
  isFavorited,
  onToggleProvider,
  onSelect,
  onToggleFavorite,
  onShowMobileDetail,
  onDesktopDetailOpen,
  onDesktopDetailClose,
  onDisabledSelect,
}: {
  favoriteOnly: boolean
  hasChatboxCatalog: boolean
  favoritedModels?: FavoriteModel[]
  genericProviders: FilteredProvider[]
  collapsedProviders: Record<string, boolean>
  search: string
  selectedProviderId?: string
  selectedModelId?: string
  isMobile: boolean
  modelFilter?: (model: ProviderModelInfo, providerId?: string) => boolean
  modelDisabledCheck?: (model: ProviderModelInfo, providerId?: string) => string | undefined
  isFavorited: (providerId: string, modelId: string) => boolean
  onToggleProvider: (providerId: string) => void
  onSelect: (providerId: string, modelId: string) => void
  onToggleFavorite: (providerId: string, modelId: string) => void
  onShowMobileDetail: (detail: DetailModel) => void
  onDesktopDetailOpen: (key: string, detail: DetailModel, pricingLink: string | undefined, anchor: HTMLElement) => void
  onDesktopDetailClose: () => void
  onDisabledSelect: (modelId: string) => void
}) {
  const source = favoriteOnly
    ? Object.entries(groupFavorites(favoritedModels))
    : genericProviders.map((p) => [p.id, { provider: p, models: [] }] as const)
  let byokDividerShown = false
  const rows = source.map(([_providerId, group]) => {
    const provider = favoriteOnly ? group.provider : (group.provider as FilteredProvider)
    if (!provider || (hasChatboxCatalog && provider.id === ModelProviderEnum.ChatboxAI)) return null
    const collapsed = collapsedProviders[provider.id] || false
    const models = favoriteOnly
      ? group.models
          .map((favorite) => favorite.model)
          .filter((model): model is ProviderModelInfo => {
            if (!model) return false
            if (!modelMatchesSearch({ modelId: model.modelId, modelName: model.nickname }, search, provider.name)) {
              return false
            }
            return modelFilter ? modelFilter(model, provider.id) : !model.type || model.type === 'chat'
          })
      : (provider as FilteredProvider).models || []
    if (models.length === 0) return null
    const showByokDivider = !favoriteOnly && provider.id !== ModelProviderEnum.ChatboxAI && !byokDividerShown
    if (showByokDivider) byokDividerShown = true
    return (
      <div key={provider.id}>
        {showByokDivider && <ByokSectionDivider mobile={isMobile} />}
        <ProviderRowHeader
          provider={provider}
          modelCount={models.length}
          collapsed={collapsed}
          onToggle={() => onToggleProvider(provider.id)}
        />
        {!collapsed &&
          models.map((model) => {
            const disabledReason = modelDisabledCheck?.(model, provider.id)
            const detail: DetailModel = {
              providerId: provider.id,
              providerName: provider.name,
              modelId: model.modelId,
              name: model.nickname || model.modelId,
              capabilities: model.capabilities,
              disabledReason,
            }
            const detailKey = `${provider.id}/${model.modelId}`
            return (
              <ModelRow
                key={detailKey}
                detail={detail}
                providerModel={model}
                selected={selectedProviderId === provider.id && selectedModelId === model.modelId}
                favorited={isFavorited(provider.id, model.modelId)}
                mobile={isMobile}
                onSelect={() => onSelect(provider.id, model.modelId)}
                onFavorite={() => onToggleFavorite(provider.id, model.modelId)}
                onShowDetail={() => onShowMobileDetail(detail)}
                onDesktopDetailOpen={(anchor) => onDesktopDetailOpen(detailKey, detail, undefined, anchor)}
                onDesktopDetailClose={onDesktopDetailClose}
                onDisabledSelect={() => onDisabledSelect(detail.modelId)}
              />
            )
          })}
      </div>
    )
  })

  if (!rows.some(Boolean)) return null

  return <>{rows}</>
}
