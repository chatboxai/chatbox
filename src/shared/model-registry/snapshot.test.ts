import { describe, expect, it } from 'vitest'
import { PROVIDER_ID_MAP } from './provider-mapping'
import { MODELS_DEV_SNAPSHOT } from './snapshot.generated'

describe('MODELS_DEV_SNAPSHOT', () => {
  it('only contains providers that the live registry refresh maps from models.dev', () => {
    const unmapped = Object.keys(MODELS_DEV_SNAPSHOT).filter((providerId) => !(providerId in PROVIDER_ID_MAP))
    expect(unmapped).toEqual([])
  })
})
