// No-op OAuth providers hook for open-source edition

export function useOAuthProviders() {
  return {
    oauthProviders: [] as never[],
    isLoading: false,
  }
}
