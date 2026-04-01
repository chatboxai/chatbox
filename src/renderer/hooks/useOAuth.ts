// No-op OAuth hook for open-source edition

export function useOAuth(_providerId: string | undefined) {
  return {
    isOAuthActive: false,
    isOAuthExpired: false,
    login: async () => {},
    logout: async () => {},
    refresh: async () => {},
    isLoading: false,
    error: null,
  }
}
