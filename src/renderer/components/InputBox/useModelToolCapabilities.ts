import { getModel } from '@shared/providers'
import type { SessionSettings } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createModelDependencies } from '@/adapters'
import { getRegistry, useModelRegistryVersion } from '@/packages/model-registry'
import platform from '@/platform'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'

interface SelectedModel {
  provider: string
  modelId: string
}

interface ModelToolCapabilities {
  agentMode: boolean
  readFile: boolean
}

export function useModelToolCapabilities(
  model: SelectedModel | undefined,
  currentSessionMergedSettings: SessionSettings
) {
  const modelRegistryVersion = useModelRegistryVersion()
  const configuredModel = useSettingsStore((state) =>
    model
      ? state.providers?.[model.provider]?.models?.find((candidate) => candidate.modelId === model.modelId)
      : undefined
  )
  const query = useQuery<ModelToolCapabilities>({
    queryKey: ['model-tool-capability', model?.provider, model?.modelId, configuredModel, modelRegistryVersion],
    queryFn: async () => {
      if (!model?.provider || !model.modelId) {
        return { agentMode: false, readFile: false }
      }

      // Hydrate the runtime registry before resolving capabilities. Without this,
      // a cold start can cache a false negative from an older bundled snapshot.
      await getRegistry()

      const globalSettings = settingsStore.getState().getSettings()
      const configs = await platform.getConfig()
      const dependencies = await createModelDependencies()
      const settings = {
        ...currentSessionMergedSettings,
        provider: model.provider,
        modelId: model.modelId,
      }
      const modelInstance = getModel(settings, globalSettings, configs, dependencies)

      return {
        agentMode: modelInstance.isSupportToolUse('agent'),
        readFile: modelInstance.isSupportToolUse('read-file'),
      }
    },
    enabled: Boolean(model?.provider && model?.modelId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  return {
    // Loading or a transient dependency failure is not evidence that the model
    // is unsupported. Generation performs the same capability gate again.
    modelSupportsAgentMode: model ? (query.isSuccess ? query.data.agentMode : true) : true,
    modelSupportToolUseForFile: query.isSuccess ? query.data.readFile : false,
    isModelToolCapabilityFetched: query.isSuccess,
  }
}
