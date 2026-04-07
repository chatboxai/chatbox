import type { PluginManifest } from '../../../shared/types/chatbridge'
import { chatBridgeStore } from '../../stores/chatBridgeStore'
import { API_BASE, useAuthStore } from '../../stores/authStore'
import { ChatBridgeWsClient } from './ws-client'

const HARDCODED_FALLBACK_APPS: PluginManifest[] = [
  {
    id: 'test-app',
    name: 'Test App',
    url: '/apps/test-app',
    description: 'Protocol compliance test fixture',
    tools: [
      {
        name: 'dummy_action',
        description: 'A test tool that always succeeds',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Optional message' },
          },
        },
      },
    ],
    status: 'approved',
    authRequired: false,
  },
  {
    id: 'chess',
    name: 'Chess',
    url: '/apps/chess',
    description:
      'Interactive chess game with AI analysis. Play chess against yourself or get move suggestions from Claude.',
    tools: [
      {
        name: 'start_game',
        description: 'Start a new chess game',
        parameters: {
          type: 'object',
          properties: {
            color: { type: 'string', enum: ['white', 'black'] },
          },
        },
      },
      {
        name: 'make_move',
        description: 'Make a chess move',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            promotion: { type: 'string', enum: ['q', 'r', 'b', 'n'] },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'get_board_state',
        description: 'Get the current board position and game status',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ],
    status: 'approved',
    authRequired: false,
  },
  {
    id: 'weather',
    name: 'Weather',
    url: '/apps/weather',
    description:
      'Weather dashboard. Ask about current conditions or forecasts for any city. Weather data is fetched server-side.',
    tools: [
      {
        name: 'get_current_weather',
        description: 'Get the current weather conditions for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name, e.g. "Tokyo"' },
          },
          required: ['location'],
        },
      },
      {
        name: 'get_forecast',
        description: 'Get a multi-day weather forecast for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
            days: { type: 'number', description: 'Number of forecast days (default 4)' },
          },
          required: ['location'],
        },
      },
    ],
    status: 'approved',
    authRequired: false,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    url: '/apps/spotify',
    description: 'Spotify playlist creator. Search for tracks and create playlists using natural language. Requires Spotify OAuth.',
    tools: [
      {
        name: 'search_tracks',
        description: 'Search for music tracks on Spotify',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query, e.g. "jazz piano"' },
            limit: { type: 'number', description: 'Max results (default 5)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'create_playlist',
        description: 'Create a Spotify playlist and add tracks to it',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Playlist name' },
            description: { type: 'string', description: 'Optional description' },
            trackQueries: {
              type: 'array',
              items: { type: 'string' },
              description: 'Search queries for tracks to add',
            },
          },
          required: ['name', 'trackQueries'],
        },
      },
    ],
    status: 'approved',
    authRequired: true,
    authProvider: 'spotify',
  },
]

export const chatBridgeController = {
  async loadRegistry(): Promise<void> {
    try {
      const token = useAuthStore.getState().token
      const res = await fetch(`${API_BASE}/api/apps`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.status === 401) {
        useAuthStore.getState().logout()
        throw new Error('/api/apps returned 401')
      }
      if (!res.ok) throw new Error(`/api/apps returned ${res.status}`)
      const data = (await res.json()) as unknown
      // Server returns { apps: [...] } or a raw array
      const apps: PluginManifest[] = Array.isArray(data)
        ? (data as PluginManifest[])
        : ((data as { apps?: PluginManifest[] }).apps ?? [])
      chatBridgeStore.getState().setRegistry(apps.length > 0 ? apps : HARDCODED_FALLBACK_APPS)
      console.log(`[ChatBridge] registry loaded: ${apps.length} app(s)`)
    } catch (err) {
      console.warn('[ChatBridge] /api/apps unavailable, using fallback registry', err)
      chatBridgeStore.getState().setRegistry(HARDCODED_FALLBACK_APPS)
    }
  },

  async activate(sessionId: string, app: PluginManifest): Promise<void> {
    const store = chatBridgeStore.getState()
    // No-op if already the active app
    if (store.getActiveApp(sessionId) === app.name) return

    store.activateSession(sessionId)
    // activateApp handles suspending the previous app and restoring/creating the new one
    store.activateApp(sessionId, app.name)

    let wsClient = store.getWsClient()
    if (!wsClient) {
      const token = useAuthStore.getState().token ?? ''

      wsClient = new ChatBridgeWsClient(token)
      store.setWsClient(wsClient)
    }

    try {
      await wsClient.connect()
      console.log(`[ChatBridge] activated app "${app.name}" for session ${sessionId}`)
    } catch (err) {
      console.error('[ChatBridge] WS connect failed during activate — chat will still work but WS routing is unavailable', err)
    }
  },

  suspend(sessionId: string, appName: string): void {
    chatBridgeStore.getState().suspendApp(sessionId, appName)
  },

  deactivate(sessionId: string, appName: string): void {
    chatBridgeStore.getState().deactivateApp(sessionId, appName)
    const session = chatBridgeStore.getState().sessions[sessionId]
    if (!session || Object.keys(session.apps).length === 0) {
      chatBridgeStore.getState().getWsClient()?.disconnect()
    }
  },
}
