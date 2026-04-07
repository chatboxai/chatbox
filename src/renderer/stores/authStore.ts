import { create } from 'zustand'

export const API_BASE = (() => {
  // In production, frontend and backend are served from the same origin
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return window.location.origin
  }
  const wsUrl = (import.meta.env.VITE_CHATBRIDGE_WS_URL as string | undefined) ?? 'ws://localhost:3000/ws'
  try {
    const url = new URL(wsUrl)
    return `${url.protocol === 'wss:' ? 'https' : 'http'}://${url.host}`
  } catch {
    return 'http://localhost:3000'
  }
})()

const JWT_KEY = 'chatbridge_jwt'

interface AuthUser {
  id: string
  email: string
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  loginDemo: () => Promise<void>
  refresh: () => Promise<boolean>
  logout: () => void
  initialize: () => Promise<void>
}

async function postAuth(
  path: string,
  body: Record<string, string>,
  token?: string | null
): Promise<{ token: string; user: AuthUser }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({ error: 'Request failed' }))) as { error?: string }
    throw new Error(errData.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<{ token: string; user: AuthUser }>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true, // Start loading to avoid flash of login page on app start
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const { token, user } = await postAuth('/api/auth/login', { email, password })
      localStorage.setItem(JWT_KEY, token)
      set({ token, user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      set({ isLoading: false, error: (err as Error).message })
      throw err
    }
  },

  register: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const { token, user } = await postAuth('/api/auth/register', { email, password })
      localStorage.setItem(JWT_KEY, token)
      set({ token, user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      set({ isLoading: false, error: (err as Error).message })
      throw err
    }
  },

  loginDemo: async () => {
    set({ isLoading: true, error: null })
    try {
      const { token, user } = await postAuth('/api/auth/demo', {})
      localStorage.setItem(JWT_KEY, token)
      set({ token, user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      set({ isLoading: false, error: (err as Error).message })
      throw err
    }
  },

  refresh: async () => {
    const { token } = get()
    if (!token) return false
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        get().logout()
        return false
      }
      const data = (await res.json()) as { token: string; user?: AuthUser }
      localStorage.setItem(JWT_KEY, data.token)
      set((state) => ({ token: data.token, user: data.user ?? state.user, isAuthenticated: true }))
      return true
    } catch {
      get().logout()
      return false
    }
  },

  logout: () => {
    localStorage.removeItem(JWT_KEY)
    set({ token: null, user: null, isAuthenticated: false, error: null })
  },

  initialize: async () => {
    const stored = localStorage.getItem(JWT_KEY)
    if (!stored) {
      set({ isLoading: false })
      return
    }
    set({ token: stored })
    const ok = await get().refresh()
    if (!ok) {
      localStorage.removeItem(JWT_KEY)
    }
    set({ isLoading: false })
  },
}))

export const authStore = useAuthStore
