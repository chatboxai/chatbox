import { hasDistinctModelAndProviderLogos } from '@shared/utils/model-logo-resolver'
import { getModelLogoConfig } from '@/utils/modelLogo'
import { ModelIcon } from './ModelIcon'
import ProviderImageIcon from './ProviderImageIcon'

export function ModelProviderIcon({ modelId, providerId, size = 20 }: {
  modelId: string
  providerId: string
  size?: number
}) {
  if (!getModelLogoConfig(modelId)) {
    return <ProviderImageIcon provider={providerId} size={size} />
  }

  return (
    <span className="relative mr-1 inline-flex shrink-0" style={{ width: size, height: size }}>
      <ModelIcon modelId={modelId} providerId={providerId} size={size} />
      {hasDistinctModelAndProviderLogos(modelId, providerId) && (
        <span
          className="absolute -bottom-0.5 -right-1 inline-flex rounded-full bg-chatbox-background-primary p-px"
          data-testid="model-provider-badge"
        >
          <ProviderImageIcon provider={providerId} size={Math.round(size / 2)} />
        </span>
      )}
    </span>
  )
}
