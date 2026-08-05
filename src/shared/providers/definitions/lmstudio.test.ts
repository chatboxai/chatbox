import { describe, expect, it } from 'vitest'
import type { ModelDependencies } from '../../types/adapters'
import type { CreateModelConfig } from '../types'
import { lmStudioProvider } from './lmstudio'

type LMStudioModel = {
  options: {
    useProxy?: boolean
  }
}

function createModel(platformType: ModelDependencies['platformType'], useProxy?: boolean): LMStudioModel {
  return lmStudioProvider.createModel({
    settings: { provider: 'lm-studio', modelId: 'local-model' },
    dependencies: { platformType } as ModelDependencies,
    providerSetting: { useProxy },
    formattedApiHost: 'http://192.168.1.10:1234',
    model: { modelId: 'local-model' },
  } as CreateModelConfig) as unknown as LMStudioModel
}

describe('LM Studio provider', () => {
  it('uses the native request transport on mobile', () => {
    expect(createModel('mobile').options.useProxy).toBe(true)
  })

  it('preserves the compatibility setting on desktop', () => {
    expect(createModel('desktop', true).options.useProxy).toBe(true)
    expect(createModel('desktop').options.useProxy).toBeUndefined()
  })
})
