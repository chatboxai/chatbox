import { getModel } from '@shared/providers'
import type { SessionSettings } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { getRegistry } from '@/packages/model-registry'
import platform from '@/platform'
import { createSandboxProvider } from '@/sandbox'
import { resolveContextSandbox } from '@/sandbox/context'
import { settingsService } from '@/settings-runtime'
import * as settingActions from '@/stores/settingActions'

export async function resolveTokenSandboxMode(enabled: boolean, supportsAgent: boolean, settings: SessionSettings) {
  const result = await resolveContextSandbox({
    enabled,
    model: { isSupportToolUse: () => supportsAgent },
    settings,
    createProvider: createSandboxProvider,
    isPro: settingActions.isPro,
  })
  return result.canExecuteCode
}

export async function resolveTokenEstimationPolicy(settings: SessionSettings, workMode: boolean) {
  await getRegistry()
  const model = getModel(
    settings,
    settingsService.getSettings(),
    await platform.getConfig(),
    await createModelDependencies()
  )
  return {
    modelSupportToolUseForFile: model.isSupportToolUse('read-file'),
    sandboxMode: await resolveTokenSandboxMode(workMode, model.isSupportToolUse('agent'), settings),
  }
}
