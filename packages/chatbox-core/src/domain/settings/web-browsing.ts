import { ModelProviderEnum } from '../../types/provider'

export function resolveWebBrowsing(explicit: boolean | undefined, provider: string | undefined): boolean {
  return explicit ?? provider === ModelProviderEnum.ChatboxAI
}
