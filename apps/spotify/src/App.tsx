import { useEffect, useRef, useState } from 'react'

interface SpotifyTrack {
  id: string
  name: string
  artist: string
  album: string
  uri: string
  previewUrl: string | null
  imageUrl: string | null
}

interface CreatedPlaylist {
  id: string
  url: string
  name: string
  tracks: SpotifyTrack[]
}

type ConnectionStatus = 'checking' | 'connected' | 'disconnected' | 'unconfigured'

const TOOL_SCHEMAS = [
  {
    name: 'search_tracks',
    description:
      'Search for music tracks on Spotify. Returns track names, artists, album, and preview info.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "jazz piano", "Miles Davis"' },
        limit: { type: 'number', description: 'Max results (default 5, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_playlist',
    description:
      'Create a Spotify playlist and populate it with tracks. Requires Spotify to be connected.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Playlist name' },
        description: { type: 'string', description: 'Optional playlist description' },
        trackQueries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of search queries, one per track (e.g. ["Take Five Dave Brubeck", "Fly Me To The Moon Frank Sinatra"]). Must be an array, not a comma-separated string.',
        },
      },
      required: ['name', 'trackQueries'],
    },
  },
]

// Get token from URL query param (passed by ChatBridgeFrame for auth-required apps)
function getTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('token')
}

