import type { SettingsRepositoryPort } from '@chatbox/core/ports'
import { type OAuthCredentials, OAuthIpcChannels, toOAuthSettingsProviderId } from '@shared/oauth'
import type { OAuthAdapter } from '@shared/types/adapters'

export interface OAuthIpcInvoker {
  invoke(channel: string, providerId: string, credentialJson: string): Promise<string>
}

export type OAuthIpcResolver = () => OAuthIpcInvoker

/**
 * Desktop OAuth bridge. Credential persistence goes through SettingsService so
 * model dependencies do not reach into the Renderer Zustand singleton.
 */
export class RendererOAuthAdapter implements OAuthAdapter {
  constructor(
    private readonly settingsRepository: SettingsRepositoryPort,
    private readonly resolveIpc: OAuthIpcResolver
  ) {}

  async refreshCredential(providerId: string, credential: OAuthCredentials): Promise<OAuthCredentials> {
    const resultJson = await this.resolveIpc().invoke(OAuthIpcChannels.REFRESH, providerId, JSON.stringify(credential))
    const result = JSON.parse(resultJson) as {
      success: boolean
      credentials?: OAuthCredentials
      error?: string
    }
    if (!result.success || !result.credentials) {
      throw new Error(result.error || `Failed to refresh OAuth credential for ${providerId}`)
    }
    return result.credentials
  }

  persistCredential(providerId: string, credential: OAuthCredentials): void {
    const settingsProviderId = toOAuthSettingsProviderId(providerId) || providerId
    this.settingsRepository.updateSettings((settings) => ({
      providers: {
        ...(settings.providers || {}),
        [settingsProviderId]: {
          ...(settings.providers?.[settingsProviderId] || {}),
          oauth: credential,
        },
      },
    }))
  }

  clearCredential(providerId: string): void {
    const settingsProviderId = toOAuthSettingsProviderId(providerId) || providerId
    this.settingsRepository.updateSettings((settings) => ({
      providers: {
        ...(settings.providers || {}),
        [settingsProviderId]: {
          ...(settings.providers?.[settingsProviderId] || {}),
          oauth: undefined,
        },
      },
    }))
  }
}
