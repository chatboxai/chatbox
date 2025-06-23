import { getModelManifest } from '@/packages/remote'
import { languageAtom } from '@/stores/atoms'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { ModelProviderEnum, ProviderModelInfo } from 'src/shared/types'
import { useProviderSettings } from './useSettings'

const useChatboxAIModels = () => {
  const language = useAtomValue(languageAtom)
  const { providerSettings: chatboxAISettings, setProviderSettings } = useProviderSettings(ModelProviderEnum.ChatboxAI)

  const { data, ...others } = useQuery({
    queryKey: ['chatbox-ai-models', language],
    queryFn: async () => {
      const res = await getModelManifest({
        aiProvider: ModelProviderEnum.ChatboxAI,
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
          })),
        }))
      }

      return res.models
    },
  })

  const allChatboxAIModels = useMemo(
    () =>
      data?.map(
        (item) =>
          ({
            modelId: item.modelId,
            nickname: item.modelName,
            labels: item.labels,
          } as ProviderModelInfo)
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
