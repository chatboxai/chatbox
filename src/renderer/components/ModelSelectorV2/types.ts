import type { ComboboxProps } from '@mantine/core'
import type { ProviderModelInfo } from '@shared/types'
import type { PropsWithChildren } from 'react'
import type { ChatboxAIModelList } from '@/packages/remote'

export type FilteredProvider = {
  id: string
  name: string
  isCustom?: boolean
  models?: ProviderModelInfo[]
}

export type FavoriteModel = {
  provider?: { id: string; name: string; isCustom?: boolean }
  model?: ProviderModelInfo
}

export type ModelSelectorV2Props = PropsWithChildren<
  {
    showAuto?: boolean
    autoText?: string
    onSelect?: (provider: string, model: string) => void
    onDropdownOpen?: () => void
    modelFilter?: (model: ProviderModelInfo, providerId?: string) => boolean
    modelDisabledCheck?: (model: ProviderModelInfo, providerId?: string) => string | undefined
    selectedProviderId?: string
    selectedModelId?: string
    searchPosition?: 'top' | 'bottom'
    pageName?: string
  } & ComboboxProps
>

export type ChatboxAIModel = ChatboxAIModelList['models'][string]

export type DetailModel = {
  providerId: string
  providerName: string
  modelId: string
  name: string
  type?: ProviderModelInfo['type']
  capabilities?: ProviderModelInfo['capabilities']
  costLevel?: string
  description?: string
  pricing?: ChatboxAIModel['pricing']
  locked?: boolean
  disabledReason?: string
}

export type DesktopDetailState = {
  key: string
  model: DetailModel
  pricingLink?: string
  upgradeLink?: string
  left: number
  top: number
}
