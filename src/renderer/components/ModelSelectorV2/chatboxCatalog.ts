import type { ChatboxAIModelList } from '@/packages/remote'

export type ChatboxAIPlan = ChatboxAIModelList['license']['plan'] | undefined
type ChatboxAILicense = Pick<ChatboxAIModelList['license'], 'plan' | 'proTrial'> | undefined

export type ChatboxAIGroupView = {
  id: string
  modelIds: string[]
  total: number
  isAdvanced: boolean
  isLocked: boolean
  isFeaturedOnly: boolean
}

export function isChatboxAIProPlan(plan: ChatboxAIPlan): boolean {
  return plan === 'pro' || plan === 'pro_plus'
}

export function isChatboxAIAdvancedGroup(groupId: string): boolean {
  return groupId === 'advanced'
}

/** The trial unlocks advanced models only while the license is still an active Lite plan. */
export function isChatboxAIProTrialActive(license: ChatboxAILicense, now = Date.now()): boolean {
  const startsAt = Date.parse(license?.proTrial?.startsAt ?? '')
  const expiresAt = Date.parse(license?.proTrial?.expiresAt ?? '')
  return license?.plan === 'lite' && now >= startsAt && now < expiresAt
}

export function isChatboxAIModelLocked(groupId: string, license: ChatboxAILicense): boolean {
  return isChatboxAIAdvancedGroup(groupId) && !isChatboxAIProPlan(license?.plan) && !isChatboxAIProTrialActive(license)
}

export function getChatboxAIModelName(model: { modelName?: string; modelId: string }): string {
  return model.modelName || model.modelId
}

export function modelMatchesSearch(
  model: { modelId: string; modelName?: string },
  search: string,
  providerName = 'Chatbox AI'
): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return (
    providerName.toLowerCase().includes(query) ||
    model.modelId.toLowerCase().includes(query) ||
    getChatboxAIModelName(model).toLowerCase().includes(query)
  )
}

export function buildChatboxAIGroupViews(params: {
  catalog: ChatboxAIModelList
  search: string
  expandedAdvanced: boolean
  collapsedGroupIds: Set<string>
  modelFilter?: (modelId: string) => boolean
}): ChatboxAIGroupView[] {
  const { catalog, search, expandedAdvanced, collapsedGroupIds, modelFilter } = params
  const isSearching = search.trim().length > 0

  return catalog.groups.map((group) => {
    const isAdvanced = isChatboxAIAdvancedGroup(group.id)
    const isLocked = isChatboxAIModelLocked(group.id, catalog.license)
    const featuredIds = group.featuredModelIds?.length ? group.featuredModelIds : group.modelIds
    const shouldShowFeaturedOnly = isAdvanced && isLocked && !expandedAdvanced && !isSearching
    const sourceIds = shouldShowFeaturedOnly ? featuredIds : group.modelIds
    const visibleIds = collapsedGroupIds.has(group.id)
      ? []
      : sourceIds.filter((modelId) => {
          const model = catalog.models[modelId]
          if (!model) return false
          if (modelFilter && !modelFilter(modelId)) return false
          return modelMatchesSearch(model, search, catalog.provider.name)
        })

    const total = group.modelIds.filter((modelId) => {
      const model = catalog.models[modelId]
      if (!model) return false
      return modelFilter ? modelFilter(modelId) : true
    }).length

    return {
      id: group.id,
      modelIds: visibleIds,
      total,
      isAdvanced,
      isLocked,
      isFeaturedOnly: shouldShowFeaturedOnly,
    }
  })
}