function makeAuthHeaders(token: string | null): HeadersInit {
  if (!token) return {}
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('checking')
  const [tracks, setTracks] = useState<SpotifyTrack[]>([])
  const [playlists, setPlaylists] = useState<CreatedPlaylist[]>([])
  const [statusMsg, setStatusMsg] = useState<string>('')
  const [isWorking, setIsWorking] = useState(false)

  const tokenRef = useRef<string | null>(getTokenFromUrl())

  // Check connection status on mount
  useEffect(() => {
    const token = tokenRef.current

    async function checkStatus() {
      try {
        const res = await fetch('/api/internal/spotify/status', {
          headers: makeAuthHeaders(token),
        })
        if (!res.ok) {
          setConnectionStatus('disconnected')
          return
        }
        const data = (await res.json()) as { connected: boolean; configured: boolean }
        if (!data.configured) {
          setConnectionStatus('unconfigured')
        } else {
          setConnectionStatus(data.connected ? 'connected' : 'disconnected')
        }
      } catch {
        setConnectionStatus('disconnected')
      }
    }

    void checkStatus()
  }, [])

  // Register tools and send ready on mount
  useEffect(() => {
    window.parent.postMessage({ type: 'ready' }, '*')
    window.parent.postMessage({ type: 'register_tools', schemas: TOOL_SCHEMAS }, '*')
  }, [])

  // Handle messages from parent (tool_invoke and auth_ready)
  useEffect(() => {
    async function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data.type !== 'string') return

      const { type } = event.data as { type: string }

      // auth_ready: OAuth just completed — re-check connection
      if (type === 'auth_ready' && event.data.provider === 'spotify') {
        setConnectionStatus('checking')
        try {
          const token = tokenRef.current
          const res = await fetch('/api/internal/spotify/status', {
            headers: makeAuthHeaders(token),
          })
          if (res.ok) {
            const data = (await res.json()) as { connected: boolean; configured: boolean }
            setConnectionStatus(data.connected ? 'connected' : 'disconnected')
            if (data.connected) {
              setStatusMsg('Spotify connected! You can now search tracks and create playlists.')
            }
          }
        } catch {
          setConnectionStatus('disconnected')
        }
        return
      }

      if (type !== 'tool_invoke') return

      const { toolCallId, toolName, params } = event.data as {
        toolCallId: string
        toolName: string
        params: Record<string, unknown>
      }

      if (connectionStatus !== 'connected') {
        window.parent.postMessage(
          {
            type: 'tool_result',
            toolCallId,
            result: {
              error: 'Spotify not connected. Ask the user to click "Connect Spotify" first.',
            },
          },
          '*'
        )
        return
      }

      setIsWorking(true)
      setStatusMsg('')

      try {
        if (toolName === 'search_tracks') {
          await handleSearchTracks(toolCallId, params)
        } else if (toolName === 'create_playlist') {
          await handleCreatePlaylist(toolCallId, params)
        } else {
          window.parent.postMessage(
            { type: 'tool_result', toolCallId, result: { error: `Unknown tool: ${toolName}` } },
            '*'
          )
        }
      } finally {
        setIsWorking(false)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [connectionStatus])

  async function handleSearchTracks(
    toolCallId: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const query = params.query as string
    const limit = typeof params.limit === 'number' ? params.limit : 5

    if (!query) {
      window.parent.postMessage(
        { type: 'tool_result', toolCallId, result: { error: 'query parameter is required' } },
        '*'
      )
      return
    }

    try {
      const token = tokenRef.current
      const res = await fetch('/api/internal/spotify/search', {
        method: 'POST',
        headers: makeAuthHeaders(token),
        body: JSON.stringify({ query, limit }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (body.error === 'auth_required') {
          setConnectionStatus('disconnected')
          window.parent.postMessage(
            { type: 'tool_result', toolCallId, result: { error: 'Spotify authentication expired. Please reconnect.' } },
            '*'
          )
          return
        }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const data = (await res.json()) as { tracks: SpotifyTrack[] }
      setTracks(data.tracks)

      window.parent.postMessage(
        {
          type: 'tool_result',
          toolCallId,
          result: {
            tracks: data.tracks.map((t) => ({
              name: t.name,
              artist: t.artist,
              album: t.album,
              uri: t.uri,
            })),
            count: data.tracks.length,
          },
        },
        '*'
      )

      window.parent.postMessage(
        {
          type: 'state_update',
          state: { lastSearch: query, trackCount: data.tracks.length },
        },
        '*'
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to search tracks'
      setStatusMsg(`Search failed: ${msg}`)
      window.parent.postMessage(
        { type: 'tool_result', toolCallId, result: { error: msg } },
        '*'
      )
    }
  }

  async function handleCreatePlaylist(
    toolCallId: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const name = params.name as string
    const description = (params.description as string | undefined) ?? ''
    // LLMs sometimes send a comma-separated string instead of an array
    const rawQueries = params.trackQueries
    const trackQueries: string[] = typeof rawQueries === 'string'
      ? rawQueries.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      : Array.isArray(rawQueries)
        ? rawQueries as string[]
        : []

    if (!name || !trackQueries.length) {
      window.parent.postMessage(
        { type: 'tool_result', toolCallId, result: { error: 'name and trackQueries are required' } },
        '*'
      )
      return
    }

    try {
      const token = tokenRef.current
      const res = await fetch('/api/internal/spotify/create-playlist', {
        method: 'POST',
        headers: makeAuthHeaders(token),
        body: JSON.stringify({ name, description, trackQueries }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        if (body.error === 'auth_required') {
          setConnectionStatus('disconnected')
          window.parent.postMessage(
            { type: 'tool_result', toolCallId, result: { error: 'Spotify authentication expired. Please reconnect.' } },
            '*'
          )
          return
        }
        if (body.error === 'permission_denied') {
          window.parent.postMessage(
            { type: 'tool_result', toolCallId, result: { error: 'Spotify returned 403 Forbidden. The user may need to be added as a tester in the Spotify Developer Dashboard for this app to create playlists.' } },
            '*'
          )
          return
        }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const data = (await res.json()) as {
        playlist: { id: string; url: string; name: string }
        tracksAdded: number
        tracks: SpotifyTrack[]
      }

      setPlaylists((prev) => [
        { id: data.playlist.id, url: data.playlist.url, name: data.playlist.name, tracks: data.tracks },
        ...prev,
      ])
      setTracks(data.tracks)

      window.parent.postMessage(
        {
          type: 'tool_result',
          toolCallId,
          result: {
            playlistName: data.playlist.name,
            playlistUrl: data.playlist.url,
            tracksAdded: data.tracksAdded,
            tracks: data.tracks.map((t) => ({ name: t.name, artist: t.artist })),
          },
        },
        '*'
      )

      window.parent.postMessage(
        {
          type: 'state_update',
          state: { lastPlaylist: data.playlist.name, tracksAdded: data.tracksAdded },
        },
        '*'
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create playlist'
      setStatusMsg(`Playlist creation failed: ${msg}`)
      window.parent.postMessage(
        { type: 'tool_result', toolCallId, result: { error: msg } },
        '*'
      )
    }
  }

  function handleConnectClick() {
    window.parent.postMessage({ type: 'oauth_request', provider: 'spotify' }, '*')
  }

  const cardStyle: React.CSSProperties = {
    background: '#282828',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '8px',
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: '#121212',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        padding: '16px',
        gap: '12px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '24px' }}>🎵</span>
        <span style={{ fontSize: '18px', fontWeight: 600, color: '#1db954' }}>Spotify</span>
        {isWorking && (
          <span style={{ fontSize: '12px', color: '#b3b3b3', marginLeft: 'auto' }}>Working...</span>
        )}
      </div>

      {/* Connection status */}
      {connectionStatus === 'checking' && (
        <div style={{ color: '#b3b3b3', fontSize: '13px' }}>Checking Spotify connection...</div>
      )}

      {connectionStatus === 'unconfigured' && (
        <div style={{ ...cardStyle, border: '1px solid #ff4444', textAlign: 'center' }}>
          <div style={{ fontSize: '20px', marginBottom: '8px' }}>⚠️</div>
          <div style={{ color: '#ff6b6b', fontWeight: 600, marginBottom: '6px' }}>
            Spotify Not Configured
          </div>
          <div style={{ color: '#b3b3b3', fontSize: '12px' }}>
            Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to server/.env to enable Spotify
            integration.
          </div>
        </div>
      )}

      {connectionStatus === 'disconnected' && (
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔗</div>
          <div style={{ color: '#fff', fontWeight: 600, marginBottom: '6px' }}>
            Connect Spotify
          </div>
          <div style={{ color: '#b3b3b3', fontSize: '12px', marginBottom: '14px' }}>
            Connect your Spotify account to search tracks and create playlists.
          </div>
          <button
            type="button"
            onClick={handleConnectClick}
            style={{
              background: '#1db954',
              color: '#000',
              border: 'none',
              borderRadius: '20px',
              padding: '10px 28px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.5px',
            }}
          >
            Connect Spotify
          </button>
        </div>
      )}

      {connectionStatus === 'connected' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: '#1db954',
          }}
        >
          <span>●</span>
          <span>Connected to Spotify</span>
        </div>
      )}

      {/* Status message */}
      {statusMsg && (
        <div style={{ color: '#b3b3b3', fontSize: '12px', fontStyle: 'italic' }}>{statusMsg}</div>
      )}

      {/* Created playlists */}
      {playlists.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '11px',
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '8px',
            }}
          >
            Created Playlists
          </div>
          {playlists.map((pl) => (
            <div key={pl.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{pl.name}</div>
                <a
                  href={pl.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    background: '#1db954',
                    color: '#000',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  Open ↗
                </a>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {pl.tracks.slice(0, 5).map((t) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {t.imageUrl && (
                      <img
                        src={t.imageUrl}
                        alt={t.album}
                        style={{ width: '28px', height: '28px', borderRadius: '3px', objectFit: 'cover' }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#b3b3b3' }}>{t.artist}</div>
                    </div>
                  </div>
                ))}
                {pl.tracks.length > 5 && (
                  <div style={{ fontSize: '11px', color: '#888' }}>+{pl.tracks.length - 5} more</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Track search results */}
      {tracks.length > 0 && playlists.length === 0 && (
        <div>
          <div
            style={{
              fontSize: '11px',
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '8px',
            }}
          >
            Search Results
          </div>
          {tracks.map((track) => (
            <div
              key={track.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px',
                borderRadius: '6px',
                marginBottom: '4px',
                background: '#1e1e1e',
              }}
            >
              {track.imageUrl ? (
                <img
                  src={track.imageUrl}
                  alt={track.album}
                  style={{ width: '36px', height: '36px', borderRadius: '4px', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '4px',
                    background: '#333',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                  }}
                >
                  🎵
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {track.name}
                </div>
                <div style={{ fontSize: '11px', color: '#b3b3b3' }}>
                  {track.artist} · {track.album}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Idle state */}
      {connectionStatus === 'connected' && tracks.length === 0 && playlists.length === 0 && !isWorking && (
        <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
          Ask me to search for tracks or create a playlist!
        </div>
      )}
    </div>
  )
}
