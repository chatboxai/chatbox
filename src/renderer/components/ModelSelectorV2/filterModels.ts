import type { ProviderModelInfo } from '@shared/types'

export function filterModelsForSelector(
  models: ProviderModelInfo[] | undefined,
  modelFilter?: (model: ProviderModelInfo, providerId?: string) => boolean,
  providerId?: string
): ProviderModelInfo[] | undefined {
  if (!models) return models

  return models.filter((model) => {
    const matchesFilter = modelFilter ? modelFilter(model, providerId) : true
    const matchesDefaultType = modelFilter ? true : !model.type || model.type === 'chat'
    return matchesFilter && matchesDefaultType
  })
}
