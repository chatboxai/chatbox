import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ModelProviderEnum, type ProviderModelInfo } from 'src/shared/types'
import { getModelManifest } from '@/packages/remote'
import { useLanguage, useProviderSettings, useSettingsStore } from '@/stores/settingsStore'

const useChatboxAIModels = () => {
  const language = useLanguage()
  const { providerSettings: chatboxAISettings, setProviderSettings } = useProviderSettings(ModelProviderEnum.ChatboxAI)
  const licenseKey = useSettingsStore((state) => state.licenseKey)

  const { data, ...others } = useQuery({
    queryKey: ['chatbox-ai-models', language, licenseKey],
    queryFn: async () => {
      const res = await getModelManifest({
        aiProvider: ModelProviderEnum.ChatboxAI,
        licenseKey,
        language,
      })

      // 只更新 ChatboxAI provider 的 models 配置，不影响其他 provider
      if (res.models && res.models.length > 0) {
        // 使用函数式更新，确保只修改 models 字段，保留其他配置
        setProviderSettings((prevChatboxAISettings) => ({
          // 保留现有的 ChatboxAI 配置（如 excludedModels 等）
          ...prevChatboxAISettings,
          // 只更新 models 字段
          models: res.models.map((m) => ({
            modelId: m.modelId,
            nickname: m.modelName,
            labels: m.labels,
            capabilities: m.capabilities,
            type: m.type,
            apiStyle: m.apiStyle,
          })),
        }))
      }

      return res.models
    },
    staleTime: 3600 * 1000,
  })

  const allChatboxAIModels = useMemo(
    () =>
      data?.map(
        (item) =>
          ({
            modelId: item.modelId,
            nickname: item.modelName,
            labels: item.labels,
            capabilities: item.capabilities,
            type: item.type,
          }) as ProviderModelInfo
      ) || [],
    [data]
  )

  const chatboxAIModels = useMemo(
    () => allChatboxAIModels.filter((m) => !chatboxAISettings?.excludedModels?.includes(m.modelId)),
    [allChatboxAIModels, chatboxAISettings]
  )

  return { allChatboxAIModels, chatboxAIModels, ...others }
}

export default useChatboxAIModels
