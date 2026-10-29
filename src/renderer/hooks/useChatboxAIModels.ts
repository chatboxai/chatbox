import { type ChatboxAILicenseDetail, ModelProviderEnum, type ProviderModelInfo } from '@shared/types'
import { type QueryFilters, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { type ChatboxAIModelList, getChatboxAIModelList, getModelManifest } from '@/packages/remote'
import { useLanguage, useProviderSettings, useSettingsStore } from '@/stores/settingsStore'

const CHATBOX_AI_MODELS_QUERY_KEY = 'chatbox-ai-models'

export function useRefreshChatboxAIModelsOnLicenseChange(
  licenseKey: string | null | undefined,
  detail:
    | Pick<ChatboxAILicenseDetail, 'plan' | 'name' | 'status' | 'expires_at' | 'token_expire_time'>
    | null
    | undefined
) {
  const queryClient = useQueryClient()
  const activeLicenseKey = useSettingsStore((state) => state.licenseKey)
  const entitlement = detail
    ? JSON.stringify([detail.plan, detail.name, detail.status, detail.expires_at, detail.token_expire_time])
    : undefined

  useEffect(() => {
    if (!licenseKey || licenseKey !== activeLicenseKey || !entitlement) return

    // The model catalog includes server-resolved access, so refresh it when the active plan changes.
    const filters: QueryFilters = {
      predicate: (query) => query.queryKey[0] === CHATBOX_AI_MODELS_QUERY_KEY && query.queryKey[2] === licenseKey,
    }
    // Discard requests started before the new entitlement was observed, including the first catalog load.
    void queryClient.cancelQueries(filters).then(() => queryClient.invalidateQueries(filters))
  }, [queryClient, activeLicenseKey, licenseKey, entitlement])
}

type ChatboxAIManifestModel = {
  modelId: string
  modelName: string
  labels?: string[]
  type?: ProviderModelInfo['type']
  apiStyle?: ProviderModelInfo['apiStyle']
  capabilities?: ProviderModelInfo['capabilities']
  contextWindow?: number
}

function toProviderModelInfo(model: ChatboxAIManifestModel): ProviderModelInfo {
  return {
    modelId: model.modelId,
    nickname: model.modelName,
    labels: model.labels,
    capabilities: model.capabilities,
    type: model.type,
    apiStyle: model.apiStyle,
    contextWindow: model.contextWindow || undefined,
  }
}

function modelListToProviderModels(modelList: ChatboxAIModelList | null): ProviderModelInfo[] {
  if (!modelList) return []
  return modelList.groups.flatMap((group) =>
    group.modelIds.flatMap((modelId) => {
      const model = modelList.models[modelId]
      return model ? [toProviderModelInfo(model)] : []
    })
  )
}

const useChatboxAIModels = () => {
  const language = useLanguage()
  const { providerSettings: chatboxAISettings, setProviderSettings } = useProviderSettings(ModelProviderEnum.ChatboxAI)
  const licenseKey = useSettingsStore((state) => state.licenseKey)

  const { data, ...others } = useQuery({
    queryKey: [CHATBOX_AI_MODELS_QUERY_KEY, language, licenseKey],
    queryFn: async () => {
      const [manifest, modelList] = await Promise.all([
        getModelManifest({
          aiProvider: ModelProviderEnum.ChatboxAI,
          licenseKey,
          language,
        }),
        getChatboxAIModelList({ licenseKey, language }).catch((error) => {
          console.error('[Chatbox AI model_list] failed', error)
          return null
        }),
      ])
      const modelListModels = modelListToProviderModels(modelList)
      const models = modelListModels.length > 0 ? modelListModels : manifest.models.map(toProviderModelInfo)

      // 只更新 ChatboxAI provider 的 models 配置，不影响其他 provider
      if (models.length > 0) {
        // 使用函数式更新，确保只修改 models 字段，保留其他配置
        setProviderSettings((prevChatboxAISettings) => ({
          // 保留现有的 ChatboxAI 配置（如 excludedModels 等）
          ...prevChatboxAISettings,
          // 只更新 models 字段
          models,
        }))
      }

      return {
        ...manifest,
        models,
        modelList,
      }
    },
    staleTime: 3600 * 1000,
    refetchOnWindowFocus: 'always',
  })

  const allChatboxAIModels = useMemo(
    () => data?.models || chatboxAISettings?.models || [],
    [data, chatboxAISettings?.models]
  )

  const chatboxAIImageModels = useMemo(
    () =>
      data?.imageModels.map(
        (item) =>
          ({
            modelId: item.modelId,
            nickname: item.modelName,
            description: item.description,
            labels: item.labels,
            capabilities: item.capabilities,
            type: item.type || 'image',
            contextWindow: item.contextWindow || undefined,
          }) satisfies ProviderModelInfo & { description?: string }
      ) || [],
    [data]
  )

  const chatboxAIModels = useMemo(
    () => allChatboxAIModels.filter((m) => !chatboxAISettings?.excludedModels?.includes(m.modelId)),
    [allChatboxAIModels, chatboxAISettings]
  )

  return {
    allChatboxAIModels,
    chatboxAIModels,
    chatboxAIImageModels,
    chatboxAIModelList: data?.modelList || null,
    ...others,
  }
}

export default useChatboxAIModels
